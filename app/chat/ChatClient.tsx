"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { ChatResponse, SourceRef } from "@/lib/schemas";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: unknown;
  createdAt: string;
};

type DocumentListEntry = {
  document_version_id: string;
  title: string;
  fileName: string;
  docType: string | null;
  uploadedAt: string;
  description: string | null;
};

type ChatClientProps = {
  caseId: string;
  threadId: string;
  threadTitle: string;
  initialMessages: ChatMessage[];
};

function getSourceLabel(source: SourceRef) {
  return source.locator?.label || source.ref_type;
}

function getSourceHref(source: SourceRef) {
  if (source.ref_type === "document" && source.document_version_id) {
    const page = source.locator?.page_start ?? null;
    return page ? `/documents/${source.document_version_id}?page=${page}` : `/documents/${source.document_version_id}`;
  }
  if (source.ref_type === "transcript_message") {
    const ids = source.transcript_message_ids?.join(",") ?? "";
    return `/transcripts${ids ? `?ids=${encodeURIComponent(ids)}` : ""}`;
  }
  return null;
}

function SourceChip({ source }: { source: SourceRef }) {
  const href = getSourceHref(source);
  const label = getSourceLabel(source);
  const detail = source.locator?.page_start ? `p.${source.locator.page_start}` : null;
  const text = detail ? `${label} • ${detail}` : label;

  if (href) {
    return (
      <a
        href={href}
        className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {text}
      </a>
    );
  }

  return (
    <span className="inline-flex items-center rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
      {text}
    </span>
  );
}

function SourceList({ sources }: { sources: SourceRef[] }) {
  if (!sources.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((source, index) => (
        <SourceChip key={`${source.ref_type}-${index}`} source={source} />
      ))}
    </div>
  );
}

function AssistantMessage({ response }: { response: ChatResponse }) {
  const [showRaw, setShowRaw] = useState(false);

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Answer
          </h3>
          <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
            Confidence: {response.answer.confidence}
          </span>
        </div>
        <p className="font-medium text-foreground">{response.answer.summary}</p>
        <p className="text-muted-foreground">{response.answer.direct_answer}</p>
      </div>

      {response.evidence.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence
          </h3>
          <div className="space-y-3">
            {response.evidence.map((item, index) => (
              <div key={`${item.claim}-${index}`} className="space-y-2">
                <p className="text-sm text-foreground">• {item.claim}</p>
                <SourceList sources={item.source_refs} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {response.what_helps.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What Helps
          </h3>
          <div className="space-y-3">
            {response.what_helps.map((item, index) => (
              <div key={`${item.point}-${index}`} className="space-y-2">
                <p className="text-sm text-foreground">• {item.point}</p>
                <SourceList sources={item.source_refs} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {response.what_hurts.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            What Hurts
          </h3>
          <div className="space-y-3">
            {response.what_hurts.map((item, index) => (
              <div key={`${item.point}-${index}`} className="space-y-2">
                <p className="text-sm text-foreground">• {item.point}</p>
                <SourceList sources={item.source_refs} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {response.next_steps.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Next Steps
          </h3>
          <div className="space-y-3">
            {response.next_steps.map((item, index) => (
              <div key={`${item.action}-${index}`} className="space-y-1 text-sm">
                <div className="font-medium text-foreground">• {item.action}</div>
                <div className="text-xs text-muted-foreground">
                  Owner: {item.owner} · Priority: {item.priority}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {response.questions_for_lawyer.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Questions For Lawyer
          </h3>
          <div className="space-y-3">
            {response.questions_for_lawyer.map((item, index) => (
              <div key={`${item.question}-${index}`} className="space-y-2">
                <p className="text-sm text-foreground">• {item.question}</p>
                <p className="text-xs text-muted-foreground">{item.why_it_matters}</p>
                <SourceList sources={item.source_refs} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {response.missing_or_requested_docs.length ? (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Missing Documents
          </h3>
          <div className="space-y-3">
            {response.missing_or_requested_docs.map((item, index) => (
              <div key={`${item.doc_name}-${index}`} className="space-y-1 text-sm">
                <div className="font-medium text-foreground">• {item.doc_name}</div>
                <div className="text-xs text-muted-foreground">{item.why}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setShowRaw((prev) => !prev)}
        >
          {showRaw ? "Hide raw JSON" : "Show raw JSON"}
        </button>
        {showRaw ? (
          <pre className="mt-3 max-h-96 overflow-auto rounded-lg border bg-card p-4 text-xs text-muted-foreground">
            {JSON.stringify(response, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function DocumentsListMessage({ documents }: { documents: DocumentListEntry[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Documents On File
      </h3>
      {documents.length === 0 ? (
        <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          No documents uploaded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {documents.map((doc) => (
            <div key={doc.document_version_id} className="rounded-lg border bg-card p-4">
              <div className="text-sm font-medium text-foreground">{doc.title}</div>
              <div className="text-xs text-muted-foreground">
                {doc.fileName} · {doc.docType ?? "Unknown type"} ·{" "}
                {new Date(doc.uploadedAt).toLocaleString()}
              </div>
              <a
                className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
                href={`/documents/${doc.document_version_id}`}
              >
                Open
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      {message}
    </div>
  );
}

function isDocumentListQuery(message: string) {
  return /what documents are on file|documents on file|list documents|what docs do we have/i.test(
    message,
  );
}

export default function ChatClient({
  caseId,
  threadId,
  threadTitle,
  initialMessages,
}: ChatClientProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const threadList = useMemo(
    () => [{ id: threadId, title: threadTitle }],
    [threadId, threadTitle],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    setError(null);
    setIsSending(true);

    const optimisticUser: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: { text: trimmed },
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticUser]);
    setInput("");

    try {
      let documentsList: DocumentListEntry[] | null = null;

      if (isDocumentListQuery(trimmed)) {
        const listResponse = await fetch(`/api/documents/list?caseId=${caseId}`);
        if (!listResponse.ok) {
          throw new Error("Failed to load document list.");
        }
        const listPayload = (await listResponse.json()) as {
          documents: DocumentListEntry[];
        };
        documentsList = listPayload.documents ?? [];
        setMessages((prev) => [
          ...prev,
          {
            id: `docs-${Date.now()}`,
            role: "assistant",
            content: { type: "documents_list", documents: documentsList },
            createdAt: new Date().toISOString(),
          },
        ]);
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          threadId,
          message: documentsList
            ? "Based on the documents on file, what is missing or should I upload next?"
            : trimmed,
          originalMessage: trimmed,
          documentsList: documentsList ?? undefined,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Chat failed.");
      }

      const data = (await response.json()) as ChatResponse;
      const assistant: ChatMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: data,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistant]);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Chat failed.";
      setError(errorMessage);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: { type: "error", message: errorMessage },
          createdAt: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
      <aside className="rounded-xl border bg-card p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Threads
        </h2>
        <div className="mt-3 space-y-2">
          {threadList.map((thread) => (
            <div
              key={thread.id}
              className="rounded-lg border bg-background px-3 py-2 text-sm font-medium"
            >
              {thread.title}
            </div>
          ))}
        </div>
      </aside>

      <section className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Case Chat</h1>
          <p className="text-muted-foreground">
            Ask questions grounded in your case documents and get cited answers.
          </p>
        </div>

        <div className="space-y-6">
          {messages.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              No messages yet. Upload documents and ask a question to get started.
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={message.role === "user" ? "space-y-2" : "space-y-4"}
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {message.role === "user" ? "You" : "Assistant"}
                </div>
                {message.role === "user" ? (
                  <div className="rounded-2xl border bg-card px-4 py-3 text-sm text-foreground">
                    {(message.content as { text?: string })?.text ?? ""}
                  </div>
                ) : (
                  <>
                    {(message.content as { type?: string })?.type ===
                    "documents_list" ? (
                      <DocumentsListMessage
                        documents={
                          (message.content as { documents?: DocumentListEntry[] })
                            ?.documents ?? []
                        }
                      />
                    ) : (message.content as { type?: string })?.type === "error" ? (
                      <ErrorMessage
                        message={(message.content as { message?: string })?.message ?? ""}
                      />
                    ) : (
                      <AssistantMessage response={message.content as ChatResponse} />
                    )}
                  </>
                )}
              </div>
            ))
          )}
        </div>

        <form className="space-y-3" onSubmit={handleSend}>
          <textarea
            className="min-h-[120px] w-full rounded-lg border bg-background px-3 py-2 text-sm"
            placeholder="Ask a question about custody schedules, agreements, or evidence..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          <Button type="submit" disabled={isSending}>
            {isSending ? "Sending..." : "Send"}
          </Button>
        </form>
        <div ref={bottomRef} />
      </section>
    </div>
  );
}
