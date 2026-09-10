/**
 * Read a streamed UTF-8 Coach reply and expose the complete text after each
 * decoded chunk. TextDecoder's final flush matters when a response ends on a
 * partial multi-byte sequence.
 */
export async function readCoachStream(
  stream: ReadableStream<Uint8Array>,
  onText: (text: string) => void,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (!chunk) continue;
      text += chunk;
      onText(text);
    }
    const tail = decoder.decode();
    if (tail) {
      text += tail;
      onText(text);
    }
    return text;
  } finally {
    reader.releaseLock();
  }
}
