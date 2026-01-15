import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getOpenAI } from "@/lib/openai";
import { TimelineExtractResponseSchema } from "@/lib/schemas";
import { TIMELINE_EXTRACTION_PROMPT } from "@/lib/prompts";
import { getOrCreateCase } from "@/lib/cases";

export const runtime = "nodejs";

function extractJson(text: string) {
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error("No JSON object found in model output.");
  }
  return text.slice(first, last + 1);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const sourceText = body?.sourceText as string | undefined;
    const caseId = body?.caseId as string | undefined;
    const documentVersionId = body?.documentVersionId as string | undefined;

    if (!sourceText) {
      return NextResponse.json(
        { error: "Missing sourceText." },
        { status: 400 },
      );
    }

    const caseRecord = await getOrCreateCase(caseId);

    const input = [
      `Case ID: ${caseRecord.id}`,
      `Document version ID: ${documentVersionId ?? "unknown"}`,
      "Source text:",
      sourceText,
    ].join("\n\n");

    const response = await getOpenAI().responses.create({
      model: "gpt-5.2-pro",
      instructions: TIMELINE_EXTRACTION_PROMPT,
      input,
    });

    const payload = JSON.parse(extractJson(response.output_text ?? ""));
    const parsed = TimelineExtractResponseSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Timeline response failed schema validation.", issues: parsed.error },
        { status: 422 },
      );
    }

    const created = await prisma.$transaction(
      parsed.data.events.map((event) =>
        prisma.timelineEvent.create({
          data: {
            caseId: caseRecord.id,
            occurredAt: event.occurred_at ? new Date(event.occurred_at) : null,
            precision: event.precision,
            title: event.title,
            summary: event.summary,
            category: event.category,
            people: event.people,
            sourceRef: event.source_ref,
          },
        }),
      ),
    );

    return NextResponse.json({ events: created });
  } catch (error) {
    return NextResponse.json(
      { error: "Timeline extraction failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
