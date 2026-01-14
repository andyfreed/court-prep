import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";

import { prisma } from "@/lib/db";
import { ensureVectorStore } from "@/lib/cases";
import { openai } from "@/lib/openai";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");
    const title = (formData.get("title") as string | null) ?? undefined;
    const caseId = (formData.get("caseId") as string | null) ?? undefined;

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing file upload." }, { status: 400 });
    }

    const { caseRecord, vectorStoreId } = await ensureVectorStore(caseId);

    const blob = await put(`cases/${caseRecord.id}/${file.name}`, file, {
      access: "private",
    });

    const openaiFile = await openai.files.create({
      file,
      purpose: "assistants",
    });

    await openai.vectorStores.files.create(vectorStoreId, {
      file_id: openaiFile.id,
    });

    const document = await prisma.document.create({
      data: {
        caseId: caseRecord.id,
        title: title ?? file.name,
        blobUrl: blob.url,
        openaiFileId: openaiFile.id,
        vectorStoreId,
        mimeType: file.type || null,
        size: file.size ?? null,
      },
    });

    return NextResponse.json({ document });
  } catch (error) {
    return NextResponse.json(
      { error: "Upload failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
