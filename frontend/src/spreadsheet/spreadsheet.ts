import { Sheet } from '../worksheet/sheet';
import { Store } from '../store/store';
// import { createStore } from '../store/local';
import { createBackendStore } from '../store/backend';

import { Worksheet } from './worksheet';
import { Dropzone } from './dropzone';

/**
 * setupSpreadsheet sets up the spreadsheet in the given container.
 * @param container Container element to render the spreadsheet.
 */
export async function setupSpreadsheet(container: HTMLDivElement) {
  const spreadsheet = new Spreadsheet(container);
  const store = await createBackendStore('spreadsheet');
  await spreadsheet.initialize(store);
}

/**
 * Spreadsheet is a class that represents a spreadsheet.
 */
class Spreadsheet {
  private readonly container: HTMLDivElement;
  private worksheet: Worksheet;
  private dropzone: Dropzone;

  /**
   * `constructor` initializes the spreadsheet with the given grid.
   */
  constructor(container: HTMLDivElement) {
    this.container = container;
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';

    this.worksheet = new Worksheet(this.container);
    this.dropzone = new Dropzone(this.container);
  }

  /**
   * `initialize` initializes the spreadsheet with the given store.
   */
  public async initialize(store: Store) {
    const sheet = new Sheet(store);
    this.worksheet.initialize(sheet);
    this.dropzone.initialize(sheet);
  }
}
