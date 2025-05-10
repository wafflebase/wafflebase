// NOTE(hackerwins): This file is only used to develop the spreadsheet in dev mode.
import { initialize } from './view/spreadsheet.ts';
initialize(document.querySelector<HTMLDivElement>('#app')!);
