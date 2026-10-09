// Small text formats shared by the big view, the info panel and Export for Web.

/** File size for people: "512 B", "84 KB", "3.2 MB" (1 KB = 1024 bytes, as sizes add up on disk). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/** How much smaller `after` is than `before`, in whole percent: 0 when not smaller, at most 99,
 *  so a tiny result never reads "100% smaller". */
export function savingPercent(before: number, after: number): number {
  if (before <= 0) return 0
  return Math.max(0, Math.min(99, Math.floor((1 - after / before) * 100)))
}
