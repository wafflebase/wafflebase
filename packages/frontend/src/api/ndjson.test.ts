import { describe, it, expect } from "vitest";
import { createNdjsonLineReader } from "./ndjson";

const encoder = new TextEncoder();

/** Feed a whole byte array through the reader and collect every line. */
function readAll(chunks: Uint8Array[]): string[] {
  const reader = createNdjsonLineReader();
  const lines: string[] = [];
  for (const chunk of chunks) lines.push(...reader.push(chunk));
  lines.push(...reader.flush());
  return lines;
}

/** Split `bytes` at `at`, as a transport is free to do at any offset. */
function splitAt(bytes: Uint8Array, at: number): Uint8Array[] {
  return [bytes.subarray(0, at), bytes.subarray(at)];
}

describe("createNdjsonLineReader", () => {
  it("joins a single line split across two chunks", () => {
    // The chunk boundary lands in the MIDDLE of a JSON object, which is the
    // common case for a long `result` line.
    const line = '{"type":"progress","stage":"items","done":1250}';
    const bytes = encoder.encode(`${line}\n`);
    const lines = readAll(splitAt(bytes, 20));

    expect(lines).toEqual([line]);
    expect(JSON.parse(lines[0])).toMatchObject({ done: 1250 });
  });

  it("survives a line split at every possible offset", () => {
    // A transport picks the boundary, not us. Exhaustive rather than lucky.
    const line = '{"type":"progress","stage":"images","done":3,"total":12}';
    const bytes = encoder.encode(`${line}\n`);
    for (let at = 0; at <= bytes.length; at++) {
      expect(readAll(splitAt(bytes, at))).toEqual([line]);
    }
  });

  it("emits several lines carried in one chunk", () => {
    const a = '{"type":"progress","stage":"items","done":50}';
    const b = '{"type":"progress","stage":"items","done":100}';
    const c = '{"type":"progress","stage":"connectors","done":40}';

    expect(readAll([encoder.encode(`${a}\n${b}\n${c}\n`)])).toEqual([a, b, c]);
  });

  it("emits a final line that has no trailing newline", () => {
    // A server that ends the response right after the last line — which is
    // exactly what `res.end()` after a terminal `result` produces if the
    // newline is ever dropped — must not lose it.
    const a = '{"type":"progress","stage":"images","done":1,"total":1}';
    const b = '{"type":"result","items":[],"connectors":[],"notes":[]}';

    expect(readAll([encoder.encode(`${a}\n${b}`)])).toEqual([a, b]);
  });

  it("does not emit anything for a chunk with no complete line yet", () => {
    const reader = createNdjsonLineReader();
    expect(reader.push(encoder.encode('{"type":"pro'))).toEqual([]);
    expect(reader.push(encoder.encode('gress","stage":"items"'))).toEqual([]);
    expect(reader.push(encoder.encode(',"done":7}\n'))).toEqual([
      '{"type":"progress","stage":"items","done":7}',
    ]);
    expect(reader.flush()).toEqual([]);
  });

  it("keeps a multi-byte UTF-8 character intact across a chunk boundary", () => {
    // THE trap. "보드" is 3 bytes per character in UTF-8, and a chunk boundary
    // may fall between them. Decoding each chunk independently (no
    // `{ stream: true }`) turns the orphaned bytes into U+FFFD, so the line
    // either fails to parse or parses into silently mangled text.
    const line = '{"type":"error","message":"보드를 찾을 수 없습니다 — 재시도"}';
    const bytes = encoder.encode(`${line}\n`);

    for (let at = 1; at < bytes.length; at++) {
      const lines = readAll(splitAt(bytes, at));
      expect(lines).toEqual([line]);
      expect(lines[0]).not.toContain("�");
      expect(
        (JSON.parse(lines[0]) as { message: string }).message,
      ).toBe("보드를 찾을 수 없습니다 — 재시도");
    }
  });

  it("keeps an astral-plane character (surrogate pair) intact across a boundary", () => {
    // 4-byte sequences are the worst case, and emoji reach users through Miro
    // board titles and sticky text.
    const line = '{"type":"result","note":"🎉🧩"}';
    const bytes = encoder.encode(`${line}\n`);

    for (let at = 1; at < bytes.length; at++) {
      expect(readAll(splitAt(bytes, at))).toEqual([line]);
    }
  });

  it("tolerates CRLF framing and blank lines", () => {
    const a = '{"type":"progress","stage":"items","done":1}';
    const b = '{"type":"result","items":[],"connectors":[],"notes":[]}';

    expect(readAll([encoder.encode(`${a}\r\n\r\n${b}\r\n`)])).toEqual([a, b]);
  });

  it("delivers lines byte-by-byte, the pathological chunking", () => {
    const a = '{"type":"progress","stage":"images","done":1,"total":2}';
    const b = '{"type":"result","items":[{"id":"통🧩"}],"connectors":[],"notes":[]}';
    const bytes = encoder.encode(`${a}\n${b}\n`);

    const reader = createNdjsonLineReader();
    const lines: string[] = [];
    for (const byte of bytes) lines.push(...reader.push(Uint8Array.of(byte)));
    lines.push(...reader.flush());

    expect(lines).toEqual([a, b]);
  });
});
