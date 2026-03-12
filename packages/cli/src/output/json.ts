export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
