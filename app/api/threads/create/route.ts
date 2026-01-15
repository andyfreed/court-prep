import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getOrCreateCase } from "@/lib/cases";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { caseId?: string; title?: string }
      | null;
    const caseRecord = await getOrCreateCase(body?.caseId);
    const title = body?.title?.trim() || "New chat";

    const thread = await prisma.chatThread.create({
      data: {
        caseId: caseRecord.id,
        title,
      },
    });

    return NextResponse.json({
      thread: {
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt.toISOString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to create chat thread.", detail: String(error) },
      { status: 500 },
    );
  }
}
