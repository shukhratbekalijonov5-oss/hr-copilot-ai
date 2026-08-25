import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from "@tanstack/react-query";
import { apiFetch } from "@/lib/api/client";
import { queryKeys } from "@/lib/query/keys";
import { PAGE_SIZE } from "@/lib/query/pagination";
import type { ChatMessage, Conversation, Paginated } from "@/types";

/**
 * One conversation's messages.
 *
 * ## Two paths, one shape
 *
 * A candidate reads under `/candidate-account/me/conversations`, an
 * organization under `/conversations`. The two are separate contracts on the
 * backend precisely so neither side can address the other's scope, and this
 * file keeps that split rather than collapsing it into one "smart" URL.
 */
export function conversationBase(audience: "candidate" | "recruiter"): string {
  return audience === "candidate"
    ? "/candidate-account/me/conversations"
    : "/conversations";
}

/**
 * Which page holds the newest messages.
 *
 * The server orders `createdAt ASC`, so the LAST page is the current end of
 * the conversation. An empty conversation still has page 1 — there is no
 * "page 0" to open.
 */
export function lastMessagePage(total: number, pageSize = PAGE_SIZE): number {
  if (total <= 0 || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * The next page to load, which for a transcript means the OLDER one.
 *
 * Page 1 is the beginning of the conversation, so paging stops once it has
 * been loaded — this walks N, N-1, N-2 … 1 as the reader scrolls up.
 */
export function olderMessagePage(
  last: Paginated<unknown> | undefined,
): number | undefined {
  const page = last?.meta?.page ?? 1;
  return page > 1 ? page - 1 : undefined;
}

export function useConversation(
  audience: "candidate" | "recruiter",
  id: string | null,
) {
  return useQuery({
    queryKey: ["chat", "conversation", audience, id] as const,
    queryFn: () => apiFetch<Conversation>(`${conversationBase(audience)}/${id}`),
    enabled: Boolean(id),
  });
}

/**
 * The transcript, newest page first and older pages loaded backwards.
 *
 * ## The server orders messages OLDEST first
 *
 * `createdAt ASC`, so page 1 is the beginning of the conversation and the
 * LAST page holds what was just said. A chat that opened on page 1 would show
 * a months-old greeting as the current state of the thread, and reversing
 * page 1 only reverses the wrong fifty messages.
 *
 * So this starts at `meta.totalPages` and walks DOWN — page N, N-1, N-2 — as
 * the reader scrolls up. Finding the last page costs one probe request for
 * page 1 with `limit: 1`, which is cheap and asks the server rather than
 * guessing from a message count nobody sent us.
 *
 * ## Display order stays chronological
 *
 * Pages arrive newest-first but each page is internally oldest-first, so the
 * flattening below reverses the PAGE ORDER and not the messages inside them.
 * The result is one ascending transcript regardless of what arrived when.
 */
export function useMessages(
  audience: "candidate" | "recruiter",
  conversationId: string | null,
) {
  const base = conversationBase(audience);

  /*
   * Which page is last. `limit: 1` keeps the probe to a single row — we want
   * `meta.totalPages` for OUR page size, so it is computed from `total`
   * rather than read from a response paged differently.
   */
  const bounds = useQuery({
    queryKey: ["chat", "messageBounds", audience, conversationId] as const,
    enabled: Boolean(conversationId),
    queryFn: async () => {
      const probe = await apiFetch<Paginated<ChatMessage>>(
        `${base}/${conversationId}/messages`,
        { query: { page: 1, limit: 1 } },
      );
      const total = probe.meta?.total ?? 0;
      return { total, lastPage: lastMessagePage(total) };
    },
  });

  const lastPage = bounds.data?.lastPage ?? 1;

  const result = useInfiniteQuery({
    queryKey: queryKeys.chat.messages(conversationId ?? ""),
    enabled: Boolean(conversationId) && bounds.isSuccess,
    initialPageParam: lastPage,
    queryFn: ({ pageParam }) =>
      apiFetch<Paginated<ChatMessage>>(`${base}/${conversationId}/messages`, {
        query: { page: pageParam, limit: PAGE_SIZE },
      }),
    getNextPageParam: olderMessagePage,
  });

  /*
   * Pages were fetched newest-first; each page is oldest-first inside. Undo
   * only the PAGE order to get one ascending transcript.
   */
  const messages = [...(result.data?.pages ?? [])]
    .reverse()
    .flatMap((page) => page.data ?? []);

  return Object.assign(result, {
    messages,
    total: bounds.data?.total ?? 0,
    isLoading: bounds.isLoading || result.isLoading,
    isError: bounds.isError || result.isError,
  });
}

/**
 * Sends over REST, not over the socket.
 *
 * The gateway accepts `message.send`, but a POST is the contract that returns
 * a definite success or a definite error. A socket emit that is dropped mid
 * reconnect looks identical to one still in flight, which is how a message
 * silently disappears; the socket's job here is to DELIVER other people's
 * messages, not to be the transport for our own.
 *
 * The reply is appended through the same de-duplicating merge the socket
 * uses, so a POST response and its echoed `message.new` cannot both land.
 */
export function useSendMessage(
  audience: "candidate" | "recruiter",
  conversationId: string | null,
) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (content: string) =>
      apiFetch<ChatMessage>(
        `${conversationBase(audience)}/${conversationId}/messages`,
        { method: "POST", body: { content } },
      ),
    onSuccess: (message) => {
      appendMessage(client, conversationId ?? "", message);
      void client.invalidateQueries({ queryKey: queryKeys.chat.conversations });
    },
  });
}

/**
 * Puts a newly arrived message into the newest page of the cache.
 *
 * The newest page is the FIRST entry in `pages`, because pages were fetched
 * newest-first. Appending to the last entry would file a new message at the
 * start of the conversation, months in the past.
 */
export function appendMessage(
  client: QueryClient,
  conversationId: string,
  message: ChatMessage,
): void {
  client.setQueryData<InfiniteData<Paginated<ChatMessage>>>(
    queryKeys.chat.messages(conversationId),
    (current) => {
      if (!current?.pages?.length) return current;
      const [newest, ...rest] = current.pages;
      const merged = mergeMessage(newest.data ?? [], message);
      if (merged === newest.data) return current;
      return {
        ...current,
        pages: [{ ...newest, data: merged }, ...rest],
      };
    },
  );
}

/**
 * Appends a message unless it is already present.
 *
 * ## Why every arrival goes through here
 *
 * The same message reaches this app twice on a good day: once as the reply to
 * our POST, once as the `message.new` the gateway broadcasts to the room we
 * joined. On a bad day a reconnect replays events we already have. Keying on
 * the server's id makes all of those idempotent, which is the whole of
 * "duplicate event safety" — no sequence numbers, no client-generated ids to
 * reconcile later.
 */
export function mergeMessage(
  current: ChatMessage[],
  incoming: ChatMessage,
): ChatMessage[] {
  if (!incoming?.id) return current;
  if (current.some((message) => message.id === incoming.id)) return current;
  return [...current, incoming];
}
