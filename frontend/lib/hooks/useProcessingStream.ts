"use client";

import { useEffect, useEffectEvent, useState } from "react";
import type { ProcessingProgressEvent } from "@/lib/api/contracts";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "offline";

interface Options {
  /** Called for every progress/completed/failed event from the backend. */
  onEvent: (event: ProcessingProgressEvent) => void;
  /**
   * Called after the stream reconnects. Events emitted while disconnected are
   * lost, so the caller re-reads current state over HTTP rather than leaving
   * stale — or worse, invented — progress on screen.
   */
  onResync?: () => void;
  enabled?: boolean;
}

/**
 * Subscribes to backend processing events.
 *
 * The browser connects to this app's own SSE route, which holds the socket.io
 * connection to the NestJS gateway server-side so the JWT never reaches client
 * JavaScript. Exactly one EventSource is opened per mount and closed on
 * unmount, so remounting cannot leave duplicate subscriptions behind.
 */
export function useProcessingStream({
  onEvent,
  onResync,
  enabled = true,
}: Options): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("connecting");

  // useEffectEvent keeps these callbacks out of the effect's dependencies, so a
  // caller passing an inline function does not tear down and reopen the stream
  // on every render.
  const handleEvent = useEffectEvent((event: ProcessingProgressEvent) => {
    onEvent(event);
  });
  const handleResync = useEffectEvent(() => {
    onResync?.();
  });

  useEffect(() => {
    if (!enabled) return;

    const source = new EventSource("/api/processing/stream");
    let hasConnected = false;

    const handle = (event: MessageEvent<string>) => {
      try {
        handleEvent(JSON.parse(event.data) as ProcessingProgressEvent);
      } catch {
        // A malformed frame is dropped rather than crashing the subscriber.
      }
    };

    source.addEventListener("progress", handle as EventListener);
    source.addEventListener("completed", handle as EventListener);
    source.addEventListener("failed", handle as EventListener);

    source.addEventListener("ready", () => {
      setStatus("live");
      // On the first connect the page already rendered fresh server data.
      if (hasConnected) handleResync();
      hasConnected = true;
    });

    source.addEventListener("disconnected", () => setStatus("reconnecting"));

    source.onerror = () => {
      // EventSource retries on its own; reflect that rather than giving up.
      setStatus(hasConnected ? "reconnecting" : "connecting");
    };

    return () => source.close();
  }, [enabled]);

  // Derived rather than stored, so disabling never needs a state write.
  return enabled ? status : "offline";
}
