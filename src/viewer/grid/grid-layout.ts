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

export function totalHeight(count: number, layout: GridLayout): number {
  const rows = Math.ceil(count / layout.columns)
  return rows * layout.rowHeight + layout.gap
}

// Zoom slider range
export const ZOOM_MIN = 80
export const ZOOM_MAX = 320
export const ZOOM_DEFAULT = 160
