// Guarded access to the window's saved settings (localStorage). Storage can be blocked or full;
// then reads give null and writes do nothing, and Kadar runs with its defaults.

/** The saved text for `key`, or null when none is saved or storage cannot be read. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Saves `value` under `key`; does nothing when storage cannot be written. */
export function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch { /* not kept: the setting lasts until Kadar quits */ }
}
