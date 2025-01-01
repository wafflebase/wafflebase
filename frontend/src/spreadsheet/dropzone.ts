import Papa, { Parser } from 'papaparse';
import { toSref } from '../worksheet/coordinates';
import { Sheet } from '../worksheet/sheet';
import { Grid } from '../worksheet/types';

/**
 * `RowChunkSize` is the number of rows to process in a single chunk.
 */
const RowChunkSize = 1000;

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

    const file = files[0];
    this.uploadFile(file);
  }

  private async uploadFile(file: File) {
    const startTime = performance.now();
    const total = file.size;
    let processed = 0;
    let chunkCounter = 0;
    let row = 0;

    const chunk: Grid = new Map();

    const updateProgress = () => {
      const progress = Math.floor((processed / total) * 100);
      const elapsed = this.toSecs(performance.now() - startTime);
      console.log(`Progress: ${progress}%, Elapsed: ${elapsed}s`);
    };

    const processChunk = async () => {
      await this.sheet!.setGrid(chunk);
      chunk.clear();
      chunkCounter = 0;
    };

    Papa.parse(file, {
      step: async (result: { data: any }, parser: Parser) => {
        const { data } = result;
        for (let col = 1; col <= data.length; col++) {
          const cell = { v: data[col - 1] };
          chunk.set(toSref({ r: row, c: col }), cell);
        }
        row += 1;
        chunkCounter += 1;

        const rowSize = new Blob([result.data.join(',')]).size;
        processed += rowSize;

        if (chunkCounter >= RowChunkSize) {
          parser.pause();
          await processChunk();
          updateProgress();
          parser.resume();
        }
      },
      complete: async () => {
        if (chunk.size > 0) {
          await processChunk();
        }
        console.log(`Finished: ${this.toSecs(performance.now() - startTime)}s`);
      },
      error: (err: any) => {
        console.error('Error while parsing:', err);
      },
    });
  }

  private toSecs(ms: number) {
    return (ms / 1000).toFixed(2);
  }

  private hide() {
    this.element.style.display = 'none';
  }
}
