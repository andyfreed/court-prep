import { prisma } from "@/lib/db";
import { getOrCreateCase } from "@/lib/cases";
import UploadForm from "./UploadForm";

export const dynamic = "force-dynamic";

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

export default async function DocumentsPage() {
  const caseRecord = await getOrCreateCase();
  const documents = await prisma.document.findMany({
    where: { caseId: caseRecord.id },
    orderBy: { createdAt: "desc" },
  });
  const ingestJobs = await prisma.documentIngestJob.findMany({
    where: {
      caseId: caseRecord.id,
      status: { not: "done" },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Documents</h1>
        <p className="text-muted-foreground">
          Upload new documents and manage case sources for {caseRecord.name}.
        </p>
      </div>
      <UploadForm caseId={caseRecord.id} />
      {ingestJobs.length ? (
        <div className="space-y-3">
          <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Processing uploads
          </div>
          <div className="space-y-3">
            {ingestJobs.map((job) => (
              <div
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 text-sm"
              >
                <div className="space-y-1">
                  <div className="font-medium text-foreground">{job.filename}</div>
                  <div className="text-xs text-muted-foreground">
                    {job.mimeType ?? "Unknown type"} |{" "}
                    {job.sizeBytes ? formatBytes(job.sizeBytes) : "Unknown size"} |{" "}
                    {job.updatedAt.toLocaleString()}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Status: {job.status}
                    {job.error ? ` - ${job.error}` : ""}
                  </div>
                </div>
                <a
                  className="text-sm font-medium text-primary hover:underline"
                  href={job.blobUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open
                </a>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="space-y-3">
        <div className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Indexed files
        </div>
        {documents.length === 0 ? (
          <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
            No documents yet. Upload a PDF, image, or text file to start.
          </div>
        ) : (
          <div className="space-y-3">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4 text-sm"
              >
                <div className="space-y-1">
                  <div className="font-medium text-foreground">{doc.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {doc.mimeType ?? "Unknown type"} | {formatBytes(doc.size)} |{" "}
                    {doc.createdAt.toLocaleString()}
                  </div>
                </div>
                <a
                  className="text-sm font-medium text-primary hover:underline"
                  href={doc.blobUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open
                </a>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
