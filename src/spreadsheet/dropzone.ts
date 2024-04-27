import Papa from 'papaparse';
import { toRef } from '../sheet/coordinates';
import { Sheet } from '../sheet/sheet';
import { Grid } from '../sheet/types';

/**
 * `Dropzone` is a class that handles the drag and drop of files.
 * It listens to the drag events on the container and shows a drop zone
 * when a file is dragged over the container. For now, it only supports CSV files.
 */
export class Dropzone {
  private sheet?: Sheet;

  private container: HTMLDivElement;
  private element: HTMLDivElement;

  constructor(container: HTMLDivElement) {
    this.element = document.createElement('div');
    this.element.style.display = 'none';
    this.element.style.position = 'absolute';
    this.element.style.top = '0';
    this.element.style.left = '0';
    this.element.style.width = 'calc(100% - 4px)';
    this.element.style.height = 'calc(100% - 4px)';
    this.element.style.border = '2px dashed #4A90E2';
    this.element.style.justifyContent = 'center';
    this.element.style.alignItems = 'center';
    this.element.style.backgroundColor = '#fff';
    this.element.style.opacity = '0.8';
    this.element.style.zIndex = '1000';
    this.element.style.color = '#4A90E2';
    this.element.style.fontSize = '24px';
    this.element.style.fontWeight = 'bold';
    this.element.innerText = 'Drag and drop a file here';

    this.container = container;
    this.container.appendChild(this.element);

    this.handleDragEnter = this.handleDragEnter.bind(this);
    this.handleDragLeave = this.handleDragLeave.bind(this);
    this.handleDragOver = this.handleDragOver.bind(this);
    this.handleFileSelect = this.handleFileSelect.bind(this);
  }

  /**
   * `initialize` initializes Dropzone with the given sheet.
   */
  public initialize(sheet: Sheet) {
    this.sheet = sheet;
    this.addEventListeners();
  }

  /**
   * `destroy` destroys the Dropzone.
   */
  public destroy() {
    this.container.removeChild(this.element);
    this.removeEventListeners();
  }

  private addEventListeners() {
    this.container.addEventListener('dragenter', this.handleDragEnter);
    this.container.addEventListener('dragleave', this.handleDragLeave);
    this.element.addEventListener('dragover', this.handleDragOver, false);
    this.element.addEventListener('drop', this.handleFileSelect, false);
  }

  private removeEventListeners() {
    this.container.removeEventListener('dragenter', this.handleDragEnter);
    this.container.removeEventListener('dragleave', this.handleDragLeave);
    this.element.removeEventListener('dragover', this.handleDragOver, false);
    this.element.removeEventListener('drop', this.handleFileSelect, false);
  }

  private handleDragEnter(e: DragEvent) {
    e.stopPropagation();
    e.preventDefault();
    this.element.style.display = 'flex';
  }

  private handleDragLeave(e: DragEvent) {
    e.stopPropagation();

    // Check if the related target is inside the container
    if (!this.container.contains(e.relatedTarget as Node)) {
      this.hide();
    }
  }

  /**
   * `handleDragOver` handles the drag over event.
   */
  private handleDragOver(e: DragEvent) {
    e.stopPropagation();
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  }

  /**
   * `handleFileSelect` handles the file select event.
   */
  private handleFileSelect(evt: DragEvent) {
    this.hide();
    evt.stopPropagation();
    evt.preventDefault();

    const files = evt.dataTransfer?.files;
    if (!files || files.length === 0) {
      return;
    }

    // TODO(hackerwins): We need to introduce chunking for large files.
    // For now, we are loading the entire file in memory.
    let row = 1;
    const grid: Grid = new Map();
    for (const file of files) {
      let processedBytes = 0;
      const totalBytes = file.size;
      Papa.parse(file, {
        worker: true,
        step: (result: { data: any }) => {
          const { data } = result;
          for (let col = 1; col <= data.length; col++) {
            const cell = { v: data[col - 1] };
            grid.set(toRef({ row, col }), cell);
          }
          row += 1;

          const rowSize = new Blob([result.data.join(',')]).size;
          processedBytes += rowSize;
          console.log('Progress:', processedBytes / totalBytes);
        },
        complete: async () => {
          await this.sheet!.setGrid(grid);
          console.log('Saved:', processedBytes / totalBytes);
        },
        error: (err: any) => {
          console.error('Error while parsing:', err);
        },
      });
    }
  }

  private hide() {
    this.element.style.display = 'none';
  }
}
