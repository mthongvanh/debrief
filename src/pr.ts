// The open pull request for a workspace's branch, through the GitHub CLI and the person's own
// `gh` login. Read-only: this module never comments on, reviews or edits a pull request.
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type PullRequest = {
  number: number
  title: string
  url: string
  isDraft: boolean
  baseRefName: string
  headRefName: string
}

/** What a review run is told about the pull request: its claims and what reviewers already said. */
export type PrContext = PullRequest & {
  body: string
  comments: { author: string; body: string; path?: string; line?: number }[]
}

const MAX_BODY = 2000
const MAX_COMMENT = 300
const MAX_COMMENTS = 40

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}...` : text)

function gh(cwd: string, args: string[], command: string): Promise<string> {
  const home = homedir()
  const env = { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1' }
  env.PATH = [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', env.PATH].filter(Boolean).join(':')
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { cwd, env, timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error((stderr || error.message).trim().split('\n')[0]))
      else resolvePromise(stdout)
    })
  })
}

/** The first open pull request in `gh pr list --json` output, or null. */
export function parsePrList(json: string): PullRequest | null {
  const list = JSON.parse(json) as Partial<PullRequest>[]
  const first = Array.isArray(list) ? list.find((pr) => typeof pr.number === 'number' && typeof pr.url === 'string') : undefined
  if (!first) return null
  return {
    number: first.number as number,
    title: String(first.title ?? ''),
    url: first.url as string,
    isDraft: first.isDraft === true,
    baseRefName: String(first.baseRefName ?? ''),
    headRefName: String(first.headRefName ?? '')
  }
}

type ViewJson = {
  body?: string
  reviews?: { author?: { login?: string }; body?: string }[]
  comments?: { author?: { login?: string }; body?: string }[]
}
type InlineJson = { user?: { login?: string }; body?: string; path?: string; line?: number | null; original_line?: number | null }[]

/** The pull request's description and comments, clipped so the brief stays small. */
export function parseContext(pr: PullRequest, view: string, inline: string): PrContext {
  const data = JSON.parse(view) as ViewJson
  const lines = (JSON.parse(inline || '[]') as InlineJson).map((c) => {
    const comment: PrContext['comments'][number] = { author: c.user?.login ?? '', body: clip((c.body ?? '').trim(), MAX_COMMENT) }
    if (c.path) comment.path = c.path
    const line = c.line ?? c.original_line
    if (typeof line === 'number') comment.line = line
    return comment
  })
  const general = [...(data.reviews ?? []), ...(data.comments ?? [])].map((c) => ({
    author: c.author?.login ?? '',
    body: clip((c.body ?? '').trim(), MAX_COMMENT)
  }))
  return {
    ...pr,
    body: clip((data.body ?? '').trim(), MAX_BODY),
    comments: [...lines, ...general].filter((c) => c.body !== '').slice(0, MAX_COMMENTS)
  }
}

/** The open pull request whose head is `branch`, or null when there is none. Throws when gh fails. */
export async function findOpenPr(cwd: string, branch: string, command = 'gh'): Promise<PullRequest | null> {
  const name = branch.replace(/^refs\/heads\//, '')
  if (name === '' || name.startsWith('-')) return null
  const out = await gh(cwd, [
    'pr', 'list', '--head', name, '--state', 'open', '--limit', '1',
    '--json', 'number,title,url,isDraft,baseRefName,headRefName'
  ], command)
  return parsePrList(out)
}

/** Reads the description, reviews and comments of `pr`, inline ones included. */
export async function readPrContext(cwd: string, pr: PullRequest, command = 'gh'): Promise<PrContext> {
  const [view, inline] = await Promise.all([
    gh(cwd, ['pr', 'view', String(pr.number), '--json', 'body,reviews,comments'], command),
    gh(cwd, ['api', `repos/{owner}/{repo}/pulls/${pr.number}/comments`, '--paginate', '--slurp'], command)
      .then((out) => JSON.stringify((JSON.parse(out) as unknown[][]).flat()))
      .catch(() => '[]')
  ])
  return parseContext(pr, view, inline)
}
