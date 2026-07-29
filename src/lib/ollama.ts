// Small, dependency-free adapter for the local Ollama API. Keeping this on the
// server means browser clients never learn the Ollama address or gateway token.

export interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

interface OllamaChunk {
  message?: { content?: unknown };
}

function ollamaUrl(path: string): string {
  const base = (process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  return `${base}${path}`;
}

function ollamaHeaders(): HeadersInit {
  const token = process.env.OLLAMA_GATEWAY_TOKEN;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Send a chat request to Ollama, or to the authenticated gateway in production. */
export async function ollamaChat(payload: Record<string, unknown>): Promise<Response> {
  const response = await fetch(ollamaUrl("/api/chat"), {
    method: "POST",
    headers: ollamaHeaders(),
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "");
    throw new Error(`Ollama request failed (${response.status}): ${details.slice(0, 300)}`);
  }
  return response;
}

/**
 * Ollama streams newline-delimited JSON. The coach UI already expects a plain
 * text stream, so expose only the generated text chunks to its route handler.
 */
export async function* ollamaTextChunks(response: Response): AsyncGenerator<string> {
  if (!response.body) throw new Error("Ollama returned no response body.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consumeLine = (line: string): string | null => {
    if (!line.trim()) return null;
    const chunk = JSON.parse(line) as OllamaChunk;
    return typeof chunk.message?.content === "string" ? chunk.message.content : null;
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const text = consumeLine(buffer.slice(0, newline));
      if (text) yield text;
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }

  const text = consumeLine(buffer);
  if (text) yield text;
}
