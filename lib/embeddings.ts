import { prisma } from "@/lib/db";
import { getOpenAI } from "@/lib/openai";

const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

let vectorReady: boolean | null = null;

export function getEmbeddingModel() {
  return process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
}

export async function ensureVectorReady() {
  if (vectorReady !== null) return vectorReady;
  try {
    const rows = await prisma.$queryRaw<Array<{ extname: string }>>
      `SELECT extname FROM pg_extension WHERE extname = 'vector'`;
    vectorReady = rows.length > 0;
  } catch {
    vectorReady = false;
  }
  return vectorReady;
}

export async function embedTexts(texts: string[]) {
  const model = getEmbeddingModel();
  const client = getOpenAI();
  const response = await client.embeddings.create({
    model,
    input: texts,
  });
  return response.data.map((item) => item.embedding);
}

export async function resolveEmbeddingStorage() {
  const ready = await ensureVectorReady();
  return ready ? "vector" : "json";
}
