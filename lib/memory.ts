import { z } from "zod";

import { prisma } from "@/lib/db";
import { createResponses } from "@/lib/openai";
import { CASE_MEMORY_EXTRACTION_PROMPT } from "@/lib/prompts";
import { SourceRefSchema } from "@/lib/schemas";

const MemoryExtractionSchema = z.object({
  document_type: z.string(),
  entities: z.array(
    z.object({
      type: z.enum(["person", "child", "attorney", "judge", "org", "address"]),
      name: z.string(),
      attributes: z.record(z.unknown()).optional(),
      citations: z.array(SourceRefSchema),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  facts: z.array(
    z.object({
      type: z.enum([
        "parenting_rule",
        "custody",
        "support",
        "restriction",
        "definition",
        "asset",
        "debt",
        "schedule",
        "education",
        "medical",
        "travel",
        "communication",
        "other",
      ]),
      key: z.string(),
      value: z.record(z.unknown()),
      citations: z.array(SourceRefSchema),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  timeline: z.array(
    z.object({
      event_date: z.string().nullable(),
      title: z.string(),
      description: z.string(),
      citations: z.array(SourceRefSchema),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
  obligations: z.array(
    z.object({
      obligation_type: z.enum(["payment", "exchange", "notice", "filing", "other"]),
      due_date: z.string().nullable(),
      recurrence: z.string().nullable().optional(),
      description: z.string(),
      citations: z.array(SourceRefSchema),
      confidence: z.enum(["high", "medium", "low"]),
    }),
  ),
});

type DocumentChunkRow = {
  pageNumber: number | null;
  chunkIndex: number;
  text: string;
};

function extractJson(text: string) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in model output.");
  }
  return text.slice(first, last + 1);
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function chunkBatches<T>(items: T[], batchSize: number) {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

function buildChunkContext(chunks: DocumentChunkRow[]) {
  return chunks
    .map((chunk) => {
      const pageLabel = chunk.pageNumber ? `Page ${chunk.pageNumber}` : "Page n/a";
      return `[${pageLabel}] ${chunk.text}`;
    })
    .join("\n\n");
}

export async function rebuildCaseMemory(params: {
  caseId: string;
  documentIds?: string[];
}) {
  const { caseId, documentIds } = params;
  const documents = await prisma.document.findMany({
    where: {
      caseId,
      ...(documentIds?.length ? { id: { in: documentIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
  });

  for (const document of documents) {
    const chunks = await prisma.documentChunk.findMany({
      where: { documentId: document.id },
      orderBy: [{ pageNumber: "asc" }, { chunkIndex: "asc" }],
    });
    if (chunks.length === 0) {
      continue;
    }

    await prisma.caseEntity.deleteMany({ where: { caseId, documentId: document.id } });
    await prisma.caseFact.deleteMany({ where: { caseId, documentId: document.id } });
    await prisma.timelineEvent.deleteMany({ where: { caseId, documentId: document.id } });
    await prisma.obligation.deleteMany({ where: { caseId, documentId: document.id } });

    const batches = chunkBatches(chunks, 20);
    const allEntities: z.infer<typeof MemoryExtractionSchema>[
      "entities"
    ] = [];
    const allFacts: z.infer<typeof MemoryExtractionSchema>["facts"] = [];
    const allTimeline: z.infer<typeof MemoryExtractionSchema>["timeline"] = [];
    const allObligations: z.infer<typeof MemoryExtractionSchema>["obligations"] = [];
    let documentType: string | null = null;

    for (const batch of batches) {
      const input = [
        `Document ID: ${document.id}`,
        `Document title: ${document.title}`,
        "Document excerpts with page markers:",
        buildChunkContext(batch),
      ].join("\n\n");

      const response = await withTimeout(
        (signal) =>
          createResponses(
            {
              model: "gpt-5.2-pro",
              instructions: CASE_MEMORY_EXTRACTION_PROMPT,
              input,
              max_output_tokens: 1200,
            } as unknown as Parameters<typeof createResponses>[0],
            { signal },
          ),
        45000,
        "memory_extraction",
      );

      const outputText = (response as { output_text?: string }).output_text ?? "";
      const payload = JSON.parse(extractJson(outputText));
      const parsed = MemoryExtractionSchema.safeParse(payload);
      if (!parsed.success) {
        continue;
      }

      if (!documentType && parsed.data.document_type) {
        documentType = parsed.data.document_type;
      }

      allEntities.push(...parsed.data.entities);
      allFacts.push(...parsed.data.facts);
      allTimeline.push(...parsed.data.timeline);
      allObligations.push(...parsed.data.obligations);
    }

    if (documentType) {
      await prisma.document.update({
        where: { id: document.id },
        data: { documentType },
      });
    }

    if (allEntities.length) {
      await prisma.caseEntity.createMany({
        data: allEntities.map((entity) => ({
          caseId,
          documentId: document.id,
          type: entity.type,
          name: entity.name,
          attributesJson: entity.attributes ?? {},
          citationsJson: entity.citations,
          confidence: entity.confidence,
        })),
      });
    }

    if (allFacts.length) {
      await prisma.caseFact.createMany({
        data: allFacts.map((fact) => ({
          caseId,
          documentId: document.id,
          type: fact.type,
          key: fact.key,
          valueJson: fact.value,
          citationsJson: fact.citations,
          confidence: fact.confidence,
        })),
      });
    }

    if (allTimeline.length) {
      await prisma.timelineEvent.createMany({
        data: allTimeline.map((event) => ({
          caseId,
          documentId: document.id,
          eventDate: event.event_date ? new Date(event.event_date) : null,
          occurredAt: event.event_date ? new Date(event.event_date) : null,
          precision: event.event_date ? "exact" : "unknown",
          title: event.title,
          summary: event.description,
          category: "legal",
          people: [],
          sourceRef: event.citations[0] ?? {},
          citationsJson: event.citations,
          confidence: event.confidence,
        })),
      });
    }

    if (allObligations.length) {
      await prisma.obligation.createMany({
        data: allObligations.map((obligation) => ({
          caseId,
          documentId: document.id,
          obligationType: obligation.obligation_type,
          dueDate: obligation.due_date ? new Date(obligation.due_date) : null,
          recurrence: obligation.recurrence ?? null,
          description: obligation.description,
          citationsJson: obligation.citations,
          confidence: obligation.confidence,
        })),
      });
    }
  }
}

export async function acquireMemoryRebuildLock(caseId: string) {
  const result = await prisma.case.updateMany({
    where: { id: caseId, memoryRebuildInProgress: false },
    data: {
      memoryRebuildInProgress: true,
      memoryRebuildRequestedAt: new Date(),
    },
  });
  return result.count > 0;
}

export async function releaseMemoryRebuildLock(caseId: string) {
  await prisma.case.update({
    where: { id: caseId },
    data: { memoryRebuildInProgress: false },
  });
}
