/**
 * Incremental newline-delimited-JSON reading.
 *
 * A streamed response gives NO alignment guarantees between chunks and lines.
 * `ReadableStream` hands over whatever the transport happened to deliver, so a
 * reader must survive all four of these on the same stream:
 *
 * 1. one line split across two (or ten) chunks;
 * 2. one chunk carrying several complete lines;
 * 3. a final line with no trailing newline;
 * 4. a multi-byte UTF-8 character split across a chunk boundary — the byte
 *    sequence for a single character arriving as `[0xE2, 0x9C]` then `[0x93]`.
 *
 * (4) is the one that looks like it cannot happen and does: decoding each
 * chunk independently turns the incomplete sequence into U+FFFD and CORRUPTS
 * the text, which for a JSON line means a parse error or, worse, a silently
 * mangled string. `TextDecoder` fixes it only when told the input is a
 * stream — `decode(chunk, { stream: true })` holds the partial sequence back
 * until the continuation bytes arrive.
 *
 * Kept free of `fetch`, `Response` and the Miro payload shape on purpose: this
 * is the piece with the interesting edge cases, so it is a pure state machine
 * that can be driven byte-for-byte by a test.
 */
export interface NdjsonLineReader {
  /** Feed one chunk; returns whatever COMPLETE lines it completed. */
  push(chunk: Uint8Array): string[];
  /**
   * Signal end-of-stream; returns the trailing line if the body did not end
   * with a newline (and flushes the decoder's pending bytes).
   */
  flush(): string[];
}

/** Drop blank lines and a `\r` left by CRLF framing. */
function normalize(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

export function createNdjsonLineReader(): NdjsonLineReader {
  const decoder = new TextDecoder();
  // Everything received but not yet terminated by a newline. Bounded in
  // practice by one line, because it is drained on every newline seen.
  let pending = "";

  return {
    push(chunk: Uint8Array): string[] {
      pending += decoder.decode(chunk, { stream: true });
      const parts = pending.split("\n");
      // The last element is either "" (the chunk ended exactly on a newline)
      // or a partial line. Either way it is NOT complete, so it stays.
      pending = parts.pop() ?? "";
      return normalize(parts);
    },

    flush(): string[] {
      // A final `decode()` with no argument flushes any bytes the decoder is
      // still holding for an incomplete sequence, so a truncated stream yields
      // a replacement character rather than losing the tail silently.
      pending += decoder.decode();
      const rest = pending;
      pending = "";
      return normalize([rest]);
    },
  };
}
