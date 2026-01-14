import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <section className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-6">
        <div className="inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground">
          Custody Case Assistant
        </div>
        <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
          Document-grounded insights for custody prep, without the chaos.
        </h1>
        <p className="max-w-xl text-base text-muted-foreground md:text-lg">
          Upload documents, extract timelines, and generate lawyer-ready notes
          with citations. Built to surface strengths, risks, and missing
          evidence in a neutral, grounded way.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/chat">Start a case chat</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/documents">Upload documents</Link>
          </Button>
        </div>
      </div>
      <div className="space-y-4 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
        <div className="text-xs font-semibold uppercase tracking-wide text-foreground">
          Orchestration
        </div>
        <ol className="space-y-2">
          <li>1. Plan retrieval with targeted queries.</li>
          <li>2. Search case vector store for evidence.</li>
          <li>3. Synthesize JSON responses with citations.</li>
          <li>4. Enforce schema + citations automatically.</li>
          <li>5. Optional timeline + insights jobs.</li>
        </ol>
      </div>
    </section>
  );
}
