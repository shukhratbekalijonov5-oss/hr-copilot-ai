import { io, type Socket } from "socket.io-client";
import { PROCESSING_SOCKET_URL } from "@/lib/config";
import { getSessionToken } from "@/lib/api/session";
import type { ProcessingProgressEvent } from "@/lib/api/contracts";

/**
 * Server-sent-events bridge to the backend's socket.io processing gateway.
 *
 * The gateway authenticates with the same JWT the REST API uses. Rather than
 * handing that token to browser JavaScript so it can open its own socket, this
 * route holds the socket.io connection server-side and forwards each event to
 * the browser as SSE. The token never leaves the server, and the client gets
 * EventSource's built-in reconnection for free.
 *
 * Event names and payload shape come from the gateway itself
 * (backend/src/processing/processing.gateway.ts): `processing.progress`,
 * `processing.completed`, `processing.failed`.
 */

export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;

export async function GET(request: Request): Promise<Response> {
  const token = await getSessionToken();
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
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
          // The client went away between the check and the write.
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        socket?.disconnect();
        socket = null;
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      };

      socket = io(PROCESSING_SOCKET_URL, {
        auth: { token },
        transports: ["websocket"],
        // EventSource reconnects the browser end; letting socket.io also retry
        // here keeps a transient backend restart from tearing down the stream.
        reconnection: true,
        reconnectionAttempts: 5,
      });

      socket.on("connect", () => send("ready", { connected: true }));

      socket.on("processing.progress", (event: ProcessingProgressEvent) =>
        send("progress", event),
      );
      socket.on("processing.completed", (event: ProcessingProgressEvent) =>
        send("completed", event),
      );
      socket.on("processing.failed", (event: ProcessingProgressEvent) =>
        send("failed", event),
      );

      socket.on("disconnect", () => send("disconnected", { connected: false }));
      socket.on("connect_error", () => {
        // Never forward the underlying reason: it can name internal hosts.
        send("disconnected", { connected: false });
      });

      // Keeps intermediaries from closing an idle connection.
      heartbeat = setInterval(() => send("ping", { at: Date.now() }), HEARTBEAT_MS);

      request.signal.addEventListener("abort", cleanup);
    },

    cancel() {
      if (heartbeat) clearInterval(heartbeat);
      socket?.disconnect();
      socket = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Prevents proxy buffering, which would defeat streaming entirely.
      "X-Accel-Buffering": "no",
    },
  });
}
