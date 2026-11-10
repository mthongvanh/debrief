// Code a walkthrough cites: a few lines of a file before or after the change, or the diff of
// those lines. The worker reads them from git at the capture's commits, so a walkthrough names
// lines instead of pasting code that could drift. Pure logic, shared by the worker and its tests.

export type CiteShow = 'diff' | 'after' | 'before'

/** Lines `from` to `to` of `path`: in the after file for `diff` and `after`, the before file for `before`. */
export type Cite = { path: string; lines: [number, number]; show: CiteShow; note?: string }

/** One row of a cited block. `line` is the number shown in the gutter; a deleted row has none. */
export type CiteRow = { kind: 'context' | 'added' | 'deleted' | 'gap'; line?: number; text: string }

export const MAX_CITE_LINES = 40

/** Lines `from`..`to` of a file's text, numbered from 1. */
export function sliceFile(text: string, from: number, to: number): CiteRow[] {
  return text
    .split('\n')
    .slice(from - 1, to)
    .map((line, index) => ({ kind: 'context' as const, line: from + index, text: line }))
}

/**
 * The rows of a unified diff that fall in `from`..`to` of the new file, padded by `pad` lines.
 * Deleted rows are kept when the line they sat before is kept. A jump in line numbers between
 * kept rows becomes a `gap` row.
 */
export function diffWindow(diff: string, from: number, to: number, pad = 2): CiteRow[] {
  const low = from - pad
  const high = to + pad
  const rows: CiteRow[] = []
  let pending: CiteRow[] = []
  let next = 0
  let lastKept: number | null = null
  const keep = (row: CiteRow, at: number) => {
    if (lastKept !== null && at > lastKept + 1) rows.push({ kind: 'gap', text: '' })
    rows.push(...pending, row)
    pending = []
    lastKept = at
  }
  for (const line of diff.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
    if (hunk) {
      next = Number(hunk[1])
      pending = []
      continue
    }
    if (next === 0 || line.startsWith('\\')) continue
    const sign = line[0]
    const text = line.slice(1)
    if (sign === '-') {
      pending.push({ kind: 'deleted', text })
    } else if (sign === '+' || sign === ' ') {
      const row: CiteRow = { kind: sign === '+' ? 'added' : 'context', line: next, text }
      if (next >= low && next <= high) keep(row, next)
      else pending = []
      next++
    }
  }
  // Deleted rows at the end of a hunk sit before the line `next` would have been.
  if (pending.length > 0 && next >= low && next <= high + 1) rows.push(...pending)
  return rows
}

/** Cuts rows to MAX_CITE_LINES; `truncated` says whether anything was cut. */
export function capRows(rows: CiteRow[]): { rows: CiteRow[]; truncated: boolean } {
  return rows.length > MAX_CITE_LINES
    ? { rows: rows.slice(0, MAX_CITE_LINES), truncated: true }
    : { rows, truncated: false }
}
