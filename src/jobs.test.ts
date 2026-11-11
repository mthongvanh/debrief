import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, test } from 'orca/testing'
import type { BriefScope } from './git.ts'
import { enqueue, jobsDir, listJobs, startNext } from './jobs.ts'

let dir = ''
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

const scopeOf = (label: string): BriefScope => ({
  label, before: 'a'.repeat(40), after: 'b'.repeat(40), capture: { base: 'a'.repeat(40), commit: 'b'.repeat(40) },
  commits: [], files: [], skipped: [], truncated: false
})

async function finished(root: string): Promise<void> {
  const deadline = Date.now() + 8000
  while ((await listJobs(root)).some((job) => job.status === 'running') && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 50))
  }
}

test('draws each queued scope in a run of its own, and drops a repeat of one already queued', async () => {
  dir = mkdtempSync(join(tmpdir(), 'debrief-jobs-'))
  const root = join(dir, '.context/debrief')
  // `true` stands in for claude: the run ends at once, so the next one can start.
  const settings = { model: 'sonnet', maxBudgetUsd: 1, claudeCommand: 'true' }
  const sources = {
    scopeFor: async (scope: { from?: string }) => scopeOf(scope.from ?? ''),
    reviewFor: async () => { throw new Error('no reviews here') },
    captureRules: async () => undefined
  }
  await enqueue(root, { from: 'one' }, 'one')
  await enqueue(root, { from: 'two' }, 'two')
  await enqueue(root, { from: 'one' }, 'one')

  const labels: string[][] = []
  for (let run = 0; run < 3; run++) {
    const id = await startNext(root, dir, settings, sources)
    if (id === null) break
    labels.push(JSON.parse(readFileSync(join(jobsDir(root), `r-${id}.brief.json`), 'utf8')).scopes.map((s: BriefScope) => s.label))
    await finished(root)
  }
  assert.deepEqual(labels, [['one'], ['two']])
  assert.deepEqual(readdirSync(jobsDir(root)).filter((name) => name.startsWith('q-')), [])
})
