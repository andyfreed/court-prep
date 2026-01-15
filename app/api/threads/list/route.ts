import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getOrCreateCase } from "@/lib/cases";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const caseId = req.nextUrl.searchParams.get("caseId") ?? undefined;
    const caseRecord = await getOrCreateCase(caseId);
    const threads = await prisma.chatThread.findMany({
      where: { caseId: caseRecord.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      caseId: caseRecord.id,
      threads: threads.map((thread) => ({
        id: thread.id,
        title: thread.title,
        createdAt: thread.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list chat threads.", detail: String(error) },
      { status: 500 },
    );
  }
}
