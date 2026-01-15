"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";

type IngestJob = {
  id: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  blobUrl: string;
  status: string;
  error: string | null;
  updatedAt: string;
};

type ProcessingUploadsProps = {
  caseId: string;
};

function formatBytes(bytes: number | null) {
  if (!bytes) return "Unknown size";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 && unit > 0 ? 1 : 0)} ${units[unit]}`;
}

export default function ProcessingUploads({ caseId }: ProcessingUploadsProps) {
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const pending = useMemo(
    () => jobs.filter((job) => job.status !== "done"),
    [jobs],
  );

  async function loadJobs() {
    const response = await fetch(`/api/jobs/ingest/status?caseId=${caseId}`);
    if (!response.ok) return;
    const payload = (await response.json()) as { jobs: IngestJob[] };
    setJobs(payload.jobs ?? []);
  }

  useEffect(() => {
    void loadJobs();
  }, [caseId]);

  useEffect(() => {
    if (pending.length === 0) return;
    const interval = setInterval(() => {
      void loadJobs();
    }, 5000);
    return () => clearInterval(interval);
  }, [pending.length]);

  async function handleProcessNow() {
    setIsProcessing(true);
    try {
      await fetch("/api/jobs/ingest/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caseId }),
      });
      await loadJobs();
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleRetry(jobId: string) {
    await fetch("/api/jobs/ingest/process", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId, jobIds: [jobId] }),
    });
    await loadJobs();
  }

  if (pending.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Processing uploads
        </div>
        <Button type="button" onClick={handleProcessNow} disabled={isProcessing}>
          {isProcessing ? "Processing..." : "Process now"}
        </Button>
      </div>
      <div className="space-y-3">
        {pending.map((job) => (
          <div
            key={job.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 text-sm"
          >
            <div className="space-y-1">
              <div className="font-medium text-foreground">{job.filename}</div>
              <div className="text-xs text-muted-foreground">
                {job.mimeType ?? "Unknown type"} | {formatBytes(job.sizeBytes)} |{" "}
                {new Date(job.updatedAt).toLocaleString()}
              </div>
              <div className="text-xs text-muted-foreground">
                Status: {job.status}
                {job.error ? ` - ${job.error}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {job.status === "error" ? (
                <Button type="button" variant="outline" onClick={() => handleRetry(job.id)}>
                  Retry
                </Button>
              ) : null}
              <a
                className="text-sm font-medium text-primary hover:underline"
                href={job.blobUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
