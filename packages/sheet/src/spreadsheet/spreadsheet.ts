import { Sheet } from '../worksheet/sheet';
import { Store } from '../store/store';
import { createStore } from '../store/local';

import { Worksheet } from './worksheet';

export type Theme = 'light' | 'dark' | 'system';

export interface SetupOptions {
  theme?: Theme;
}

/**
 * setupSpreadsheet sets up the spreadsheet in the given container.
 * @param container Container element to render the spreadsheet.
 * @param options Optional setup options.
 * @returns A function to clean up the spreadsheet.
 */
export async function setup(container: HTMLDivElement, options?: SetupOptions) {
  const spreadsheet = new Spreadsheet(container, options);
  const store = await createStore();
  spreadsheet.initialize(store);
  return () => spreadsheet.cleanup();
}

/**
 * Spreadsheet is a class that represents a spreadsheet.
 */
export class Spreadsheet {
  private container: HTMLDivElement;
  private worksheet: Worksheet;
  private theme: Theme;

  /**
   * `constructor` initializes the spreadsheet with the given grid.
   */
  constructor(container: HTMLDivElement, options?: SetupOptions) {
    this.container = container;
    this.container.style.position = 'relative';
    this.container.style.overflow = 'hidden';
    this.theme = options?.theme || 'light';

    this.worksheet = new Worksheet(this.container, this.theme);
  }

  /**
   * `initialize` initializes the spreadsheet with the given store.
   */
  public async initialize(store: Store) {
    const sheet = new Sheet(store);
    this.worksheet.initialize(sheet);
  }

  public cleanup() {
    this.worksheet.cleanup();
  }
}
