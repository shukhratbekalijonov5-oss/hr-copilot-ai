import { useLocalSearchParams } from "expo-router";
import { ChatThread } from "@/components/chat/ChatThread";

export default function CandidateChatThreadScreen() {
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  return (
    <ChatThread
      audience="candidate"
      conversationId={params.id}
      title={params.title ?? null}
    />
  );
}
