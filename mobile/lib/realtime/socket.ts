import { useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { io, type Socket } from "socket.io-client";
import { CHAT_SOCKET_URL } from "@/constants/config";
import { currentAccessToken, onAccessTokenChange } from "@/lib/api/client";

/**
 * The realtime connection to the existing chat gateway.
 *
 * ## It joins an existing contract; it does not add one
 *
 * Same namespace, same JWT handshake, same `conversation.join` /
 * `message.new` / `notification:new` events the web client uses. No new
 * server, no new event, no polling fallback pretending to be realtime.
 *
 * ## The handshake authenticates; it does not authorize
 *
 * The token identifies the user and nothing more. Every join and every send
 * is re-authorized against the database by the gateway, so a socket that
 * survives a revoked membership still cannot read the room. That means this
 * file never has to reason about permissions — it reconnects and rejoins, and
 * the server decides what that is worth.
 *
 * ## A rotated token means a new connection
 *
 * The handshake carries the access token that existed at connect time. When
 * the client rotates it, the socket is still authenticated on a credential
 * the server has invalidated — it survives until the next reconnect and then
 * silently fails to authenticate, which looks like "realtime randomly stops
 * working an hour in". So a token change re-arms `auth` and reconnects.
 *
 * ## Background, foreground, and the gap between them
 *
 * iOS suspends sockets when an app backgrounds; Android may too. Reconnecting
 * on foreground is therefore normal operation, not error recovery — and
 * because messages missed while suspended are fetched by refetching the list
 * rather than replayed over the socket, a reconnect cannot leave a hole in
 * the transcript.
 */
export type ConnectionState = "connecting" | "connected" | "offline";

interface ChatSocketOptions {
  conversationId: string | null;
  onMessage: (message: unknown) => void;
  onNotification?: (notification: unknown) => void;
  /** Called after a reconnect, so the caller can refetch what it missed. */
  onResync?: () => void;
  enabled?: boolean;
}

export function useChatSocket({
  conversationId,
  onMessage,
  onNotification,
  onResync,
  enabled = true,
}: ChatSocketOptions): ConnectionState {
  const [state, setState] = useState<ConnectionState>("connecting");
  const socketRef = useRef<Socket | null>(null);

  /*
   * Handlers live in a ref so a parent re-render does not tear the socket
   * down and build a new one. Without it, every keystroke in the composer
   * would reconnect — worse on a flaky connection than having no realtime.
   *
   * The ref is written in an effect with no dependency list, so it refreshes
   * after every render without being touched DURING one.
   */
  const handlers = useRef({ onMessage, onNotification, onResync });
  useEffect(() => {
    handlers.current = { onMessage, onNotification, onResync };
  });

  /*
   * A conversation this hook was not given is not a connection failure, so
   * it is derived rather than stored — writing "offline" into state from an
   * effect would be a second source of truth for something already known.
   */
  const inactive = !enabled || !conversationId;

  useEffect(() => {
    if (inactive) return;

    /*
     * No token means the handshake will be rejected, and the rejection
     * arrives as `connect_error` — the same path as any other refusal. There
     * is deliberately no local short circuit: one way to reach "offline"
     * beats two that can disagree.
     */
    const token = currentAccessToken();

    const socket = io(CHAT_SOCKET_URL, {
      auth: { token },
      transports: ["websocket"],
      // React Native has no long-polling fallback worth having, and letting
      // socket.io try one just delays the failure by a few seconds.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });
    socketRef.current = socket;

    let hadConnected = false;

    function join() {
      socket.emit("conversation.join", { conversationId });
    }

    socket.on("connect", () => {
      setState("connected");
      join();
      // A RE-connect means time passed with the socket down, so whatever
      // arrived in that window has to come from the REST list, not from here.
      if (hadConnected) handlers.current.onResync?.();
      hadConnected = true;
    });

    socket.on("disconnect", () => setState("connecting"));
    socket.on("connect_error", () => setState("offline"));
    socket.on("message.new", (message: unknown) =>
      handlers.current.onMessage(message),
    );
    socket.on("notification:new", (notification: unknown) =>
      handlers.current.onNotification?.(notification),
    );

    /*
     * Foreground: reconnect if the OS killed the socket while suspended.
     * `socket.connected` is checked rather than assumed, because a short
     * background trip often leaves it perfectly alive.
     */
    function onAppState(status: AppStateStatus) {
      if (status === "active" && !socket.connected) socket.connect();
    }
    const subscription = AppState.addEventListener("change", onAppState);

    /*
     * A refresh rotated the token, or a sign-out cleared it. `socket.auth` is
     * read at each handshake, so updating it and cycling the connection is
     * what carries the new credential; with no token there is nothing to
     * reconnect as, so the socket just goes down.
     */
    const unsubscribeToken = onAccessTokenChange((next) => {
      if (!next) {
        socket.disconnect();
        return;
      }
      socket.auth = { token: next };
      socket.disconnect().connect();
    });

    return () => {
      unsubscribeToken();
      subscription.remove();
      socket.emit("conversation.leave", { conversationId });
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [conversationId, inactive]);

  return inactive ? "offline" : state;
}
