import { prisma } from "@/lib/db";
import { getOrCreateCase } from "@/lib/cases";
import ChatClient from "./ChatClient";

export const dynamic = "force-dynamic";

type ChatPageProps = {
  searchParams?: { threadId?: string };
};

export default async function ChatPage({ searchParams }: ChatPageProps) {
  const caseRecord = await getOrCreateCase();
  const threads = await prisma.chatThread.findMany({
    where: { caseId: caseRecord.id },
    orderBy: { createdAt: "asc" },
  });
  let activeThread = threads.find((thread) => thread.id === searchParams?.threadId) ?? null;
  if (!activeThread) {
    activeThread = threads[0] ?? null;
  }
  if (!activeThread) {
    activeThread = await prisma.chatThread.create({
      data: { caseId: caseRecord.id, title: "New chat" },
    });
    threads.push(activeThread);
  }

  const messages = await prisma.chatMessage.findMany({
    where: { threadId: activeThread.id },
    orderBy: { createdAt: "asc" },
  });

  return (
    <ChatClient
      caseId={caseRecord.id}
      threadId={activeThread.id}
      threadTitle={activeThread.title}
      threads={threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
      }))}
      initialMessages={messages.map((message) => ({
        id: message.id,
        role: message.role as "user" | "assistant",
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      }))}
    />
  );
}
