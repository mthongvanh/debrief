// Pipes to stand-in commands, never the real clipboard.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, test } from 'orca/testing'
import { clipboardCommands, writeClipboard } from './clipboard.ts'

let dir = ''
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

/** A command that writes what it reads to `file`, like a clipboard would keep it. */
const keepIn = (file: string) => ({
  command: process.execPath,
  args: ['-e', 'require("fs").writeFileSync(process.argv[1], require("fs").readFileSync(0))', file]
})

test('picks the clipboard tool for each platform', () => {
  assert.deepEqual(clipboardCommands('darwin').map((c) => c.command), ['pbcopy'])
  assert.deepEqual(clipboardCommands('win32').map((c) => c.command), ['clip'])
  assert.deepEqual(clipboardCommands('linux').map((c) => c.command), ['wl-copy', 'xclip', 'xsel'])
})

test('writes the text whole, as UTF-8, with the first tool that works', async () => {
  dir = mkdtempSync(join(tmpdir(), 'debrief-clip-'))
  const file = join(dir, 'clip')
  const text = '# Notes\n\n## 1. `a.ts` lines 3–5 → fix\n'
  await writeClipboard(text, [{ command: 'debrief-no-such-tool', args: [] }, keepIn(file)])
  assert.equal(readFileSync(file, 'utf8'), text)
})

test('says why when no tool works, instead of claiming it copied', async () => {
  const failing = { command: process.execPath, args: ['-e', 'process.stderr.write("no display"); process.exit(3)'] }
  await assert.rejects(writeClipboard('x', [{ command: 'debrief-no-such-tool', args: [] }, failing]), /debrief-no-such-tool: .*ENOENT.*; .*: no display/)
})
