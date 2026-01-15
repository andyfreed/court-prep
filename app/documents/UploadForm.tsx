"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { Button } from "@/components/ui/button";

type UploadFormProps = {
  caseId: string;
};

type QueueStatus =
  | "queued"
  | "uploading"
  | "uploaded"
  | "extracting"
  | "ready_to_index"
  | "indexing"
  | "done"
  | "error";

type QueueItem = {
  id: string;
  file: File;
  title: string;
  description: string;
  status: QueueStatus;
  progress: number | null;
  error: string | null;
  blobUrl: string | null;
  jobId: string | null;
};

type IngestJob = {
  id: string;
  filename: string;
  blobUrl: string;
  status: QueueStatus;
  error: string | null;
  updatedAt: string;
};

const MAX_FILES = 50;
const MAX_BYTES = 2550 * 1024 * 1024;

function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

function createQueueItem(file: File, batchDescription: string): QueueItem {
  return {
    id: crypto.randomUUID(),
    file,
    title: file.name,
    description: batchDescription,
    status: "queued",
    progress: null,
    error: null,
    blobUrl: null,
    jobId: null,
  };
}

export default function UploadForm({ caseId }: UploadFormProps) {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [batchDescription, setBatchDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const pendingJobs = useMemo(
    () => queue.some((item) => ["queued", "uploading", "uploaded", "extracting", "ready_to_index", "indexing"].includes(item.status)),
    [queue],
  );

  useEffect(() => {
    if (!pendingJobs) return;

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/jobs/ingest/status?caseId=${caseId}`);
        if (!response.ok) return;
        const payload = (await response.json()) as { jobs: IngestJob[] };
        setQueue((prev) =>
          prev.map((item) => {
            const match = payload.jobs.find(
              (job) => job.id === item.jobId || job.blobUrl === item.blobUrl,
            );
            if (!match) return item;
            return {
              ...item,
              status: match.status,
              error: match.error,
              jobId: match.id,
            };
          }),
        );
      } catch {
        return;
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [pendingJobs, caseId]);

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);

    const list = Array.from(files);
    if (queue.length + list.length > MAX_FILES) {
      setError(`Batch limit is ${MAX_FILES} files.`);
      return;
    }

    const oversized = list.find((file) => file.size > MAX_BYTES);
    if (oversized) {
      setError(`${oversized.name} exceeds the ${formatBytes(MAX_BYTES)} limit.`);
      return;
    }

    setQueue((prev) => [...prev, ...list.map((file) => createQueueItem(file, batchDescription))]);
  }

  function removeFromQueue(id: string) {
    setQueue((prev) => prev.filter((item) => item.id != id));
  }

  function updateQueueItem(id: string, update: Partial<QueueItem>) {
    setQueue((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...update } : item)),
    );
  }

  async function handleUploadAll() {
    setError(null);
    const queued = queue.filter((item) => item.status === "queued" || item.status === "error");
    if (queued.length === 0) {
      setError("No files queued for upload.");
      return;
    }

    setIsUploading(true);

    for (const item of queued) {
      updateQueueItem(item.id, { status: "uploading", progress: 0, error: null });
      try {
        const blob = await upload(`cases/${caseId}/${item.file.name}`, item.file, {
          access: "public",
          handleUploadUrl: "/api/documents/upload-batch",
          clientPayload: JSON.stringify({
            caseId,
            title: item.title.trim() || undefined,
            description: item.description.trim() || undefined,
            originalName: item.file.name,
            size: item.file.size,
            mimeType: item.file.type || undefined,
          }),
          multipart: item.file.size > 10 * 1024 * 1024,
          onUploadProgress: (event) => updateQueueItem(item.id, { progress: event.percentage }),
        });
        updateQueueItem(item.id, {
          status: "uploaded",
          progress: null,
          blobUrl: blob.url,
        });
      } catch (err) {
        updateQueueItem(item.id, {
          status: "error",
          error: err instanceof Error ? err.message : "Upload failed.",
          progress: null,
        });
      }
    }

    try {
      await fetch("/api/jobs/ingest/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
    } catch {
      setError("Upload completed, but ingest did not start.");
    } finally {
      setIsUploading(false);
      router.refresh();
    }
  }

  async function handleRetry(item: QueueItem) {
    if (!item.jobId) return;
    updateQueueItem(item.id, { status: "uploaded", error: null });
    await fetch("/api/jobs/ingest/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, jobIds: [item.jobId] }),
    });
  }

  return (
    <div className="space-y-6">
      <div
        className={`rounded-xl border border-dashed p-6 text-sm ${isDragging ? "bg-card" : "bg-background"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          addFiles(event.dataTransfer.files);
        }}
      >
        <div className="space-y-2">
          <div className="text-sm font-medium">Drag and drop files here</div>
          <div className="text-xs text-muted-foreground">
            Supports PDF, DOCX, TXT, HTML, CSV, images, email files, and ZIP archives.
          </div>
          <input
            className="mt-3 w-full rounded-md border bg-background px-3 py-2 text-sm"
            type="file"
            multiple
            onChange={(event) => addFiles(event.target.files)}
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="batch-description">
          Batch description (optional)
        </label>
        <input
          id="batch-description"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="Notes that apply to every file in this batch"
          value={batchDescription}
          onChange={(event) => setBatchDescription(event.target.value)}
        />
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <div className="space-y-3">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Upload queue
        </div>
        {queue.length === 0 ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            No files queued yet.
          </div>
        ) : (
          <div className="space-y-3">
            {queue.map((item) => (
              <div key={item.id} className="rounded-lg border bg-card p-4 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="font-medium text-foreground">{item.file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.file.type || "Unknown type"} | {formatBytes(item.file.size)}
                    </div>
                    <div className="text-xs text-muted-foreground">Status: {item.status}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.status === "error" && item.jobId ? (
                      <Button type="button" variant="outline" onClick={() => handleRetry(item)}>
                        Retry
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => removeFromQueue(item.id)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Title</label>
                    <input
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={item.title}
                      onChange={(event) => updateQueueItem(item.id, { title: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Description</label>
                    <input
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={item.description}
                      onChange={(event) =>
                        updateQueueItem(item.id, { description: event.target.value })
                      }
                    />
                  </div>
                </div>
                {item.progress !== null ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Uploading... {Math.round(item.progress)}%
                  </div>
                ) : null}
                {item.error ? (
                  <div className="mt-2 text-xs text-red-500">{item.error}</div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <Button type="button" onClick={handleUploadAll} disabled={isUploading}>
        {isUploading ? "Uploading..." : "Upload batch"}
      </Button>
    </div>
  );
}
