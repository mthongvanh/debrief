// The walkthrough file a capture may carry: a guided path through its diagrams with the code
// each step is about, and the design decisions behind it. Pure logic
// shared by the worker, the walkthrough editor and the tests. No Node or Orca calls here.
import { CaptureError, IMAGE_TYPES, extensionOf, insidePath } from './captures.ts'
import { MAX_CITE_LINES, type Cite, type CiteShow } from './cite.ts'

/** Files ending in this open in the walkthrough editor. */
export const WALKTHROUGH_SUFFIX = '.debrief.json'

/** A small diagram for an abstract idea, drawn into the capture folder like the views. */
export type Figure = { image: string; source?: string; caption?: string }

export type WalkthroughStep = {
  title: string
  /** One to four short points; `backticks` mark code names. */
  points: string[]
  /** Index into the capture's views: the diagram shown for this step. */
  view?: number
  /** D2 node ids to light up in that diagram; everything else is dimmed. */
  focus: string[]
  /** At most two cited blocks of code. */
  code: Cite[]
}

/** Stated: the commit message, a comment or a doc says so. Inferred: read from the code's shape. */
export type Evidence = 'stated' | 'inferred'

export type Decision = {
  decision: string
  why: string
  evidence: Evidence
  /** Where it is stated, or what in the code it was inferred from. */
  source: string
  /** What was done, in a few words, shown next to `alternative`. */
  chosen?: string
  /** The option not taken, when the code or the commit names one. */
  alternative?: string
  /** The rule to follow next time, phrased as "When ..., ...". */
  applyElsewhere?: string
  figure?: Figure
  code?: Cite
}

export type Walkthrough = {
  version: 1
  /** The capture folder this belongs to; its views are the diagrams the steps point at. */
  capture: string
  title: string
  /** One sentence: the idea to hold on to while reading. */
  intro: string
  figure?: Figure
  steps: WalkthroughStep[]
  decisions: Decision[]
}

/** Longest text each field takes, so a walkthrough stays a set of short points. */
export const LIMITS = {
  title: 70, intro: 200, stepTitle: 50, point: 140,
  decision: 70, why: 160, source: 160, chosen: 100, alternative: 100, applyElsewhere: 140, caption: 140, note: 120
} as const

const EVIDENCE: readonly Evidence[] = ['stated', 'inferred']
const SHOWS: readonly CiteShow[] = ['diff', 'after', 'before']

function fail(message: string): never {
  throw new CaptureError(message)
}

const record = (value: unknown, field: string) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`"${field}" must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, max: number): string
function text(value: unknown, field: string, max: number, optional: true): string | undefined
function text(value: unknown, field: string, max: number, optional = false): string | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.trim() === '') fail(`"${field}" must be a non-empty string`)
  if (value.length > max) fail(`"${field}" is ${value.length} characters; keep it to ${max}`)
  return value
}

const list = (value: unknown, field: string, max = Infinity): unknown[] => {
  if (value === undefined) return []
  if (!Array.isArray(value)) fail(`"${field}" must be a list`)
  if (value.length > max) fail(`"${field}" has ${value.length} items; keep it to ${max}`)
  return value
}

export function isEnvFile(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  return name === '.env' || name.startsWith('.env.')
}

/** A workspace path a walkthrough may name: relative, no `..`, not under .git, never a .env file. */
export function repoPath(value: unknown, field: string): string {
  const path = insidePath(value, field) as string
  if (isEnvFile(path) || path.split('/')[0] === '.git') fail(`"${field}" may not point at a .env file or into .git`)
  return path
}

export function parseCite(raw: unknown, field: string): Cite {
  const cite = record(raw, field)
  const lines = cite.lines
  if (!Array.isArray(lines) || lines.length !== 2 || !lines.every((n) => Number.isInteger(n) && n >= 1) || lines[0] > lines[1]) {
    fail(`"${field}.lines" must be [first, last], line numbers from 1`)
  }
  if (lines[1] - lines[0] + 1 > MAX_CITE_LINES) fail(`"${field}.lines" covers ${lines[1] - lines[0] + 1} lines; cite at most ${MAX_CITE_LINES}`)
  const show = cite.show ?? 'diff'
  if (!SHOWS.includes(show as CiteShow)) fail(`"${field}.show" must be one of ${SHOWS.join(', ')}`)
  const parsed: Cite = { path: repoPath(cite.path, `${field}.path`), lines: [lines[0], lines[1]], show: show as CiteShow }
  const note = text(cite.note, `${field}.note`, LIMITS.note, true)
  // A cite goes to the worker as a request, and Orca refuses requests holding undefined fields.
  if (note !== undefined) parsed.note = note
  return parsed
}

function parseFigure(raw: unknown, field: string): Figure | undefined {
  if (raw === undefined) return undefined
  const figure = record(raw, field)
  const image = insidePath(figure.image, `${field}.image`) as string
  if (!(extensionOf(image) in IMAGE_TYPES)) fail(`"${field}.image" must be one of ${Object.keys(IMAGE_TYPES).join(' ')}`)
  return {
    image,
    source: insidePath(figure.source, `${field}.source`, true),
    caption: text(figure.caption, `${field}.caption`, LIMITS.caption, true)
  }
}

/** Reads one walkthrough file. Throws CaptureError naming the first field that is wrong. */
export function parseWalkthrough(json: string): Walkthrough {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (error) {
    fail(`not JSON: ${(error as Error).message}`)
  }
  const data = record(raw, 'walkthrough')
  if (data.version !== 1) fail('"version" must be 1')
  const steps = list(data.steps, 'steps', 8).map((item, i): WalkthroughStep => {
    const at = `steps[${i}]`
    const step = record(item, at)
    const view = step.view
    if (view !== undefined && !(Number.isInteger(view) && (view as number) >= 0)) fail(`"${at}.view" must be a view index`)
    const points = list(step.points, `${at}.points`, 4).map((point, j) => text(point, `${at}.points[${j}]`, LIMITS.point))
    if (points.length === 0) fail(`"${at}.points" must list at least one point`)
    return {
      title: text(step.title, `${at}.title`, LIMITS.stepTitle),
      points,
      view: view as number | undefined,
      focus: list(step.focus, `${at}.focus`).map((id, j) => text(id, `${at}.focus[${j}]`, 200)),
      code: list(step.code, `${at}.code`, 2).map((cite, j) => parseCite(cite, `${at}.code[${j}]`))
    }
  })
  if (steps.length === 0) fail('"steps" must list at least one step')
  return {
    version: 1,
    capture: text(data.capture, 'capture', 200),
    title: text(data.title, 'title', LIMITS.title),
    intro: text(data.intro, 'intro', LIMITS.intro),
    figure: parseFigure(data.figure, 'figure'),
    steps,
    decisions: list(data.decisions, 'decisions', 5).map((item, i) => {
      const at = `decisions[${i}]`
      const d = record(item, at)
      if (!EVIDENCE.includes(d.evidence as Evidence)) fail(`"${at}.evidence" must be stated or inferred`)
      return {
        decision: text(d.decision, `${at}.decision`, LIMITS.decision),
        why: text(d.why, `${at}.why`, LIMITS.why),
        evidence: d.evidence as Evidence,
        source: text(d.source, `${at}.source`, LIMITS.source),
        chosen: text(d.chosen, `${at}.chosen`, LIMITS.chosen, true),
        alternative: text(d.alternative, `${at}.alternative`, LIMITS.alternative, true),
        applyElsewhere: text(d.applyElsewhere, `${at}.applyElsewhere`, LIMITS.applyElsewhere, true),
        figure: parseFigure(d.figure, `${at}.figure`),
        code: d.code === undefined ? undefined : parseCite(d.code, `${at}.code`)
      }
    })
  }
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

/**
 * The id a D2 group class stands for, or null when the class is not one of D2's ids. D2 writes
 * each node's and edge's id HTML-escaped (`-&gt;`), then base64-encoded, as the group's first
 * class.
 */
export function d2IdOf(className: string): string | null {
  if (!/^[A-Za-z0-9+/]+=*$/.test(className) || className.length % 4 !== 0) return null
  try {
    const binary = atob(className)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    const escaped = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return escaped.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity])
  } catch {
    return null
  }
}

/**
 * The two ends of an edge id, as full node ids. D2 names an edge's group `(a -> b)[0]`, or
 * `box.(a -> b)[0]` for an edge drawn inside the container `box`.
 */
export function edgeEnds(id: string): [string, string] | null {
  const match = /^(?:(.+)\.)?\((.+?) (?:<->|->|<-|--) (.+?)\)\[\d+\]$/.exec(id)
  if (!match) return null
  const prefix = match[1] ? `${match[1]}.` : ''
  return [prefix + match[2], prefix + match[3]]
}

/**
 * Which ids to light up: the focused nodes, anything nested inside them, the containers around
 * them, and edges whose ends are both focused. `ids` are every group id in the SVG.
 */
export function litIds(ids: readonly string[], focus: readonly string[]): Set<string> {
  const inFocus = (id: string) => focus.some((f) => id === f || id.startsWith(`${f}.`))
  // A container stays lit around a focused box inside it, or its own fade would hide the box.
  const holdsFocus = (id: string) => focus.some((f) => f.startsWith(`${id}.`))
  const lit = new Set<string>()
  for (const id of ids) {
    const ends = edgeEnds(id)
    if (ends ? inFocus(ends[0]) && inFocus(ends[1]) : inFocus(id) || holdsFocus(id)) lit.add(id)
  }
  return lit
}
