import OpenAI from "openai";

let client: OpenAI | null = null;

const UNSUPPORTED_FOR_REASONING = [
  "temperature",
  "top_p",
  "presence_penalty",
  "frequency_penalty",
] as const;

type ResponseCreateParams = Parameters<OpenAI["responses"]["create"]>[0];
type ResponseCreateOptions = Parameters<OpenAI["responses"]["create"]>[1];

function stripParams(
  params: ResponseCreateParams,
  keys: readonly string[],
): ResponseCreateParams {
  const copy = { ...(params as Record<string, unknown>) };
  for (const key of keys) {
    if (key in copy) {
      delete copy[key];
    }
  }
  return copy as ResponseCreateParams;
}

function shouldStripForModel(model: string) {
  return /gpt-5|reasoning/i.test(model);
}

function extractUnsupportedParam(message: string) {
  const match = message.match(/Unsupported parameter: ([a-zA-Z0-9_]+)/i);
  return match ? match[1] : null;
}

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

export function buildResponsesParams(base: ResponseCreateParams): ResponseCreateParams {
  const model = typeof base.model === "string" ? base.model : "";
  if (!model) return base;
  if (shouldStripForModel(model)) {
    return stripParams(base, UNSUPPORTED_FOR_REASONING);
  }
  return base;
}

export async function createResponses(
  base: ResponseCreateParams,
  options?: ResponseCreateOptions,
) {
  const client = getOpenAI();
  const sanitized = buildResponsesParams(base);
  try {
    return await client.responses.create(sanitized, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = (error as { status?: number }).status;
    const unsupported = extractUnsupportedParam(message);
    if (status === 400 && unsupported) {
      const retryParams = stripParams(sanitized as Record<string, unknown>, [
        unsupported,
        ...UNSUPPORTED_FOR_REASONING,
      ]);
      console.warn(
        JSON.stringify({
          event: "openai_retry_strip_param",
          model: base.model,
          unsupported,
        }),
      );
      return client.responses.create(retryParams as ResponseCreateParams, options);
    }
    throw error;
  }
}
