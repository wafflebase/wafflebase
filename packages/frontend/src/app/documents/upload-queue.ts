import { classifyUploadKind, SKIP_REASON, type UploadKind } from "./upload-kind";

export type UploadStatus =
  | "pending"
  | "parsing"
  | "uploading"
  | "done"
  | "error"
  | "skipped";

export interface UploadItem {
  id: string;
  file?: File; // retained for the worker; omitted from public reasoning
  fileName: string;
  kind: UploadKind | null;
  workspaceId?: string;
  status: UploadStatus;
  done: number;
  total: number;
  docId?: string;
  docPath?: string;
  reason?: string;
}

let seq = 0;
let items: UploadItem[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const cb of listeners) cb();
}

function replace(next: UploadItem[]) {
  items = next;
  emit();
}

export function getSnapshot(): readonly UploadItem[] {
  return items;
}

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function enqueue(files: File[], workspaceId?: string): UploadItem[] {
  const created: UploadItem[] = files.map((file) => {
    const kind = classifyUploadKind(file.name);
    return {
      id: `u${++seq}`,
      file,
      fileName: file.name,
      kind,
      workspaceId,
      status: kind ? "pending" : "skipped",
      done: 0,
      total: 0,
      reason: kind ? undefined : SKIP_REASON,
    };
  });
  replace([...items, ...created]);
  return created;
}

export function patchItem(id: string, patch: Partial<UploadItem>): void {
  replace(items.map((it) => (it.id === id ? { ...it, ...patch } : it)));
}

export function removeItem(id: string): void {
  replace(items.filter((it) => it.id !== id));
}

export function clearFinished(): void {
  replace(
    items.filter((it) => it.status !== "done" && it.status !== "skipped"),
  );
}

export function nextPendingId(): string | undefined {
  return items.find((it) => it.status === "pending")?.id;
}

export function activeCount(): number {
  return items.filter(
    (it) => it.status === "parsing" || it.status === "uploading",
  ).length;
}

/** Test-only reset of module state. */
export function __resetForTest(): void {
  items = [];
  listeners.clear();
  seq = 0;
}
