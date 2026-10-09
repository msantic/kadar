// Grid geometry: how many columns fit, cell size and row height. All values in CSS px.
// Pure math; grid.ts uses it to place cells and size the scroll area.

/** Sizes in CSS px. `cellHeight` includes the file name line; `rowHeight` adds the gap. */
export interface GridLayout {
  columns: number
  cellWidth: number
  cellHeight: number
  gap: number
  rowHeight: number
}

const GAP = 10

/** Compute grid layout from container width and a target cell size (from zoom slider). */
export function computeLayout(containerWidth: number, targetCell: number): GridLayout {
  const usable = Math.max(0, containerWidth - GAP)
  const columns = Math.max(1, Math.floor((usable + GAP) / (targetCell + GAP)))
  const cellWidth = Math.floor((usable - (columns - 1) * GAP) / columns)
  const cellHeight = cellWidth + 24 // + filename row
  return {
    columns,
    cellWidth,
    cellHeight,
    gap: GAP,
    rowHeight: cellHeight + GAP,
  }
}

/** Height in px of the whole grid for `count` cells, with a gap at the bottom. */
export function totalHeight(count: number, layout: GridLayout): number {
  const rows = Math.ceil(count / layout.columns)
  return rows * layout.rowHeight + layout.gap
}

// Zoom slider range
export const ZOOM_MIN = 80
/** Largest target cell width, in px. */
export const ZOOM_MAX = 320
/** Target cell width in px before the user zooms. */
export const ZOOM_DEFAULT = 160
