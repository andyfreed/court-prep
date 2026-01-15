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

  return response.output_text ?? "";
}

async function buildSearchPlan(message: string) {
  const planText = await runResponse({
    instructions: SEARCH_PLAN_PROMPT,
    input: message,
  });
  try {
    return JSON.parse(extractJson(planText)) as SearchPlan;
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

    const baseInput = [
      `Case ID: ${caseRecord.id}`,
      `SearchPlan: ${JSON.stringify(plan)}`,
      `User question: ${message}`,
    ].join("\n\n");

    const initialText = await runResponse({
      instructions: MAIN_CHAT_SYSTEM_PROMPT,
      input: baseInput,
      vectorStoreId,
      requireFileSearch: true,
    });

    const initialJson = extractJson(initialText);
    let parsed = ChatResponseSchema.safeParse(JSON.parse(initialJson));

    if (!parsed.success || needsCitationRetry(parsed.data)) {
      const enforcement = [
        MAIN_CHAT_SYSTEM_PROMPT,
        "Your last answer lacked sufficient citations or valid JSON.",
        "Rewrite and attach SourceRef citations for every key factual claim.",
        "If you cannot cite, mark it 'uncited inference' and move it to uncertainties.",
        "Return ONLY valid JSON for ChatResponse.",
      ].join("\n");

      const retryText = await runResponse({
        instructions: enforcement,
        input: baseInput,
        vectorStoreId,
        requireFileSearch: true,
      });

      const retryJson = extractJson(retryText);
      parsed = ChatResponseSchema.safeParse(JSON.parse(retryJson));
    }

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Model output failed schema validation.", issues: parsed.error },
        { status: 422 },
      );
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
