"use client";

import { useCallback, type PointerEvent } from "react";

/**
 * Pointer position as two CSS custom properties, for `.spotlight`.
 *
 * ## Why it writes to the DOM instead of React state
 *
 * A pointer-move handler that calls `setState` re-renders the component on
 * every mouse pixel. Writing two custom properties straight onto the element
 * updates only the compositor, costs no React work at all, and cannot make a
 * card with expensive children janky.
 *
 * ## It is inert without a pointer
 *
 * A touch device never fires `pointermove` over a card, and the CSS defaults
 * centre the gradient — so nothing renders wrong, it simply never lights up.
 * Reduced motion disables the layer entirely, in CSS.
 */
export function useSpotlight() {
  return useCallback((event: PointerEvent<HTMLElement>) => {
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    target.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    target.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  }, []);
}
