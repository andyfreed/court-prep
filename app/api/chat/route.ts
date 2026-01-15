import { NextRequest, NextResponse } from "next/server";

import { ensureVectorStore, getOrCreateDefaultThread } from "@/lib/cases";
import { buildResponsesParams, getOpenAI } from "@/lib/openai";
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
export const maxDuration = 120;

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

type FileSearchContent = {
  text?: string | null;
};

type FileSearchResult = {
  file_id?: string;
  page?: number | null;
  section?: string | null;
  content?: FileSearchContent | null;
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

function isDocumentListQuery(message: string) {
  return /what documents are (on file|uploaded)|documents on file|list documents|what docs do we have|what files are uploaded|list files|what files do we have/i.test(
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
  documents: Array<{ document_version_id: string; title: string }>;
}) {
  const lines = params.documents.map(
    (doc) => `- ${doc.title} (ID: ${doc.document_version_id})`,
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
      claim: `Document on file: ${doc.title}`,
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

function extractFileSearchResults(response: unknown) {
  const output = (response as { output?: unknown })?.output;
  const items = Array.isArray(output) ? output : [];
  const results: FileSearchResult[] = [];

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { type?: unknown; results?: unknown };
    if (entry.type !== "file_search_call" || !Array.isArray(entry.results)) continue;

    for (const rawResult of entry.results) {
      if (!rawResult || typeof rawResult !== "object") continue;
      const result = rawResult as Record<string, unknown>;
      const file_id = typeof result.file_id === "string" ? result.file_id : undefined;
      const page = typeof result.page === "number" ? result.page : null;
      const section = typeof result.section === "string" ? result.section : null;
      const contentRaw = result.content as Record<string, unknown> | null | undefined;
      const contentText =
        contentRaw && typeof contentRaw.text === "string" ? contentRaw.text : null;

      results.push({
        file_id,
        page,
        section,
        content: contentText ? { text: contentText } : null,
      });
    }
  }

  return results;
}

async function runResponse(params: {
  instructions: string;
  input: string;
  vectorStoreId?: string;
  requireFileSearch?: boolean;
  timeoutMs: number;
  label: string;
}) {
  const tools = params.vectorStoreId
    ? [
        {
          type: "file_search" as const,
          vector_store_ids: [params.vectorStoreId],
        },
      ]
    : undefined;

  const response = await withTimeout(
    (signal) =>
      getOpenAI().responses.create(
        buildResponsesParams({
          model: "gpt-5.2-pro",
          instructions: params.instructions,
          input: params.input,
          tools,
          tool_choice: tools ? (params.requireFileSearch ? "required" : "auto") : undefined,
          include: params.vectorStoreId ? ["file_search_call.results"] : undefined,
          max_output_tokens: 1200,
        }),
        { signal },
      ),
    params.timeoutMs,
    params.label,
  );

  return {
    text: response.output_text ?? "",
    results: extractFileSearchResults(response),
  };
}

async function runRetrieval(params: { message: string; vectorStoreId: string }) {
  const retrieval = await runResponse({
    instructions:
      "Run file_search and return ONLY the word OK. Do not include any JSON.",
    input: params.message,
    vectorStoreId: params.vectorStoreId,
    requireFileSearch: true,
    timeoutMs: 30000,
    label: "file_search",
  });
  return retrieval.results;
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
      const docList =
        documentsList?.length
          ? documentsList.map((doc) => ({
              document_version_id: doc.document_version_id,
              title: doc.title,
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

    const { vectorStoreId } = await ensureVectorStore(caseRecord.id);
    marks.vectorStoreReady = Date.now();
    const files = await withTimeout(
      () => getOpenAI().vectorStores.files.list(vectorStoreId),
      20000,
      "vectorStores.files.list",
    );
    marks.fileListReady = Date.now();
    hasIndexedFiles = (files?.data?.length ?? 0) > 0;

    if (!hasIndexedFiles) {
      const emptyResponse: ChatResponse = {
        answer: {
          summary: "No indexed documents yet.",
          direct_answer:
            "I do not have any indexed documents for this case yet. Upload at least one document so I can cite it in answers.",
          confidence: "low",
          uncertainties: [
            {
              topic: "Document coverage",
              why: "The case has no files indexed in the vector store yet.",
              needed_sources: ["document"],
            },
          ],
        },
        evidence: [],
        what_helps: [],
        what_hurts: [],
        next_steps: [
          { action: "Upload a case document.", owner: "user", priority: "high" },
        ],
        questions_for_lawyer: [],
        missing_or_requested_docs: [
          {
            doc_name: "Primary custody agreement or order",
            why: "Needed to answer custody-specific questions with citations.",
            priority: "high",
          },
        ],
        meta: {
          used_retrieval: false,
          retrieval_notes: "No vector store files found for this case.",
          safety_note: "Neutral, document-grounded guidance only.",
        },
      };

      await prisma.chatMessage.create({
        data: {
          caseId: caseRecord.id,
          threadId: threadRecord.id,
          role: "assistant",
          content: emptyResponse,
        },
      });

      return NextResponse.json(emptyResponse);
    }
    const documentsContext = documentsList?.length
      ? `Documents on file (from DB): ${JSON.stringify(documentsList)}`
      : "Documents on file (from DB): none provided";

    const retrievalResults = (await runRetrieval({
      message,
      vectorStoreId,
    })).slice(0, 6);
    marks.retrievalReady = Date.now();
    retrievedCount = retrievalResults.length;

    const retrievedSources: RetrievedSource[] = [];
    if (retrievalResults.length > 0) {
      const fileIds = Array.from(
        new Set(
          retrievalResults
            .map((item) => item.file_id)
            .filter((id): id is string => typeof id === "string" && id.length > 0),
        ),
      );
      const docs = await prisma.document.findMany({
        where: { openaiFileId: { in: fileIds } },
      });
      const docByFileId = new Map(docs.map((doc) => [doc.openaiFileId, doc]));

      for (const result of retrievalResults) {
        if (!result.file_id) continue;
        const doc = docByFileId.get(result.file_id);
        if (!doc) continue;
        retrievedSources.push({
          document_version_id: doc.id,
          label: doc.title,
          locator: {
            label: doc.title,
            page_start: result?.page ?? null,
            page_end: result?.page ?? null,
            section: result?.section ?? null,
            quote: result?.content?.text ?? null,
          },
          excerpt: result?.content?.text ?? null,
        });
      }
    }

    const baseInput = [
      `Case ID: ${caseRecord.id}`,
      documentsContext,
      `RetrievedSources: ${JSON.stringify(retrievedSources)}`,
      `User question: ${message}`,
    ].join("\n\n");

    const citationInstruction = [
      MAIN_CHAT_SYSTEM_PROMPT,
      "You MUST cite using SourceRef objects with document_version_id from RetrievedSources.",
      "Do not cite filenames. Use only document_version_id values provided.",
      `Allowed document_version_id values: ${retrievedSources
        .map((source) => source.document_version_id)
        .join(", ") || "none"}.`,
    ].join("\n");

    const initialResponse = await runResponse({
      instructions: citationInstruction,
      input: baseInput,
      vectorStoreId,
      requireFileSearch: true,
      timeoutMs: 45000,
      label: "synthesis",
    });
    marks.synthesisReady = Date.now();

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
        vectorStoreId,
        requireFileSearch: true,
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
        retrieval_notes: "Request failed before completing.",
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
