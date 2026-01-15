import { NextRequest, NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";

import { prisma } from "@/lib/db";
import { getOrCreateCase } from "@/lib/cases";

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
          const caseRecord = await getOrCreateCase(payload.caseId);
          const fileName = getFileName(blob.pathname, "upload.bin");
          const document = await prisma.document.create({
            data: {
              caseId: caseRecord.id,
              title: payload.title ?? payload.originalName ?? fileName,
              blobUrl: blob.url,
              mimeType: payload.mimeType ?? blob.contentType ?? null,
              size: payload.size ?? null,
            },
          });

          await prisma.documentIngestJob.create({
            data: {
              caseId: caseRecord.id,
              documentId: document.id,
              filename: payload.title ?? payload.originalName ?? fileName,
              blobUrl: blob.url,
              mimeType: payload.mimeType ?? blob.contentType ?? null,
              sizeBytes: payload.size ?? null,
              status: "uploaded",
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
