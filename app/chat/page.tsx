import { prisma } from "@/lib/db";
import { getOrCreateDefaultThread } from "@/lib/cases";
import ChatClient from "./ChatClient";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const { caseRecord, thread } = await getOrCreateDefaultThread();
  const messages = await prisma.chatMessage.findMany({
    where: { threadId: thread.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <ChatClient
      caseId={caseRecord.id}
      threadId={thread.id}
      threadTitle={thread.title}
      initialMessages={messages.map((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant",
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      }))}
    />
  );
}
