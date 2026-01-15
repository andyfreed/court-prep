import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { threadId?: string }
      | null;
    const threadId = body?.threadId;
    if (!threadId) {
      return NextResponse.json({ error: "Missing threadId." }, { status: 400 });
    }

    const thread = await prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!thread) {
      return NextResponse.json({ error: "Thread not found." }, { status: 404 });
    }

    await prisma.chatThread.delete({ where: { id: threadId } });

    const remaining = await prisma.chatThread.findMany({
      where: { caseId: thread.caseId },
      orderBy: { createdAt: "asc" },
    });

    let nextThread = remaining[0] ?? null;
    if (!nextThread) {
      nextThread = await prisma.chatThread.create({
        data: {
          caseId: thread.caseId,
          title: "New chat",
        },
      });
    }

    return NextResponse.json({
      nextThreadId: nextThread.id,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to delete chat thread.", detail: String(error) },
      { status: 500 },
    );
  }
}
