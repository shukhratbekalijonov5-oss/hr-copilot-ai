/**
 * Opens the header's notification dropdown from elsewhere.
 *
 * The web product has no notifications PAGE — the bell owns that surface —
 * so the mobile More sheet needs a way to reach it without inventing a route
 * or lifting the bell's state into a store. One event, the same pattern the
 * command palette trigger uses.
 */
export const OPEN_NOTIFICATIONS_EVENT = "hrc:notifications";

export function openNotifications(): void {
  window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
}
