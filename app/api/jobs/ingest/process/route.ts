import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import AdmZip from "adm-zip";
import pdfParse from "pdf-parse";
import mammoth from "mammoth";
import { htmlToText } from "html-to-text";
import { simpleParser } from "mailparser";
import { lookup as lookupMime } from "mime-types";
import type { DocumentIngestStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ensureVectorStore, getOrCreateCase } from "@/lib/cases";
import { createResponses, getOpenAI } from "@/lib/openai";
import { embedTexts, resolveEmbeddingStorage } from "@/lib/embeddings";
import { acquireMemoryRebuildLock, rebuildCaseMemory, releaseMemoryRebuildLock } from "@/lib/memory";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_CONCURRENCY = 12;
const MAX_JOBS = 50;

type ProcessRequest = {
  caseId?: string;
  jobIds?: string[];
};

type ExtractedPage = {
  pageNumber: number | null;
  text: string;
};

type ExtractResult = {
  text: string;
  pages: ExtractedPage[];
  warnings?: string[];
};

function getExtension(filename: string) {
  const match = filename.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function isImageExtension(ext: string) {
  return ["png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "webp"].includes(ext);
}

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fn(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${label} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchBlobBuffer(blobUrl: string) {
  const response = await withTimeout(
    (signal) => fetch(blobUrl, { signal }),
    20000,
    "blob_fetch",
  );
  if (!response.ok) {
    throw new Error(`Failed to download blob (${response.status}).`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function extractTextFromBuffer(params: {
  buffer: Buffer;
  filename: string;
  mimeType?: string | null;
  blobUrl: string;
}): Promise<ExtractResult> {
  const ext = getExtension(params.filename);

  if (ext === "pdf") {
    try {
      const pages: ExtractedPage[] = [];
      const data = await pdfParse(params.buffer, {
        pagerender: async (pageData) => {
          const textContent = await pageData.getTextContent();
          const pageText = textContent.items
            .map((item) => ("str" in item ? String(item.str) : ""))
            .join(" ");
          pages.push({ pageNumber: pageData.pageIndex + 1, text: pageText });
          return pageText;
        },
      });
      return { text: data.text, pages };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/password|encrypted/i.test(message)) {
        throw new Error("PDF is password-protected or encrypted.");
      }
      throw error;
    }
  }

  if (ext === "docx") {
    const data = await mammoth.extractRawText({ buffer: params.buffer });
    return { text: data.value, pages: [{ pageNumber: null, text: data.value }] };
  }

  if (["txt", "md", "rtf"].includes(ext)) {
    const text = params.buffer.toString("utf-8");
    return { text, pages: [{ pageNumber: null, text }] };
  }

  if (ext === "html" || ext === "htm") {
    const html = params.buffer.toString("utf-8");
    const text = htmlToText(html, { wordwrap: false });
    return { text, pages: [{ pageNumber: null, text }] };
  }

  if (ext === "csv") {
    const text = params.buffer.toString("utf-8");
    return { text, pages: [{ pageNumber: null, text }] };
  }

  if (ext === "eml") {
    const parsed = await simpleParser(params.buffer);
    const html = parsed.html ? htmlToText(String(parsed.html), { wordwrap: false }) : "";
    const body = parsed.text ?? html ?? "";
    const headers = [
      parsed.subject ? `Subject: ${parsed.subject}` : null,
      parsed.from?.text ? `From: ${parsed.from.text}` : null,
      parsed.to?.text ? `To: ${parsed.to.text}` : null,
      parsed.date ? `Date: ${parsed.date.toISOString()}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const text = [headers, body].filter(Boolean).join("\n\n");
    return { text, pages: [{ pageNumber: null, text }] };
  }

  if (ext === "msg") {
    const mod = await import("msgreader");
    const MsgReader = (mod as { default?: unknown }).default ?? mod;
    const reader = new (MsgReader as {
      new (data: Buffer): { getFileData: () => Record<string, unknown> | null };
    })(params.buffer);
    const data = reader.getFileData() ?? {};
    const bodyHtml = data?.bodyHTML
      ? htmlToText(String(data.bodyHTML), { wordwrap: false })
      : "";
    const body = (data?.body as string | undefined) ?? bodyHtml ?? "";
    const dateValue = data?.date;
    const date =
      typeof dateValue === "string" || typeof dateValue === "number" || dateValue instanceof Date
        ? new Date(dateValue)
        : null;
    const headers = [
      data?.subject ? `Subject: ${data.subject}` : null,
      data?.senderName ? `From: ${data.senderName}` : null,
      data?.senderEmail ? `FromEmail: ${data.senderEmail}` : null,
      data?.recipients ? `To: ${data.recipients}` : null,
      date ? `Date: ${date.toISOString()}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const text = [headers, body].filter(Boolean).join("\n\n");
    return { text, pages: [{ pageNumber: null, text }] };
  }

  if (isImageExtension(ext)) {
    const response = await withTimeout(
      (signal) =>
        createResponses(
          {
            model: "gpt-4o-mini",
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: "Extract all readable text from this image." },
                  { type: "input_image", image_url: params.blobUrl },
                ],
              },
            ],
            max_output_tokens: 1200,
          } as unknown as Parameters<typeof createResponses>[0],
          { signal },
        ),
      45000,
      "ocr",
    );
    const text = (response as { output_text?: string }).output_text ?? "";
    return { text, pages: [{ pageNumber: null, text }] };
  }

  throw new Error(`Unsupported file type: .${ext || "unknown"}`);
}

function chunkText(text: string, chunkSize: number, overlap: number) {
  const chunks: string[] = [];
  if (!text) return chunks;
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end === text.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function buildChunks(pages: ExtractedPage[]) {
  const result: Array<{ pageNumber: number | null; chunkIndex: number; text: string }> = [];
  let chunkIndex = 0;
  for (const page of pages) {
    const pageChunks = chunkText(page.text, 1000, 150);
    for (const text of pageChunks) {
      result.push({
        pageNumber: page.pageNumber,
        chunkIndex,
        text,
      });
      chunkIndex += 1;
    }
  }
  return result;
}

async function expandZip(params: {
  caseId: string;
  parentJobId: string;
  filename: string;
  buffer: Buffer;
}) {
  const zip = new AdmZip(params.buffer);
  const entries = (zip.getEntries() as Array<{
    entryName: string;
    isDirectory: boolean;
    getData: () => Buffer;
  }>).filter((entry) => !entry.isDirectory);

  for (const entry of entries) {
    const entryName = entry.entryName;
    const entryBuffer = entry.getData();
    const contentType = lookupMime(entryName) || "application/octet-stream";
    const blob = await put(
      `cases/${params.caseId}/uploads/${entryName}`,
      entryBuffer,
      {
        access: "public",
        contentType: String(contentType),
        addRandomSuffix: true,
      },
    );

    const document = await prisma.document.create({
      data: {
        caseId: params.caseId,
        title: entryName,
        blobUrl: blob.url,
        mimeType: String(contentType),
        size: entryBuffer.length,
      },
    });

    await prisma.documentIngestJob.create({
      data: {
        caseId: params.caseId,
        documentId: document.id,
        filename: entryName,
        mimeType: String(contentType),
        sizeBytes: entryBuffer.length,
        blobUrl: blob.url,
        status: "queued",
      },
    });
  }
}

async function processJob(jobId: string) {
  const job = await prisma.documentIngestJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;

  try {
    const existingDocument = job.documentId
      ? await prisma.document.findUnique({ where: { id: job.documentId } })
      : null;
    const document =
      existingDocument ??
      (await prisma.document.create({
        data: {
          caseId: job.caseId,
          title: job.filename,
          blobUrl: job.blobUrl,
          mimeType: job.mimeType ?? null,
          size: job.sizeBytes ?? null,
        },
      }));

    await prisma.documentIngestJob.update({
      where: { id: job.id },
      data: { status: "extracting", error: null },
    });

    const buffer = await fetchBlobBuffer(job.blobUrl);
    const ext = getExtension(job.filename);

    if (ext === "zip") {
      await expandZip({
        caseId: job.caseId,
        parentJobId: job.id,
        filename: job.filename,
        buffer,
      });
      await prisma.documentIngestJob.update({
        where: { id: job.id },
        data: { status: "done" },
      });
      return;
    }

    const extracted = await extractTextFromBuffer({
      buffer,
      filename: job.filename,
      mimeType: job.mimeType,
      blobUrl: job.blobUrl,
    });

    const textBlob = await put(
      `cases/${job.caseId}/extracted/${job.id}.txt`,
      extracted.text,
      {
        access: "public",
        contentType: "text/plain",
        addRandomSuffix: true,
      },
    );

    await prisma.documentIngestJob.update({
      where: { id: job.id },
      data: {
        status: "ready_to_index",
        extractedTextBlobUrl: textBlob.url,
      },
    });

    await prisma.documentIngestJob.update({
      where: { id: job.id },
      data: { status: "indexing" },
    });

    await prisma.documentChunk.deleteMany({ where: { documentId: document.id } });
    const chunks = buildChunks(extracted.pages);
    if (chunks.length > 0) {
      const embeddings = await embedTexts(chunks.map((chunk) => chunk.text));
      const storage = await resolveEmbeddingStorage();

      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i];
        const embedding = embeddings[i];
        const created = await prisma.documentChunk.create({
          data: {
            caseId: job.caseId,
            documentId: document.id,
            pageNumber: chunk.pageNumber,
            chunkIndex: chunk.chunkIndex,
            text: chunk.text,
            embeddingJson: embedding,
          },
        });

        if (storage === "vector") {
          const vectorLiteral = `[${embedding.join(",")}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE "DocumentChunk" SET "embedding" = '${vectorLiteral}'::vector WHERE "id" = '${created.id}'`,
          );
        }
      }
    }

    const { vectorStoreId } = await ensureVectorStore(job.caseId);
    const file = new File([extracted.text], `${job.filename}.txt`, {
      type: "text/plain",
    });

    const openaiFile = await withTimeout(
      (signal) =>
        getOpenAI().files.create(
          {
            file,
            purpose: "assistants",
          },
          { signal },
        ),
      45000,
      "openai_file_create",
    );

    await withTimeout(
      (signal) =>
        getOpenAI().vectorStores.files.create(
          vectorStoreId,
          { file_id: openaiFile.id },
          { signal },
        ),
      45000,
      "vector_store_attach",
    );

    const updatedDocument = await prisma.document.update({
      where: { id: document.id },
      data: {
        openaiFileId: openaiFile.id,
        vectorStoreId,
      },
    });

    await prisma.documentIngestJob.update({
      where: { id: job.id },
      data: {
        status: "done",
        openaiFileId: openaiFile.id,
        documentId: updatedDocument.id,
      },
    });

    const acquired = await acquireMemoryRebuildLock(job.caseId);
    if (acquired) {
      try {
        await rebuildCaseMemory({
          caseId: job.caseId,
          documentIds: [updatedDocument.id],
        });
      } finally {
        await releaseMemoryRebuildLock(job.caseId);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.documentIngestJob.update({
      where: { id: job.id },
      data: { status: "error", error: message },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as ProcessRequest | null;
    const caseId = body?.caseId;
    const caseRecord = await getOrCreateCase(caseId);

    const where = body?.jobIds?.length
      ? { id: { in: body.jobIds } }
      : {
          caseId: caseRecord.id,
          status: {
            in: ["queued", "uploaded", "ready_to_index", "error"] as DocumentIngestStatus[],
          },
        };

    const jobs = await prisma.documentIngestJob.findMany({
      where,
      orderBy: { createdAt: "asc" },
      take: MAX_JOBS,
    });

    for (let i = 0; i < jobs.length; i += MAX_CONCURRENCY) {
      const slice = jobs.slice(i, i + MAX_CONCURRENCY);
      await Promise.all(slice.map((job) => processJob(job.id)));
    }

    return NextResponse.json({
      caseId: caseRecord.id,
      processed: jobs.length,
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Ingest processing failed.", detail: String(error) },
      { status: 500 },
    );
  }
}
