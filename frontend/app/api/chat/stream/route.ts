import { io, type Socket } from "socket.io-client";
import { CHAT_SOCKET_URL } from "@/lib/config";
import { getSessionToken } from "@/lib/api/session";
import type {
  InterviewChatClosedReason,
  InterviewMessage,
} from "@/lib/types";

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

interface JoinAck {
  joined?: boolean;
  error?: string;
}

interface ClosedPayload {
  conversationId: string;
  reason: InterviewChatClosedReason;
}

export async function GET(request: Request): Promise<Response> {
  const token = await getSessionToken();
  if (!token) return new Response("Unauthorized", { status: 401 });

  const url = new URL(request.url);
  const conversationIds = Array.from(
    new Set(
      url.searchParams
        .getAll("conversationId")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  );

  if (conversationIds.length === 0) {
    return new Response("conversationId is required", { status: 400 });
  }

  const encoder = new TextEncoder();
  let socket: Socket | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // The browser disconnected between the check and enqueue.
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        for (const conversationId of conversationIds) {
          socket?.emit("conversation.leave", { conversationId });
        }
        socket?.disconnect();
        socket = null;
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      socket = io(CHAT_SOCKET_URL, {
        auth: { token },
        transports: ["websocket"],
        reconnection: true,
        reconnectionAttempts: 5,
      });

      socket.on("connect", () => {
        send("ready", { connected: true });
        for (const conversationId of conversationIds) {
          socket?.emit(
            "conversation.join",
            { conversationId },
            (ack: JoinAck | undefined) => {
              if (ack?.joined) {
                send("joined", { conversationId });
                return;
              }
              send("join-error", {
                conversationId,
                error: ack?.error ?? "NOT_FOUND",
              });
            },
          );
        }
      });

      socket.on("message.new", (message: InterviewMessage) =>
        send("message", message),
      );

      socket.on("conversation.closed", (event: ClosedPayload) =>
        send("closed", event),
      );

      socket.on("disconnect", () => send("disconnected", { connected: false }));
      socket.on("connect_error", () =>
        send("disconnected", { connected: false }),
      );

      heartbeat = setInterval(() => send("ping", { at: Date.now() }), HEARTBEAT_MS);
      request.signal.addEventListener("abort", cleanup);
    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      for (const conversationId of conversationIds) {
        socket?.emit("conversation.leave", { conversationId });
      }
      socket?.disconnect();
      socket = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
