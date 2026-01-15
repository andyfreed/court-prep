import { NextRequest, NextResponse } from "next/server";

import { ensureVectorStore, getOrCreateDefaultThread } from "@/lib/cases";
import { getOpenAI } from "@/lib/openai";
import { prisma } from "@/lib/db";
import {
  ChatResponseSchema,
  type ChatResponse,
} from "@/lib/schemas";
import {
  MAIN_CHAT_SYSTEM_PROMPT,
  SEARCH_PLAN_PROMPT,
} from "@/lib/prompts";

export const runtime = "nodejs";

type SearchPlan = {
  search_queries: string[];
  needed_sources: Array<"document" | "transcript_message" | "email">;
  time_window_hint: { start: string | null; end: string | null };
  key_entities: string[];
  should_update_timeline: boolean;
  should_create_lawyer_note: boolean;
};

type RetrievedSource = {
  document_version_id: string;
  label: string;
  locator: {
    page_start?: number | null;
    page_end?: number | null;
    section?: string | null;
    quote?: string | null;
  };
  excerpt?: string | null;
};

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

function extractFileSearchResults(response: any) {
  const output = Array.isArray(response?.output) ? response.output : [];
  const results: any[] = [];
  for (const item of output) {
    if (item?.type === "file_search_call" && Array.isArray(item?.results)) {
      results.push(...item.results);
    }
  }
  return results;
}

async function runResponse(params: {
  instructions: string;
  input: string;
  vectorStoreId?: string;
  requireFileSearch?: boolean;
}) {
  const tools = params.vectorStoreId
    ? [
        {
          type: "file_search" as const,
          vector_store_ids: [params.vectorStoreId],
        },
      ]
    : undefined;

  const response = await getOpenAI().responses.create({
    model: "gpt-5.2-pro",
    instructions: params.instructions,
    input: params.input,
    tools,
    tool_choice: tools ? (params.requireFileSearch ? "required" : "auto") : undefined,
    include: params.vectorStoreId ? ["file_search_call.results"] : undefined,
  });

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

async function buildSearchPlan(message: string) {
  const planResponse = await runResponse({
    instructions: SEARCH_PLAN_PROMPT,
    input: message,
  });
  try {
    return JSON.parse(extractJson(planResponse.text)) as SearchPlan;
  } catch {
    return {
      search_queries: [message],
      needed_sources: ["document"],
      time_window_hint: { start: null, end: null },
      key_entities: [],
      should_update_timeline: false,
      should_create_lawyer_note: false,
    } satisfies SearchPlan;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = body?.message as string | undefined;
    const caseId = body?.caseId as string | undefined;
    const threadId = body?.threadId as string | undefined;
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

    const { caseRecord, thread } = await getOrCreateDefaultThread(caseId);
    const { vectorStoreId } = await ensureVectorStore(caseRecord.id);

    const threadRecord = threadId
      ? await prisma.chatThread.findFirst({
          where: { id: threadId, caseId: caseRecord.id },
        })
      : thread;

    if (!threadRecord) {
      return NextResponse.json({ error: "Invalid thread." }, { status: 404 });
    }

    const files = await getOpenAI().vectorStores.files.list(vectorStoreId);
    const hasIndexedFiles = (files?.data?.length ?? 0) > 0;

    await prisma.chatMessage.create({
      data: {
        caseId: caseRecord.id,
        threadId: threadRecord.id,
        role: "user",
        content: { text: message },
      },
    });

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
    const plan = await buildSearchPlan(message);

    const documentsContext = documentsList?.length
      ? `Documents on file (from DB): ${JSON.stringify(documentsList)}`
      : "Documents on file (from DB): none provided";

    const retrievalResults = await runRetrieval({
      message,
      vectorStoreId,
    });

    const retrievedSources: RetrievedSource[] = [];
    if (retrievalResults.length > 0) {
      const fileIds = Array.from(
        new Set(
          retrievalResults
            .map((item: any) => item?.file_id)
            .filter((id: string | undefined) => Boolean(id)),
        ),
      );
      const docs = await prisma.document.findMany({
        where: { openaiFileId: { in: fileIds } },
      });
      const docByFileId = new Map(docs.map((doc) => [doc.openaiFileId, doc]));

      for (const result of retrievalResults) {
        const doc = docByFileId.get(result.file_id);
        if (!doc) continue;
        retrievedSources.push({
          document_version_id: doc.id,
          label: doc.title,
          locator: {
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
      `SearchPlan: ${JSON.stringify(plan)}`,
      documentsContext,
      `RetrievedSources: ${JSON.stringify(retrievedSources)}`,
      `User question: ${message}`,
    ].join("\n\n");

    const citationInstruction = [
      MAIN_CHAT_SYSTEM_PROMPT,
      "You MUST cite using SourceRef objects with document_version_id from RetrievedSources.",
      "Do not cite filenames. Use only document_version_id values provided.",
    ].join("\n");

    const initialResponse = await runResponse({
      instructions: citationInstruction,
      input: baseInput,
      vectorStoreId,
      requireFileSearch: true,
    });

    let parsed = parseChatResponse(initialResponse.text);

    if (
      !parsed.success ||
      needsCitationRetry(parsed.data) ||
      validateCitationCoverage({
        parsed: parsed.success ? parsed.data : ({} as ChatResponse),
        hasFiles: hasIndexedFiles,
        message,
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
      });

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

    return NextResponse.json(parsed.data);
  } catch (error) {
    return NextResponse.json(
      { error: "Chat failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
