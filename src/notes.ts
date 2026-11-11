// Notes for the agent, left on lines of a capture's diff. They live in the capture folder as
// notes.json, and leave as Markdown: copied to paste into an agent, or written to a file that a
// new Claude is started on. Pure logic, shared by the worker and its tests.
import { repoPath } from './walkthrough.ts'

export const NOTES_FILE = 'notes.json'
export const MAX_NOTES = 200
export const MAX_NOTE_CHARS = 4000
/** The code a note quotes: at most this many lines, each cut to MAX_QUOTE_LINE_CHARS. */
export const MAX_QUOTE_LINES = 40
const MAX_QUOTE_LINE_CHARS = 400

/** A note on lines `lines` of `path`, numbered as they read after the change. */
export type Note = {
  id: string
  path: string
  lines: [number, number]
  body: string
  /** The noted lines as they read when the note was written, so the agent sees what was meant. */
  quote: string[]
  createdAt: string
  /** When the note was handed off; notes not handed off yet have none. */
  sentAt?: string
  /** How it was handed off: copied as Markdown, or given to a new Claude. */
  sentVia?: SentVia
}

export type SentVia = 'copy' | 'claude'

export type NoteInput = { path: string; lines: [number, number]; body: string; quote: string[] }

export class NoteError extends Error {}

function fail(message: string): never {
  throw new NoteError(message)
}

function lineRange(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2 || !value.every((n) => Number.isInteger(n) && n >= 1) || value[0] > value[1]) {
    fail('"lines" must be [first, last], line numbers from 1')
  }
  return [value[0], value[1]]
}

function quoteOf(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((line) => typeof line === 'string')) fail('"quote" must be a list of lines')
  return value.slice(0, MAX_QUOTE_LINES).map((line: string) => line.slice(0, MAX_QUOTE_LINE_CHARS))
}

/** A new note from what the editor sent, checked as the worker checks any request. */
export function newNote(raw: unknown, id: string, now: Date): Note {
  if (typeof raw !== 'object' || raw === null) fail('A note must be an object')
  const input = raw as Record<string, unknown>
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (body === '') fail('A note needs some text')
  if (body.length > MAX_NOTE_CHARS) fail(`A note is at most ${MAX_NOTE_CHARS} characters`)
  let path: string
  try {
    path = repoPath(input.path, 'path')
  } catch (error) {
    fail((error as Error).message)
  }
  return { id, path, lines: lineRange(input.lines), body, quote: quoteOf(input.quote), createdAt: now.toISOString() }
}

/** The notes in a notes.json; an entry that does not read as a note is left out, not fatal. */
export function parseNotes(text: string): Note[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return []
  }
  const list = (raw as { notes?: unknown } | null)?.notes
  if (!Array.isArray(list)) return []
  return list.flatMap((entry): Note[] => {
    try {
      const e = entry as Record<string, unknown>
      if (typeof e.id !== 'string' || typeof e.createdAt !== 'string') return []
      const note = newNote(e, e.id, new Date(e.createdAt))
      note.createdAt = e.createdAt
      if (typeof e.sentAt === 'string') note.sentAt = e.sentAt
      if (e.sentVia === 'copy' || e.sentVia === 'claude') note.sentVia = e.sentVia
      return [note]
    } catch {
      return []
    }
  })
}

export function notesJson(notes: readonly Note[]): string {
  return JSON.stringify({ version: 1, notes }, null, 2)
}

/** A code fence longer than any run of backticks in `lines`. */
function fence(lines: readonly string[]): string {
  const longest = Math.max(2, ...lines.map((line) => Math.max(0, ...(line.match(/`+/g) ?? []).map((run) => run.length))))
  return '`'.repeat(longest + 1)
}

const span = ([from, to]: [number, number]) => (from === to ? `${from}` : `${from}–${to}`)

/** The notes as a Markdown brief for the agent: each note under the lines it is about. */
export function notesMarkdown(
  capture: { id: string; title: string; base?: string; commit?: string },
  notes: readonly Note[]
): string {
  const range = capture.base && capture.commit ? ` (${capture.base.slice(0, 9)}..${capture.commit.replace(/\+dirty$/, ' plus uncommitted work')})` : ''
  const out = [
    `# Review notes on ${capture.title}`,
    '',
    `Notes left in Debrief on the diff of capture \`${capture.id}\`${range}. Each note is about the lines quoted under it, numbered as they read after the change.`,
    '',
    'Work through them in order. Change the code where a note asks for it. Where a note is unclear, or you think the code is right as it is, say so and why instead of changing it.',
  ]
  notes.forEach((note, index) => {
    const marker = fence(note.quote)
    out.push('', `## ${index + 1}. \`${note.path}\` line${note.lines[0] === note.lines[1] ? '' : 's'} ${span(note.lines)}`, '')
    if (note.quote.length > 0) out.push(marker, ...note.quote, marker, '')
    out.push(note.body)
  })
  return out.join('\n') + '\n'
}
