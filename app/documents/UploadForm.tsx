"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

import { Button } from "@/components/ui/button";

type UploadFormProps = {
  caseId: string;
};

export default function UploadForm({ caseId }: UploadFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!file) {
      setError("Choose a file to upload.");
      return;
    }

    try {
      setIsUploading(true);
      setProgress(0);

      await upload(`cases/${caseId}/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/documents/upload",
        clientPayload: JSON.stringify({
          caseId,
          title: title.trim() || undefined,
          originalName: file.name,
          size: file.size,
          mimeType: file.type || undefined,
        }),
        multipart: file.size > 10 * 1024 * 1024,
        onUploadProgress: (event) => setProgress(event.percentage),
      });

      setTitle("");
      setFile(null);
      setProgress(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setProgress(null);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form className="space-y-4 rounded-xl border bg-card p-6" onSubmit={handleSubmit}>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="title">
          Title (optional)
        </label>
        <input
          id="title"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="School report, text message export, medical note..."
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium" htmlFor="file">
          File
        </label>
        <input
          id="file"
          className="w-full rounded-md border bg-background px-3 py-2 text-sm"
          type="file"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>
      {progress !== null ? (
        <div className="text-xs text-muted-foreground">
          Uploading... {Math.round(progress)}%
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      <Button type="submit" disabled={isUploading}>
        {isUploading ? "Uploading..." : "Upload document"}
      </Button>
    </form>
  );
}
