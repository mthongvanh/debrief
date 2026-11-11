import { assert, test } from 'orca/testing'
import { MAX_QUOTE_LINES, NoteError, newNote, notesJson, notesMarkdown, parseNotes } from './notes.ts'

const now = new Date('2026-11-11T10:00:00Z')
const isNoteError = (error: unknown) => error instanceof NoteError
const input = { path: 'lib/socket.dart', lines: [282, 284], body: '  Track partials too.  ', quote: ['if (final) {', '  x()', '}'] }

test('a note keeps its trimmed text, lines and quoted code', () => {
  const note = newNote(input, 'n1', now)
  assert.deepEqual(note, {
    id: 'n1', path: 'lib/socket.dart', lines: [282, 284], body: 'Track partials too.',
    quote: ['if (final) {', '  x()', '}'], createdAt: '2026-11-11T10:00:00.000Z'
  })
  assert.equal(newNote({ ...input, quote: Array.from({ length: 90 }, () => 'l') }, 'n2', now).quote.length, MAX_QUOTE_LINES)
})

test('refuses an empty note, a bad range and paths outside the code', () => {
  assert.throws(() => newNote({ ...input, body: '   ' }, 'n', now), isNoteError)
  assert.throws(() => newNote({ ...input, lines: [5, 2] }, 'n', now), /lines/)
  assert.throws(() => newNote({ ...input, lines: [0, 2] }, 'n', now), /lines/)
  assert.throws(() => newNote({ ...input, path: '.env' }, 'n', now), /\.env/)
  assert.throws(() => newNote({ ...input, path: '../x' }, 'n', now), isNoteError)
  assert.throws(() => newNote(null, 'n', now), isNoteError)
})

test('reads notes back, keeping when they were sent and dropping entries that are not notes', () => {
  const sent = { ...newNote(input, 'a', now), sentAt: '2026-11-11T11:00:00Z', sentVia: 'claude' as const }
  const text = JSON.stringify({ version: 1, notes: [sent, { id: 'b' }, 'junk', { ...newNote(input, 'c', now), path: '.git/config' }] })
  assert.deepEqual(parseNotes(text), [sent])
  assert.deepEqual(parseNotes(notesJson([sent])), [sent])
  assert.deepEqual(parseNotes('not json'), [])
  assert.deepEqual(parseNotes('{}'), [])
})

test('writes the notes as a brief the agent can work through', () => {
  const one = newNote(input, 'a', now)
  const two = newNote({ path: 'lib/b.dart', lines: [7, 7], body: 'Why `late`?', quote: ['const s = ```x```'] }, 'b', now)
  const markdown = notesMarkdown({ id: 'cap', title: 'End of utterance', base: '35b81e40f17e', commit: '4f127c8f101a' }, [one, two])
  assert.match(markdown, /^# Review notes on End of utterance\n/)
  assert.match(markdown, /capture `cap` \(35b81e40f\.\.4f127c8f101a\)/)
  assert.match(markdown, /## 1\. `lib\/socket\.dart` lines 282–284\n\n```\nif \(final\) \{\n  x\(\)\n\}\n```\n\nTrack partials too\./)
  // A quote holding a run of backticks gets a longer fence, so it cannot close early.
  assert.match(markdown, /## 2\. `lib\/b\.dart` line 7\n\n````\nconst s = ```x```\n````\n\nWhy `late`\?\n$/)
  assert.match(notesMarkdown({ id: 'c', title: 't', base: 'aaaaaaaaaa', commit: 'bbbbbbb+dirty' }, [one]), /aaaaaaaaa\.\.bbbbbbb plus uncommitted work/)
})
