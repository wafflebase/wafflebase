import { Sheet } from '../worksheet/sheet';
import { Store } from '../store/store';
import { MemStore } from '../store/memory';
import { Worksheet } from './worksheet';

export type Theme = 'light' | 'dark';

export interface Options {
  theme?: Theme;
  store?: Store;
}

/**
 * setupSpreadsheet sets up the spreadsheet in the given container.
 * @param container Container element to render the spreadsheet.
 * @param options Optional setup options.
 * @returns A function to clean up the spreadsheet.
 */
export function initialize(
  container: HTMLDivElement,
  options?: Options,
): Spreadsheet {
  const spreadsheet = new Spreadsheet(container, options);
  const store = options?.store || new MemStore();
  spreadsheet.initialize(store);
  return spreadsheet;
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
  constructor(container: HTMLDivElement, options?: Options) {
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

  /**
   * `render` renders the spreadsheet.
   */
  public render() {
    this.worksheet.render();
  }

  public cleanup() {
    this.worksheet.cleanup();
  }
}
