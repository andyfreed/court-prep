import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getOrCreateCase } from "@/lib/cases";

export const runtime = "nodejs";

function getFileName(blobUrl: string, fallback: string) {
  try {
    const url = new URL(blobUrl);
    const parts = url.pathname.split("/");
    return parts[parts.length - 1] || fallback;
  } catch {
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  try {
    const caseId = req.nextUrl.searchParams.get("caseId") ?? undefined;
    const caseRecord = await getOrCreateCase(caseId);
    const documents = await prisma.document.findMany({
      where: { caseId: caseRecord.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      caseId: caseRecord.id,
      documents: documents.map((doc) => ({
        document_version_id: doc.id,
        title: doc.title,
        fileName: getFileName(doc.blobUrl, doc.title),
        docType: doc.mimeType ?? null,
        uploadedAt: doc.createdAt.toISOString(),
        description: null,
      })),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Failed to list documents.", detail: String(error) },
      { status: 500 },
    );
  }
}
