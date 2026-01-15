import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getOpenAI } from "@/lib/openai";
import { InsightsResponseSchema } from "@/lib/schemas";
import { INSIGHTS_PROMPT } from "@/lib/prompts";
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
    const evidence = body?.evidence as string[] | undefined;
    const caseId = body?.caseId as string | undefined;
    const window = body?.window as { start: string | null; end: string | null } | undefined;

    if (!evidence || evidence.length === 0) {
      return NextResponse.json(
        { error: "Missing evidence snippets." },
        { status: 400 },
      );
    }

    const caseRecord = await getOrCreateCase(caseId);

    const input = [
      `Case ID: ${caseRecord.id}`,
      window ? `Window: ${JSON.stringify(window)}` : "Window: null",
      "Evidence snippets:",
      evidence.map((item, index) => `${index + 1}. ${item}`).join("\n"),
    ].join("\n\n");

    const response = await getOpenAI().responses.create({
      model: "gpt-5.2-pro",
      instructions: INSIGHTS_PROMPT,
      input,
    });

    const payload = JSON.parse(extractJson(response.output_text ?? ""));
    const parsed = InsightsResponseSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Insights response failed schema validation.", issues: parsed.error },
        { status: 422 },
      );
    }

    const stored = await prisma.insight.create({
      data: {
        caseId: caseRecord.id,
        content: parsed.data,
      },
    });

    return NextResponse.json({ insight: stored, content: parsed.data });
  } catch (error) {
    return NextResponse.json(
      { error: "Insights job failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
