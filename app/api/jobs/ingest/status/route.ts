import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getOrCreateCase } from "@/lib/cases";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const caseId = req.nextUrl.searchParams.get("caseId") ?? undefined;
    const caseRecord = await getOrCreateCase(caseId);
    const jobs = await prisma.documentIngestJob.findMany({
      where: { caseId: caseRecord.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      caseId: caseRecord.id,
      jobs: jobs.map((job) => ({
        id: job.id,
        filename: job.filename,
        mimeType: job.mimeType,
        sizeBytes: job.sizeBytes,
        blobUrl: job.blobUrl,
        status: job.status,
        error: job.error,
        extractedTextBlobUrl: job.extractedTextBlobUrl,
        openaiFileId: job.openaiFileId,
        documentId: job.documentId,
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to load ingest status.", detail: String(error) },
      { status: 500 },
    );
  }
}
