import { NextRequest, NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob";

import { prisma } from "@/lib/db";
import { ensureVectorStore } from "@/lib/cases";
import { getOpenAI } from "@/lib/openai";

export const runtime = "nodejs";

type UploadPayload = {
  caseId?: string;
  title?: string;
  originalName?: string;
  size?: number;
  mimeType?: string;
};

function parsePayload(payload: string | null): UploadPayload {
  if (!payload) return {};
  try {
    return JSON.parse(payload) as UploadPayload;
  } catch {
    return {};
  }
}

function getFileName(pathname: string, fallback: string) {
  const parts = pathname.split("/");
  return parts[parts.length - 1] || fallback;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const payload = parsePayload(clientPayload);
        return {
          tokenPayload: JSON.stringify(payload),
          addRandomSuffix: true,
          allowOverwrite: false,
          maximumSizeInBytes: 200 * 1024 * 1024,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parsePayload(tokenPayload ?? null);
        try {
          const { caseRecord, vectorStoreId } = await ensureVectorStore(
            payload.caseId,
          );
          const fileName = getFileName(blob.pathname, "upload.bin");
          const response = await fetch(blob.downloadUrl ?? blob.url);

          if (!response.ok) {
            throw new Error("Failed to fetch uploaded blob.");
          }

          const arrayBuffer = await response.arrayBuffer();
          const file = new File([arrayBuffer], payload.originalName ?? fileName, {
            type: payload.mimeType ?? blob.contentType ?? "application/octet-stream",
          });

          const openaiFile = await getOpenAI().files.create({
            file,
            purpose: "assistants",
          });

          await getOpenAI().vectorStores.files.create(vectorStoreId, {
            file_id: openaiFile.id,
          });

          await prisma.document.create({
            data: {
              caseId: caseRecord.id,
              title: payload.title ?? payload.originalName ?? fileName,
              blobUrl: blob.url,
              openaiFileId: openaiFile.id,
              vectorStoreId,
              mimeType: payload.mimeType ?? blob.contentType ?? null,
              size: payload.size ?? null,
            },
          });
        } catch (error) {
          console.error("Upload completion failed:", error);
        }
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Upload failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
