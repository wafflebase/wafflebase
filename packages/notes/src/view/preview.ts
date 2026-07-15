import MarkdownIt from 'markdown-it';

const md: MarkdownIt = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
});

/**
 * A lightweight, framework-free markdown preview pane. Renders `markdown-it`
 * HTML into a container element on demand.
 */
export class NotePreview {
  readonly el: HTMLDivElement;

  constructor() {
    this.el = document.createElement('div');
    this.el.dataset.role = 'note-preview';
    this.el.className = 'note-preview markdown-body';
  }

  render(markdown: string): void {
    this.el.innerHTML = md.render(markdown);
  }
}
