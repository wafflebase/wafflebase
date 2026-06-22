export function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Build an attribute string ` k="v"` (escaped), or '' when value is undefined. */
export function attr(name: string, value: string | number | undefined): string {
  if (value === undefined) return '';
  return ` ${name}="${escapeXmlAttr(String(value))}"`;
}
