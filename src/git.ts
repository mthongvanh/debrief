// The branch history the timeline is drawn from, and checks on a commit range before an agent is
// asked to draw it. Read-only git commands, run in the workspace folder.
import { execFile } from 'node:child_process'
import type { CommitInfo, History } from './protocol.ts'

const MAX_COMMITS = 60
const FIELD = '\x1f'
const RECORD = '\x1e'
const SHA = /^[0-9a-f]{7,40}$/

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(new Error(stderr.trim() || error.message), { code: 'action_failed' }))
      else resolvePromise(stdout)
    })
  })
}

export const runGit = (cwd: string, args: string[]) => git(cwd, args)

const attempt = (cwd: string, args: string[]) => git(cwd, args).then((out) => out.trim(), () => null)

function parseLog(out: string): CommitInfo[] {
  return out
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, subject, date, parents] = record.split(FIELD)
      return { sha, short: sha.slice(0, 9), subject, date, parent: parents.split(' ')[0] || null }
    })
}

const LOG_FORMAT = `--format=%H${FIELD}%s${FIELD}%cI${FIELD}%P${RECORD}`

/** Where this branch left its trunk: the first of origin/master, origin/main, master, main. */
async function branchBase(cwd: string, head: string): Promise<string | null> {
  for (const trunk of ['origin/master', 'origin/main', 'master', 'main']) {
    const base = await attempt(cwd, ['merge-base', 'HEAD', trunk])
    // On the trunk itself the base is HEAD, which says nothing; show recent history instead.
    if (base && base !== head) return base
  }
  return null
}

export async function readHistory(cwd: string): Promise<History> {
  const head = await attempt(cwd, ['rev-parse', 'HEAD'])
  if (head === null) {
    return { head: null, dirty: false, base: null, commits: [], truncated: false, error: 'Not a Git repository, or it has no commits yet' }
  }
  const [status, baseSha] = await Promise.all([attempt(cwd, ['status', '--porcelain']), branchBase(cwd, head)])
  const range = baseSha ? [`${baseSha}..HEAD`] : ['HEAD']
  const commits = parseLog(await git(cwd, ['log', '--first-parent', `-n${MAX_COMMITS + 1}`, LOG_FORMAT, ...range]))
  const base = baseSha ? parseLog(await git(cwd, ['log', '-n1', LOG_FORMAT, baseSha]))[0] ?? null : null
  return {
    head,
    dirty: (status ?? '') !== '',
    base,
    commits: commits.slice(0, MAX_COMMITS),
    truncated: commits.length > MAX_COMMITS
  }
}

/**
 * The full shas of a range an agent may be asked to draw: both real commits, `from` an ancestor
 * of `to`. Refuses anything else, so the prompt only ever carries two hex shas.
 */
export async function checkRange(cwd: string, from: string, to: string): Promise<{ from: string; to: string }> {
  if (!SHA.test(from) || !SHA.test(to)) {
    throw Object.assign(new Error('Pick two commits from the list'), { code: 'invalid_params' })
  }
  const resolve = async (sha: string) => {
    const full = await attempt(cwd, ['rev-parse', '--verify', '--quiet', `${sha}^{commit}`])
    if (full === null) throw Object.assign(new Error(`${sha} is not a commit here`), { code: 'invalid_params' })
    return full
  }
  const [fullFrom, fullTo] = await Promise.all([resolve(from), resolve(to)])
  if (fullFrom === fullTo) throw Object.assign(new Error('From and To are the same commit'), { code: 'invalid_params' })
  const ancestor = await git(cwd, ['merge-base', '--is-ancestor', fullFrom, fullTo]).then(() => true, () => false)
  if (!ancestor) throw Object.assign(new Error('From must be older than To, on the same line of history'), { code: 'invalid_params' })
  return { from: fullFrom, to: fullTo }
}

/** Files the drawing leaves out: generated code, lockfiles, and the captures themselves. */
const GENERATED = [
  /\.g\.dart$/, /\.freezed\.dart$/, /\.mocks\.dart$/, /\.gr\.dart$/, /\.config\.dart$/,
  /(^|\/)app_localizations[^/]*\.dart$/, /(^|\/)generated\//,
  /(^|\/)(pubspec\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Podfile\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock)$/,
  /^\.context\//
]
const MAX_FILES = 300
const STATUS: Record<string, BriefFile['status']> = { A: 'added', M: 'modified', D: 'deleted', R: 'renamed', C: 'added', T: 'modified' }

export type BriefFile = { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed'; added: number; deleted: number; from?: string }

/** One thing to draw, worked out from git so the agent does not have to. */
export type BriefScope = {
  label: string
  /** Full sha the before views are read from. */
  before: string
  /** Full sha the after views are read from, or "working-tree". */
  after: string
  /** Values for capture.json, so the timeline places the capture right. */
  capture: { base: string; commit: string }
  /**
   * The commits in the range, oldest first. Subjects say what the work meant to do; a body, when
   * there is one, often says why, which is where a walkthrough's stated decisions come from.
   */
  commits: { short: string; subject: string; body?: string }[]
  files: BriefFile[]
  skipped: { path: string; reason: 'generated' }[]
  truncated: boolean
  /** Capture folders already drawn for this exact base and commit: redraw these, do not add one. */
  existing?: string[]
}

/** Merges `--name-status -M` and `--numstat -M` output into one list. */
function parseDiff(nameStatus: string, numstat: string): BriefFile[] {
  const counts = new Map<string, [number, number]>()
  for (const line of numstat.split('\n').filter(Boolean)) {
    const [added, deleted, ...rest] = line.split('\t')
    // A rename reads "old => new" or "dir/{old => new}"; the new path is what name-status keys on.
    const path = rest.join('\t').replace(/\{[^{}]* => ([^{}]*)\}/, '$1').replace(/^.* => /, '').replace(/\/\//g, '/')
    counts.set(path, [Number(added) || 0, Number(deleted) || 0])
  }
  return nameStatus.split('\n').filter(Boolean).map((line) => {
    const [code, first, second] = line.split('\t')
    const path = second ?? first
    const [added, deleted] = counts.get(path) ?? [0, 0]
    const file: BriefFile = { path, status: STATUS[code[0]] ?? 'modified', added, deleted }
    if (second) file.from = first
    return file
  })
}

const MAX_BODY = 1200
const TRAILER = /^[A-Za-z-]+: .+$/

/** A commit body without its trailers (Co-Authored-By and the like), cut to MAX_BODY characters. */
export function commitBody(raw: string): string | undefined {
  const lines = raw.trimEnd().split('\n')
  while (lines.length > 0 && (TRAILER.test(lines[lines.length - 1]) || lines[lines.length - 1].trim() === '')) lines.pop()
  const body = lines.join('\n').trim()
  if (body === '') return undefined
  return body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}...` : body
}

/** The full sha of HEAD's branch base, the first trunk that works. */
async function fullBase(cwd: string): Promise<string> {
  const head = await git(cwd, ['rev-parse', 'HEAD']).then((out) => out.trim())
  return (await branchBase(cwd, head)) ?? head
}

export async function buildScope(
  cwd: string,
  scope: { from?: string; to?: string; uncommitted?: boolean }
): Promise<BriefScope> {
  const head = (await git(cwd, ['rev-parse', 'HEAD'])).trim()
  let before: string
  let after: string
  let label: string
  if (scope.uncommitted && scope.from !== undefined) {
    // From a commit to the working tree: a capture that drew uncommitted work on top of it.
    if (!SHA.test(scope.from)) throw Object.assign(new Error('Pick a commit from the list'), { code: 'invalid_params' })
    const full = await attempt(cwd, ['rev-parse', '--verify', '--quiet', `${scope.from}^{commit}`])
    if (full === null) throw Object.assign(new Error(`${scope.from} is not a commit here`), { code: 'invalid_params' })
    before = full
    after = 'working-tree'
    label = `${before.slice(0, 12)}..working tree`
  } else if (scope.from !== undefined || scope.to !== undefined) {
    const range = await checkRange(cwd, scope.from ?? '', scope.to ?? '')
    before = range.from
    after = range.to
    label = `${before.slice(0, 12)}..${after.slice(0, 12)}`
  } else {
    before = scope.uncommitted ? head : await fullBase(cwd)
    after = 'working-tree'
    label = scope.uncommitted ? 'uncommitted' : 'branch'
  }
  const target = after === 'working-tree' ? [before] : [before, after]
  const [nameStatus, numstat] = await Promise.all([
    git(cwd, ['diff', '--name-status', '-M', ...target]),
    git(cwd, ['diff', '--numstat', '-M', ...target])
  ])
  const files = parseDiff(nameStatus, numstat)
  if (after === 'working-tree') {
    const untracked = (await git(cwd, ['ls-files', '--others', '--exclude-standard'])).split('\n').filter(Boolean)
    for (const path of untracked) files.push({ path, status: 'added', added: 0, deleted: 0 })
  }
  const log = before === head && after === 'working-tree'
    ? ''
    : await git(cwd, ['log', '--reverse', '--first-parent', `--format=%h${FIELD}%s${FIELD}%b${RECORD}`, `${before}..${after === 'working-tree' ? 'HEAD' : after}`])
  const commits = log.split(RECORD).map((record) => record.replace(/^\n+/, '')).filter(Boolean).map((record) => {
    const [short, subject, rawBody = ''] = record.split(FIELD)
    const body = commitBody(rawBody)
    return body ? { short, subject, body } : { short, subject }
  })
  const kept = files.filter((file) => !GENERATED.some((pattern) => pattern.test(file.path)))
  const skipped = files.filter((file) => !kept.includes(file)).map((file) => ({ path: file.path, reason: 'generated' as const }))
  const dirty = after === 'working-tree' && (await git(cwd, ['status', '--porcelain'])).trim() !== ''
  return {
    label,
    before,
    after,
    capture: { base: before, commit: after === 'working-tree' ? `${head}${dirty ? '+dirty' : ''}` : after },
    commits,
    files: kept.slice(0, MAX_FILES),
    skipped,
    truncated: kept.length > MAX_FILES
  }
}
