import OpenAI from "openai";

let client: OpenAI | null = null;

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  if (!client) {
    client = new OpenAI({ apiKey });
  }

  return client;
}

export function buildResponsesParams<T extends Record<string, unknown>>(base: T): T {
  return { ...base };
}
