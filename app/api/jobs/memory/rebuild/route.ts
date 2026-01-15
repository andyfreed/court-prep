import { NextRequest, NextResponse } from "next/server";

import { getOrCreateCase } from "@/lib/cases";
import { acquireMemoryRebuildLock, rebuildCaseMemory, releaseMemoryRebuildLock } from "@/lib/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { caseId?: string; documentIds?: string[] }
      | null;
    const caseRecord = await getOrCreateCase(body?.caseId);
    const acquired = await acquireMemoryRebuildLock(caseRecord.id);
    if (!acquired) {
      return NextResponse.json({ status: "in_progress" }, { status: 202 });
    }

    try {
      await rebuildCaseMemory({
        caseId: caseRecord.id,
        documentIds: body?.documentIds,
      });
    } finally {
      await releaseMemoryRebuildLock(caseRecord.id);
    }

    return NextResponse.json({ status: "completed" });
  } catch (error) {
    return NextResponse.json(
      { error: "Memory rebuild failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
