import { NextRequest, NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";

import { prisma } from "@/lib/db";
import { getOrCreateCase } from "@/lib/cases";

export const runtime = "nodejs";

type UploadPayload = {
  caseId?: string;
  title?: string;
  description?: string;
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
          maximumSizeInBytes: 2550 * 1024 * 1024,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        const payload = parsePayload(tokenPayload ?? null);
        try {
          const caseRecord = await getOrCreateCase(payload.caseId);
          const fallbackName = payload.originalName ?? "upload.bin";
          const fileName = getFileName(blob.pathname, fallbackName);
          await prisma.documentIngestJob.create({
            data: {
              caseId: caseRecord.id,
              filename: payload.title ?? fileName,
              mimeType: payload.mimeType ?? blob.contentType ?? null,
              sizeBytes: payload.size ?? null,
              blobUrl: blob.url,
              status: "uploaded",
            },
          });
        } catch (error) {
          console.error("Upload batch completion failed:", error);
        }
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: "Batch upload failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
