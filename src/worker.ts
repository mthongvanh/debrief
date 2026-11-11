// Reads captures from the focused workspace's disk for the panel, opens them in Orca, and queues
// background runs of the debrief skill that draw new ones. The only capture this code writes is a
// review-only one: a capture.json with no diagrams, so a review can run before anything is drawn.
import { watch, type FSWatcher } from 'node:fs'
import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeClipboard } from './clipboard.ts'
import type { OrcaWorkerApi } from 'orca/worker'
import {
  CaptureError,
  IMAGE_TYPES,
  extensionOf,
  newestFirst,
  parseCapture,
  pickWorkspace,
  type Capture,
  type CaptureView
} from './captures.ts'
import { buildScope, readHistory, runGit, type BriefScope } from './git.ts'
import { cancelJob, dismissJob, enqueue, ensureIgnored, idlePrompt, jobLog, jobsDir, listJobs, pruneRuns, skillDir, startNext, JOBS_DIR } from './jobs.ts'
import type { CaptureListing, CaptureScope, ListedCapture, ViewRef, WorkspaceInfo } from './protocol.ts'
import { MAX_DIFF_ROWS, capRows, diffWindow, fileDiff, sliceFile } from './cite.ts'
import { parseCite, parseWalkthrough, repoPath } from './walkthrough.ts'
import { MAX_NOTES, NOTES_FILE, newNote, notesJson, notesMarkdown, parseNotes, type Note, type SentVia } from './notes.ts'
import { REVIEW_FILE, parseReview, summarize } from './review.ts'
import { findOpenPr, readPrContext, type PrContext as PrContextType, type PullRequest } from './pr.ts'
import { CAPTURE_RULES_FILE, REVIEW_RULES_FILE, readProjectRules } from './rules.ts'

/** Answers are capped at 1 MiB and base64 grows a file by a third. */
const MAX_IMAGE_BYTES = 700 * 1024
const CAPTURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

type Settings = {
  capturesDir: string
  captureTarget: 'background' | 'idle-agent'
  model: string
  maxBudgetUsd: number
  claudeCommand: string
  ghCommand: string
}

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

async function readSettings(orca: OrcaWorkerApi): Promise<Settings> {
  const raw = await orca.settings.get()
  const pick = (key: string, fallback: string) => {
    const value = raw[key]
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
  }
  const budget = Number(raw.maxBudgetUsd)
  return {
    capturesDir: pick('capturesDir', '.context/debrief'),
    captureTarget: pick('captureTarget', 'background') === 'idle-agent' ? 'idle-agent' : 'background',
    model: pick('model', 'sonnet'),
    maxBudgetUsd: Number.isFinite(budget) && budget > 0 ? budget : 1,
    claudeCommand: pick('claudeCommand', 'claude'),
    ghCommand: pick('ghCommand', 'gh')
  }
}

async function focusedWorkspace(orca: OrcaWorkerApi): Promise<WorkspaceInfo | null> {
  const context = await orca.host.call('workspace.readContext', {})
  if (context === null) return null
  const { workspaces } = await orca.host.call('workspace.list', {})
  const found = pickWorkspace(context, workspaces)
  return found && { id: found.id, name: found.name, branch: found.branch, path: found.path }
}

/** The captures folder, refused when the setting points outside the workspace. */
function capturesRoot(workspace: WorkspaceInfo, capturesDir: string): string {
  const root = resolve(workspace.path, capturesDir)
  if (relative(workspace.path, root).startsWith('..')) {
    throw codedError('invalid_params', `Captures folder "${capturesDir}" is outside the workspace`)
  }
  return root
}

/** `child` resolved inside `parent`, following symlinks, or an error when it lands outside. */
async function inside(parent: string, child: string): Promise<string> {
  const [realParent, realChild] = await Promise.all([realpath(parent), realpath(resolve(parent, child))])
  if (!realChild.startsWith(realParent + sep)) {
    throw codedError('not_permitted', `${child} is outside its capture folder`)
  }
  return realChild
}

const isMissing = (error: unknown) => (error as { code?: unknown } | null)?.code === 'ENOENT'

/** The capture plus its review summary and walkthrough size, read from files beside it. A bad
 *  review file is reported; a bad walkthrough is left to the editor, which shows its error. */
async function withExtras(capture: Capture, folder: string): Promise<ListedCapture> {
  const listed: ListedCapture = capture
  const review = await readFile(resolve(folder, REVIEW_FILE), 'utf8').catch(() => null)
  if (review !== null) {
    try {
      listed.review = summarize(parseReview(review))
    } catch (error) {
      listed.reviewProblem = error instanceof CaptureError ? error.message : String(error)
    }
  }
  if (capture.walkthrough !== undefined) {
    try {
      const walkthrough = parseWalkthrough(await readFile(await inside(folder, capture.walkthrough), 'utf8'))
      listed.walkthroughSize = { steps: walkthrough.steps.length, decisions: walkthrough.decisions.length }
    } catch {
      // The button still opens it, and the editor says what is wrong.
    }
  }
  return listed
}

async function listCaptures(root: string): Promise<Pick<CaptureListing, 'captures' | 'problems'>> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    if (isMissing(error)) return { captures: [], problems: [] }
    throw error
  }
  const captures: ListedCapture[] = []
  const problems: CaptureListing['problems'] = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !CAPTURE_ID.test(entry.name)) continue
    try {
      const json = await readFile(resolve(root, entry.name, 'capture.json'), 'utf8')
      captures.push(await withExtras(parseCapture(entry.name, json), resolve(root, entry.name)))
    } catch (error) {
      // The skill writes capture.json last, so a folder without one is still being drawn.
      if (isMissing(error)) continue
      const message = error instanceof CaptureError ? error.message : String(error)
      problems.push({ id: entry.name, message })
    }
  }
  return { captures: captures.sort(newestFirst), problems }
}

type Found = { workspace: WorkspaceInfo; folder: string; capture: Capture }
type Located = Found & { view: CaptureView }

async function locateCapture(orca: OrcaWorkerApi, captureId: string): Promise<Found> {
  if (!CAPTURE_ID.test(captureId)) throw codedError('invalid_params', 'Bad capture id')
  const workspace = await focusedWorkspace(orca)
  if (workspace === null) throw codedError('unavailable', 'No local workspace is focused')
  const root = capturesRoot(workspace, (await readSettings(orca)).capturesDir)
  const folder = await inside(root, captureId)
  const capture = parseCapture(captureId, await readFile(resolve(folder, 'capture.json'), 'utf8'))
  return { workspace, folder, capture }
}

/** Opens `file`, an absolute path inside the workspace, in an Orca editor tab. */
async function openInEditor(orca: OrcaWorkerApi, workspace: WorkspaceInfo, file: string): Promise<{ opened: true }> {
  // editor.open takes a path relative to the workspace root, with forward slashes.
  const path = relative(await realpath(workspace.path), file).split(sep).join('/')
  await orca.host.call('editor.open', { workspaceId: workspace.id, path })
  return { opened: true as const }
}

/**
 * The commits a capture's code is read from: `base` and `after`, or `base` and the working tree
 * when the capture was drawn from uncommitted work. `label` names the after side.
 */
function captureRange(capture: { base?: string; commit?: string }): { base: string; after: string; dirty: boolean; label: string } {
  const sha = /^[0-9a-f]{7,40}$/
  const base = (capture.base ?? '').toLowerCase()
  const commit = (capture.commit ?? '').toLowerCase()
  const dirty = commit.endsWith('+dirty')
  const after = commit.replace(/\+dirty$/, '')
  if (!sha.test(base) || !sha.test(after)) throw codedError('unavailable', 'The capture has no base and commit to read code from')
  return { base, after, dirty, label: dirty ? 'working tree' : after.slice(0, 9) }
}

async function readNotes(folder: string): Promise<Note[]> {
  try {
    return parseNotes(await readFile(join(folder, NOTES_FILE), 'utf8'))
  } catch (error) {
    if (isMissing(error)) return []
    throw error
  }
}

/** Writes to one capture's notes, one change at a time, so two quick saves never lose one. */
const noteWrites = new Map<string, Promise<unknown>>()
function changeNotes(folder: string, change: (notes: Note[]) => Note[]): Promise<void> {
  const run = (noteWrites.get(folder) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => writeFile(join(folder, NOTES_FILE), notesJson(change(await readNotes(folder)))))
  noteWrites.set(folder, run)
  void run.finally(() => { if (noteWrites.get(folder) === run) noteWrites.delete(folder) }).catch(() => undefined)
  return run
}

const MAX_CLIPBOARD_CHARS = 2_000_000

/** Writes the system clipboard; tests swap `write` so they never touch the real one. */
export const clipboard = { write: writeClipboard }

/** Marks notes handed off now, by `via`; ids that are not notes are ignored. */
function markSent(folder: string, ids: unknown, via: SentVia): Promise<void> {
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw codedError('invalid_params', 'ids must be a list of note ids')
  const marked = new Set(ids as string[])
  const sentAt = new Date().toISOString()
  return changeNotes(folder, (notes) => notes.map((note) => (marked.has(note.id) && !note.sentAt ? { ...note, sentAt, sentVia: via } : note)))
}

async function locateView(orca: OrcaWorkerApi, ref: ViewRef): Promise<Located> {
  const { workspace, folder, capture } = await locateCapture(orca, ref.captureId)
  const view = capture.views[ref.view]
  if (view === undefined) throw codedError('invalid_params', `Capture has no view ${ref.view}`)
  return { workspace, folder, capture, view }
}

/** Open pull requests by workspace path, so the panel's refreshes do not each ask GitHub. */
const PR_TTL_MS = 60_000
const prCache = new Map<string, { at: number; value: { pr: PullRequest | null; error?: string } }>()

async function openPr(workspace: WorkspaceInfo, ghCommand: string): Promise<{ pr: PullRequest | null; error?: string }> {
  const key = `${workspace.path}\0${workspace.branch ?? ''}`
  const cached = prCache.get(key)
  if (cached && Date.now() - cached.at < PR_TTL_MS) return cached.value
  const value = await findOpenPr(workspace.path, workspace.branch ?? '', ghCommand).then(
    (pr) => ({ pr }),
    (error: Error) => ({ pr: null, error: `Could not ask GitHub for a pull request: ${error.message}` })
  )
  prCache.set(key, { at: Date.now(), value })
  return value
}

let watcher: FSWatcher | null = null
let watchedRoot: string | null = null
let debounce: ReturnType<typeof setTimeout> | undefined
let jobsTimer: ReturnType<typeof setTimeout> | undefined

export default function activate(orca: OrcaWorkerApi): void {
  /** Tells open panels about writes under `root`; a missing folder is picked up on the next list. */
  function watchRoot(root: string, workspaceId: string): void {
    if (root === watchedRoot) return
    watcher?.close()
    watcher = null
    watchedRoot = root
    try {
      watcher = watch(root, { recursive: true }, (_event, name) => {
        const file = String(name ?? '')
        if (file.startsWith(`${JOBS_DIR}/`) || file === JOBS_DIR) {
          // A run's log grows by the second: tell panels at most every 1.5 s.
          if (jobsTimer === undefined) {
            jobsTimer = setTimeout(() => {
              jobsTimer = undefined
              orca.panels.post('jobs.changed', { workspaceId })
            }, 1500)
          }
          if (file.endsWith('.exit')) void advanceQueue()
          return
        }
        clearTimeout(debounce)
        debounce = setTimeout(() => orca.panels.post('captures.changed', { workspaceId }), 400)
      })
      watcher.on('error', (error) => orca.log(`watch ${root}: ${error.message}`))
    } catch (error) {
      if (!isMissing(error)) orca.log(`watch ${root}: ${String(error)}`)
      watchedRoot = null
    }
  }

  orca.panels.handle('captures.list', async () => {
    const { capturesDir } = await readSettings(orca)
    const workspace = await focusedWorkspace(orca)
    if (workspace === null) return { workspace, capturesDir, captures: [], problems: [] }
    const root = capturesRoot(workspace, capturesDir)
    const listing = await listCaptures(root)
    watchRoot(root, workspace.id)
    return { workspace, capturesDir, ...listing }
  })

  orca.panels.handle('captures.image', async (ref) => {
    const { folder, view } = await locateView(orca, ref)
    const file = await inside(folder, view.image)
    const { size } = await stat(file)
    if (size > MAX_IMAGE_BYTES) {
      throw codedError('too_large', `${view.image} is ${Math.round(size / 1024)} KiB; the panel shows up to 700 KiB. Open it in a tab instead.`)
    }
    const mime = IMAGE_TYPES[extensionOf(view.image)]
    const data = (await readFile(file)).toString('base64')
    return { url: `data:${mime};base64,${data}`, bytes: size }
  })

  orca.panels.handle('captures.open', async ({ what, ...ref }) => {
    const { workspace, folder, view } = await locateView(orca, ref)
    const target = what === 'source' ? view.source : view.image
    if (target === undefined) throw codedError('invalid_params', 'This view has no .d2 source')
    return openInEditor(orca, workspace, await inside(folder, target))
  })

  orca.panels.handle('captures.get', async ({ captureId }) => {
    const { capture, folder } = await locateCapture(orca, captureId)
    return withExtras(capture, folder)
  })

  orca.panels.handle('walkthrough.open', async ({ captureId }) => {
    const { workspace, folder, capture } = await locateCapture(orca, captureId)
    if (capture.walkthrough === undefined) throw codedError('invalid_params', 'This capture has no walkthrough')
    return openInEditor(orca, workspace, await inside(folder, capture.walkthrough))
  })

  orca.panels.handle('code.open', async ({ path }) => {
    const workspace = await focusedWorkspace(orca)
    if (workspace === null) throw codedError('unavailable', 'No local workspace is focused')
    try {
      repoPath(path, 'path')
    } catch {
      throw codedError('not_permitted', 'That file is not opened from a walkthrough')
    }
    try {
      return await openInEditor(orca, workspace, await inside(workspace.path, path))
    } catch (error) {
      if (isMissing(error)) throw codedError('invalid_params', `${path} is not in this workspace at the moment`)
      throw error
    }
  })

  orca.panels.handle('captures.asset', async ({ captureId, path }) => {
    const { folder } = await locateCapture(orca, captureId)
    const mime = IMAGE_TYPES[extensionOf(String(path))]
    if (mime === undefined) throw codedError('invalid_params', 'Only images are served from a capture folder')
    const file = await inside(folder, path)
    const { size } = await stat(file)
    if (size > MAX_IMAGE_BYTES) throw codedError('too_large', `${path} is ${Math.round(size / 1024)} KiB; the editor shows up to 700 KiB`)
    return { url: `data:${mime};base64,${(await readFile(file)).toString('base64')}`, bytes: size }
  })

  orca.panels.handle('code.cite', async ({ captureId, cite: raw }) => {
    const { workspace, capture } = await locateCapture(orca, captureId)
    let cite
    try {
      cite = parseCite(raw, 'cite')
    } catch (error) {
      throw codedError('invalid_params', (error as Error).message)
    }
    const { base, after, dirty, label } = captureRange(capture)
    const [from, to] = cite.lines
    const git = (args: string[]) => runGit(workspace.path, args)
    const afterText = async () =>
      dirty ? readFile(await inside(workspace.path, cite.path), 'utf8') : git(['show', `${after}:${cite.path}`])
    try {
      if (cite.show === 'before') {
        return { ...capRows(sliceFile(await git(['show', `${base}:${cite.path}`]), from, to)), from: base.slice(0, 9) }
      }
      if (cite.show === 'diff') {
        const diff = await git(['diff', '-U5', base, ...(dirty ? [] : [after]), '--', cite.path])
        const rows = diffWindow(diff, from, to)
        if (rows.some((row) => row.kind === 'added' || row.kind === 'deleted')) {
          return { ...capRows(rows), from: `${base.slice(0, 9)}..${label}` }
        }
      }
      return { ...capRows(sliceFile(await afterText(), from, to)), from: label }
    } catch (error) {
      if (isMissing(error) || /does not exist|exists on disk, but not in/.test((error as Error).message)) {
        throw codedError('invalid_params', `${cite.path} is not in ${cite.show === 'before' ? 'the before' : 'the after'} commit`)
      }
      throw error
    }
  })

  orca.panels.handle('code.diff', async ({ captureId, path: raw }) => {
    const { workspace, capture } = await locateCapture(orca, captureId)
    let path
    try {
      path = repoPath(raw, 'path')
    } catch (error) {
      throw codedError('invalid_params', (error as Error).message)
    }
    const { base, after, dirty, label } = captureRange(capture)
    // --no-renames keeps a moved file's diff about this path alone.
    const diff = await runGit(workspace.path, ['diff', '--no-renames', '-U5', base, ...(dirty ? [] : [after]), '--', path])
    if (/^Binary files /m.test(diff)) throw codedError('invalid_params', `${path} is a binary file, so there are no lines to show`)
    const rows = fileDiff(diff)
    return {
      rows: rows.slice(0, MAX_DIFF_ROWS),
      truncated: rows.length > MAX_DIFF_ROWS,
      from: `${base.slice(0, 9)}..${label}`
    }
  })

  orca.panels.handle('notes.list', async ({ captureId }) => {
    const { folder } = await locateCapture(orca, captureId)
    return { notes: await readNotes(folder) }
  })

  orca.panels.handle('notes.add', async ({ captureId, note: raw }) => {
    const { folder } = await locateCapture(orca, captureId)
    let note: Note
    try {
      note = newNote(raw, randomUUID(), new Date())
    } catch (error) {
      throw codedError('invalid_params', (error as Error).message)
    }
    await changeNotes(folder, (notes) => {
      if (notes.length >= MAX_NOTES) throw codedError('too_large', `A capture holds at most ${MAX_NOTES} notes`)
      return [...notes, note]
    })
    return { note }
  })

  orca.panels.handle('notes.remove', async ({ captureId, id }) => {
    const { folder } = await locateCapture(orca, captureId)
    await changeNotes(folder, (notes) => notes.filter((note) => note.id !== id))
    return { ok: true as const }
  })

  orca.panels.handle('clipboard.write', async ({ text }) => {
    if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_CHARS) throw codedError('invalid_params', 'text must be a string of at most 2 MB')
    try {
      await clipboard.write(text)
    } catch (error) {
      throw codedError('unavailable', (error as Error).message)
    }
    return { ok: true as const }
  })

  /**
   * Copies the notes not handed off yet as Markdown and marks them copied. When the clipboard
   * cannot be written, `copied` is false, nothing is marked, and `markdown` is there to copy by hand.
   */
  orca.panels.handle('notes.copy', async ({ captureId }) => {
    const { folder, capture } = await locateCapture(orca, captureId)
    const unsent = (await readNotes(folder)).filter((note) => !note.sentAt)
    if (unsent.length === 0) throw codedError('invalid_params', 'Every note was already handed off')
    const markdown = notesMarkdown(capture, unsent)
    try {
      await clipboard.write(markdown)
    } catch (error) {
      return { copied: false, count: unsent.length, markdown, error: (error as Error).message }
    }
    await markSent(folder, unsent.map((note) => note.id), 'copy')
    return { copied: true, count: unsent.length, markdown }
  })

  orca.panels.handle('notes.launch', async ({ captureId }) => {
    const { workspace, folder, capture } = await locateCapture(orca, captureId)
    const unsent = (await readNotes(folder)).filter((note) => !note.sentAt)
    if (unsent.length === 0) throw codedError('invalid_params', 'Every note was already handed off')
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = join(folder, `notes-${stamp}.md`)
    await writeFile(file, notesMarkdown(capture, unsent))
    // The capture folder is a real path, so the workspace's must be too, or the path climbs out.
    const path = relative(await realpath(workspace.path), file).split(sep).join('/')
    const { terminalId } = await orca.host.call('agent.launch', {
      workspaceId: workspace.id,
      agent: 'claude',
      prompt: `Read the review notes in ${path} and work through each one.`
    })
    await markSent(folder, unsent.map((note) => note.id), 'claude')
    return { count: unsent.length, terminalId }
  })

  orca.panels.handle('git.pr', async () => {
    const workspace = await focusedWorkspace(orca)
    if (workspace === null) return { pr: null }
    return openPr(workspace, (await readSettings(orca)).ghCommand)
  })

  orca.panels.handle('git.history', async () => {
    const workspace = await focusedWorkspace(orca)
    if (workspace === null) {
      return { head: null, dirty: false, base: null, commits: [], truncated: false, error: 'No local workspace is focused' }
    }
    return readHistory(workspace.path)
  })

  type Place = { workspace: WorkspaceInfo; root: string; settings: Settings }

  async function place(): Promise<Place> {
    const settings = await readSettings(orca)
    const workspace = await focusedWorkspace(orca)
    if (workspace === null) throw codedError('unavailable', 'Focus a local workspace first')
    return { workspace, root: capturesRoot(workspace, settings.capturesDir), settings }
  }

  /** Starts the next background run when none is going; called after each change to the queue. */
  async function advanceQueue(): Promise<void> {
    try {
      const { workspace, root, settings } = await place()
      const started = await startNext(root, workspace.path, settings, {
        scopeFor: async (scope) => {
          const brief = await buildScope(workspace.path, scope)
          const { captures } = await listCaptures(root)
          // A review-only capture holds no diagrams to check, so it is not handed to a capture run.
          const existing = captures
            .filter((capture) => capture.kind !== 'review' && capture.base === brief.capture.base && capture.commit === brief.capture.commit)
            .map((capture) => capture.id)
          return existing.length > 0 ? { ...brief, existing } : brief
        },
        reviewFor: async (captureId) => {
          const { capture, folder } = await locateCapture(orca, captureId)
          const pr = await prFor(workspace, capture, settings.ghCommand)
          const scope = await buildScope(workspace.path, reviewScope(capture))
          // Read before the change, so a change cannot rewrite the rules of its own review.
          const projectRules = await readProjectRules(workspace.path, REVIEW_RULES_FILE, scope.before)
          return {
            ...pr,
            ...(projectRules ? { projectRules } : {}),
            capture: {
              id: capture.id, title: capture.title, summary: capture.summary,
              base: capture.base ?? '', commit: capture.commit ?? '',
              ...(capture.walkthrough ? { walkthrough: capture.walkthrough } : {})
            },
            // locateCapture resolves symlinks, so the workspace must be resolved too.
            captureDir: relative(await realpath(workspace.path), folder).split(sep).join('/'),
            scope
          }
        },
        captureRules: () => readProjectRules(workspace.path, CAPTURE_RULES_FILE, 'HEAD')
      })
      if (started) {
        orca.log(`started background run ${started}`)
        watchRoot(root, workspace.id)
        orca.panels.post('jobs.changed', { workspaceId: workspace.id })
      }
    } catch (error) {
      orca.log(`could not start a background run: ${(error as Error).message}`)
    }
  }

  /**
   * The open pull request a capture's change belongs to, read for a review run: the capture's
   * commit must be on the branch the pull request is open for. Failing to ask GitHub never stops
   * the review; it only says why there is no pull request context.
   */
  async function prFor(workspace: WorkspaceInfo, capture: Capture, ghCommand: string): Promise<{ pr?: PrContextType; prNote?: string }> {
    const commit = (capture.commit ?? '').replace(/\+dirty$/, '')
    const onBranch = commit !== '' && await runGit(workspace.path, ['merge-base', '--is-ancestor', commit, 'HEAD']).then(() => true, () => false)
    if (!onBranch) return {}
    prCache.delete(`${workspace.path}\0${workspace.branch ?? ''}`)
    const { pr, error } = await openPr(workspace, ghCommand)
    if (error) return { prNote: error }
    if (!pr) return {}
    return readPrContext(workspace.path, pr, ghCommand).then(
      (context) => ({ pr: context }),
      (failure: Error) => ({ prNote: `Found pull request #${pr.number} but could not read it: ${failure.message}` })
    )
  }

  /** The change a capture drew, as a scope: its base to its commit, or to the working tree. */
  function reviewScope(capture: Capture): CaptureScope {
    const base = capture.base ?? ''
    const commit = capture.commit ?? ''
    if (!base || !commit) throw codedError('unavailable', 'This capture has no base and commit to review')
    return commit.endsWith('+dirty') ? { from: base, uncommitted: true } : { from: base, to: commit }
  }

  /** Queues a review of the capture's change, or returns the review already queued or running. */
  async function queueReview(captureId: string): Promise<{ jobId: string }> {
    const { workspace, root } = await place()
    const { capture } = await locateCapture(orca, captureId)
    // Checks the range now, so a bad one fails here rather than in the background.
    await buildScope(workspace.path, reviewScope(capture))
    const jobs = await listJobs(root)
    const pending = jobs.find((job) => job.kind === 'review' && job.captureId === captureId && (job.status === 'queued' || job.status === 'running'))
    if (pending) return { jobId: pending.id }
    const jobId = await enqueue(root, {}, `review: ${capture.title}`, { captureId })
    watchRoot(root, workspace.id)
    await advanceQueue()
    orca.panels.post('jobs.changed', { workspaceId: workspace.id })
    return { jobId }
  }

  orca.panels.handle('captures.review', ({ captureId }) => queueReview(captureId))

  /** What a review-only capture is called: the commit's subject when it is one commit. */
  function reviewTitle(scope: CaptureScope, brief: BriefScope, branch: string | null): string {
    if (brief.after !== 'working-tree' && brief.commits.length === 1) return brief.commits[0].subject.slice(0, 120)
    if (scope.uncommitted && scope.from === undefined) return 'Uncommitted changes'
    if (brief.label === 'branch') return `Branch ${branch?.replace(/^refs\/heads\//, '') || 'work'}`
    return `${brief.commits.length} commits, ${brief.label}`
  }

  /**
   * Reviews a commit, a range, the uncommitted changes or the whole branch without drawing it
   * first: the review lands in a review-only capture for that range, made once and reused.
   */
  orca.panels.handle('review.request', async (scope) => {
    const { workspace, root } = await place()
    const brief = await buildScope(workspace.path, scope ?? {})
    if (brief.files.length === 0) throw codedError('invalid_params', 'There are no changed files to review')
    await ensureIgnored(workspace.path, relative(workspace.path, root), (args) => runGit(workspace.path, args))
    const { captures } = await listCaptures(root)
    const same = captures.find((c) => c.kind === 'review' && c.base === brief.capture.base && c.commit === brief.capture.commit)
    if (same) return { ...(await queueReview(same.id)), captureId: same.id }

    const now = new Date()
    const head = brief.capture.commit.slice(0, 7)
    const slug = `${now.toISOString().slice(0, 10)}-review-${brief.after === 'working-tree' ? `${brief.label === 'branch' ? 'branch' : 'uncommitted'}-${head}` : `${brief.before.slice(0, 7)}-${head}`}`
    let captureId = slug
    for (let n = 2; await stat(resolve(root, captureId)).then(() => true, () => false); n++) captureId = `${slug}-${n}`
    const files = brief.files.length
    const capture = {
      version: 1,
      kind: 'review',
      title: reviewTitle(scope ?? {}, brief, workspace.branch),
      summary: `A code review of ${files} changed file${files === 1 ? '' : 's'}, with no diagrams drawn.`,
      createdAt: now.toISOString(),
      base: brief.capture.base,
      commit: brief.capture.commit,
      files: brief.files.map((file) => ({ path: file.path, status: file.status })),
      views: []
    }
    await mkdir(resolve(root, captureId), { recursive: true })
    await writeFile(resolve(root, captureId, 'capture.json'), JSON.stringify(capture, null, 2))
    return { ...(await queueReview(captureId)), captureId }
  })

  orca.panels.handle('review.open', async ({ captureId }) => {
    const { workspace, folder } = await locateCapture(orca, captureId)
    return openInEditor(orca, workspace, await inside(folder, REVIEW_FILE))
  })

  const scopeLabel = (scope: CaptureScope) =>
    scope.uncommitted ? 'uncommitted' : scope.from || scope.to ? null : 'branch'

  async function requestCapture(
    scope: CaptureScope = {}
  ): Promise<{ how: 'queued' | 'sent'; jobId?: string; terminalId?: string; scope: string }> {
    const { workspace, root, settings } = await place()
    // Checks the range now, so a bad one fails here rather than in the background.
    const brief = await buildScope(workspace.path, scope ?? {})
    await ensureIgnored(workspace.path, relative(workspace.path, root), (args) => runGit(workspace.path, args))

    if (settings.captureTarget === 'idle-agent') {
      const { agents } = await orca.host.call('agents.list', {})
      const idle = agents.find(
        (agent) => agent.terminalId !== null && agent.agent === 'claude' && (agent.state === 'waiting' || agent.state === 'done')
      )
      if (idle?.terminalId) {
        await mkdir(jobsDir(root), { recursive: true })
        const path = join(jobsDir(root), `i-${Date.now().toString(36)}.brief.json`)
        const projectRules = await readProjectRules(workspace.path, CAPTURE_RULES_FILE, 'HEAD')
        const content = {
          capturesDir: relative(workspace.path, root), skillDir: skillDir(), lookDir: relative(workspace.path, join(jobsDir(root), 'look')),
          scopes: [brief], rules: [], ...(projectRules ? { projectRules } : {})
        }
        await writeFile(path, JSON.stringify(content, null, 2))
        await orca.host.call('terminal.sendText', {
          terminalId: idle.terminalId,
          text: idlePrompt(relative(workspace.path, path)),
          enter: true
        })
        return { how: 'sent', terminalId: idle.terminalId, scope: brief.label }
      }
    }
    const jobId = await enqueue(root, scope ?? {}, scopeLabel(scope ?? {}) ?? brief.label)
    watchRoot(root, workspace.id)
    await advanceQueue()
    orca.panels.post('jobs.changed', { workspaceId: workspace.id })
    return { how: 'queued', jobId, scope: brief.label }
  }

  orca.panels.handle('captures.request', (scope) => requestCapture(scope))

  orca.panels.handle('jobs.list', async () => {
    const { workspace, root } = await place().catch(() => ({ workspace: null, root: null }))
    if (!workspace || !root) return []
    watchRoot(root, workspace.id)
    // A worker started after a run ended picks up the queue here.
    await advanceQueue()
    await pruneRuns(root)
    return listJobs(root)
  })

  orca.panels.handle('jobs.log', async ({ id }) => ({ lines: await jobLog((await place()).root, id) }))

  orca.panels.handle('jobs.cancel', async ({ id }) => {
    await cancelJob((await place()).root, id)
    return { ok: true as const }
  })

  orca.panels.handle('jobs.dismiss', async ({ id }) => {
    await dismissJob((await place()).root, id)
    return { ok: true as const }
  })

  orca.commands.register('capture', async () => {
    const { how, scope } = await requestCapture({})
    return how === 'sent'
      ? `Asked the idle Claude in this workspace to capture ${scope}.`
      : `Queued a background capture of ${scope}. The Debrief panel shows its progress.`
  })
}

export function deactivate(): void {
  clearTimeout(debounce)
  clearTimeout(jobsTimer)
  jobsTimer = undefined
  watcher?.close()
  watcher = null
  watchedRoot = null
}
