// The panel <-> worker contract, declared once: src/panel.ts and src/worker.ts both read it.
import type { Capture } from './captures.ts'
import type { Cite, CiteRow } from './cite.ts'
import type { ReviewSummary } from './review.ts'
import type { PullRequest } from './pr.ts'

export type WorkspaceInfo = { id: string; name: string; branch: string | null; path: string }

/** A capture as the panel lists it: what capture.json says, plus its review and the size of its
 *  walkthrough when there are those. */
export type ListedCapture = Capture & {
  review?: ReviewSummary
  reviewProblem?: string
  walkthroughSize?: { steps: number; decisions: number }
}

export type CaptureListing = {
  /** The focused workspace, or null when none is focused or it is not on this machine. */
  workspace: WorkspaceInfo | null
  /** Folder the captures are read from, relative to the workspace root. */
  capturesDir: string
  /** Newest first. */
  captures: ListedCapture[]
  /** Capture folders that could not be read, with the reason, so a bad write is visible. */
  problems: { id: string; message: string }[]
}

export type ViewRef = { captureId: string; view: number }

export type CommitInfo = { sha: string; short: string; subject: string; date: string; parent: string | null }

export type History = {
  /** Full sha of HEAD, or null outside a Git repository. */
  head: string | null
  /** Uncommitted or untracked changes in the working tree. */
  dirty: boolean
  /** Where the branch left its trunk; null on the trunk itself. */
  base: CommitInfo | null
  /** The branch's own commits, newest first, following first parents. */
  commits: CommitInfo[]
  truncated: boolean
  error?: string
}

/** What to capture: nothing set means the skill's default scope (the branch plus uncommitted work). */
export type CaptureScope = { from?: string; to?: string; uncommitted?: boolean }

/** What a headless run reported, from its stream-json output. */
export type JobRun = {
  /** The latest tool call or message, for a one-line progress note. */
  activity?: string
  costUsd?: number
  turns?: number
  durationMs?: number
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number }
  error?: string
}

export type Job = JobRun & {
  id: string
  /** A capture run draws diagrams; a review run reviews one capture's code. */
  kind: 'capture' | 'review'
  /** The capture a review run is for. */
  captureId?: string
  status: 'queued' | 'running' | 'done' | 'failed'
  /** One per scope in the run: "abc..def", "uncommitted" or "branch". */
  labels: string[]
  createdAt: string
  startedAt?: string
  finishedAt?: string
}

declare module 'orca' {
  interface PluginRequests {
    'captures.list': { output: CaptureListing }
    /** The view's image as a data: URL. */
    'captures.image': { input: ViewRef; output: { url: string; bytes: number } }
    /** One capture of the focused workspace, read again from disk; the walkthrough editor uses it. */
    'captures.get': { input: { captureId: string }; output: ListedCapture }
    /** The open pull request for the focused workspace's branch, through the gh CLI; cached a minute. */
    'git.pr': { output: { pr: PullRequest | null; error?: string } }
    /** Queues a background code review of the capture's change. */
    'captures.review': { input: { captureId: string }; output: { jobId: string } }
    /** Opens the capture's review file, which Orca shows in the walkthrough editor. */
    'review.open': { input: { captureId: string }; output: { opened: true } }
    /** Opens the capture's walkthrough file, which Orca shows in the walkthrough editor. */
    'walkthrough.open': { input: { captureId: string }; output: { opened: true } }
    /** The rows a walkthrough cites, read from git at the capture's base and commit. */
    'code.cite': {
      input: { captureId: string; cite: Cite }
      output: { rows: CiteRow[]; truncated: boolean; from: string }
    }
    /** An image inside a capture folder, such as a walkthrough figure, as a data: URL. */
    'captures.asset': { input: { captureId: string; path: string }; output: { url: string; bytes: number } }
    /** Opens a file of the focused workspace in an editor tab: a walkthrough's code links. */
    'code.open': { input: { path: string }; output: { opened: true } }
    /** Opens the view's image, or its .d2 source, in an Orca editor tab. */
    'captures.open': { input: ViewRef & { what: 'image' | 'source' }; output: { opened: true } }
    /** The focused workspace's branch history, for the timeline and the range picker. */
    'git.history': { output: History }
    /**
     * Captures the workspace's completed work, or one commit range of it: queued for a headless
     * run, or typed into an idle agent when the setting says so.
     */
    'captures.request': {
      input: CaptureScope
      output: { how: 'queued' | 'sent'; jobId?: string; terminalId?: string; scope: string }
    }
    /** Queued, running and recently finished headless runs, newest first. */
    'jobs.list': { output: Job[] }
    /** A run's steps, one line each. */
    'jobs.log': { input: { id: string }; output: { lines: string[] } }
    'jobs.cancel': { input: { id: string }; output: { ok: true } }
    'jobs.dismiss': { input: { id: string }; output: { ok: true } }
  }
  interface PluginPanelEvents {
    /** A capture was written, changed or removed in the focused workspace. */
    'captures.changed': { workspaceId: string }
    /** A run was queued, started, made progress or finished. */
    'jobs.changed': { workspaceId: string }
  }
}
