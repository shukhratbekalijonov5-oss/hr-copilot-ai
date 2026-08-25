import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import { usePagedQuery } from "@/lib/query/pagination";
import type { NotificationItem } from "@/types";

/**
 * Notifications, straight off the existing BFF routes.
 *
 * The contract is the web client's: `GET /notifications`, an unread count,
 * `PATCH /:id/read` and `POST /read-all`. Nothing new was added for mobile.
 */
export function useNotifications() {
  return usePagedQuery<NotificationItem>(
    queryKeys.notifications.list(0),
    "/notifications",
  );
}

export function useUnreadCount() {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount,
    queryFn: async () => {
      const response = await apiFetch<{
        unread?: number;
        unreadCount?: number;
        count?: number;
      }>("/notifications/unread-count");
      return response.unread ?? response.unreadCount ?? response.count ?? 0;
    },
    // The badge is glanceable, so it may lag slightly rather than refetching
    // on every screen mount over a cellular link.
    staleTime: 60_000,
  });
}

export function useMarkRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<NotificationItem>(`/notifications/${id}/read`, { method: "PATCH" }),
    // The list and the badge both change, and both are the server's to state.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}

export function useMarkAllRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiFetch<{ updated: number }>("/notifications/read-all", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });
}
