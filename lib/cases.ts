import { prisma } from "@/lib/db";
import { getOpenAI } from "@/lib/openai";

export async function getOrCreateCase(caseId?: string) {
  if (caseId) {
    const existing = await prisma.case.findUnique({ where: { id: caseId } });
    if (existing) return existing;
  }

  const existing = await prisma.case.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;

  return prisma.case.create({
    data: {
      name: "Default Case",
    },
  });
}

export async function ensureVectorStore(caseId?: string) {
  const caseRecord = await getOrCreateCase(caseId);
  if (caseRecord.vectorStoreId) {
    return { caseRecord, vectorStoreId: caseRecord.vectorStoreId };
  }

  const vectorStore = await getOpenAI().vectorStores.create({
    name: `case-${caseRecord.id}`,
  });

  const updated = await prisma.case.update({
    where: { id: caseRecord.id },
    data: { vectorStoreId: vectorStore.id },
  });

  return { caseRecord: updated, vectorStoreId: vectorStore.id };
}

export async function getOrCreateDefaultThread(caseId?: string) {
  const caseRecord = await getOrCreateCase(caseId);
  const existing = await prisma.chatThread.findFirst({
    where: { caseId: caseRecord.id },
    orderBy: { createdAt: "asc" },
  });

  if (existing) return { caseRecord, thread: existing };

  const thread = await prisma.chatThread.create({
    data: {
      caseId: caseRecord.id,
      title: "Default thread",
    },
  });

  return { caseRecord, thread };
}
