export function escapeHTML(text: string): string {
  text = text.replace(/&/g, '&amp;');
  text = text.replace(/</g, '&lt;');
  text = text.replace(/>/g, '&gt;');
  text = text.replace(/"/g, '&quot;');
  text = text.replace(/'/g, '&#039;');
  text = text.replace(/\n/g, '<br>');
  text = text.replace(/ /g, '&nbsp;');
  return text;
}
