// Keep both Lakehouse surfaces behind one lazy boundary. Besides avoiding
// unnecessary work for ordinary sheets, a single entry prevents Vite from
// producing separate selector, view, and shared API chunks.
export { LakehouseView } from '@/app/spreadsheet/lakehouse-view';
export { LakehouseSelector } from '@/components/lakehouse-selector';
