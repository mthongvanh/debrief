// Background runs: a queue of capture and review requests, and one headless `claude -p` run at a
// time. A capture run draws diagrams; a review run reviews one capture's code. Everything
// lives in files under <captures>/.jobs, so a run outlives the worker (Orca stops idle workers) and
// any worker that starts later can read its state, finish its bookkeeping and start the next run.
import { spawn } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BriefScope } from './git.ts'
import type { PrContext } from './pr.ts'
import type { CaptureScope, Job, JobRun } from './protocol.ts'
import type { ProjectRules } from './rules.ts'

export const JOBS_DIR = '.jobs'
const QUEUED = /^q-([A-Za-z0-9-]+)\.json$/
const BRIEF = /^r-([A-Za-z0-9-]+)\.brief\.json$/
const LOG_TAIL_BYTES = 256 * 1024
/** Finished runs stay listed this long unless dismissed. */
const KEEP_FINISHED_MS = 6 * 60 * 60 * 1000

export type RunnerSettings = { model: string; maxBudgetUsd: number; claudeCommand: string }

type Queued = { id: string; createdAt: string; scope: CaptureScope; label: string; kind?: 'review'; captureId?: string }
type CaptureBrief = {
  id: string
  kind?: 'capture'
  createdAt: string
  startedAt: string
  capturesDir: string
  skillDir: string
  lookDir: string
  scopes: BriefScope[]
  rules: string[]
  /** The repository's own capture instructions, read at HEAD. */
  projectRules?: ProjectRules
}
/** What a review run gets: one capture, its change worked out from git, and where to write. */
export type ReviewTarget = {
  capture: { id: string; title: string; summary: string; base: string; commit: string; walkthrough?: string }
  /** The capture folder, relative to the workspace: the review is written there. */
  captureDir: string
  scope: BriefScope
  /** The open pull request this change belongs to: its claims and what reviewers already said. */
  pr?: PrContext
  /** Why there is no pull request context, when looking it up failed. */
  prNote?: string
  /** The repository's own review instructions, read at the commit before the change. */
  projectRules?: ProjectRules
}
type ReviewBrief = ReviewTarget & {
  id: string
  kind: 'review'
  createdAt: string
  startedAt: string
  reviewFile: string
  rules: string[]
}
type Brief = CaptureBrief | ReviewBrief

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const jobsDir = (root: string) => join(root, JOBS_DIR)

/** Where Claude Code looks for the skill when someone types /debrief. Linking it there is optional. */
const linkedSkill = () => join(homedir(), '.claude', 'skills', 'debrief', 'SKILL.md')

/** The skill shipped inside this plugin; background runs read it from here, so nothing has to be installed. */
export function skillDir(): string {
  const bundled = fileURLToPath(new URL('../skills/debrief/', import.meta.url))
  return existsSync(join(bundled, 'SKILL.md')) ? realpathSync(bundled) : dirname(linkedSkill())
}

/**
 * What to type into an idle Claude: the slash command when the skill is linked into
 * ~/.claude/skills, otherwise a pointer to the skill file inside the plugin.
 */
export function idlePrompt(briefPath: string, linked = existsSync(linkedSkill())): string {
  return linked
    ? `/debrief brief=${briefPath}`
    : `Follow the instructions in ${join(skillDir(), 'SKILL.md')} with brief=${briefPath}`
}

export async function enqueue(
  root: string,
  scope: CaptureScope,
  label: string,
  review?: { captureId: string }
): Promise<string> {
  await mkdir(jobsDir(root), { recursive: true })
  const id = newId()
  const queued: Queued = { id, createdAt: new Date().toISOString(), scope, label }
  if (review) Object.assign(queued, { kind: 'review', captureId: review.captureId })
  await writeFile(join(jobsDir(root), `q-${id}.json`), JSON.stringify(queued, null, 2))
  return id
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as { code?: string }).code === 'EPERM'
  }
}

const readJson = async <T>(path: string): Promise<T | null> =>
  readFile(path, 'utf8').then((text) => JSON.parse(text) as T, () => null)
const readText = (path: string) => readFile(path, 'utf8').catch(() => null)

async function tail(path: string): Promise<string> {
  try {
    const { size } = await stat(path)
    const text = await readFile(path, 'utf8')
    return size > LOG_TAIL_BYTES ? text.slice(-LOG_TAIL_BYTES) : text
  } catch {
    return ''
  }
}

type StreamEvent = {
  type?: string
  subtype?: string
  is_error?: boolean
  result?: string
  total_cost_usd?: number
  num_turns?: number
  duration_ms?: number
  usage?: Record<string, number>
  message?: { content?: { type: string; name?: string; text?: string; input?: Record<string, unknown> }[] }
}

function events(log: string): StreamEvent[] {
  return log.split('\n').flatMap((line) => {
    if (!line.startsWith('{')) return []
    try {
      return [JSON.parse(line) as StreamEvent]
    } catch {
      return []
    }
  })
}

/** One readable line per step of a run, for the panel's log. */
export function describeEvents(log: string): string[] {
  const lines: string[] = []
  for (const event of events(log)) {
    if (event.type === 'assistant') {
      for (const part of event.message?.content ?? []) {
        if (part.type === 'tool_use') {
          const input = part.input ?? {}
          const detail = String(input.command ?? input.file_path ?? input.pattern ?? input.skill ?? '')
          lines.push(`> ${part.name}${detail ? `: ${detail.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`)
        } else if (part.type === 'text' && part.text?.trim()) {
          lines.push(part.text.trim().replace(/\s+/g, ' ').slice(0, 200))
        }
      }
    } else if (event.type === 'result') {
      lines.push(`${event.is_error ? 'Failed' : 'Done'}${event.result ? `: ${event.result.replace(/\s+/g, ' ').slice(0, 300)}` : ''}`)
    }
  }
  return lines
}

function runOf(log: string): Partial<JobRun> {
  const all = events(log)
  const result = [...all].reverse().find((event) => event.type === 'result')
  const steps = describeEvents(log)
  const run: Partial<JobRun> = { activity: steps.filter((line) => line.startsWith('>')).at(-1) ?? steps.at(-1) }
  if (result) {
    const usage = result.usage ?? {}
    run.costUsd = result.total_cost_usd
    run.turns = result.num_turns
    run.durationMs = result.duration_ms
    run.tokens = {
      input: usage.input_tokens ?? 0,
      output: usage.output_tokens ?? 0,
      cacheRead: usage.cache_read_input_tokens ?? 0,
      cacheWrite: usage.cache_creation_input_tokens ?? 0
    }
    if (result.is_error || result.subtype !== 'success') run.error = result.result ?? result.subtype ?? 'the run failed'
  }
  return run
}

export async function listJobs(root: string): Promise<Job[]> {
  const dir = jobsDir(root)
  const names = await readdir(dir).catch(() => [] as string[])
  const jobs: Job[] = []
  for (const name of names) {
    const queued = QUEUED.exec(name)
    if (queued) {
      const entry = await readJson<Queued>(join(dir, name))
      if (entry) {
        jobs.push({
          id: entry.id, status: 'queued', labels: [entry.label], createdAt: entry.createdAt,
          kind: entry.kind ?? 'capture', ...(entry.captureId ? { captureId: entry.captureId } : {})
        })
      }
      continue
    }
    const run = BRIEF.exec(name)
    if (!run) continue
    const id = run[1]
    const brief = await readJson<Brief>(join(dir, name))
    if (!brief || names.includes(`r-${id}.dismissed`)) continue
    const exit = await readText(join(dir, `r-${id}.exit`))
    const pid = Number(await readText(join(dir, `r-${id}.pid`)))
    const details = runOf(await tail(join(dir, `r-${id}.log`)))
    let status: Job['status'] = 'running'
    let error = details.error
    if (exit !== null) {
      status = exit.trim() === '0' && !error ? 'done' : 'failed'
      if (status === 'failed' && !error) error = `claude exited with ${exit.trim()}`
    } else if (pid > 0 && !alive(pid)) {
      status = 'failed'
      error = error ?? 'the run stopped before it finished'
    }
    const finishedAt = exit !== null ? (await stat(join(dir, `r-${id}.exit`))).mtime.toISOString() : undefined
    if (finishedAt && Date.now() - Date.parse(finishedAt) > KEEP_FINISHED_MS) continue
    jobs.push({
      id,
      status,
      labels: brief.kind === 'review' ? [`review: ${brief.capture.title}`] : brief.scopes.map((scope) => scope.label),
      kind: brief.kind ?? 'capture',
      ...(brief.kind === 'review' ? { captureId: brief.capture.id } : {}),
      createdAt: brief.createdAt,
      startedAt: brief.startedAt,
      finishedAt,
      ...details,
      error: status === 'failed' ? error : undefined
    })
  }
  // Orca refuses answers with undefined fields, so leave unknown values out.
  return JSON.parse(JSON.stringify(jobs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)))) as Job[]
}

export async function jobLog(root: string, id: string): Promise<string[]> {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return []
  const log = await tail(join(jobsDir(root), `r-${id}.log`))
  const steps = describeEvents(log)
  // Before any JSON arrives (or when claude fails to start) show the raw text.
  return steps.length > 0 ? steps.slice(-80) : log.split('\n').filter(Boolean).slice(-40)
}

export async function cancelJob(root: string, id: string): Promise<void> {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return
  const dir = jobsDir(root)
  await rm(join(dir, `q-${id}.json`), { force: true })
  const pid = Number(await readText(join(dir, `r-${id}.pid`)))
  if (pid > 0 && alive(pid)) {
    // Detached runs lead their own process group: stop the shell and claude together.
    try {
      process.kill(-pid, 'SIGTERM')
    } catch {
      process.kill(pid, 'SIGTERM')
    }
  }
}

export async function dismissJob(root: string, id: string): Promise<void> {
  if (!/^[A-Za-z0-9-]+$/.test(id)) return
  await writeFile(join(jobsDir(root), `r-${id}.dismissed`), '')
}

const RULES = [
  'Draw only what this brief lists; it was worked out from git, so do not re-derive the scope.',
  'Write only under capturesDir; never edit code, commit, push or stash.',
  'Put each scope\'s capture.json base and commit exactly as given in its "capture" field.',
  'Use lookDir for look-check screenshots.'
]

const REVIEW_RULES = [
  'Review only the change this brief names; it was worked out from git, so do not re-derive it.',
  'Write only the reviewFile; never edit code, commit, push or stash.',
  'Do not run builds, tests or the app; say so in basis.'
]

const READ_ONLY_GIT = ['show', 'diff', 'log', 'rev-parse', 'ls-files', 'grep', 'cat-file', 'blame'].map((sub) => `Bash(git ${sub}:*)`)

/** Tools a capture run may use: read-only git, d2, the look-check script and file edits. */
export function allowedTools(skill: string): string[] {
  // No cat, head or grep: they read files past the .env deny rules below. Read and Grep do that job.
  const shell = ['d2', 'mkdir', 'cp', 'ls', 'cd', 'wc', 'file', 'diff', 'echo'].map((cmd) => `Bash(${cmd}:*)`)
  return ['Read', 'Write', 'Edit', 'Glob', 'Grep', ...READ_ONLY_GIT, ...shell, `Bash(${join(skill, 'scripts', 'look.sh')}:*)`]
}

/** Tools a review run may use: reading code and git, and writing its one review file. */
export function reviewTools(): string[] {
  return ['Read', 'Write', 'Edit', 'Glob', 'Grep', ...READ_ONLY_GIT, 'Bash(ls:*)', 'Bash(wc:*)']
}

/** Secrets stay out of the model's context even when a run strays from its brief. */
export const deniedTools = ['Read(**/.env)', 'Read(**/.env.*)', 'Grep(**/.env)', 'Grep(**/.env.*)']

/** Run files older than this are deleted: their logs hold code excerpts and paths. */
const DELETE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** Deletes runs (brief, log, exit, pid, look screenshots) that finished more than a week ago. */
export async function pruneRuns(root: string): Promise<void> {
  const dir = jobsDir(root)
  const names = await readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    const match = /^r-([A-Za-z0-9-]+)\.exit$/.exec(name)
    if (!match) continue
    const { mtimeMs } = await stat(join(dir, name))
    if (Date.now() - mtimeMs < DELETE_AFTER_MS) continue
    for (const other of names.filter((entry) => entry.startsWith(`r-${match[1]}`))) {
      await rm(join(dir, other), { recursive: true, force: true })
    }
  }
  for (const name of names.filter((entry) => /^i-.*\.brief\.json$/.test(entry))) {
    const { mtimeMs } = await stat(join(dir, name))
    if (Date.now() - mtimeMs >= DELETE_AFTER_MS) await rm(join(dir, name), { force: true })
  }
}

export type RunSources = {
  scopeFor: (scope: CaptureScope) => Promise<BriefScope>
  reviewFor: (captureId: string) => Promise<ReviewTarget>
  /** The repository's capture rules, when it has them. */
  captureRules: () => Promise<ProjectRules | undefined>
}

/**
 * Starts the next run when nothing is running: a review request on its own, or every queued
 * capture request in one run. Returns the new run's id, or null when a run is already going or
 * the queue is empty.
 */
export async function startNext(root: string, cwd: string, settings: RunnerSettings, sources: RunSources): Promise<string | null> {
  const current = await listJobs(root)
  if (current.some((job) => job.status === 'running')) return null
  const dir = jobsDir(root)
  const names = (await readdir(dir).catch(() => [] as string[])).filter((name) => QUEUED.test(name)).sort()
  const entries: { name: string; entry: Queued }[] = []
  for (const name of names) {
    const entry = await readJson<Queued>(join(dir, name))
    if (entry) entries.push({ name, entry })
    else await rm(join(dir, name), { force: true })
  }
  if (entries.length === 0) return null

  const id = newId()
  const now = new Date().toISOString()
  const skill = skillDir()
  const briefPath = join(dir, `r-${id}.brief.json`)
  if (entries[0].entry.kind === 'review') {
    const { name, entry } = entries[0]
    await rm(join(dir, name), { force: true })
    const target = await sources.reviewFor(entry.captureId ?? '')
    const brief: ReviewBrief = {
      id, kind: 'review', createdAt: entry.createdAt, startedAt: now, ...target,
      reviewFile: `${target.captureDir}/review.debrief.json`, rules: REVIEW_RULES
    }
    await writeFile(briefPath, JSON.stringify(brief, null, 2))
    await launch(dir, id, cwd, settings, {
      prompt: `Follow the code review instructions in your system prompt with brief=${relative(cwd, briefPath)}`,
      systemPrompt: join(skill, 'REVIEW.md'),
      tools: reviewTools(),
      skill
    })
    return id
  }

  const scopes: BriefScope[] = []
  const seen = new Set<string>()
  for (const { name, entry } of entries) {
    if (entry.kind === 'review') continue
    await rm(join(dir, name), { force: true })
    if (seen.has(entry.label)) continue
    seen.add(entry.label)
    scopes.push(await sources.scopeFor(entry.scope))
  }
  if (scopes.length === 0) return null
  const projectRules = await sources.captureRules()
  const brief: CaptureBrief = {
    id,
    createdAt: now,
    startedAt: now,
    capturesDir: relative(cwd, root),
    skillDir: skill,
    lookDir: relative(cwd, join(dir, `r-${id}-look`)),
    scopes,
    rules: RULES,
    ...(projectRules ? { projectRules } : {})
  }
  await writeFile(briefPath, JSON.stringify(brief, null, 2))
  await launch(dir, id, cwd, settings, {
    prompt: `Follow the debrief instructions in your system prompt with brief=${relative(cwd, briefPath)}`,
    systemPrompt: join(skill, 'SKILL.md'),
    tools: allowedTools(skill),
    skill
  })
  return id
}

type Launch = { prompt: string; systemPrompt: string; tools: string[]; skill: string }

/** Starts `claude -p` detached, its output in r-<id>.log and its exit code in r-<id>.exit. */
async function launch(dir: string, id: string, cwd: string, settings: RunnerSettings, run: Launch): Promise<void> {
  // Lean on purpose: every turn re-reads the whole base context, so the run gets its instructions
  // as the system prompt and nothing else it would carry for nothing (MCP servers, the skill
  // listing, CLAUDE.md, the memory index, built-in tools it never calls).
  const args = [
    '-p', run.prompt,
    '--append-system-prompt-file', run.systemPrompt,
    '--disable-slash-commands',
    '--tools', 'Bash,Read,Write,Edit,Glob,Grep',
    '--model', settings.model,
    '--strict-mcp-config',
    '--allowedTools', ...run.tools,
    '--disallowedTools', ...deniedTools,
    '--add-dir', run.skill,
    '--max-budget-usd', String(settings.maxBudgetUsd),
    '--no-session-persistence',
    '--output-format', 'stream-json', '--verbose'
  ]
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('D2_')) delete env[key]
  env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
  env.CLAUDE_CODE_DISABLE_CLAUDE_MDS = '1'
  const home = homedir()
  // Claude Code finds its login in the macOS keychain under the user's name; Orca's worker
  // process has no USER, and without it every run fails with "Not logged in".
  env.HOME ??= home
  env.USER ??= userInfo().username
  env.LOGNAME ??= env.USER
  env.PATH = [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', env.PATH].filter(Boolean).join(':')
  env.DEBRIEF_LOG = join(dir, `r-${id}.log`)
  env.DEBRIEF_EXIT = join(dir, `r-${id}.exit`)
  // The shell records claude's exit code, so a worker started later can tell done from failed.
  const child = spawn('/bin/sh', ['-c', '"$0" "$@" > "$DEBRIEF_LOG" 2>&1 < /dev/null; echo $? > "$DEBRIEF_EXIT"', settings.claudeCommand, ...args], {
    cwd,
    env,
    detached: true,
    stdio: 'ignore'
  })
  await writeFile(join(dir, `r-${id}.pid`), String(child.pid ?? 0))
  child.unref()
}

/** Adds the captures folder to .git/info/exclude when nothing ignores it yet. */
export async function ensureIgnored(cwd: string, capturesDir: string, git: (args: string[]) => Promise<string>): Promise<void> {
  const ignored = await git(['check-ignore', '-q', capturesDir]).then(() => true, () => false)
  if (ignored) return
  const exclude = resolve(cwd, (await git(['rev-parse', '--git-path', 'info/exclude'])).trim())
  const current = existsSync(exclude) ? await readFile(exclude, 'utf8') : ''
  await mkdir(resolve(exclude, '..'), { recursive: true })
  await writeFile(exclude, `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}${capturesDir.replace(/\/?$/, '/')}\n`)
}
