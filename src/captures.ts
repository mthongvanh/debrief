// Pure logic shared by the worker and its tests: the capture.json format, and which workspace
// the panel is looking at. No Node or Orca calls here.

/** A review capture holds no diagrams: only a code review of its range. */
export type CaptureKind = 'modification' | 'addition' | 'review'
export type ViewRole = 'before' | 'after' | 'flow'
export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export type CaptureView = {
  role: ViewRole
  title: string
  caption?: string
  /** Rendered diagram, relative to the capture folder: .svg, .png, .jpg or .webp. */
  image: string
  /** The .d2 source, relative to the capture folder. */
  source?: string
}

export type Capture = {
  /** The capture's folder name. */
  id: string
  title: string
  kind: CaptureKind
  summary: string
  /** ISO 8601. */
  createdAt: string
  /** HEAD when the capture was drawn. */
  commit?: string
  /** The commit the before views were read from. */
  base?: string
  /** What the diagrams were drawn from, such as "code reading of the diff". */
  basis?: string
  files: { path: string; status: FileStatus }[]
  views: CaptureView[]
  /** The walkthrough file, relative to the capture folder; it ends in `.debrief.json`. */
  walkthrough?: string
}

export const IMAGE_TYPES: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const KINDS: readonly CaptureKind[] = ['modification', 'addition', 'review']
const ROLES: readonly ViewRole[] = ['before', 'after', 'flow']
const STATUSES: readonly FileStatus[] = ['added', 'modified', 'deleted', 'renamed']

export class CaptureError extends Error {}

function fail(message: string): never {
  throw new CaptureError(message)
}

function text(value: unknown, field: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || value.trim() === '') fail(`"${field}" must be a non-empty string`)
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (!allowed.includes(value as T)) fail(`"${field}" must be one of ${allowed.join(', ')}`)
  return value as T
}

/** A path inside the capture folder: relative, no `..`, no backslashes. */
export function insidePath(value: unknown, field: string, optional = false): string | undefined {
  const path = text(value, field, optional)
  if (path === undefined) return undefined
  if (path.startsWith('/') || path.includes('\\') || path.split('/').includes('..')) {
    fail(`"${field}" must be a path inside the capture folder`)
  }
  return path
}

export function extensionOf(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot === -1 ? '' : path.slice(dot).toLowerCase()
}

function parseView(raw: unknown, index: number): CaptureView {
  if (typeof raw !== 'object' || raw === null) fail(`views[${index}] must be an object`)
  const view = raw as Record<string, unknown>
  const image = insidePath(view.image, `views[${index}].image`) as string
  if (!(extensionOf(image) in IMAGE_TYPES)) {
    fail(`views[${index}].image must be one of ${Object.keys(IMAGE_TYPES).join(' ')}`)
  }
  return {
    role: oneOf(view.role, ROLES, `views[${index}].role`),
    title: text(view.title, `views[${index}].title`) as string,
    caption: text(view.caption, `views[${index}].caption`, true),
    image,
    source: insidePath(view.source, `views[${index}].source`, true)
  }
}

/** Reads one capture.json. Throws CaptureError naming the first field that is wrong. */
export function parseCapture(id: string, json: string): Capture {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (error) {
    fail(`capture.json is not JSON: ${(error as Error).message}`)
  }
  if (typeof raw !== 'object' || raw === null) fail('capture.json must hold an object')
  const data = raw as Record<string, unknown>
  if (data.version !== 1) fail('"version" must be 1')

  const kind = oneOf(data.kind, KINDS, 'kind')
  const createdAt = text(data.createdAt, 'createdAt') as string
  if (Number.isNaN(Date.parse(createdAt))) fail('"createdAt" must be an ISO 8601 date')
  if (!Array.isArray(data.views)) fail('"views" must be a list')
  if (kind === 'review' && data.views.length > 0) fail('a review capture has no views')
  if (kind !== 'review' && data.views.length === 0) fail('"views" must list at least one view')
  const views = data.views.map(parseView)
  const has = (role: ViewRole) => views.some((view) => view.role === role)
  if (kind === 'modification' && !(has('before') && has('after'))) {
    fail('a modification needs a "before" and an "after" view')
  }
  if (kind === 'addition' && !has('flow')) fail('an addition needs a "flow" view')

  const files = Array.isArray(data.files) ? data.files : []
  const walkthrough = insidePath(data.walkthrough, 'walkthrough', true)
  if (walkthrough !== undefined && !walkthrough.endsWith('.debrief.json')) fail('"walkthrough" must end in .debrief.json')
  return {
    id,
    title: text(data.title, 'title') as string,
    kind,
    summary: text(data.summary, 'summary') as string,
    createdAt,
    commit: text(data.commit, 'commit', true),
    base: text(data.base, 'base', true),
    basis: text(data.basis, 'basis', true),
    files: files.map((file, index) => {
      const entry = (typeof file === 'object' && file !== null ? file : {}) as Record<string, unknown>
      return {
        path: text(entry.path, `files[${index}].path`) as string,
        status: oneOf(entry.status, STATUSES, `files[${index}].status`)
      }
    }),
    views,
    walkthrough
  }
}

export function newestFirst(a: Capture, b: Capture): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt)
}

type Context = { branch: string; displayName: string } | null
type Workspace = { id: string; name: string; path: string; branch: string | null; hostId: string | null }

const shortBranch = (branch: string | null) => (branch ?? '').replace(/^refs\/heads\//, '')

/**
 * The workspace readContext describes. readContext has no id or path, so match on branch, then
 * name. Only local workspaces count: the worker reads captures from this machine's disk.
 */
export function pickWorkspace<W extends Workspace>(context: Context, workspaces: readonly W[]): W | null {
  if (context === null) return null
  // Orca reports this machine as hostId "local"; null is accepted too.
  const local = workspaces.filter((workspace) => workspace.hostId === null || workspace.hostId === 'local')
  const branch = shortBranch(context.branch)
  const byBranch = branch === '' ? [] : local.filter((w) => shortBranch(w.branch) === branch)
  const byName = (candidates: readonly W[]) => candidates.find((w) => w.name === context.displayName)
  if (byBranch.length === 1) return byBranch[0]
  return byName(byBranch.length > 1 ? byBranch : local) ?? byBranch[0] ?? null
}
