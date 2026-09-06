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
  // Everything received but not yet terminated by a newline: at most one line.
  //
  // "At most one line" is not the same as "small". The Miro import's terminal
  // `result` line carries the whole board as a SINGLE line — bounded by
  // `MiroService.MAX_ITEMS`, so ~15 MiB at 10,000 items and connectors — which
  // is why the scan below never touches this buffer.
  let pending = "";

  return {
    push(chunk: Uint8Array): string[] {
      const text = decoder.decode(chunk, { stream: true });

      // Search only the NEW text. Splitting the accumulated buffer instead
      // rescans every byte already seen, once per chunk, which is quadratic in
      // the length of a line — invisible for progress-sized lines and brutal
      // for the multi-megabyte result line: measured 87 ms at 4 MiB, 310 ms at
      // 7.6 MiB and 1,255 ms at 15 MiB, all of it blocking the main thread
      // this reader runs on. Scanning the tail only is linear: 4 / 7 / 14 ms.
      //
      // `pending` is still built by `+=`, which engines represent as a rope, so
      // accumulating a long line stays cheap; it is flattened once, when the
      // line finally completes below.
      if (!text.includes("\n")) {
        pending += text;
        return [];
      }

      const parts = text.split("\n");
      // The last element is either "" (the chunk ended exactly on a newline)
      // or a partial line. Either way it is NOT complete, so it stays.
      const tail = parts.pop() ?? "";
      // Only the FIRST piece continues whatever was buffered; the rest began
      // inside this chunk.
      parts[0] = pending + parts[0];
      pending = tail;
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
