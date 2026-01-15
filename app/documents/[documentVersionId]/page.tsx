import { prisma } from "@/lib/db";

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
      <a
        className="inline-flex items-center rounded-md border px-3 py-2 text-sm font-medium"
        href={document.blobUrl}
        target="_blank"
        rel="noreferrer"
      >
        Open document
      </a>
    </section>
  );
}
