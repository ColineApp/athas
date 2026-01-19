import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import type {
  AutocompleteError,
  AutocompleteProvider,
  AutocompleteRequest,
  AutocompleteResponse,
  AutocompleteStreamHandlers,
} from "./autocomplete-providers";

export const COLINE_TAB_API_URL = "https://coline.app/api/v1/tab/completions";
export const COLINE_PROVIDER_ID = "coline-tab";

const isTauriRuntime = () => {
  if (typeof window === "undefined") return false;
  const w = window as { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown };
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
};

const getFetch = () => (isTauriRuntime() ? tauriFetch : fetch);

async function parseColineError(response: Response): Promise<AutocompleteError> {
  try {
    const data = (await response.json()) as {
      error?: { code?: string; message?: string; request_id?: string };
    };
    if (data?.error) {
      return {
        status: response.status,
        code: data.error.code,
        message: data.error.message || "Coline API error",
        requestId: data.error.request_id,
      };
    }
  } catch {
    // Fall through to raw text
  }

  const raw = await response.text().catch(() => "");
  return {
    status: response.status,
    message: raw || `Coline API error (${response.status})`,
    raw,
  };
}

export async function requestColineCompletion(
  request: AutocompleteRequest,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AutocompleteResponse> {
  const fetchFn = getFetch();
  const response = await fetchFn(COLINE_TAB_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    throw await parseColineError(response);
  }

  const data = (await response.json()) as {
    suggestion: string;
    confidence?: number;
    latency_ms?: number;
    model?: string;
    tokenCount?: number;
  };
  return {
    suggestion: data.suggestion,
    confidence: data.confidence,
    latencyMs: data.latency_ms,
    model: data.model,
    tokenCount: data.tokenCount,
  };
}

export async function streamColineCompletion(
  request: AutocompleteRequest,
  apiKey: string,
  handlers: AutocompleteStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const fetchFn = getFetch();
  const response = await fetchFn(COLINE_TAB_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok) {
    handlers.onError(await parseColineError(response));
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    handlers.onError({
      status: 0,
      message: "No response body reader available",
    });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === "data: [DONE]") {
          handlers.onComplete();
          return;
        }
        if (!trimmed.startsWith("data: ")) continue;

        try {
          const payload = JSON.parse(trimmed.slice(6)) as { suggestion?: string };
          if (typeof payload.suggestion === "string") {
            handlers.onSuggestion(payload.suggestion);
          }
        } catch {
          // Ignore malformed lines
        }
      }
    }

    handlers.onComplete();
  } catch {
    handlers.onError({
      status: 0,
      message: "Error reading Coline stream",
    });
  } finally {
    reader.releaseLock();
  }
}

export async function validateColineApiKey(apiKey: string): Promise<boolean> {
  try {
    await requestColineCompletion(
      {
        text: "const x = ",
        cursorPosition: 10,
        maxTokens: 1,
        temperature: 0,
      },
      apiKey,
    );
    return true;
  } catch (error) {
    const err = error as AutocompleteError;
    if (err?.status === 401) {
      return false;
    }
    throw error;
  }
}

export const colineAutocompleteProvider: AutocompleteProvider = {
  id: COLINE_PROVIDER_ID,
  name: "Coline Tab",
  requiresApiKey: true,
  requestCompletion: requestColineCompletion,
  streamCompletion: streamColineCompletion,
  validateApiKey: validateColineApiKey,
};
