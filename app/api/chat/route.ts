import { NextRequest, NextResponse } from "next/server";

import { getOrCreateDefaultThread } from "@/lib/cases";
import { createResponses } from "@/lib/openai";
import { embedTexts, resolveEmbeddingStorage } from "@/lib/embeddings";
import { prisma } from "@/lib/db";
import {
  ChatResponseSchema,
  type ChatResponse,
} from "@/lib/schemas";
import {
  MAIN_CHAT_SYSTEM_PROMPT,
} from "@/lib/prompts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type RetrievedSource = {
  document_version_id: string;
  label: string;
  locator: {
    label: string;
    page_start?: number | null;
    page_end?: number | null;
    section?: string | null;
    quote?: string | null;
  };
  excerpt?: string | null;
};

type StepMarks = {
  t0: number;
  threadReady?: number;
  vectorStoreReady?: number;
  fileListReady?: number;
  retrievalReady?: number;
  synthesisReady?: number;
  validated?: number;
  retryDone?: number;
};

function logTimings(params: {
  step: string;
  caseId: string | null;
  threadId: string | null;
  hasIndexedFiles?: boolean;
  retrievedCount?: number;
  marks: StepMarks;
  error?: string | null;
}) {
  const ms: Record<string, number> = {};
  const t0 = params.marks.t0;
  for (const [key, value] of Object.entries(params.marks)) {
    if (key === "t0" || value == null) continue;
    ms[key] = value - t0;
  }
  console.log(
    JSON.stringify({
      step: params.step,
      caseId: params.caseId,
      threadId: params.threadId,
      hasIndexedFiles: params.hasIndexedFiles,
      retrievedCount: params.retrievedCount,
      ms,
      error: params.error ?? undefined,
    }),
  );
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

function extractJson(text: string) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in model output.");
  }
  return text.slice(first, last + 1);
}

function truncateText(text: string | null | undefined, maxLength: number) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}…`;
}

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function cleanExcerpt(text: string | null | undefined, maxLength: number) {
  if (!text) return "";
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const alpha = (line.match(/[A-Za-z]/g) ?? []).length;
      return alpha >= 3 || line.length < 10;
    });
  const seen = new Map<string, number>();
  const deduped = lines.filter((line) => {
    const count = (seen.get(line) ?? 0) + 1;
    seen.set(line, count);
    return count <= 2;
  });
  return truncateText(normalizeWhitespace(deduped.join(" ")), maxLength);
}

function getBlobFileName(blobUrl: string, fallback: string) {
  try {
    const url = new URL(blobUrl);
    const parts = url.pathname.split("/");
    return parts[parts.length - 1] || fallback;
  } catch {
    return fallback;
  }
}

function needsCitationRetry(parsed: ChatResponse) {
  if (!parsed.meta.used_retrieval) return true;
  if (parsed.evidence.length === 0) return true;
  const helpsMissing = parsed.what_helps.some(
    (item) => item.source_refs.length === 0,
  );
  const hurtsMissing = parsed.what_hurts.some(
    (item) => item.source_refs.length === 0,
  );
  return helpsMissing || hurtsMissing;
}

function isDocumentContentQuestion(message: string) {
  return /(what does|what do|say about|agreement|order|policy|report|evidence)/i.test(
    message,
  );
}

function isContestedTopic(message: string) {
  return /custody|holiday|schedule|support|abuse|violence|relocation|parenting/i.test(
    message,
  );
}

function isAgreementFocusedQuery(message: string) {
  return /(separation agreement|agreement|parenting plan|parenting|holiday|holidays|schedule)/i.test(
    message,
  );
}

function isParentingFocusedQuery(message: string) {
  return /(parenting|holiday|holidays|schedule|custody|visitation|exchange)/i.test(message);
}

function isMemoryQuery(message: string) {
  return /(rule|schedule|custody|support|holiday|parenting|deadline|notice|obligation|timeline|when|date|travel|communication)/i.test(
    message,
  );
}

function isDocumentListQuery(message: string) {
  return /what documents are (on file|uploaded)|documents on file|list documents|what docs do we have|what files are uploaded|list files|list the files|list uploaded files|show uploaded files|what files do we have|what files are there/i.test(
    message,
  );
}

function buildDocumentSourceRef(params: {
  caseId: string;
  documentVersionId: string;
  label: string;
}) {
  return {
    ref_type: "document" as const,
    case_id: params.caseId,
    document_version_id: params.documentVersionId,
    transcript_message_ids: null,
    email_id: null,
    timeline_event_id: null,
    lawyer_note_id: null,
    locator: {
      label: params.label,
      page_start: null,
      page_end: null,
      section: null,
      quote: null,
      timestamp: null,
    },
    confidence: "high" as const,
  };
}

function buildDocumentsListResponse(params: {
  caseId: string;
  documents: Array<{ document_version_id: string; title: string; status?: string }>;
}) {
  const lines = params.documents.map(
    (doc) =>
      `- ${doc.title} (ID: ${doc.document_version_id}${
        doc.status && doc.status !== "done" ? `, status: ${doc.status}` : ""
      })`,
  );

  return {
    answer: {
      summary: "Documents on file for this case.",
      direct_answer:
        params.documents.length === 0
          ? "No documents are on file yet."
          : ["Documents on file:", ...lines].join("\n"),
      confidence: "high" as const,
      uncertainties: [],
    },
    evidence: params.documents.map((doc) => ({
      claim: `Document on file: ${doc.title}${
        doc.status && doc.status !== "done" ? ` (status: ${doc.status})` : ""
      }`,
      source_refs: [
        buildDocumentSourceRef({
          caseId: params.caseId,
          documentVersionId: doc.document_version_id,
          label: doc.title,
        }),
      ],
      type: "fact" as const,
    })),
    what_helps: [],
    what_hurts: [],
    next_steps:
      params.documents.length === 0
        ? [{ action: "Upload a case document.", owner: "user", priority: "high" as const }]
        : [],
    questions_for_lawyer: [],
    missing_or_requested_docs: [],
    meta: {
      used_retrieval: false,
      retrieval_notes: "Document list returned from the database.",
      safety_note: "Neutral, document-grounded guidance only.",
    },
  } satisfies ChatResponse;
}

function validateCitationCoverage(params: {
  parsed: ChatResponse;
  hasFiles: boolean;
  message: string;
}) {
  const { parsed, hasFiles, message } = params;
  if (hasFiles && !parsed.meta.used_retrieval) return true;
  if (isDocumentContentQuestion(message) && parsed.evidence.length === 0) {
    return true;
  }
  if (isContestedTopic(message) && parsed.what_hurts.length === 0) return true;
  const helpsMissing = parsed.what_helps.some(
    (item) => item.source_refs.length === 0,
  );
  const hurtsMissing = parsed.what_hurts.some(
    (item) => item.source_refs.length === 0,
  );
  return helpsMissing || hurtsMissing;
}

async function runResponse(params: {
  instructions: string;
  input: string;
  model: string;
  timeoutMs: number;
  label: string;
}) {
  const response = await withTimeout(
    (signal) =>
      createResponses(
        {
          model: params.model,
          instructions: params.instructions,
          input: params.input,
          max_output_tokens: 1200,
        } as unknown as Parameters<typeof createResponses>[0],
        { signal },
      ),
    params.timeoutMs,
    params.label,
  );

  return {
    text: (response as { output_text?: string }).output_text ?? "",
  };
}

function formatValueSummary(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const summary =
      (typeof record.summary === "string" && record.summary) ||
      (typeof record.rule === "string" && record.rule) ||
      (typeof record.value === "string" && record.value);
    if (summary) return summary;
    return JSON.stringify(record).slice(0, 240);
  }
  return String(value ?? "");
}

function normalizeCitations(value: unknown) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return [value];
  return [];
}

function buildMemoryResponse(params: {
  caseId: string;
  facts: Array<{
    key: string;
    valueJson: unknown;
    citationsJson: unknown;
    confidence: string;
  }>;
  obligations: Array<{
    description: string;
    dueDate: Date | null;
    recurrence: string | null;
    citationsJson: unknown;
    confidence: string;
  }>;
  timeline: Array<{
    title: string;
    summary: string;
    eventDate: Date | null;
    citationsJson: unknown;
    confidence: string | null;
  }>;
}) {
  const lines: string[] = [];
  const evidence: ChatResponse["evidence"] = [];

  for (const fact of params.facts) {
    const summary = formatValueSummary(fact.valueJson);
    lines.push(`- ${fact.key}: ${summary}`);
    evidence.push({
      claim: `${fact.key}: ${summary}`,
      source_refs: normalizeCitations(fact.citationsJson) as ChatResponse["evidence"][number]["source_refs"],
      type: "fact",
    });
  }

  for (const obligation of params.obligations) {
    const due = obligation.dueDate ? ` (due ${obligation.dueDate.toDateString()})` : "";
    const recurrence = obligation.recurrence ? ` (${obligation.recurrence})` : "";
    const line = `- ${obligation.description}${due}${recurrence}`;
    lines.push(line);
    evidence.push({
      claim: line,
      source_refs: normalizeCitations(obligation.citationsJson) as ChatResponse["evidence"][number]["source_refs"],
      type: "fact",
    });
  }

  for (const event of params.timeline) {
    const date = event.eventDate ? event.eventDate.toDateString() : "Unknown date";
    const line = `- ${date}: ${event.title} - ${event.summary}`;
    lines.push(line);
    evidence.push({
      claim: line,
      source_refs: normalizeCitations(event.citationsJson) as ChatResponse["evidence"][number]["source_refs"],
      type: "fact",
    });
  }

  const summary =
    lines.length > 0
      ? "Case memory summary."
      : "No stored case memory matched this question yet.";

  return {
    answer: {
      summary,
      direct_answer: lines.length ? lines.join("\n") : summary,
      confidence: lines.length ? "medium" : "low",
      uncertainties: lines.length
        ? []
        : [
            {
              topic: "Case memory",
              why: "No stored facts or obligations matched the question.",
              needed_sources: ["document"],
            },
          ],
    },
    evidence,
    what_helps: [],
    what_hurts: [],
    next_steps: [],
    questions_for_lawyer: [],
    missing_or_requested_docs: [],
    meta: {
      used_retrieval: false,
      retrieval_notes: "Memory-first response.",
      safety_note: "Neutral, document-grounded guidance only.",
    },
  } satisfies ChatResponse;
}

async function searchDocumentChunks(params: {
  caseId: string;
  query: string;
}) {
  const keywordRows = await prisma.documentChunk.findMany({
    where: {
      caseId: params.caseId,
      text: { contains: params.query, mode: "insensitive" },
    },
    take: 6,
    orderBy: { createdAt: "desc" },
  });

  const storage = await resolveEmbeddingStorage();
  let vectorRows: Array<{
    id: string;
    documentId: string;
    pageNumber: number | null;
    chunkIndex: number;
    text: string;
  }> = [];

  if (storage === "vector") {
    const [embedding] = await embedTexts([params.query]);
    const vectorLiteral = `[${embedding.join(",")}]`;
    vectorRows = await prisma.$queryRawUnsafe(
      `SELECT "id", "documentId", "pageNumber", "chunkIndex", "text"
       FROM "DocumentChunk"
       WHERE "caseId" = '${params.caseId}' AND "embedding" IS NOT NULL
       ORDER BY "embedding" <-> '${vectorLiteral}'::vector
       LIMIT 6`,
    );
  }

  const combined = new Map<string, typeof keywordRows[number]>();
  for (const row of [...vectorRows, ...keywordRows]) {
    combined.set(row.id, row as typeof keywordRows[number]);
  }

  return Array.from(combined.values()).slice(0, 8);
}

function extractSectionHint(text: string) {
  const patterns = [
    /parenting plan/i,
    /holiday/i,
    /school vacation/i,
    /vacation/i,
    /parenting time/i,
    /schedule/i,
    /exchanges?/i,
    /summer/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

function isIrrelevantParentingSection(text: string) {
  return /(exhibit\s+[a-z]|real estate|assets|liabilities|property|mortgage|bank|debt|retirement|equity|tax)/i.test(
    text,
  );
}

function parseChatResponse(text: string) {
  try {
    const json = extractJson(text);
    return ChatResponseSchema.safeParse(JSON.parse(json));
  } catch {
    return ChatResponseSchema.safeParse({});
  }
}

export async function POST(req: NextRequest) {
  let caseRecord: { id: string; name: string } | null = null;
  let threadRecord: { id: string } | null = null;
  let storedUserMessage: string | null = null;
  const requestId = crypto.randomUUID();
  let hasIndexedFiles: boolean | undefined;
  let retrievedCount: number | undefined;
  const marks: StepMarks = { t0: Date.now() };
  try {
    const body = await req.json();
    const message = body?.message as string | undefined;
    const caseId = body?.caseId as string | undefined;
    const threadId = body?.threadId as string | undefined;
    const originalMessage = body?.originalMessage as string | undefined;
    const documentsList = body?.documentsList as
      | Array<{
          document_version_id: string;
          title: string;
          fileName: string;
          docType: string | null;
          uploadedAt: string;
          description: string | null;
          status?: string;
          ingestError?: string | null;
        }>
      | undefined;

    if (!message) {
      return NextResponse.json({ error: "Missing message." }, { status: 400 });
    }

    const threadData = await getOrCreateDefaultThread(caseId);
    caseRecord = threadData.caseRecord;
    marks.threadReady = Date.now();

    threadRecord = threadId
      ? await prisma.chatThread.findFirst({
          where: { id: threadId, caseId: caseRecord.id },
        })
      : threadData.thread;

    if (!threadRecord) {
      return NextResponse.json({ error: "Invalid thread." }, { status: 404 });
    }

    storedUserMessage = originalMessage ?? message;
    await prisma.chatMessage.create({
      data: {
        caseId: caseRecord.id,
        threadId: threadRecord.id,
        role: "user",
        content: { text: storedUserMessage },
      },
    });

    if (isDocumentListQuery(storedUserMessage)) {
      const docList: Array<{
        document_version_id: string;
        title: string;
        status?: string;
      }> = documentsList?.length
        ? documentsList.map((doc) => ({
            document_version_id: doc.document_version_id,
            title: doc.title,
            status: doc.status ?? undefined,
          }))
        : (
            await prisma.document.findMany({
              where: { caseId: caseRecord.id },
              orderBy: { createdAt: "desc" },
            })
          ).map((doc) => ({
            document_version_id: doc.id,
            title: doc.title,
          }));

      if (!documentsList?.length) {
        const jobs = await prisma.documentIngestJob.findMany({
          where: { caseId: caseRecord.id },
          orderBy: { updatedAt: "desc" },
        });
        const jobByDocumentId = new Map(
          jobs
            .filter((job) => job.documentId)
            .map((job) => [job.documentId!, job.status]),
        );
        for (const doc of docList) {
          const status = jobByDocumentId.get(doc.document_version_id);
          if (status) {
            doc.status = status;
          }
        }
      }

      const response = buildDocumentsListResponse({
        caseId: caseRecord.id,
        documents: docList,
      });

      await prisma.chatMessage.create({
        data: {
          caseId: caseRecord.id,
          threadId: threadRecord.id,
          role: "assistant",
          content: response,
        },
      });

      return NextResponse.json(response);
    }

    if (isMemoryQuery(storedUserMessage)) {
      const wantsTimeline = /timeline|when|date|dated/i.test(storedUserMessage);
      const wantsObligations = /obligation|due|deadline|notice|pay|payment/i.test(
        storedUserMessage,
      );
      const factTypes = isParentingFocusedQuery(storedUserMessage)
        ? ["parenting_rule", "schedule", "custody", "travel", "communication"]
        : ["parenting_rule", "custody", "support", "restriction", "definition", "other"];

      const [facts, obligations, timeline] = await Promise.all([
        prisma.caseFact.findMany({
          where: { caseId: caseRecord.id, type: { in: factTypes } },
          orderBy: { updatedAt: "desc" },
          take: 8,
        }),
        wantsObligations
          ? prisma.obligation.findMany({
              where: { caseId: caseRecord.id },
              orderBy: { updatedAt: "desc" },
              take: 6,
            })
          : Promise.resolve([]),
        wantsTimeline
          ? prisma.timelineEvent.findMany({
              where: { caseId: caseRecord.id },
              orderBy: { occurredAt: "desc" },
              take: 6,
            })
          : Promise.resolve([]),
      ]);

      if (facts.length || obligations.length || timeline.length) {
        const response = buildMemoryResponse({
          caseId: caseRecord.id,
          facts: facts.map((fact) => ({
            key: fact.key,
            valueJson: fact.valueJson,
            citationsJson: fact.citationsJson,
            confidence: fact.confidence,
          })),
          obligations: obligations.map((obligation) => ({
            description: obligation.description,
            dueDate: obligation.dueDate ?? null,
            recurrence: obligation.recurrence ?? null,
            citationsJson: obligation.citationsJson,
            confidence: obligation.confidence,
          })),
          timeline: timeline.map((event) => ({
            title: event.title,
            summary: event.summary,
            eventDate: event.eventDate ?? event.occurredAt ?? null,
            citationsJson: event.citationsJson ?? event.sourceRef,
            confidence: event.confidence ?? "medium",
          })),
        });

        await prisma.chatMessage.create({
          data: {
            caseId: caseRecord.id,
            threadId: threadRecord.id,
            role: "assistant",
            content: response,
          },
        });

        return NextResponse.json(response);
      }
    }

    const indexedDocs = await prisma.document.findMany({
      where: { caseId: caseRecord.id, chunks: { some: {} } },
      orderBy: { createdAt: "desc" },
    });
    const allDocs = await prisma.document.findMany({
      where: { caseId: caseRecord.id },
      orderBy: { createdAt: "desc" },
    });
    const jobs = await prisma.documentIngestJob.findMany({
      where: { caseId: caseRecord.id },
      orderBy: { updatedAt: "desc" },
    });
    const jobByDocumentId = new Map(
      jobs
        .filter((job) => job.documentId)
        .map((job) => [job.documentId!, job.status]),
    );

    const chunkCount = await prisma.documentChunk.count({
      where: { caseId: caseRecord.id },
    });
    hasIndexedFiles = chunkCount > 0;
    if (!hasIndexedFiles) {
      const response = buildDocumentsListResponse({
        caseId: caseRecord.id,
        documents: allDocs.map((doc) => ({
          document_version_id: doc.id,
          title: doc.title,
          status: jobByDocumentId.get(doc.id) ?? "uploaded",
        })),
      });
      response.answer.summary = "No indexed documents yet.";
      response.answer.direct_answer = [
        "I do not have any indexed documents for this case yet.",
        response.answer.direct_answer,
      ].join("\n\n");
      response.meta.used_retrieval = false;
      response.meta.retrieval_notes = `No indexed docs. requestId=${requestId}`;

      await prisma.chatMessage.create({
        data: {
          caseId: caseRecord.id,
          threadId: threadRecord.id,
          role: "assistant",
          content: response,
        },
      });

      return NextResponse.json(response);
    }

    console.log(
      JSON.stringify({
        step: "chunk_search_start",
        requestId,
        caseId: caseRecord.id,
        threadId: threadRecord.id,
      }),
    );
    let retrievalResults = await searchDocumentChunks({
      caseId: caseRecord.id,
      query: message,
    });

    const agreementCandidates = indexedDocs.filter((doc) => {
      const fileName = getBlobFileName(doc.blobUrl, doc.title);
      return /separation agreement/i.test(doc.title) || /separation agreement/i.test(fileName);
    });
    const preferredDocumentIds = agreementCandidates.map((doc) => doc.id);

    if (isAgreementFocusedQuery(message) && preferredDocumentIds.length > 0) {
      const preferredSet = new Set(preferredDocumentIds);
      const filtered = retrievalResults.filter((result) =>
        preferredSet.has(result.documentId),
      );
      if (filtered.length > 0) {
        retrievalResults = filtered;
      }
    }

    if (isParentingFocusedQuery(message)) {
      retrievalResults = retrievalResults.filter((result) => {
        return !isIrrelevantParentingSection(result.text ?? "");
      });
    }
    marks.retrievalReady = Date.now();
    retrievedCount = retrievalResults.length;
    console.log(
      JSON.stringify({
        step: "chunk_search_done",
        requestId,
        caseId: caseRecord.id,
        threadId: threadRecord.id,
        retrievedCount,
        ms: { retrieval: marks.retrievalReady - marks.t0 },
      }),
    );

    const retrievedSources: RetrievedSource[] = [];
    if (retrievalResults.length > 0) {
      const documentIds = Array.from(
        new Set(retrievalResults.map((item) => item.documentId)),
      );
      const docs = await prisma.document.findMany({
        where: { id: { in: documentIds } },
      });
      const docById = new Map(docs.map((doc) => [doc.id, doc]));

      for (const result of retrievalResults) {
        const doc = docById.get(result.documentId);
        if (!doc) continue;
        const rawContent = result.text ?? "";
        const contentText = cleanExcerpt(rawContent, 450);
        const sectionHint = extractSectionHint(rawContent);
        retrievedSources.push({
          document_version_id: doc.id,
          label: doc.title,
          locator: {
            label: doc.title,
            page_start: result.pageNumber ?? null,
            page_end: result.pageNumber ?? null,
            section: sectionHint,
            quote: cleanExcerpt(rawContent, 320),
          },
          excerpt: contentText,
        });
      }
    }

    const baseInput = [
      `Case ID: ${caseRecord.id}`,
      `RetrievedSources: ${JSON.stringify(retrievedSources)}`,
      `User question: ${message}`,
    ].join("\n\n");

    const citationInstruction = [
      MAIN_CHAT_SYSTEM_PROMPT,
      "You MUST cite using SourceRef objects with document_version_id from RetrievedSources.",
      "Do not cite filenames. Use only document_version_id values provided.",
      "Answer format requirements:",
      "- answer.summary must be 1-2 sentences.",
      "- answer.direct_answer must be readable prose with short sections and bullets.",
      "- Do NOT paste raw OCR blobs. Use short quotes (<= 2 sentences) in locator.quote only.",
      "- Every bullet/claim in direct_answer must have at least one SourceRef in evidence.",
      `Allowed document_version_id values: ${retrievedSources
        .map((source) => source.document_version_id)
        .join(", ") || "none"}.`,
    ].join("\n");

    const caseIdValue = caseRecord.id;
    const bulletClaims = retrievedSources.slice(0, 8).map((source) => ({
      text: `Relevant section found in ${source.label}.`,
      source,
    }));
    const mentionsHoliday = retrievedSources.some((source) =>
      /holiday/i.test(source.excerpt ?? ""),
    );
    if (isParentingFocusedQuery(message) && !mentionsHoliday && bulletClaims.length > 0) {
      bulletClaims.unshift({
        text:
          "No explicit holiday schedule language appears in the retrieved sections; closest related scheduling language is shown below.",
        source: bulletClaims[0].source,
      });
    }

    const stageOneResponse: ChatResponse = {
      answer: {
        summary:
          retrievedSources.length === 0
            ? "No matching sections were found."
            : "Relevant sections found in the indexed documents.",
        direct_answer:
          bulletClaims.length === 0
            ? "No matching sections were found."
            : bulletClaims.map((item) => `- ${item.text}`).join("\n"),
        confidence: retrievedSources.length ? "medium" : "low",
        uncertainties: retrievedSources.length
          ? []
          : [
              {
                topic: "Matching evidence",
                why: "Retrieval returned no excerpts.",
                needed_sources: ["document"],
              },
            ],
      },
      evidence: bulletClaims.map((item) => ({
        claim: item.text,
        source_refs: [
          {
            ref_type: "document",
            case_id: caseIdValue,
            document_version_id: item.source.document_version_id,
            transcript_message_ids: null,
            email_id: null,
            timeline_event_id: null,
            lawyer_note_id: null,
            locator: {
              label: item.source.label,
              page_start: item.source.locator.page_start ?? null,
              page_end: item.source.locator.page_end ?? null,
              section: item.source.locator.section ?? null,
              quote: item.source.locator.quote ?? null,
              timestamp: null,
            },
            confidence: "medium",
          },
        ],
        type: "quote",
      })),
      what_helps: [],
      what_hurts: [],
      next_steps: [],
      questions_for_lawyer: [],
      missing_or_requested_docs: [],
      meta: {
        used_retrieval: true,
        retrieval_notes: `Stage 1 response. requestId=${requestId}`,
        safety_note: "Neutral, document-grounded guidance only.",
      },
    };

    if (retrievedSources.length === 0) {
      await prisma.chatMessage.create({
        data: {
          caseId: caseRecord.id,
          threadId: threadRecord.id,
          role: "assistant",
          content: stageOneResponse,
        },
      });
      return NextResponse.json(stageOneResponse);
    }

    console.log(
      JSON.stringify({
        step: "synthesis_start",
        requestId,
        caseId: caseRecord.id,
        threadId: threadRecord.id,
      }),
    );
    let initialResponse;
    try {
      initialResponse = await runResponse({
        instructions: citationInstruction,
        input: baseInput,
        model: "gpt-5.2-pro",
        timeoutMs: 45000,
        label: "synthesis",
      });
      marks.synthesisReady = Date.now();
      console.log(
        JSON.stringify({
          step: "synthesis_done",
          requestId,
          caseId: caseRecord.id,
          threadId: threadRecord.id,
          ms: { synthesis: marks.synthesisReady - marks.t0 },
        }),
      );
    } catch (synthesisError) {
      const errMsg =
        synthesisError instanceof Error ? synthesisError.message : String(synthesisError);
      if (/timed out/i.test(errMsg)) {
        await prisma.chatMessage.create({
          data: {
            caseId: caseRecord.id,
            threadId: threadRecord.id,
            role: "assistant",
            content: stageOneResponse,
          },
        });
        return NextResponse.json(stageOneResponse);
      }
      throw synthesisError;
    }

    let parsed = parseChatResponse(initialResponse.text);
    marks.validated = Date.now();

    if (
      !parsed.success ||
      needsCitationRetry(parsed.data) ||
      validateCitationCoverage({
        parsed: parsed.success ? parsed.data : ({} as ChatResponse),
        hasFiles: hasIndexedFiles,
        message: originalMessage ?? message,
      })
    ) {
      const enforcement = [
        citationInstruction,
        "Your last answer lacked sufficient citations or valid JSON.",
        "Rewrite and attach SourceRef citations for every key factual claim.",
        "If you cannot cite, mark it 'uncited inference' and move it to uncertainties.",
        "Return ONLY valid JSON for ChatResponse.",
        `RetrievedSources: ${JSON.stringify(retrievedSources)}`,
      ].join("\n");

      const retryResponse = await runResponse({
        instructions: enforcement,
        input: baseInput,
        model: "gpt-5.2-pro",
        timeoutMs: 45000,
        label: "synthesis_retry",
      });
      marks.retryDone = Date.now();

      parsed = parseChatResponse(retryResponse.text);
    }

    if (!parsed.success) {
      console.error("Chat response invalid:", initialResponse.text);
      const failureResponse: ChatResponse = {
        answer: {
          summary: "Chat response failed validation.",
          direct_answer:
            "The assistant response could not be validated. Try rephrasing your question or try again.",
          confidence: "low",
          uncertainties: [
            {
              topic: "Response formatting",
              why: "The model returned invalid JSON or missing citations.",
              needed_sources: ["document"],
            },
          ],
        },
        evidence: [],
        what_helps: [],
        what_hurts: [],
        next_steps: [
          { action: "Retry the question.", owner: "user", priority: "medium" },
        ],
        questions_for_lawyer: [],
        missing_or_requested_docs: [],
        meta: {
          used_retrieval: hasIndexedFiles,
          retrieval_notes: "Model output invalid; see server logs for raw output.",
          safety_note: "Neutral, document-grounded guidance only.",
        },
      };

      await prisma.chatMessage.create({
        data: {
          caseId: caseRecord.id,
          threadId: threadRecord.id,
          role: "assistant",
          content: failureResponse,
        },
      });

      return NextResponse.json(failureResponse);
    }

    await prisma.chatMessage.create({
      data: {
        caseId: caseRecord.id,
        threadId: threadRecord.id,
        role: "assistant",
        content: parsed.data,
      },
    });

    logTimings({
      step: "completed",
      caseId: caseRecord.id,
      threadId: threadRecord.id,
      hasIndexedFiles,
      retrievedCount,
      marks,
    });

    return NextResponse.json(parsed.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = /timed out/i.test(message);
    if (
      isTimeout &&
      /chunk_search/i.test(message) &&
      caseRecord &&
      threadRecord
    ) {
      const docs = await prisma.document.findMany({
        where: { caseId: caseRecord.id },
        orderBy: { createdAt: "desc" },
      });
      const jobs = await prisma.documentIngestJob.findMany({
        where: { caseId: caseRecord.id },
        orderBy: { updatedAt: "desc" },
      });
      const jobByDocumentId = new Map(
        jobs
          .filter((job) => job.documentId)
          .map((job) => [job.documentId!, job.status]),
      );
      const response = buildDocumentsListResponse({
        caseId: caseRecord.id,
        documents: docs.map((doc) => ({
          document_version_id: doc.id,
          title: doc.title,
          status: jobByDocumentId.get(doc.id) ?? "uploaded",
        })),
      });
      response.answer.summary = "Retrieval timed out.";
      response.answer.direct_answer = [
        "I could not retrieve evidence in time.",
        "If your uploads are still processing, click Process now to finish indexing.",
        response.answer.direct_answer,
      ].join("\n\n");
      response.meta.used_retrieval = false;
      response.meta.retrieval_notes = `chunk_search timed out. requestId=${requestId}`;

      await prisma.chatMessage.create({
        data: {
          caseId: caseRecord.id,
          threadId: threadRecord.id,
          role: "assistant",
          content: response,
        },
      });

      return NextResponse.json(response);
    }
    logTimings({
      step: "failed",
      caseId: caseRecord?.id ?? null,
      threadId: threadRecord?.id ?? null,
      hasIndexedFiles,
      retrievedCount,
      marks,
      error: message,
    });
    const failureResponse: ChatResponse = {
      answer: {
        summary: isTimeout ? "Chat request timed out." : "Chat request failed.",
        direct_answer: isTimeout
          ? `The assistant timed out during ${message.replace(' timed out', '')}. Try again, or ask a more specific question.`
          : "The assistant hit an error while responding. Try again in a moment.",
        confidence: "low",
        uncertainties: [
          {
            topic: "Request failure",
            why: message,
            needed_sources: ["document"],
          },
        ],
      },
      evidence: [],
      what_helps: [],
      what_hurts: [],
      next_steps: [
        { action: "Retry the question.", owner: "user", priority: "medium" },
      ],
      questions_for_lawyer: [],
      missing_or_requested_docs: [],
      meta: {
        used_retrieval: false,
        retrieval_notes: `Request failed before completing. requestId=${requestId}`,
        safety_note: "Neutral, document-grounded guidance only.",
      },
    };

    if (caseRecord && threadRecord && storedUserMessage) {
      await prisma.chatMessage.create({
        data: {
          caseId: caseRecord.id,
          threadId: threadRecord.id,
          role: "assistant",
          content: failureResponse,
        },
      });
    }

    return NextResponse.json(
      failureResponse,
      { status: 200 },
    );
  }
}
