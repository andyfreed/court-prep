import { prisma } from "@/lib/db";
import DocumentSearch from "./DocumentSearch";

export const dynamic = "force-dynamic";

type DocumentDetailPageProps = {
  params: { documentVersionId: string };
  searchParams?: { page?: string };
};

export default async function DocumentDetailPage({
  params,
  searchParams,
}: DocumentDetailPageProps) {
  const document = await prisma.document.findUnique({
    where: { id: params.documentVersionId },
  });
  const ingestJob = document
    ? await prisma.documentIngestJob.findFirst({
        where: { documentId: document.id },
        orderBy: { updatedAt: "desc" },
      })
    : null;

  if (!document) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Document</h1>
        <p className="text-muted-foreground">Document not found.</p>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">{document.title}</h1>
        <p className="text-muted-foreground">
          Viewing document ID {document.id}
          {searchParams?.page ? ` (page ${searchParams.page})` : ""}.
        </p>
      </div>
      <div className="rounded-lg border bg-card p-4 text-sm">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Metadata
        </div>
        <div className="mt-2 space-y-1 text-sm text-foreground">
          <div>Type: {document.mimeType ?? "Unknown"}</div>
          <div>Size: {document.size ?? "Unknown"} bytes</div>
          <div>Uploaded: {document.createdAt.toLocaleString()}</div>
          <div>Status: {ingestJob?.status ?? "uploaded"}</div>
          {ingestJob?.error ? <div>Error: {ingestJob.error}</div> : null}
        </div>
      </div>
      <a
        className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
        href={document.blobUrl}
        target="_blank"
        rel="noreferrer"
      >
        Open document
      </a>
      <DocumentSearch extractedTextUrl={ingestJob?.extractedTextBlobUrl ?? null} />
    </section>
  );
}
