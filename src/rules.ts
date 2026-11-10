// A repository's own instructions for runs, committed beside its code so the whole team shares
// them: `.debrief/review.md` for reviews and `.debrief/capture.md` for captures. Read from git at a
// commit, never from the working tree, so what a run is told is what the repository holds there.
import { runGit } from './git.ts'

export const REVIEW_RULES_FILE = '.debrief/review.md'
export const CAPTURE_RULES_FILE = '.debrief/capture.md'
/** Kept short: every turn of a run re-reads its brief. */
export const MAX_RULES_CHARS = 4000

export type ProjectRules = {
  /** The file, relative to the repository root. */
  path: string
  /** The commit it was read at. */
  from: string
  text: string
  /** Set when the file was longer than MAX_RULES_CHARS and was cut at a line break. */
  truncated?: true
}

/** The file's text trimmed and cut to MAX_RULES_CHARS, or undefined when it says nothing. */
export function clipRules(path: string, from: string, raw: string): ProjectRules | undefined {
  const text = raw.trim()
  if (text === '') return undefined
  if (text.length <= MAX_RULES_CHARS) return { path, from, text }
  const cut = text.slice(0, MAX_RULES_CHARS)
  const line = cut.lastIndexOf('\n')
  return { path, from, text: (line > 0 ? cut.slice(0, line) : cut).trimEnd(), truncated: true }
}

/** `path` as committed at `commit` (a sha or a name such as HEAD), or undefined when it has no such file. */
export async function readProjectRules(cwd: string, path: string, commit: string): Promise<ProjectRules | undefined> {
  const sha = (await runGit(cwd, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]).catch(() => ''))
    .trim()
  if (sha === '') return undefined
  const raw = await runGit(cwd, ['show', `${sha}:${path}`]).catch(() => null)
  return raw === null ? undefined : clipRules(path, sha, raw)
}
