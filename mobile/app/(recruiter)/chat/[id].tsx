import { useLocalSearchParams } from "expo-router";
import { ChatThread } from "@/components/chat/ChatThread";

export default function RecruiterChatThreadScreen() {
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  return (
    <ChatThread
      audience="recruiter"
      conversationId={params.id}
      title={params.title ?? null}
    />
  );
}
