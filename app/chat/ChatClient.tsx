"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  status?: string;
  ingestError?: string | null;
};

type ChatClientProps = {
  caseId: string;
  threadId: string;
  threadTitle: string;
  threads: Array<{ id: string; title: string }>;
  initialMessages: ChatMessage[];
};

function getSourceLabel(source: SourceRef) {
  return source.locator.label || source.ref_type;
}

function getSourceHref(source: SourceRef) {
  if (source.ref_type === "document" && source.document_version_id) {
    const pageStart = source.locator.page_start ?? null;
    const pageParam = pageStart ? `?page=${pageStart}` : "";
    return `/documents/${source.document_version_id}${pageParam}`;
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
  const pageStart = source.locator.page_start ?? null;
  const pageEnd = source.locator.page_end ?? null;
  const detail = pageStart
    ? pageEnd && pageEnd !== pageStart
      ? `p.${pageStart}-${pageEnd}`
      : `p.${pageStart}`
    : null;
  const text = detail ? `${label} ${detail}` : label;

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

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function getRequestId(notes?: string | null) {
  if (!notes) return null;
  const match = notes.match(/requestId=([a-f0-9-]+)/i);
  return match ? match[1] : null;
}

function isPartialResponse(response: ChatResponse) {
  const summary = response.answer.summary.toLowerCase();
  const notes = response.meta?.retrieval_notes?.toLowerCase() ?? "";
  return (
    summary.includes("retrieved evidence excerpts") ||
    notes.includes("stage 1") ||
    notes.includes("timed out")
  );
}

function truncateQuote(text: string | null | undefined, maxLength: number) {
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function getEvidenceQuote(sources: SourceRef[]) {
  for (const source of sources) {
    if (source.locator.quote) {
      return source.locator.quote;
    }
  }
  return null;
}

function buildCitationText(source: SourceRef, quote: string | null) {
  const label = getSourceLabel(source);
  const pageStart = source.locator.page_start ?? null;
  const pageEnd = source.locator.page_end ?? null;
  const detail = pageStart
    ? pageEnd && pageEnd !== pageStart
      ? `p.${pageStart}-${pageEnd}`
      : `p.${pageStart}`
    : null;
  const lead = detail ? `${label} (${detail})` : label;
  const snippet = quote ? truncateQuote(quote, 320) : "";
  return snippet ? `${lead} ${snippet}` : lead;
}

type AssistantMessageProps = {
  response: ChatResponse;
  onRetry?: () => void;
};

function AssistantMessage({ response, onRetry }: AssistantMessageProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [copiedCitationId, setCopiedCitationId] = useState<string | null>(null);
  const [copiedRaw, setCopiedRaw] = useState(false);
  const partial = isPartialResponse(response);
  const requestId = getRequestId(response.meta?.retrieval_notes);

  async function handleCopyCitation(id: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCitationId(id);
      setTimeout(() => setCopiedCitationId(null), 2000);
    } catch {
      setCopiedCitationId(null);
    }
  }

  async function handleCopyRaw() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(response, null, 2));
      setCopiedRaw(true);
      setTimeout(() => setCopiedRaw(false), 2000);
    } catch {
      setCopiedRaw(false);
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          Confidence: {response.answer.confidence}
        </span>
      </div>
      {partial ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          <div className="font-semibold">Partial result (retrieval incomplete).</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onRetry}>
              Retry
            </Button>
            {requestId ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard.writeText(requestId)}
              >
                Copy requestId
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="space-y-2">
        <p className="text-base font-semibold text-foreground">
          {response.answer.summary}
        </p>
        <div className="prose prose-sm max-w-none text-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {response.answer.direct_answer}
          </ReactMarkdown>
        </div>
      </div>

      {response.evidence.length ? (
        <details className="rounded-lg border bg-background/40 p-3">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Evidence
          </summary>
          <div className="mt-3 space-y-3">
            {response.evidence.map((item, index) => {
              const quote = getEvidenceQuote(item.source_refs);
              const firstSource = item.source_refs[0];
              const citationText = firstSource
                ? buildCitationText(firstSource, quote)
                : item.claim;
              return (
                <div key={`${item.claim}-${index}`} className="space-y-2">
                  <p className="text-sm text-foreground">- {item.claim}</p>
                  {quote ? (
                    <div className="rounded-md border bg-card p-3 text-xs text-muted-foreground">
                      "{truncateQuote(quote, 320)}"
                    </div>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-2">
                    <SourceList sources={item.source_refs} />
                    {firstSource ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleCopyCitation(`${item.claim}-${index}`, citationText)}
                      >
                        {copiedCitationId === `${item.claim}-${index}`
                          ? "Copied"
                          : "Copy citation"}
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
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
          <div className="mt-3 space-y-2">
            <Button type="button" size="sm" variant="outline" onClick={handleCopyRaw}>
              {copiedRaw ? "Copied" : "Copy raw JSON"}
            </Button>
            <pre className="max-h-96 overflow-auto rounded-lg border bg-card p-4 text-xs text-muted-foreground">
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  const isAuth = /session expired|session\/auth issue/i.test(message);
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <div>{message}</div>
      {isAuth ? (
        <a className="mt-2 inline-flex text-sm font-medium underline" href="/login">
          Go to login
        </a>
      ) : null}
    </div>
  );
}

function isDocumentListQuery(message: string) {
  return /what documents are (on file|uploaded)|documents on file|list documents|what docs do we have|what files are uploaded|list files|list the files|list uploaded files|show uploaded files|what files do we have|what files are there/i.test(
    message,
  );
}

export default function ChatClient({
  caseId,
  threadId,
  threadTitle,
  threads,
  initialMessages,
}: ChatClientProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastUserMessageRef = useRef<string | null>(null);

  const threadList = useMemo(() => threads, [threads]);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const element = list;

    function handleScroll() {
      const threshold = 180;
      const { scrollTop, scrollHeight, clientHeight } = element;
      setIsNearBottom(scrollHeight - scrollTop - clientHeight < threshold);
    }

    handleScroll();
    element.addEventListener("scroll", handleScroll, { passive: true });
    return () => element.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isNearBottom) {
      const list = listRef.current;
      if (!list) return;
      list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isNearBottom]);

  async function handleCopy(message: ChatMessage) {
    const text =
      message.role === "user"
        ? String((message.content as { text?: string })?.text ?? "")
        : [
            (message.content as ChatResponse)?.answer?.summary ?? "",
            (message.content as ChatResponse)?.answer?.direct_answer ?? "",
          ]
            .filter(Boolean)
            .join("\n\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(message.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      setCopiedId(null);
    }
  }

  async function sendMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    setError(null);
    setIsSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 180000);

    const optimisticUser: ChatMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: { text: trimmed },
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticUser]);
    setInput("");
    lastUserMessageRef.current = trimmed;

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
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caseId,
          threadId,
          message: trimmed,
          originalMessage: trimmed,
          documentsList: documentsList ?? undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? "Chat failed.");
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(
          `Session/auth issue. Status ${response.status}. Please reload and sign in again.`,
        );
      }

      if (response.redirected && response.url.includes("/login")) {
        throw new Error("Session expired. Please sign in again.");
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
      const errorMessage =
        err instanceof Error && err.name === "AbortError"
          ? "Request timed out. Please try again."
          : err instanceof Error
            ? err.message
            : "Chat failed.";
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
      window.clearTimeout(timeoutId);
      setIsSending(false);
      abortRef.current = null;
    }
  }

  async function handleCreateThread() {
    const response = await fetch("/api/threads/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId }),
    });
    if (!response.ok) {
      setError("Failed to create a new chat.");
      return;
    }
    const payload = (await response.json()) as { thread?: { id: string } };
    if (payload.thread?.id) {
      router.push(`/chat?threadId=${payload.thread.id}`);
      router.refresh();
    }
  }

  async function handleDeleteThread(targetThreadId: string) {
    const confirmed = window.confirm("Delete this chat? This cannot be undone.");
    if (!confirmed) return;
    const response = await fetch("/api/threads/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: targetThreadId }),
    });
    if (!response.ok) {
      setError("Failed to delete the chat.");
      return;
    }
    const payload = (await response.json()) as { nextThreadId?: string };
    const next = payload.nextThreadId ?? "";
    if (next) {
      router.push(`/chat?threadId=${next}`);
      router.refresh();
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[240px_1fr] h-[calc(100vh-120px)]">
      <aside className="hidden rounded-xl border bg-card p-4 lg:block">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Threads
          </h2>
          <Button type="button" size="sm" variant="outline" onClick={handleCreateThread}>
            New
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {threadList.map((thread) => (
            <div
              key={thread.id}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-medium ${
                thread.id === threadId ? "bg-card" : "bg-background"
              }`}
            >
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => router.push(`/chat?threadId=${thread.id}`)}
              >
                {thread.title}
              </button>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => handleDeleteThread(thread.id)}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 flex-col space-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Case Chat</h1>
          <p className="text-muted-foreground">
            Ask questions grounded in your case documents and get cited answers.
          </p>
        </div>

        <div
          ref={listRef}
          className="flex-1 space-y-4 overflow-y-auto rounded-xl border bg-background p-4"
        >
          {messages.length === 0 ? (
            <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
              No messages yet. Upload documents and ask a question to get started.
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex flex-col gap-2 ${
                  message.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>
                    {message.role === "user" ? "You" : "Assistant"} - {" "}
                    {formatTimestamp(message.createdAt)}
                  </span>
                  <button
                    type="button"
                    className="text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => handleCopy(message)}
                  >
                    {copiedId === message.id ? "Copied" : "Copy"}
                  </button>
                </div>
                {message.role === "user" ? (
                  <div className="max-w-[85%] rounded-2xl bg-foreground px-4 py-3 text-sm text-background shadow-sm">
                    {(message.content as { text?: string })?.text ?? ""}
                  </div>
                ) : (
                  <div className="max-w-[85%] rounded-2xl border bg-card px-4 py-3 shadow-sm">
                    {(message.content as { type?: string })?.type === "error" ? (
                      <ErrorMessage
                        message={(message.content as { message?: string })?.message ?? ""}
                      />
                    ) : (
                      <AssistantMessage
                        response={message.content as ChatResponse}
                        onRetry={() => {
                          if (lastUserMessageRef.current) {
                            void sendMessage(lastUserMessageRef.current);
                          }
                        }}
                      />
                    )}
                  </div>
                )}
              </div>
            ))
          )}
          {isSending ? (
            <div className="flex flex-col items-start gap-2">
              <div className="text-[11px] text-muted-foreground">Assistant - typing...</div>
              <div className="rounded-2xl border bg-card px-4 py-3 text-sm text-muted-foreground">
                Thinking...
              </div>
            </div>
          ) : null}
        </div>

        {!isNearBottom ? (
          <div className="flex justify-end">
            <button
              type="button"
              className="rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                const list = listRef.current;
                if (list) {
                  list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
                }
              }}
            >
              Jump to latest
            </button>
          </div>
        ) : null}
        <form
          className="sticky bottom-0 space-y-3 border-t bg-background/95 p-4 backdrop-blur"
          onSubmit={(event) => {
            event.preventDefault();
            void sendMessage(input);
          }}
        >
          <textarea
            className="min-h-[100px] w-full resize-none rounded-lg border bg-background px-3 py-2 text-sm"
            placeholder="Ask a question about custody schedules, agreements, or evidence..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage(input);
              }
            }}
          />
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button type="submit" disabled={isSending}>
              {isSending ? "Sending..." : "Send"}
            </Button>
            {isSending ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => abortRef.current?.abort()}
              >
                Stop generating
              </Button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}
