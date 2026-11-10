// Runs src/worker.ts's activate(orca) over a mock host and a workspace folder on disk.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, assert, mockHost, mountWorker, test } from 'orca/testing'
import { buildScope, commitBody } from './git'
import * as main from './worker'


const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'
let dir = ''
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }))

function workspaceWith(captures: Record<string, unknown>) {
  dir = mkdtempSync(join(tmpdir(), 'debrief-'))
  for (const [id, capture] of Object.entries(captures)) {
    const folder = join(dir, '.context/debrief', id)
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'before.svg'), SVG)
    writeFileSync(join(folder, 'after.svg'), SVG)
    writeFileSync(join(folder, 'before.d2'), 'a -> b')
    if (capture !== null) writeFileSync(join(folder, 'capture.json'), typeof capture === 'string' ? capture : JSON.stringify(capture))
  }
  return dir
}

const capture = (createdAt: string) => ({
  version: 1, title: `At ${createdAt}`, kind: 'modification', summary: 'S', createdAt, files: [],
  views: [
    { role: 'before', title: 'Before', image: 'before.svg', source: 'before.d2' },
    { role: 'after', title: 'After', image: 'after.svg' }
  ]
})

function host(path: string, agents: unknown[] = [], settings: Record<string, string | number> = {}) {
  return mockHost({
    settings,
    results: {
      'workspace.readContext': { branch: 'feature/x', displayName: 'my-worktree', terminals: [] },
      'workspace.list': { workspaces: [{ id: 'ws1', kind: 'worktree', name: 'my-worktree', path, branch: 'feature/x', hostId: 'local' }], truncated: false },
      'agents.list': { agents },
      'terminal.sendText': { accepted: true },
      'editor.open': { opened: true }
    }
  })
}

test('lists captures newest first and reports broken ones', async () => {
  const path = workspaceWith({
    old: capture('2026-11-01T00:00:00Z'),
    fresh: capture('2026-11-09T00:00:00Z'),
    broken: '{"version": 1}',
    drawing: null
  })
  const worker = await mountWorker(main, { host: host(path) })
  const listing = await worker.request('captures.list')
  assert.equal(listing.workspace?.id, 'ws1')
  assert.deepEqual(listing.captures.map((c) => c.id), ['fresh', 'old'])
  assert.deepEqual(listing.problems.map((p) => p.id), ['broken'])
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('serves a view as a data URL and opens its source in a tab', async () => {
  const path = workspaceWith({ one: capture('2026-11-09T00:00:00Z') })
  const mock = host(path)
  const worker = await mountWorker(main, { host: mock })
  const image = await worker.request('captures.image', { captureId: 'one', view: 0 })
  assert.match(image.url, /^data:image\/svg\+xml;base64,/)
  assert.equal(Buffer.from(image.url.split(',')[1], 'base64').toString(), SVG)

  await worker.request('captures.open', { captureId: 'one', view: 0, what: 'source' })
  assert.deepEqual(mock.callsOf('editor.open'), [{ workspaceId: 'ws1', path: '.context/debrief/one/before.d2' }])
  await assert.rejects(worker.request('captures.open', { captureId: 'one', view: 1, what: 'source' }), /no \.d2 source/)
  await assert.rejects(worker.request('captures.image', { captureId: '../x', view: 0 }), /Bad capture id/)
  assert.deepEqual(worker.refusals, [])
  await worker.deactivate()
})

test('opens a walkthrough in its editor, and code it links to, never .env or .git', async () => {
  const path = workspaceWith({
    guided: { ...capture('2026-11-09T00:00:00Z'), walkthrough: 'walkthrough.debrief.json' },
    plain: capture('2026-11-08T00:00:00Z')
  })
  writeFileSync(join(path, '.context/debrief/guided/walkthrough.debrief.json'), '{}')
  mkdirSync(join(path, 'lib'))
  writeFileSync(join(path, 'lib/a.dart'), '')
  writeFileSync(join(path, '.env'), 'SECRET=1')
  const mock = host(path)
  const worker = await mountWorker(main, { host: mock })

  const guided = await worker.request('captures.get', { captureId: 'guided' })
  assert.equal(guided.walkthrough, 'walkthrough.debrief.json')
  // An unreadable walkthrough still opens; the editor shows what is wrong, so the size is left out.
  assert.equal(guided.walkthroughSize, undefined)
  await worker.request('walkthrough.open', { captureId: 'guided' })
  await assert.rejects(worker.request('walkthrough.open', { captureId: 'plain' }), /no walkthrough/)
  await worker.request('code.open', { path: 'lib/a.dart' })
  assert.deepEqual(mock.callsOf('editor.open'), [
    { workspaceId: 'ws1', path: '.context/debrief/guided/walkthrough.debrief.json' },
    { workspaceId: 'ws1', path: 'lib/a.dart' }
  ])
  for (const bad of ['.env', '.git/config', '../outside.dart', '/etc/hosts']) {
    await assert.rejects(worker.request('code.open', { path: bad }))
  }
  await assert.rejects(worker.request('code.open', { path: 'lib/gone.dart' }), /not in this workspace/)
  assert.equal(mock.callsOf('editor.open').length, 2)
  await worker.deactivate()
})

function gitRepo() {
  const path = workspaceWith({})
  const run = (...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim()
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 't@example.com')
  run('config', 'user.name', 'T')
  const commit = (name: string, body?: string) => {
    writeFileSync(join(path, name), name)
    run('add', name)
    run('commit', '-q', '-m', `add ${name}`, ...(body ? ['-m', body] : []))
    return run('rev-parse', 'HEAD')
  }
  const base = commit('a')
  run('checkout', '-q', '-b', 'feature/x')
  const one = commit('b')
  const two = commit('c', 'Keeps c apart from b, so b can be reverted alone.\n\nCo-Authored-By: Someone <s@example.com>')
  writeFileSync(join(path, 'd'), 'uncommitted')
  return { path, base, one, two }
}

test('reads the branch history down to where it left main', async () => {
  const { path, base, one, two } = gitRepo()
  const worker = await mountWorker(main, { host: host(path) })
  const history = await worker.request('git.history')
  assert.deepEqual(history.commits.map((c) => c.sha), [two, one])
  assert.equal(history.commits[0].subject, 'add c')
  assert.equal(history.commits[0].parent, one)
  assert.equal(history.base?.sha, base)
  assert.equal(history.head, two)
  assert.equal(history.dirty, true)
  await worker.deactivate()
})

/** A stand-in for `claude -p`: logs stream-json, writes one capture from the brief, exits 0. */
function fakeClaude(dir: string): string {
  const script = join(dir, 'fake-claude.mjs')
  writeFileSync(script, `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs'
const args = process.argv.slice(2)
if (!process.env.USER) { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Not logged in' })); process.exit(1) }
appendFileSync(${JSON.stringify(join(dir, 'args.log'))}, JSON.stringify(args) + '\\n')
const brief = JSON.parse(readFileSync(args[1].split('brief=')[1], 'utf8'))
const say = (event) => console.log(JSON.stringify(event))
say({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x.ts' } }] } })
if (brief.kind === 'review') {
  writeFileSync(brief.reviewFile, JSON.stringify({ version: 1, kind: 'review', capture: brief.capture.id,
    createdAt: new Date().toISOString(), summary: 'One bug.', basis: 'code reading of ' + brief.scope.label,
    findings: [{ severity: 'high', confidence: 'confirmed', title: 'T', failure: 'F', why: 'W', code: { path: 'c', lines: [1, 1] } }] }))
  say({ type: 'result', subtype: 'success', is_error: false, result: '1 high', total_cost_usd: 0.05, num_turns: 3, duration_ms: 1000, usage: {} })
  process.exit(0)
}
const scope = brief.scopes[0]
const folder = brief.capturesDir + '/2026-11-10-fake'
mkdirSync(folder, { recursive: true })
writeFileSync(folder + '/flow.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>')
writeFileSync(folder + '/capture.json', JSON.stringify({ version: 1, title: 'Fake', kind: 'addition', summary: 'S',
  createdAt: new Date().toISOString(), base: scope.capture.base, commit: scope.capture.commit, files: [],
  views: [{ role: 'flow', title: 'Flow', image: 'flow.svg' }] }))
say({ type: 'result', subtype: 'success', is_error: false, result: 'Drew 1 capture', total_cost_usd: 0.12, num_turns: 7,
  duration_ms: 42000, usage: { input_tokens: 900, output_tokens: 3000, cache_read_input_tokens: 40000, cache_creation_input_tokens: 9000 } })
`, { mode: 0o755 })
  return script
}

async function until<T>(read: () => Promise<T>, ok: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 8000
  for (;;) {
    const value = await read()
    if (ok(value) || Date.now() > deadline) return value
    await new Promise((done) => setTimeout(done, 100))
  }
}

test('runs a commit range in the background and reports what it cost', async () => {
  const { path, base, one, two } = gitRepo()
  const claude = fakeClaude(path)
  const worker = await mountWorker(main, { host: host(path, [], { claudeCommand: claude }) })

  // Orca's worker has no USER; the run must still find the login (the fake fails without it).
  const user = process.env.USER
  delete process.env.USER
  const answer = await worker.request('captures.request', { from: base.slice(0, 9), to: two }).finally(() => {
    process.env.USER = user
  })
  assert.equal(answer.how, 'queued')
  assert.equal(answer.scope, `${base.slice(0, 12)}..${two.slice(0, 12)}`)

  const jobs = await until(() => worker.request('jobs.list'), (list) => list[0]?.status === 'done')
  assert.equal(jobs[0].status, 'done', JSON.stringify(jobs))
  // Orca only accepts plain JSON answers: no undefined fields.
  assert.deepStrictEqual(jobs, JSON.parse(JSON.stringify(jobs)))
  assert.equal(jobs[0].costUsd, 0.12)
  assert.deepEqual(jobs[0].tokens, { input: 900, output: 3000, cacheRead: 40000, cacheWrite: 9000 })

  // The brief carried the range worked out from git, with the values capture.json must use.
  const args = JSON.parse(readFileSync(join(path, 'args.log'), 'utf8').trim())
  assert.ok(['--strict-mcp-config', '--max-budget-usd', '--disable-slash-commands', '--append-system-prompt-file'].every((flag) => args.includes(flag)))
  assert.equal(args[args.indexOf('--tools') + 1], 'Bash,Read,Write,Edit,Glob,Grep')
  assert.ok(args.includes('Read(**/.env)') && !args.includes('Bash(cat:*)'))
  assert.equal(args[args.indexOf('--model') + 1], 'sonnet')
  assert.ok(!args.some((arg: string) => arg === 'Bash' || arg.startsWith('Bash(git push') || arg === 'Bash(git:*)'))
  const listing = await worker.request('captures.list')
  assert.equal(listing.captures[0].base, base)
  assert.equal(listing.captures[0].commit, two)
  assert.deepEqual((await worker.request('jobs.log', { id: jobs[0].id })).lines, ['> Read: x.ts', 'Done: Drew 1 capture'])
  assert.ok(one)
  await worker.deactivate()
})

test('reviews a capture in its own background run and lists what it found', async () => {
  const { path, base, two } = gitRepo()
  const claude = fakeClaude(path)
  const folder = join(path, '.context/debrief/drawn')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'before.svg'), SVG)
  writeFileSync(join(folder, 'after.svg'), SVG)
  writeFileSync(join(folder, 'capture.json'), JSON.stringify({ ...capture('2026-11-09T00:00:00Z'), base, commit: two }))
  const worker = await mountWorker(main, { host: host(path, [], { claudeCommand: claude, ghCommand: fakeGh(path, 'none') }) })

  const { jobId } = await worker.request('captures.review', { captureId: 'drawn' })
  // A second press while it is queued or running joins the same run.
  assert.equal((await worker.request('captures.review', { captureId: 'drawn' })).jobId !== undefined, true)
  const jobs = await until(() => worker.request('jobs.list'), (list) => list.find((j) => j.kind === 'review')?.status === 'done')
  const job = jobs.find((j) => j.kind === 'review')
  assert.equal(job?.status, 'done', JSON.stringify(jobs) + readFileSync(join(path, '.context/debrief/.jobs', `r-${job?.id}.log`), 'utf8'))
  assert.equal(job?.captureId, 'drawn')
  assert.deepEqual(job?.labels, ['review: At 2026-11-09T00:00:00Z'])
  assert.ok(jobId)

  const args = JSON.parse(readFileSync(join(path, 'args.log'), 'utf8').trim().split('\n')[0])
  assert.ok(args[args.indexOf('--append-system-prompt-file') + 1].endsWith('REVIEW.md'))
  assert.ok(!args.some((arg: string) => arg.startsWith('Bash(d2') || arg.includes('look.sh')))
  const brief = JSON.parse(readFileSync(join(path, args[1].split('brief=')[1].trim()), 'utf8'))
  assert.equal(brief.scope.before, base)
  assert.equal(brief.scope.after, two)
  assert.equal(brief.reviewFile, '.context/debrief/drawn/review.debrief.json')

  const listed = (await worker.request('captures.list')).captures.find((c) => c.id === 'drawn')
  assert.deepEqual(listed?.review && { ...listed.review, createdAt: 'x' }, { createdAt: 'x', findings: 1, high: 1, medium: 0, low: 0, summary: 'One bug.' })
  assert.equal((await worker.request('captures.get', { captureId: 'drawn' })).review?.high, 1)
  await worker.request('review.open', { captureId: 'drawn' })
  await worker.deactivate()
})

/** A stand-in for `gh`: one open pull request, its description and one inline comment. */
function fakeGh(dir: string, mode: 'pr' | 'none' | 'broken'): string {
  const script = join(dir, `fake-gh-${mode}.mjs`)
  writeFileSync(script, `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ')
const mode = ${JSON.stringify(mode)}
if (mode === 'broken') { console.error('gh: To get started with GitHub CLI, please run:  gh auth login'); process.exit(4) }
if (args.startsWith('pr list')) {
  console.log(JSON.stringify(mode === 'pr' && args.includes('--head feature/x') ? [{ number: 7, title: 'Seams', url: 'https://github.com/o/r/pull/7', isDraft: false, baseRefName: 'main', headRefName: 'feature/x' }] : []))
} else if (args.startsWith('pr view 7')) {
  console.log(JSON.stringify({ body: 'Fixes the double finish. No behaviour change.', reviews: [], comments: [] }))
} else if (args.startsWith('api repos/{owner}/{repo}/pulls/7/comments')) {
  console.log(JSON.stringify([[{ user: { login: 'rex' }, body: 'Is c used?', path: 'c', line: 1 }]]))
} else { console.error('unexpected: ' + args); process.exit(1) }
`, { mode: 0o755 })
  return script
}

for (const mode of ['pr', 'broken', 'none'] as const) {
  test(`a review reads the open pull request for its branch (${mode})`, async () => {
    const { path, base, two } = gitRepo()
    const folder = join(path, '.context/debrief/drawn')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'before.svg'), SVG)
    writeFileSync(join(folder, 'after.svg'), SVG)
    writeFileSync(join(folder, 'capture.json'), JSON.stringify({ ...capture('2026-11-09T00:00:00Z'), base, commit: two }))
    const worker = await mountWorker(main, {
      host: host(path, [], { claudeCommand: fakeClaude(path), ghCommand: fakeGh(path, mode) })
    })
    const answer = await worker.request('git.pr')
    assert.equal(answer.pr?.number, mode === 'pr' ? 7 : undefined)
    assert.equal(Boolean(answer.error), mode === 'broken')

    await worker.request('captures.review', { captureId: 'drawn' })
    const jobs = await until(() => worker.request('jobs.list'), (list) => list[0]?.status === 'done')
    assert.equal(jobs[0].status, 'done', JSON.stringify(jobs))
    const args = JSON.parse(readFileSync(join(path, 'args.log'), 'utf8').trim().split('\n')[0])
    const brief = JSON.parse(readFileSync(join(path, args[1].split('brief=')[1].trim()), 'utf8'))
    if (mode === 'pr') {
      assert.equal(brief.pr.number, 7)
      assert.equal(brief.pr.body, 'Fixes the double finish. No behaviour change.')
      assert.deepEqual(brief.pr.comments, [{ author: 'rex', body: 'Is c used?', path: 'c', line: 1 }])
    } else {
      assert.equal(brief.pr, undefined)
      assert.equal(Boolean(brief.prNote), mode === 'broken')
    }
    await worker.deactivate()
  })
}

test('refuses a bad range before queueing anything', async () => {
  const { path, base, two } = gitRepo()
  const worker = await mountWorker(main, { host: host(path) })
  await assert.rejects(worker.request('captures.request', { from: two, to: base }), /older than To/)
  await assert.rejects(worker.request('captures.request', { from: 'HEAD~1; rm -rf /', to: two }), /Pick two commits/)
  await assert.rejects(worker.request('captures.request', { from: 'abcdef1234', to: two }), /not a commit/)
  assert.deepEqual(await worker.request('jobs.list'), [])
  await worker.deactivate()
})

test('the brief carries commit bodies without their trailers', async () => {
  const { path, base, two } = gitRepo()
  const scope = await buildScope(path, { from: base, to: two })
  assert.deepEqual(scope.commits.map((c) => [c.subject, c.body]), [
    ['add b', undefined],
    ['add c', 'Keeps c apart from b, so b can be reverted alone.']
  ])
  assert.ok(!('body' in scope.commits[0]))
  assert.equal(commitBody('Signed-off-by: A <a@b>\n'), undefined)
  assert.equal(commitBody('x'.repeat(1300))?.length, 1203)
})

test('reads cited code from git at the capture commits, and figures from its folder', async () => {
  const { path, base, one, two } = gitRepo()
  const folder = join(path, '.context/debrief/cited')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'after.svg'), SVG)
  writeFileSync(join(folder, 'before.svg'), SVG)
  writeFileSync(join(folder, 'idea.svg'), SVG)
  writeFileSync(join(folder, 'capture.json'), JSON.stringify({ ...capture('2026-11-09T00:00:00Z'), base, commit: two }))
  const mock = mockHost({
    results: {
      'workspace.readContext': { branch: 'feature/x', displayName: 'my-worktree', terminals: [] },
      'workspace.list': { workspaces: [{ id: 'ws1', kind: 'worktree', name: 'my-worktree', path, branch: 'feature/x', hostId: 'local' }], truncated: false }
    }
  })
  const worker = await mountWorker(main, { host: mock })
  const cite = (file: string, show: string) => worker.request('code.cite', { captureId: 'cited', cite: { path: file, lines: [1, 1], show } as never })

  const diff = await cite('c', 'diff')
  assert.deepEqual(diff.rows, [{ kind: 'added', line: 1, text: 'c' }])
  assert.equal(diff.from, `${base.slice(0, 9)}..${two.slice(0, 9)}`)
  // d is only in the working tree, never in the commits the capture names.
  await assert.rejects(cite('d', 'after'), /not in the after commit/)
  await assert.rejects(cite('b', 'before'), /not in the before commit/)
  assert.deepEqual((await cite('a', 'before')).rows, [{ kind: 'context', line: 1, text: 'a' }])
  // An unchanged file has no diff, so the cite falls back to the after file.
  assert.equal((await cite('a', 'diff')).from, two.slice(0, 9))
  await assert.rejects(cite('.env', 'after'), /\.env/)

  const figure = await worker.request('captures.asset', { captureId: 'cited', path: 'idea.svg' })
  assert.match(figure.url, /^data:image\/svg\+xml;base64,/)
  await assert.rejects(worker.request('captures.asset', { captureId: 'cited', path: 'capture.json' }), /Only images/)
  await assert.rejects(worker.request('captures.asset', { captureId: 'cited', path: '../../../a.svg' }))
  void one
  await worker.deactivate()
})

test('hands a brief to an idle claude when the setting says so', async () => {
  const { path } = gitRepo()
  const idle = { terminalId: 't1', title: 'Claude', agent: 'claude', state: 'done', stateStartedAt: 0 }
  const mock = host(path, [{ ...idle, terminalId: 't2', state: 'working' }, idle], { captureTarget: 'idle-agent' })
  const worker = await mountWorker(main, { host: mock })
  const answer = await worker.request('captures.request', { uncommitted: true })
  assert.equal(answer.how, 'sent')
  const sent = mock.callsOf('terminal.sendText')[0] as { terminalId: string; text: string }
  assert.equal(sent.terminalId, 't1')
  const brief = JSON.parse(readFileSync(join(path, sent.text.split('brief=')[1]), 'utf8'))
  assert.equal(brief.scopes[0].label, 'uncommitted')
  assert.deepEqual(brief.scopes[0].files.map((f: { path: string }) => f.path), ['d'])
  await worker.deactivate()
})

test('deletes run files a week after the run finished, and keeps newer ones', async () => {
  const path = workspaceWith({})
  const jobs = join(path, '.context/debrief/.jobs')
  mkdirSync(join(jobs, 'r-old-look'), { recursive: true })
  for (const id of ['old', 'new']) {
    writeFileSync(join(jobs, `r-${id}.brief.json`), JSON.stringify({ id, createdAt: new Date().toISOString(), scopes: [] }))
    writeFileSync(join(jobs, `r-${id}.log`), '')
    writeFileSync(join(jobs, `r-${id}.exit`), '0')
  }
  const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
  utimesSync(join(jobs, 'r-old.exit'), eightDaysAgo, eightDaysAgo)
  const worker = await mountWorker(main, { host: host(path) })
  await worker.request('jobs.list')
  assert.deepEqual(readdirSync(jobs).sort(), ['r-new.brief.json', 'r-new.exit', 'r-new.log'])
  await worker.deactivate()
})

test('finds the skill inside the plugin, and needs no install for an idle agent', async () => {
  const jobs = await import('./jobs.ts')
  assert.ok(jobs.skillDir().endsWith('/skills/debrief'))
  assert.ok(readFileSync(join(jobs.skillDir(), 'SKILL.md'), 'utf8').startsWith('---\nname: debrief'))
  assert.equal(jobs.idlePrompt('b.json', true), '/debrief brief=b.json')
  assert.equal(jobs.idlePrompt('b.json', false), `Follow the instructions in ${join(jobs.skillDir(), 'SKILL.md')} with brief=b.json`)
})
