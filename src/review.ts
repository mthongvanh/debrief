// A code review of one capture's change: `review.debrief.json` in the capture folder, written by a
// background review run and shown in the walkthrough editor. Pure logic shared by the worker, the
// editor and the tests. No Node or Orca calls here.
import { CaptureError } from './captures.ts'
import type { Cite } from './cite.ts'
import { parseCite } from './walkthrough.ts'

export const REVIEW_FILE = 'review.debrief.json'

export type Severity = 'high' | 'medium' | 'low'
/** Confirmed: traced end to end through the code. Plausible: the path is likely but a step is assumed. */
export type Confidence = 'confirmed' | 'plausible'

export type Finding = {
  severity: Severity
  confidence: Confidence
  title: string
  /** What goes wrong: the inputs or state, and the wrong outcome. */
  failure: string
  /** Why the code does that. */
  why: string
  fix?: string
  code: Cite
}

export type Review = {
  version: 1
  kind: 'review'
  capture: string
  createdAt: string
  /** One sentence: the verdict. */
  summary: string
  /** What the review read and ran, and what it did not. */
  basis: string
  findings: Finding[]
  /** Areas looked at where nothing was wrong, so a short list still shows its coverage. */
  checked: string[]
  /** Where the walkthrough misreads the code: a fix for the walkthrough, not the code. */
  walkthroughErrors?: string[]
  /** The open pull request the review read, when there was one. */
  pr?: { number: number; url: string }
}

export type ReviewSummary = {
  createdAt: string
  findings: number
  high: number
  medium: number
  low: number
  /** The review's one-sentence verdict. */
  summary: string
  /** The pull request the review read, when there was one. */
  pr?: number
}

export const REVIEW_LIMITS = { title: 90, failure: 220, why: 220, fix: 160, summary: 200, basis: 200, checked: 120, walkthroughErrors: 220 } as const
const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low']
const CONFIDENCES: readonly Confidence[] = ['confirmed', 'plausible']

function fail(message: string): never {
  throw new CaptureError(message)
}

const record = (value: unknown, field: string) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`"${field}" must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, max: number, optional = false): string | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.trim() === '') fail(`"${field}" must be a non-empty string`)
  if (value.length > max) fail(`"${field}" is ${value.length} characters; keep it to ${max}`)
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) fail(`"${field}" must be one of ${allowed.join(', ')}`)
  return value as T
}

const list = (value: unknown, field: string, max: number): unknown[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`"${field}" must be a list`)
  if (value.length > max) fail(`"${field}" has ${value.length} items; keep it to ${max}`)
  return value
}

/** True when a .debrief.json file's text is a review rather than a walkthrough. */
export function isReviewText(json: string): boolean {
  try {
    return (JSON.parse(json) as { kind?: unknown })?.kind === 'review'
  } catch {
    return false
  }
}

/** Reads one review file. Throws CaptureError naming the first field that is wrong. */
export function parseReview(json: string): Review {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (error) {
    fail(`not JSON: ${(error as Error).message}`)
  }
  const data = record(raw, 'review')
  if (data.version !== 1) fail('"version" must be 1')
  if (data.kind !== 'review') fail('"kind" must be "review"')
  const createdAt = text(data.createdAt, 'createdAt', 40) as string
  if (Number.isNaN(Date.parse(createdAt))) fail('"createdAt" must be an ISO 8601 date')
  const order = (finding: Finding) => SEVERITIES.indexOf(finding.severity)
  let pr: Review['pr']
  if (data.pr !== undefined) {
    const raw = record(data.pr, 'pr')
    if (!Number.isInteger(raw.number) || (raw.number as number) < 1) fail('"pr.number" must be a pull request number')
    const url = text(raw.url, 'pr.url', 300) as string
    if (!/^https:\/\//.test(url)) fail('"pr.url" must be an https URL')
    pr = { number: raw.number as number, url }
  }
  const review: Review = {
    version: 1,
    kind: 'review',
    capture: text(data.capture, 'capture', 200) as string,
    createdAt,
    summary: text(data.summary, 'summary', REVIEW_LIMITS.summary) as string,
    basis: text(data.basis, 'basis', REVIEW_LIMITS.basis) as string,
    findings: list(data.findings, 'findings', 10)
      .map((item, i): Finding => {
        const at = `findings[${i}]`
        const f = record(item, at)
        const finding: Finding = {
          severity: oneOf(f.severity, SEVERITIES, `${at}.severity`),
          confidence: oneOf(f.confidence, CONFIDENCES, `${at}.confidence`),
          title: text(f.title, `${at}.title`, REVIEW_LIMITS.title) as string,
          failure: text(f.failure, `${at}.failure`, REVIEW_LIMITS.failure) as string,
          why: text(f.why, `${at}.why`, REVIEW_LIMITS.why) as string,
          code: parseCite(f.code, `${at}.code`)
        }
        const fix = text(f.fix, `${at}.fix`, REVIEW_LIMITS.fix, true)
        if (fix !== undefined) finding.fix = fix
        return finding
      })
      .sort((a, b) => order(a) - order(b)),
    checked: list(data.checked, 'checked', 6).map((item, i) => text(item, `checked[${i}]`, REVIEW_LIMITS.checked) as string)
  }
  const walkthroughErrors = list(data.walkthroughErrors, 'walkthroughErrors', 5)
    .map((item, i) => text(item, `walkthroughErrors[${i}]`, REVIEW_LIMITS.walkthroughErrors) as string)
  if (walkthroughErrors.length > 0) review.walkthroughErrors = walkthroughErrors
  if (pr) review.pr = pr
  return review
}

/** Where a finding's cited lines are, for text: "`lib/a.dart` lines 10–14", "(before)" for deleted code. */
function citeText(code: Cite): string {
  const [from, to] = code.lines
  return `\`${code.path}\` ${from === to ? `line ${from}` : `lines ${from}–${to}`}${code.show === 'before' ? ' (before the change)' : ''}`
}

/**
 * The review as Markdown, to paste into a pull request comment or a chat. The text fields already
 * use backticks for code names, so they go in as they are.
 */
export function reviewMarkdown(review: Review, capture: { title: string; base?: string; commit?: string }): string {
  const count = (severity: Severity) => review.findings.filter((f) => f.severity === severity).length
  const tally = SEVERITIES.filter((s) => count(s) > 0).map((s) => `${count(s)} ${s}`).join(' · ')
  const base = (capture.base ?? '').slice(0, 7)
  const commit = (capture.commit ?? '').replace(/\+dirty$/, ' + uncommitted').replace(/^([0-9a-f]{7})[0-9a-f]*/i, '$1')
  const lines = [
    `### Review: ${capture.title}`,
    '',
    review.summary,
    '',
    [
      `**${tally || 'No findings'}**`,
      base && commit ? `\`${base}..${commit}\`` : '',
      review.basis
    ].filter(Boolean).join(' · ')
  ]
  review.findings.forEach((f, i) => {
    lines.push(
      '',
      `${i + 1}. **${f.title}** (${f.severity}, ${f.confidence}) at ${citeText(f.code)}`,
      `   - What breaks: ${f.failure}`,
      `   - Why: ${f.why}`
    )
    if (f.fix) lines.push(`   - Fix: ${f.fix}`)
  })
  if (review.walkthroughErrors) {
    lines.push('', 'Walkthrough errors (the walkthrough is wrong, not the code):', ...review.walkthroughErrors.map((w) => `- ${w}`))
  }
  if (review.checked.length > 0) lines.push('', `Also checked, nothing wrong: ${review.checked.join('; ')}.`)
  return `${lines.join('\n')}\n`
}

export function summarize(review: Review): ReviewSummary {
  const count = (severity: Severity) => review.findings.filter((f) => f.severity === severity).length
  return {
    createdAt: review.createdAt, findings: review.findings.length, high: count('high'), medium: count('medium'), low: count('low'),
    summary: review.summary, ...(review.pr ? { pr: review.pr.number } : {})
  }
}
