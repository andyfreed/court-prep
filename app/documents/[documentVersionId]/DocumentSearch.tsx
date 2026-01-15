"use client";

import { useEffect, useMemo, useState } from "react";

type DocumentSearchProps = {
  extractedTextUrl: string | null;
};

const MAX_TEXT_LENGTH = 200000;

export default function DocumentSearch({ extractedTextUrl }: DocumentSearchProps) {
  const [text, setText] = useState<string>("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    "idle",
  );

  useEffect(() => {
    if (!extractedTextUrl) return;
    let cancelled = false;
    setStatus("loading");
    fetch(extractedTextUrl)
      .then((response) => {
        if (!response.ok) {
          throw new Error("Failed to load extracted text.");
        }
        return response.text();
      })
      .then((data) => {
        if (cancelled) return;
        setText(data.slice(0, MAX_TEXT_LENGTH));
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [extractedTextUrl]);

  const matches = useMemo(() => {
    if (!query || !text) return [];
    const lowerText = text.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const results: Array<{ index: number; snippet: string }> = [];
    let index = lowerText.indexOf(lowerQuery);
    while (index !== -1 && results.length < 5) {
      const start = Math.max(0, index - 80);
      const end = Math.min(text.length, index + lowerQuery.length + 80);
      results.push({ index, snippet: text.slice(start, end).trim() });
      index = lowerText.indexOf(lowerQuery, index + lowerQuery.length);
    }
    return results;
  }, [query, text]);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Find in document
      </div>
      <input
        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
        placeholder="Search extracted text..."
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={!extractedTextUrl || status === "loading"}
      />
      {!extractedTextUrl ? (
        <p className="text-xs text-muted-foreground">
          Search will be available after extraction completes.
        </p>
      ) : status === "loading" ? (
        <p className="text-xs text-muted-foreground">Loading extracted text...</p>
      ) : status === "error" ? (
        <p className="text-xs text-red-500">Could not load extracted text.</p>
      ) : query ? (
        <div className="space-y-2">
          <div className="text-xs text-muted-foreground">
            Showing {matches.length} of the first matches.
          </div>
          {matches.map((match) => (
            <div
              key={`${match.index}-${match.snippet}`}
              className="rounded-md border bg-background p-3 text-xs text-muted-foreground"
            >
              {match.snippet}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
