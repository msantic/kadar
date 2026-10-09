// Undo for file changes made in Kadar (⌘Z): Move to Trash and rename. Kept while Kadar is open.

import { emit } from './bus'
import { selectPath } from './selection'
import { getState, setState } from './store'
import { updateSession } from './session'
import { baseName } from '../paths'

/** One change that ⌘Z can reverse. */
export type UndoStep =
  | { kind: 'trash'; pairs: [string, string][] } // [where it was, where it is in the Trash]
  | { kind: 'rename'; now: string; before: string } // full paths

const MAX_STEPS = 50
const steps: UndoStep[] = []

/** Remembers a change for ⌘Z. Keeps the newest 50; older ones drop off. */
export function pushUndo(step: UndoStep): void {
  steps.push(step)
  if (steps.length > MAX_STEPS) steps.shift()
}

const name = (path: string): string => baseName(path)

/** Undoes the newest step and selects what came back. */
export async function undoLast(): Promise<void> {
  const step = steps.pop()
  if (!step) {
    emit('toast', { text: 'Nothing to undo' })
    return
  }
  try {
    if (step.kind === 'trash') {
      const back = await window.viewer.fs.putBack(step.pairs)
      setState({ selection: new Set(back), selectedPath: back[0] ?? null, anchorPath: back[0] ?? null })
      updateSession({ selectedPaths: back, selectedPath: back[0] ?? null, anchorPath: back[0] ?? null })
      emit('toast', { text: back.length === 1 ? `Put back "${name(back[0]!)}"` : `Put back ${back.length} files` })
    } else {
      const restored = await window.viewer.fs.rename(step.now, name(step.before))
      selectPath(restored)
      emit('toast', { text: `Renamed back to "${name(restored)}"` })
    }
  } catch (err) {
    emit('toast', { text: `Undo failed: ${String(err)}` })
  }
  // The live folder shows the change too; this shows it at once.
  if (getState().currentFolder) emit('folder:refresh', undefined)
}
