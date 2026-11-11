// The sidebar panel: an HTML frame Orca wraps in a generated page. It lists the focused
// workspace's captures and shows one at a time: before and after side by side (or flipped in
// place) for a modification, the flow for an addition. All data comes from src/worker.ts.
import type { Capture, CaptureView } from './captures.ts'
import type { CaptureListing, CaptureScope, CommitInfo, History, Job, ListedCapture } from './protocol.ts'
import type { PullRequest } from './pr.ts'
import { icon, type IconName } from './icons.ts'
import { LEGEND_CSS, LEGEND_KEYS, LEGEND_LABEL, removeLegend, trimToContent, type LegendKey } from './legend.ts'

const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; font: 13px/1.45 system-ui, sans-serif;
  color: var(--orca-foreground); background: var(--orca-background);
}
#app { container-type: inline-size; padding: 10px 12px 24px; }
button {
  font: inherit; color: var(--orca-secondary-foreground); background: var(--orca-secondary);
  border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px);
  padding: 3px 10px; cursor: pointer;
}
button:hover:not(:disabled) { background: var(--orca-accent); color: var(--orca-accent-foreground); }
button:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
button:disabled { opacity: .55; cursor: default; }
button.primary { background: var(--orca-primary); color: var(--orca-primary-foreground); border-color: transparent; }
button.ghost { background: transparent; border-color: transparent; }
button.link { background: none; border: none; padding: 0; color: var(--orca-muted-foreground); text-decoration: underline; }
.bar { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; flex-wrap: wrap; }
.bar .grow { flex: 1; min-width: 0; }
.bar.top { align-items: flex-start; }
.bar.top .badge { margin-top: 3px; }
.title { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: var(--orca-muted-foreground); }
.small { font-size: 11.5px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.status { margin: 0 0 10px; }
.callout {
  border: 1px solid var(--orca-border); border-left: 3px solid var(--orca-destructive);
  border-radius: var(--orca-radius, 6px); padding: 6px 8px; margin-bottom: 10px; background: var(--orca-card);
}
.empty { text-align: center; padding: 28px 8px; color: var(--orca-muted-foreground); }
.empty p { margin: 6px 0 14px; }
.card {
  display: block; width: 100%; text-align: left; margin-bottom: 8px; padding: 9px 10px;
  background: var(--orca-card); color: var(--orca-card-foreground);
  border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px);
}
.card .head { display: flex; gap: 6px; align-items: baseline; }
.card .head .title { flex: 1; font-size: 13px; white-space: normal; }
.title.wrap { white-space: normal; }
.card p { margin: 4px 0 0; }
.badge {
  display: inline-block; font-size: 10.5px; font-weight: 600; letter-spacing: .02em;
  padding: 1px 6px; border-radius: 999px; white-space: nowrap; border: 1px solid currentColor;
}
.badge.modification { color: #d08a1c; }
.badge.addition { color: #2f9e62; }
.badge.review { color: var(--orca-muted-foreground); }
.badge.before { color: var(--orca-muted-foreground); }
.badge.after, .badge.flow { color: var(--orca-foreground); }
.summary { margin: 0 0 10px; }
.seg { display: inline-flex; border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px); overflow: hidden; }
.seg button { border: none; border-radius: 0; background: transparent; }
.seg button[aria-pressed="true"] { background: var(--orca-accent); color: var(--orca-accent-foreground); }
.pair { display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr); }
.pair.side { grid-template-columns: repeat(2, minmax(0, 1fr)); }
figure { margin: 0; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
figcaption { font-size: 12.5px; line-height: 1.45; color: var(--orca-muted-foreground); }
.frame {
  position: relative; flex: 1; display: flex; min-height: 120px;
  border: 1px solid var(--orca-border); border-radius: 10px; background: #f3f1ea; overflow: hidden;
}
.frame .zoom {
  flex: 1; min-width: 0; display: flex; align-items: center; justify-content: center; padding: 40px 14px 14px;
  border: 0; border-radius: 0; background: transparent; cursor: zoom-in;
}
.frame .zoom:hover:not(:disabled) { background: transparent; }
.frame img { display: block; min-width: 0; max-width: 100%; height: auto; }
.frame .msg { padding: 18px 10px; color: #6b675e; font-size: 12px; }
.frame .tag, .frame .frame-actions { position: absolute; top: 8px; }
.frame .tag {
  left: 8px; padding: 2px 8px; border-radius: 6px; font-size: 11.5px; font-weight: 600;
  background: color-mix(in srgb, var(--orca-background) 88%, transparent); color: var(--orca-foreground);
}
.frame .frame-actions { right: 6px; top: 5px; display: flex; gap: 2px; }
.frame .frame-actions .icon-btn { background: color-mix(in srgb, var(--orca-background) 88%, transparent); }
.files { margin-top: 0; border: 1px solid var(--orca-border); border-radius: 10px; overflow: hidden; }
.files summary {
  display: flex; align-items: center; gap: 8px; padding: 10px 12px; cursor: pointer; list-style: none;
  background: var(--orca-card); font-weight: 500;
}
.files summary::-webkit-details-marker { display: none; }
.files summary .icon { color: var(--orca-muted-foreground); transition: transform .12s; }
.files[open] summary .icon { transform: rotate(90deg); }
.files ul { list-style: none; margin: 0; padding: 6px 12px 4px; border-top: 1px solid var(--orca-border); }
.files li { display: flex; gap: 8px; padding: 3px 0; }
.files .mark { width: 12px; flex-shrink: 0; font-weight: 600; color: var(--orca-muted-foreground); }
.files .path { overflow-wrap: anywhere; color: var(--orca-muted-foreground); }
.files-foot { display: flex; flex-wrap: wrap; gap: 4px 8px; margin: 4px 12px 10px; padding-top: 8px; border-top: 1px dashed var(--orca-border); }
.files-foot .mono { overflow-wrap: anywhere; }
.file-added { color: #2f9e62; } .file-deleted { color: var(--orca-destructive); }
.lightbox {
  position: fixed; inset: 0; background: rgba(0,0,0,.72); display: flex; flex-direction: column; z-index: 10;
}
.lightbox .bar { margin: 0; padding: 8px 10px; background: var(--orca-popover); color: var(--orca-popover-foreground); }
.lightbox .stage { flex: 1; overflow: auto; display: flex; padding: 12px; }
.lightbox img { margin: auto; background: #fbfaf6; border-radius: 6px; }
.lightbox.fit img { max-width: 100%; max-height: 100%; object-fit: contain; cursor: zoom-in; }
.lightbox:not(.fit) img { max-width: none; cursor: zoom-out; }
/* Dark diagrams: inverts the light paper and ink, then turns the hues back so yellow, green and
   grey keep their meaning; 0.9 keeps it off pure black and white. */
.dark-diagrams .frame { background: #2a2823; }
.dark-diagrams .frame .msg { color: #b9b4a8; }
.dark-diagrams .frame img, .lightbox.dark-diagrams img { filter: invert(.9) hue-rotate(180deg) saturate(1.4); }
.lightbox.dark-diagrams img { background: #fbfaf6; }
.compare { margin-bottom: 12px; border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px); padding: 6px 10px; }
.compare summary { cursor: pointer; font-weight: 600; }
.compare label { display: block; margin-top: 8px; }
.compare select {
  display: block; width: 100%; margin-top: 3px; font: inherit; padding: 3px 4px;
  color: var(--orca-foreground); background: var(--orca-background);
  border: 1px solid var(--orca-input, var(--orca-border)); border-radius: var(--orca-radius, 6px);
}
.compare .row { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
.compare .hint { flex: 1; }
.compare .hint.bad { color: var(--orca-destructive); }
.timeline { margin: 4px 0 14px 6px; padding-left: 16px; border-left: 2px solid var(--orca-border); }
.tl-row { position: relative; margin-bottom: 14px; }
.tl-row::before {
  content: ''; position: absolute; left: -24px; top: 3px; width: 10px; height: 10px; border-radius: 50%;
  background: var(--orca-background); border: 2px solid var(--orca-muted-foreground);
}
.tl-row.captured::before { background: var(--orca-primary); border-color: var(--orca-primary); }
.tl-row.base::before { border-style: dashed; }
.tl-head { display: flex; gap: 6px; align-items: flex-start; }
.tl-head .grow { flex: 1; min-width: 0; }
.tl-head .row { display: flex; gap: 2px; flex-shrink: 0; }
.tl-subject { font-weight: 500; overflow-wrap: anywhere; }
.tl-row .card { margin: 6px 0 0; }
.chip { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10.5px; padding: 0 5px; border-radius: 4px; background: var(--orca-muted); color: var(--orca-muted-foreground); }
.section { margin: 16px 0 6px; font-weight: 600; }
.pending {
  border: 1px solid var(--orca-border); border-left: 3px solid var(--orca-primary);
  border-radius: var(--orca-radius, 6px); padding: 8px 10px; margin-bottom: 12px; background: var(--orca-card);
}
.pending.failed { border-left-color: var(--orca-destructive); }
.pending p { margin: 0 0 6px; }
.pending .row { display: flex; gap: 6px; flex-wrap: wrap; }
.pending pre {
  margin: 8px 0 0; max-height: 220px; overflow: auto; padding: 6px; font-size: 11px; line-height: 1.35;
  background: var(--orca-background); border: 1px solid var(--orca-border); border-radius: 4px; white-space: pre-wrap;
}
.icon { display: inline-flex; flex-shrink: 0; }
.ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; padding: 0;
  border: 0; background: transparent; color: var(--orca-muted-foreground); cursor: pointer; border-radius: 6px;
}
summary.icon-btn { list-style: none; }
summary.icon-btn::-webkit-details-marker { display: none; }
.topbar { display: flex; align-items: center; gap: 8px; margin: -4px -4px 14px; padding-bottom: 8px; border-bottom: 1px solid var(--orca-border); }
.topbar .grow { flex: 1; }
.topbar button.ghost { display: inline-flex; align-items: center; gap: 4px; color: var(--orca-muted-foreground); font-weight: 500; }
.menu { position: relative; }
.menu-pop {
  position: absolute; right: 0; top: 34px; z-index: 5; width: 220px; padding: 10px; display: flex; flex-direction: column; gap: 8px;
  background: var(--orca-popover); color: var(--orca-popover-foreground);
  border: 1px solid var(--orca-border); border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.35);
}
.menu-pop .seg { display: flex; } .menu-pop .seg button { flex: 1; }
.detail { display: flex; flex-direction: column; gap: 20px; min-width: 0; }
.header { display: flex; flex-direction: column; gap: 8px; }
.eyebrow { display: flex; align-items: center; gap: 6px; font-size: 12px; flex-wrap: wrap; }
.eyebrow .dot { opacity: .5; }
.header h1 { margin: 0; font-size: 19px; line-height: 1.3; font-weight: 600; letter-spacing: -.01em; overflow-wrap: anywhere; }
.header .summary { margin: 0; max-width: 68ch; line-height: 1.55; color: var(--orca-muted-foreground); }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 2px; }
.pill {
  display: inline-flex; align-items: center; gap: 5px; min-height: 24px; padding: 0 9px; border-radius: 999px;
  border: 1px solid var(--orca-border); background: transparent; color: var(--orca-muted-foreground);
  font-size: 11.5px; font-weight: 500; white-space: nowrap;
}
.pill.mono { font-size: 11px; }
button.pill { cursor: pointer; }
.pill.on { background: var(--orca-accent); color: var(--orca-accent-foreground); border-color: transparent; }
.pill.bad { color: var(--orca-destructive); border-color: currentColor; }
.pill.warn { color: var(--orca-foreground); }
.flag-bad { color: var(--orca-destructive); font-weight: 500; }
.ring { width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid var(--orca-primary); }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: pulse 1.4s ease-in-out infinite; }
.cards { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.step-card {
  display: flex; flex-direction: column; gap: 10px; padding: 14px;
  background: var(--orca-card); color: var(--orca-card-foreground);
  border: 1px solid var(--orca-border); border-radius: 10px; min-width: 0;
}
.step-card.alert { border-color: color-mix(in srgb, var(--orca-destructive) 55%, var(--orca-border)); }
.step-card p { margin: 0; line-height: 1.5; color: var(--orca-muted-foreground); }
.card-head { display: flex; align-items: center; gap: 8px; }
.card-head > .icon { color: var(--orca-primary); }
.card-head .grow { flex: 1; min-width: 0; }
.card-title { font-weight: 600; font-size: 13.5px; }
.grow-y { flex: 1; }
.card-body { min-width: 0; }
.card-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.card-actions .grow { flex: 1; }
.step-card button, .wide { min-height: 32px; font-weight: 500; }
button.wide { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; font-weight: 600; }
.step-card .callout { margin: 0; }
.log {
  margin: 0; max-height: 220px; overflow: auto; padding: 6px; font-size: 11px; line-height: 1.35; white-space: pre-wrap;
  background: var(--orca-background); border: 1px solid var(--orca-border); border-radius: 4px;
}
.diagrams { display: flex; flex-direction: column; gap: 12px; }
.section-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.section-head h2 { margin: 0; flex: 1; font-size: 14px; font-weight: 600; }
.seg button { padding: 3px 10px; }
kbd {
  display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px;
  border: 1px solid var(--orca-border); border-bottom-width: 2px; border-radius: 5px;
  font: 10.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--orca-muted-foreground);
}
.legend-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 16px; font-size: 12px; }
.basis { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; }
@keyframes pulse { 50% { opacity: .35; } }
.pending .live { animation: pulse 1.4s ease-in-out infinite; }
`

type Mode = 'side' | 'flip'
type ListView = 'timeline' | 'list'
type DiagramTheme = 'auto' | 'light' | 'dark'
const DIAGRAM_THEMES: readonly DiagramTheme[] = ['auto', 'light', 'dark']
type HostError = Error & { code?: string }

const state = {
  listing: null as CaptureListing | null,
  history: null as History | null,
  pr: null as PullRequest | null,
  view: 'timeline' as ListView,
  rangeFrom: '',
  rangeTo: '',
  compareOpen: false,
  jobs: [] as Job[],
  logs: {} as Record<string, string[] | string>,
  error: null as string | null,
  status: null as string | null,
  selected: null as string | null,
  mode: 'side' as Mode,
  flipped: false,
  busy: false,
  diagramTheme: 'auto' as DiagramTheme,
  narrow: false,
  menuOpen: false,
  filesOpen: false,
  reviewError: null as { captureId: string; message: string } | null
}
const images = new Map<string, Promise<Prepared>>()
const app = document.createElement('div')
app.id = 'app'

type Child = Node | string | null | undefined | false
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
  for (const child of children) if (child) node.append(child)
  return node
}
function button(label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const node = el('button', { type: 'button', ...attrs }, label)
  node.addEventListener('click', onClick)
  return node
}

function ibutton(children: Child[], onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const node = el('button', { type: 'button', ...attrs }, ...children)
  node.addEventListener('click', onClick)
  return node
}
function iconButton(name: IconName, label: string, onClick: () => void): HTMLButtonElement {
  return ibutton([icon(name, 15)], onClick, { class: 'icon-btn', 'aria-label': label, title: label })
}

function darkDiagrams(): boolean {
  if (state.diagramTheme === 'auto') return document.documentElement.classList.contains('dark')
  return state.diagramTheme === 'dark'
}

async function loadDiagramTheme(): Promise<void> {
  try {
    const value = await orca.settings.get('diagramTheme')
    state.diagramTheme = DIAGRAM_THEMES.includes(value as DiagramTheme) ? (value as DiagramTheme) : 'auto'
  } catch {
    state.diagramTheme = 'auto'
  }
  render()
}

function setDiagramTheme(theme: DiagramTheme): void {
  state.diagramTheme = theme
  render()
  orca.settings.set('diagramTheme', theme).catch((error) => {
    state.status = `Could not save the diagram colours: ${describe(error)}`
    render()
  })
}

function themePicker(): HTMLElement {
  const label = { auto: 'Auto', light: 'Light', dark: 'Dark' } as const
  return el(
    'div',
    { class: 'seg', role: 'group', 'aria-label': 'Diagram colours', title: 'Diagram colours. Auto follows Orca.' },
    ...DIAGRAM_THEMES.map((theme) =>
      button(label[theme], () => setDiagramTheme(theme), { 'aria-pressed': String(state.diagramTheme === theme) })
    )
  )
}

const describe = (error: unknown) => {
  const { code, message } = error as HostError
  return code ? `${message} (${code})` : String(message ?? error)
}
const KIND_LABEL = { modification: 'Changed behaviour', addition: 'New flow', review: 'Review only' } as const
const KIND_TEXT = { modification: 'Changed behaviour · before and after', addition: 'New code · flow', review: 'Code review · no diagrams' } as const
const KIND_ICON = { modification: 'split', addition: 'flow', review: 'shield' } as const

function ago(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000
  const format = new Intl.RelativeTimeFormat(orca.locale, { numeric: 'auto' })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity]
  ]
  let value = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return format.format(Math.round(value), unit)
    value /= size
  }
  return iso
}

async function loadPr(): Promise<void> {
  // gh missing, signed out or offline: the panel just shows no pull request.
  state.pr = await orca.plugin.request('git.pr').then((answer) => answer.pr, () => null)
}

async function loadHistory(): Promise<void> {
  void loadPr().then(render)
  try {
    const history = await orca.plugin.request('git.history')
    state.history = history
    const known = new Set([...history.commits.map((c) => c.sha), history.base?.sha])
    if (!known.has(state.rangeTo)) state.rangeTo = history.commits[0]?.sha ?? ''
    if (!known.has(state.rangeFrom)) {
      state.rangeFrom = history.base?.sha ?? history.commits[history.commits.length - 1]?.sha ?? ''
    }
  } catch (error) {
    state.history = { head: null, dirty: false, base: null, commits: [], truncated: false, error: describe(error) }
  }
}

async function load(): Promise<void> {
  try {
    const [listing] = await Promise.all([orca.plugin.request('captures.list'), loadHistory(), loadJobs()])
    state.listing = listing
    state.error = null
    if (state.selected && !listing.captures.some((capture) => capture.id === state.selected)) {
      state.selected = null
    }
  } catch (error) {
    state.error = describe(error)
  }
  render()
}

function reload(): void {
  images.clear()
  void load()
}

let jobPoll: ReturnType<typeof setTimeout> | undefined

/** Reads the runs; while one is queued or running, reads again every few seconds as a fallback
 *  for when the worker (and its folder watch) has been stopped by Orca. */
async function loadJobs(): Promise<void> {
  try {
    state.jobs = await orca.plugin.request('jobs.list')
  } catch (error) {
    state.status = `Could not read background runs: ${describe(error)}`
  }
  clearTimeout(jobPoll)
  if (state.jobs.some((job) => job.status === 'queued' || job.status === 'running')) {
    jobPoll = setTimeout(() => void loadJobs().then(render), 5000)
  }
}

async function requestCapture(scope: CaptureScope = {}): Promise<void> {
  state.busy = true
  state.status = null
  render()
  try {
    const answer = await orca.plugin.request('captures.request', scope)
    if (answer.how === 'sent') {
      state.status = `Asked the idle Claude in this workspace to capture ${answer.scope}. New captures appear here when it finishes.`
    }
    await loadJobs()
  } catch (error) {
    state.status = `Could not capture: ${describe(error)}`
  }
  state.busy = false
  render()
}

/** Reviews a scope without drawing it: the worker makes a review-only capture for it. */
async function requestScopeReview(scope: CaptureScope = {}): Promise<void> {
  state.busy = true
  state.status = null
  render()
  try {
    await orca.plugin.request('review.request', scope)
    state.status = 'Review queued. It shows as a review-only capture, and opens from there when it is done.'
    await loadJobs()
  } catch (error) {
    state.status = `Could not start the review: ${describe(error)}`
  }
  state.busy = false
  render()
}

async function toggleLog(id: string): Promise<void> {
  if (state.logs[id]) {
    delete state.logs[id]
    render()
    return
  }
  try {
    const { lines } = await orca.plugin.request('jobs.log', { id })
    state.logs[id] = lines.length > 0 ? lines : 'Nothing logged yet.'
  } catch (error) {
    state.logs[id] = `Could not read it: ${describe(error)}`
  }
  render()
}

function jobAction(name: 'jobs.cancel' | 'jobs.dismiss', id: string): void {
  orca.plugin.request(name, { id }).then(loadJobs, (error) => { state.status = describe(error) }).then(render)
}

const thousands = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

function jobCard(job: Job): HTMLElement {
  const what = job.kind === 'review' ? job.labels.map((label) => label.replace(/^review: /, '')).join(', ') : job.labels.join(', ')
  const headline = (job.kind === 'review'
    ? {
        queued: `Waiting to review ${what}: one background run at a time.`,
        running: `Reviewing ${what} in the background.`,
        done: `Reviewed ${what}.`,
        failed: `Reviewing ${what} failed: ${job.error ?? 'unknown error'}`
      }
    : {
        queued: `Waiting to capture ${what}: one background run at a time.`,
        running: `Capturing ${what} in the background.`,
        done: `Captured ${what}.`,
        failed: `Capturing ${what} failed: ${job.error ?? 'unknown error'}`
      })[job.status]
  const tokens = job.tokens
  const usage = job.status === 'done' || job.status === 'failed'
    ? [
        job.costUsd !== undefined && `$${job.costUsd.toFixed(2)}`,
        tokens && `${thousands(tokens.input + tokens.cacheRead + tokens.cacheWrite)} in (${thousands(tokens.cacheRead)} cached) / ${thousands(tokens.output)} out`,
        job.turns !== undefined && `${job.turns} turns`,
        job.durationMs !== undefined && `${Math.round(job.durationMs / 1000)} s`
      ].filter(Boolean).join(' · ')
    : ''
  const log = state.logs[job.id]
  return el(
    'div',
    { class: `pending small${job.status === 'failed' ? ' failed' : ''}`, role: 'status' },
    el('p', { class: job.status === 'running' || job.status === 'queued' ? 'live' : '' }, headline),
    job.status === 'running' && job.activity && el('p', { class: 'muted mono' }, job.activity),
    usage && el('p', { class: 'muted' }, usage),
    el('p', { class: 'muted' }, `Asked ${ago(job.createdAt)}.`),
    el(
      'div',
      { class: 'row' },
      job.status !== 'queued' && button(log ? 'Hide log' : 'Log', () => void toggleLog(job.id), { class: 'ghost small' }),
      (job.status === 'queued' || job.status === 'running') && button('Cancel', () => jobAction('jobs.cancel', job.id), { class: 'ghost small' }),
      (job.status === 'done' || job.status === 'failed') && button('Dismiss', () => jobAction('jobs.dismiss', job.id), { class: 'ghost small' })
    ),
    log && el('pre', { class: 'mono' }, Array.isArray(log) ? log.join('\n') : log)
  )
}

/** A diagram ready to show: its src, and the legend rows its own legend had. */
type Prepared = { src: string; keys: LegendKey[] }

function imageFor(captureId: string, view: number): Promise<Prepared> {
  const key = `${captureId}:${view}`
  let pending = images.get(key)
  if (!pending) {
    pending = orca.plugin.request('captures.image', { captureId, view }).then((answer) => withoutLegend(answer.url))
    pending.catch(() => images.delete(key))
    images.set(key, pending)
  }
  return pending
}

/**
 * Takes the legend out of a D2 diagram, since the panel draws one legend for every diagram, and
 * trims the space it held. Returns which legend rows the diagram had. Anything that is not a D2
 * SVG, or that cannot be measured, comes back as it was.
 */
async function withoutLegend(url: string): Promise<Prepared> {
  const match = /^data:image\/svg\+xml;base64,(.*)$/.exec(url)
  if (!match) return { src: url, keys: [] }
  const bytes = Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0))
  const doc = new DOMParser().parseFromString(new TextDecoder().decode(bytes), 'image/svg+xml')
  if (!(doc.documentElement instanceof SVGSVGElement)) return { src: url, keys: [] }
  const keys = removeLegend(doc)
  if (keys.length === 0) return { src: url, keys }

  // getBBox only measures a drawn element, so the SVG goes into the page, out of sight, for a moment.
  const svg = document.importNode(doc.documentElement, true)
  const host = el('div', { style: 'position:absolute;left:-100000px;top:0;visibility:hidden', 'aria-hidden': 'true' })
  host.append(svg)
  document.body.append(host)
  try {
    await document.fonts.ready
    if (!trimToContent(svg)) return { src: url, keys: [] }
    const text = new XMLSerializer().serializeToString(svg)
    return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, keys }
  } catch {
    return { src: url, keys: [] }
  } finally {
    host.remove()
  }
}

function open(captureId: string, view: number, what: 'image' | 'source'): void {
  orca.plugin.request('captures.open', { captureId, view, what }).catch((error) => {
    state.status = `Could not open it: ${describe(error)}`
    render()
  })
}

/** "1 high · 1 medium", or "No findings". */
function findingsLabel(review: NonNullable<ListedCapture['review']>): string {
  if (review.findings === 0) return 'No findings'
  return (['high', 'medium', 'low'] as const).filter((s) => review[s] > 0).map((s) => `${review[s]} ${s}`).join(' · ')
}

/** The review run for this capture that is queued or running, if any. */
const reviewJob = (captureId: string) =>
  state.jobs.find((job) => job.kind === 'review' && job.captureId === captureId && (job.status === 'queued' || job.status === 'running'))

/** The newest failed review run for this capture, unless a review was written after it. */
function failedReview(capture: ListedCapture): Job | undefined {
  const failed = state.jobs
    .filter((job) => job.kind === 'review' && job.captureId === capture.id && job.status === 'failed')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
  if (!failed) return undefined
  if (capture.review && Date.parse(capture.review.createdAt) > Date.parse(failed.createdAt)) return undefined
  return failed
}

/** The capture's commit is on this branch, so the branch's pull request covers it. */
function onBranch(capture: ListedCapture): boolean {
  const history = state.history
  if (!history?.head) return false
  const commit = commitOf(capture)
  return (isDirty(capture) && sameCommit(history.head, commit)) || history.commits.some((c) => sameCommit(c.sha, commit))
}

async function requestReview(captureId: string): Promise<void> {
  state.busy = true
  state.reviewError = null
  render()
  try {
    await orca.plugin.request('captures.review', { captureId })
    await loadJobs()
  } catch (error) {
    state.reviewError = { captureId, message: `Could not start the review: ${describe(error)}` }
  } finally {
    state.busy = false
    render()
  }
}

function openReview(captureId: string): void {
  orca.plugin.request('review.open', { captureId }).catch((error) => {
    state.status = `Could not open the review: ${describe(error)}`
    render()
  })
}

function openWalkthrough(captureId: string): void {
  orca.plugin.request('walkthrough.open', { captureId }).catch((error) => {
    state.status = `Could not open the walkthrough: ${describe(error)}`
    render()
  })
}

function lightbox(src: string, title: string): void {
  const image = el('img', { src, alt: title })
  const box = el(
    'div',
    { class: `lightbox fit${darkDiagrams() ? ' dark-diagrams' : ''}`, role: 'dialog', 'aria-label': title },
    el('div', { class: 'bar' }, el('span', { class: 'grow title' }, title), button('Close', () => close())),
    el('div', { class: 'stage' }, image)
  )
  const close = () => {
    box.remove()
    document.removeEventListener('keydown', onKey)
  }
  const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close()
  image.addEventListener('click', () => box.classList.toggle('fit'))
  document.addEventListener('keydown', onKey)
  document.body.append(box)
}

/** Below this width the before and after diagrams show one at a time. */
const NARROW = 560
const flipping = () => state.narrow || state.mode === 'flip'

function moreMenu(): HTMLElement {
  const menu = el(
    'details',
    { class: 'menu' },
    el('summary', { class: 'icon-btn', 'aria-label': 'More options', title: 'More options' }, icon('more', 18)),
    el('div', { class: 'menu-pop' }, el('div', { class: 'muted small' }, 'Diagram colours'), themePicker())
  )
  menu.open = state.menuOpen
  menu.addEventListener('toggle', () => { state.menuOpen = menu.open })
  return menu
}

function topBar(listing: CaptureListing): HTMLElement {
  return el(
    'div',
    { class: 'topbar' },
    ibutton([icon('back', 16), 'Captures'], () => { state.selected = null; state.menuOpen = false; render() }, { class: 'ghost' }),
    el('span', { class: 'grow mono muted ellipsis', title: listing.workspace?.path ?? '' }, listing.workspace?.branch ?? ''),
    moreMenu()
  )
}

function fileCounts(capture: Capture): string {
  const counts = new Map<string, number>()
  for (const file of capture.files) counts.set(file.status, (counts.get(file.status) ?? 0) + 1)
  return [...counts].map(([status, n]) => `${n} ${status}`).join(' · ')
}

function header(capture: ListedCapture, pr: PullRequest | null): HTMLElement {
  const commit = commitOf(capture).slice(0, 7)
  const base = (capture.base ?? '').slice(0, 7)
  const files = capture.files.length
  return el(
    'div',
    { class: 'header' },
    el('div', { class: 'eyebrow muted' },
      icon(KIND_ICON[capture.kind], 14),
      el('span', {}, KIND_TEXT[capture.kind]),
      el('span', { class: 'dot' }, '•'),
      el('span', {}, `${capture.kind === 'review' ? 'Made' : 'Drawn'} ${ago(capture.createdAt)}`)),
    el('h1', {}, capture.title),
    el('p', { class: 'summary' }, capture.summary),
    el('div', { class: 'chips' },
      commit && el('span', {
        class: 'pill mono',
        title: base ? `Before is drawn from ${capture.base}, after from ${capture.commit}` : `Drawn at ${capture.commit}`
      }, icon('commit', 13), base ? `${base} → ${commit}` : commit, isDirty(capture) && ' + uncommitted'),
      pr && el('span', { class: 'pill', title: `${pr.title}\n${pr.url}` },
        icon('pr', 13), `PR #${pr.number}${pr.isDraft ? ' · draft' : ''}`),
      files > 0 && ibutton([`${files} file${files === 1 ? '' : 's'} · ${fileCounts(capture)}`], () => {
        state.filesOpen = true
        render()
        document.getElementById('files')?.scrollIntoView({ block: 'nearest' })
      }, { class: 'pill' }))
  )
}

/** The range a capture was drawn from, as a scope to capture it again. */
function scopeOf(capture: Capture): CaptureScope | null {
  const base = capture.base ?? ''
  const commit = capture.commit ?? ''
  if (!base || !commit) return null
  return isDirty(capture) ? { from: base, uncommitted: true } : { from: base, to: commit }
}

/** Shown in place of the walkthrough when the skill owed this capture one and skipped it. */
function missingWalkthroughCard(capture: ListedCapture, boxes: number): HTMLElement {
  const scope = scopeOf(capture)
  return el(
    'div',
    { class: 'step-card alert' },
    el('div', { class: 'card-head' }, icon('walk', 16), el('span', { class: 'grow card-title' }, 'Walkthrough'),
      el('span', { class: 'pill bad' }, 'Missing')),
    el('p', { class: 'grow-y' },
      `The diagrams mark ${boxes} boxes changed or added, so this capture should have a walkthrough, and the run that drew it skipped it. Capturing the range again writes one.`),
    scope && ibutton(['Capture again'], () => void requestCapture(scope), {
      class: 'wide', title: BILLED, ...disabledWhileBusy()
    })
  )
}

function walkthroughCard(capture: ListedCapture): HTMLElement | false {
  if (capture.walkthroughMissing) return missingWalkthroughCard(capture, capture.walkthroughMissing.boxes)
  if (!capture.walkthrough) return false
  const size = capture.walkthroughSize
  return el(
    'div',
    { class: 'step-card' },
    el('div', { class: 'card-head' }, icon('walk', 16), el('span', { class: 'grow card-title' }, 'Walkthrough')),
    el('p', { class: 'grow-y' }, 'The change step by step in the order the code runs, with the cited code, plus the design decisions.'),
    size && el('div', { class: 'muted small' },
      `${size.steps} step${size.steps === 1 ? '' : 's'} · ${size.decisions} design decision${size.decisions === 1 ? '' : 's'}`),
    ibutton(['Open walkthrough', icon('arrow', 14)], () => openWalkthrough(capture.id), {
      class: 'primary wide', title: 'Opens in an editor tab'
    })
  )
}

const BILLED = 'Starts a background Claude run. Billed to your Claude login, capped by the cost setting.'
const REVIEW_ONLY = `Review this range without drawing it. ${BILLED}`

function reviewCard(capture: ListedCapture, pr: PullRequest | null): HTMLElement {
  const job = reviewJob(capture.id)
  const failed = job ? undefined : failedReview(capture)
  const review = capture.review
  const log = job ? state.logs[job.id] : failed ? state.logs[failed.id] : undefined
  const busy: Record<string, string> = state.busy ? { disabled: '' } : {}
  const lead = (findings: boolean) => (capture.walkthrough && !findings ? '' : 'primary')

  let pill: HTMLElement
  let body: Child[]
  let meta: string
  let actions: Child[]
  if (job?.status === 'queued') {
    pill = el('span', { class: 'pill' }, el('span', { class: 'ring' }), 'Queued')
    body = [el('p', {}, 'Starts after the current background run. One run at a time.')]
    meta = `Asked ${ago(job.createdAt)}`
    actions = [
      review && button('Open last review', () => openReview(capture.id), { class: 'grow' }),
      button('Cancel', () => jobAction('jobs.cancel', job.id), { class: 'ghost' })
    ]
  } else if (job) {
    pill = el('span', { class: 'pill on' }, el('span', { class: 'live-dot' }), 'Reviewing')
    body = [el('div', { class: 'mono muted ellipsis' }, job.activity ?? 'Starting')]
    meta = `Started ${ago(job.startedAt ?? job.createdAt)}`
    actions = [
      button(log ? 'Hide log' : 'Log', () => void toggleLog(job.id), { class: 'ghost' }),
      button('Cancel', () => jobAction('jobs.cancel', job.id), { class: 'ghost' })
    ]
  } else if (failed) {
    pill = el('span', { class: 'pill bad' }, 'Failed')
    body = [el('p', {}, `${failed.error ?? 'The run stopped before it finished.'}${review ? ' The last review is still available.' : ''}`)]
    meta = ago(failed.finishedAt ?? failed.createdAt)
    actions = [
      button(log ? 'Hide log' : 'Log', () => void toggleLog(failed.id), { class: 'ghost' }),
      button('Dismiss', () => jobAction('jobs.dismiss', failed.id), { class: 'ghost' }),
      button('Try again', () => void requestReview(capture.id), { title: BILLED, ...busy })
    ]
  } else if (review) {
    const found = review.findings > 0
    pill = found
      ? el('span', { class: `pill ${review.high > 0 ? 'bad' : 'warn'}` }, findingsLabel(review))
      : el('span', { class: 'pill on' }, icon('check', 12), 'No findings')
    body = [el('p', {}, review.summary)]
    meta = [`Reviewed ${ago(review.createdAt)}`, review.pr !== undefined && `read PR #${review.pr}`].filter(Boolean).join(' · ')
    actions = [
      button('Open review', () => openReview(capture.id), { class: `grow ${lead(found)}`, title: 'Opens in an editor tab' }),
      button('Run again', () => void requestReview(capture.id), { class: 'ghost', title: BILLED, ...busy })
    ]
  } else {
    pill = el('span', { class: 'pill' }, 'Not run')
    body = [el('p', {}, `A background Claude run checks this change for bugs: logic, async, state, error handling and broken callers.${pr ? ` It also reads PR #${pr.number}.` : ''}`)]
    meta = 'Billed to your Claude login'
    actions = [button('Review code', () => void requestReview(capture.id), { class: `grow ${lead(false)}`, title: BILLED, ...busy })]
  }

  const error = state.reviewError?.captureId === capture.id ? state.reviewError.message : null
  return el(
    'div',
    { class: `step-card${failed || (review && review.high > 0 && !job) ? ' alert' : ''}` },
    el('div', { class: 'card-head' }, icon('shield', 16), el('span', { class: 'grow card-title' }, 'Code review'), pill),
    el('div', { class: 'grow-y card-body' }, ...body),
    capture.reviewProblem && el('div', { class: 'callout small' }, `The review file is not valid: ${capture.reviewProblem}`),
    error && el('div', { class: 'callout small' }, error),
    el('div', { class: 'muted small' }, meta),
    el('div', { class: 'card-actions' }, ...actions),
    log && el('pre', { class: 'mono log' }, Array.isArray(log) ? log.join('\n') : log)
  )
}

function segmented(label: string, options: [string, boolean, () => void][]): HTMLElement {
  return el('div', { class: 'seg', role: 'group', 'aria-label': label },
    ...options.map(([text, pressed, onClick]) => button(text, onClick, { 'aria-pressed': String(pressed) })))
}

function figure(capture: Capture, index: number, legend: (keys: LegendKey[]) => void): HTMLElement {
  const view = capture.views[index]
  const zoom = el('button', { type: 'button', class: 'zoom', 'aria-label': `Enlarge ${view.title}` },
    el('div', { class: 'msg' }, 'Loading diagram...'))
  imageFor(capture.id, index).then(
    ({ src, keys }) => {
      zoom.replaceChildren(el('img', { src, alt: view.caption ?? view.title }))
      zoom.addEventListener('click', () => lightbox(src, `${capture.title} - ${view.title}`))
      legend(keys)
    },
    (error) => zoom.replaceChildren(el('div', { class: 'msg' }, describe(error)))
  )
  return el(
    'figure',
    {},
    el('div', { class: 'frame' },
      zoom,
      el('span', { class: 'tag' }, view.title),
      el('div', { class: 'frame-actions' },
        iconButton('external', `Open the ${view.title.toLowerCase()} image in a tab`, () => open(capture.id, index, 'image')),
        view.source && iconButton('code', `Open the ${view.title.toLowerCase()} D2 source`, () => open(capture.id, index, 'source')))),
    view.caption && el('figcaption', {}, view.caption)
  )
}

function diagrams(capture: Capture): HTMLElement {
  const indexes = (role: CaptureView['role']) =>
    capture.views.flatMap((view, index) => (view.role === role ? [index] : []))
  const before = indexes('before')
  const after = indexes('after')
  const rest = capture.views.flatMap((view, index) =>
    view.role === 'flow' || (view.role === 'before' && before.indexOf(index) >= after.length) ||
    (view.role === 'after' && after.indexOf(index) >= before.length) ? [index] : []
  )
  const pairs = before.slice(0, after.length).map((b, i) => [b, after[i]] as const)

  const legendRow = el('div', { class: 'legend' })
  const seen = new Set<LegendKey>()
  const legend = (keys: LegendKey[]) => {
    for (const key of keys) seen.add(key)
    legendRow.replaceChildren(...LEGEND_KEYS.filter((key) => seen.has(key)).map((key) =>
      el('span', { class: 'key' }, el('span', { class: `sw ${key}` }), LEGEND_LABEL[key])))
  }

  const flip = flipping()
  const controls: Child[] = []
  if (pairs.length > 0) {
    if (flip) {
      controls.push(
        segmented('Show', [
          ['Before', !state.flipped, () => { state.flipped = false; render() }],
          ['After', state.flipped, () => { state.flipped = true; render() }]
        ]),
        el('kbd', { title: 'Press F to switch' }, 'F')
      )
    }
    if (!state.narrow) {
      controls.push(segmented('Compare', [
        ['Side by side', state.mode === 'side', () => { state.mode = 'side'; render() }],
        ['Flip', state.mode === 'flip', () => { state.mode = 'flip'; render() }]
      ]))
    }
  }

  const figures: HTMLElement[] = []
  for (const [b, a] of pairs) {
    figures.push(flip
      ? el('div', { class: 'pair' }, figure(capture, state.flipped ? a : b, legend))
      : el('div', { class: 'pair side' }, figure(capture, b, legend), figure(capture, a, legend)))
  }
  for (const index of rest) figures.push(figure(capture, index, legend))

  return el(
    'section',
    { class: 'diagrams', 'aria-label': 'Diagrams' },
    el('div', { class: 'section-head' }, el('h2', { class: 'grow' }, 'Diagrams'), ...controls),
    el('div', { class: 'legend-row' },
      legendRow,
      capture.basis && el('span', { class: 'basis muted' }, icon('info', 13), `From ${capture.basis}`)),
    ...figures
  )
}

function filesBox(listing: CaptureListing, capture: ListedCapture): HTMLElement | false {
  const files = capture.files.length
  if (files === 0) return false
  const box = el(
    'details',
    { class: 'files', id: 'files' },
    el('summary', {},
      icon('chevron', 14),
      el('span', { class: 'grow' }, `${files} file${files === 1 ? '' : 's'} changed`),
      el('span', { class: 'muted small' }, fileCounts(capture))),
    el('ul', {}, ...capture.files.map((file) =>
      el('li', { class: 'mono', title: file.status },
        el('span', { class: `mark file-${file.status}` }, file.status[0].toUpperCase()),
        el('span', { class: 'path' }, file.path)))),
    el('div', { class: 'files-foot muted small' },
      capture.base && el('span', {}, `Before = ${capture.base.slice(0, 9)} · after = ${(capture.commit ?? '').slice(0, 9)}`),
      el('span', { class: 'grow' }),
      el('span', { class: 'mono' }, `${listing.capturesDir}/${capture.id}`))
  )
  box.open = state.filesOpen
  box.addEventListener('toggle', () => { state.filesOpen = box.open })
  return box
}

function detail(listing: CaptureListing, capture: ListedCapture): HTMLElement[] {
  const pr = onBranch(capture) ? state.pr : null
  return [
    topBar(listing),
    el('div', { class: 'detail' },
      header(capture, pr),
      state.status && el('p', { class: 'status muted small' }, state.status),
      el('div', { class: 'cards' }, walkthroughCard(capture), reviewCard(capture, pr)),
      capture.views.length > 0 && diagrams(capture),
      filesBox(listing, capture))
  ]
}

function captureCard(capture: ListedCapture, extra?: HTMLElement | false): HTMLElement {
  const views = capture.views.length
  const card = el(
    'button',
    { type: 'button', class: 'card' },
    el(
      'div',
      { class: 'head' },
      el('span', { class: 'title' }, capture.title),
      el('span', { class: `badge ${capture.kind}` }, KIND_LABEL[capture.kind])
    ),
    el('p', { class: 'small' }, capture.summary),
    el('p', { class: 'muted small' },
      `${ago(capture.createdAt)} · ${capture.kind === 'review' ? 'no diagrams' : `${views} diagram${views === 1 ? '' : 's'}`} · ${capture.files.length} file${capture.files.length === 1 ? '' : 's'}${capture.walkthrough ? ' · walkthrough' : ''}${capture.review ? ` · review: ${findingsLabel(capture.review).toLowerCase()}` : ''}`,
      capture.walkthroughMissing && ' · ',
      capture.walkthroughMissing && el('span', {
        class: 'flag-bad',
        title: `The diagrams mark ${capture.walkthroughMissing.boxes} boxes changed or added, so the skill owed this capture a walkthrough`
      }, 'walkthrough missing')),
    extra
  )
  card.addEventListener('click', () => {
    state.selected = capture.id
    state.flipped = false
    state.filesOpen = false
    state.menuOpen = false
    render()
  })
  return card
}

const disabledWhileBusy = (): Record<string, string> => (state.busy ? { disabled: '' } : {})
const commitOf = (capture: Capture) => (capture.commit ?? '').toLowerCase().replace(/\+.*$/, '')
const isDirty = (capture: Capture) => /\+dirty$/i.test(capture.commit ?? '')
const sameCommit = (sha: string, short: string) => short.length >= 7 && sha.startsWith(short)

/** "abc1234..def5678" when a capture spans more than its own commit. */
function rangeChip(capture: Capture, commit: CommitInfo | null): HTMLElement | false {
  const base = (capture.base ?? '').toLowerCase()
  if (!base || (commit?.parent && sameCommit(commit.parent, base))) return false
  return el('span', { class: 'chip', title: 'Before is drawn from the first commit, after from the second' },
    `${base.slice(0, 7)}..${commitOf(capture).slice(0, 7)}`)
}

function compareForm(history: History): HTMLElement {
  const options = [...history.commits, ...(history.base ? [history.base] : [])]
  const position = (sha: string) => options.findIndex((c) => c.sha === sha)
  const select = (label: string, value: string, onChange: (sha: string) => void) => {
    const node = el('select', { 'aria-label': label },
      ...options.map((commit, index) => {
        const tag = index === options.length - 1 && history.base ? ' (branch base)' : ''
        const option = el('option', { value: commit.sha }, `${commit.short} · ${commit.subject}${tag}`)
        option.selected = commit.sha === value
        return option
      }))
    node.addEventListener('change', () => { onChange(node.value); render() })
    return el('label', { class: 'small' }, label, node)
  }
  const from = position(state.rangeFrom)
  const to = position(state.rangeTo)
  // Newest first, so an older commit has a larger index.
  const valid = from > to && to >= 0
  const span = from - to
  const form = el(
    'details',
    { class: 'compare' },
    el('summary', { class: 'small' }, 'Capture between two commits'),
    select('From (before)', state.rangeFrom, (sha) => { state.rangeFrom = sha }),
    select('To (after)', state.rangeTo, (sha) => { state.rangeTo = sha }),
    el(
      'div',
      { class: 'row' },
      el('span', { class: `hint small ${valid ? 'muted' : 'bad'}` },
        valid ? `${span} commit${span === 1 ? '' : 's'}: before from the first, after from the second` : 'From must be older than To'),
      button('Review range', () => void requestScopeReview({ from: state.rangeFrom, to: state.rangeTo }),
        { class: 'ghost', title: REVIEW_ONLY, ...(valid ? {} : { disabled: '' }), ...disabledWhileBusy() }),
      button('Capture range', () => void requestCapture({ from: state.rangeFrom, to: state.rangeTo }),
        { class: 'primary', ...(valid ? {} : { disabled: '' }), ...disabledWhileBusy() })
    )
  )
  form.open = state.compareOpen
  form.addEventListener('toggle', () => { state.compareOpen = form.open })
  return form
}

function timeline(listing: CaptureListing, history: History): HTMLElement[] {
  const placed = new Set<string>()
  const take = (match: (capture: Capture) => boolean) =>
    listing.captures.filter((capture) => !placed.has(capture.id) && match(capture)).map((capture) => {
      placed.add(capture.id)
      return capture
    })
  const row = (
    classes: string, subject: string, meta: string, captures: Capture[], commit: CommitInfo | null,
    action: HTMLElement | false
  ) =>
    el(
      'div',
      { class: `tl-row ${classes}${captures.length > 0 ? ' captured' : ''}` },
      el('div', { class: 'tl-head' },
        el('div', { class: 'grow' }, el('div', { class: 'tl-subject' }, subject), el('div', { class: 'muted small mono' }, meta)),
        action),
      ...captures.map((capture) => captureCard(capture, rangeChip(capture, commit)))
    )
  const captureButton = (scope: CaptureScope, what: string) =>
    el('div', { class: 'row' },
      button('Review', () => void requestScopeReview(scope), { class: 'ghost small', title: `Review ${what} without drawing it. ${BILLED}`, ...disabledWhileBusy() }),
      button('Capture', () => void requestCapture(scope), { class: 'ghost small', title: `Capture ${what}`, ...disabledWhileBusy() }))

  const rows: HTMLElement[] = []
  if (history.dirty && history.head) {
    const head = history.head
    const captures = take((c) => isDirty(c) && sameCommit(head, commitOf(c)))
    rows.push(row('', 'Uncommitted changes', 'working tree', captures, null,
      captureButton({ uncommitted: true }, 'the uncommitted changes')))
  }
  for (const commit of history.commits) {
    const captures = take((c) => sameCommit(commit.sha, commitOf(c)))
    rows.push(row('', commit.subject, `${commit.short} · ${ago(commit.date)}`, captures, commit,
      commit.parent !== null && captureButton({ from: commit.parent, to: commit.sha }, `${commit.short} on its own`)))
  }
  if (history.base) {
    const base = history.base
    rows.push(row('base', base.subject, `${base.short} · branch base · ${ago(base.date)}`, take((c) => sameCommit(base.sha, commitOf(c))), base, false))
  }
  const out: HTMLElement[] = [compareForm(history), el('div', { class: 'timeline' }, ...rows)]
  if (history.truncated) out.push(el('p', { class: 'muted small' }, 'Showing the newest 60 commits.'))
  const rest = listing.captures.filter((capture) => !placed.has(capture.id))
  if (rest.length > 0) {
    out.push(el('div', { class: 'section small' }, 'Other captures'),
      el('p', { class: 'muted small' }, 'Drawn at commits that are not on this branch any more, or with no commit recorded.'),
      ...rest.map((capture) => captureCard(capture)))
  }
  return out
}

function list(listing: CaptureListing): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const problem of listing.problems) {
    out.push(el('div', { class: 'callout small' }, el('strong', {}, problem.id), `: ${problem.message}`))
  }
  const timelineShown = state.view === 'timeline' && state.history !== null && !state.history.error
  if (listing.captures.length === 0 && !timelineShown) {
    out.push(
      el(
        'div',
        { class: 'empty' },
        el('div', { class: 'title' }, 'No captures yet'),
        el('p', {}, 'Ask an agent to draw what it finished: before and after for changed behaviour, a flow for new code.'),
        button('Capture work', () => void requestCapture(), { class: 'primary', ...(state.busy ? { disabled: '' } : {}) })
      )
    )
  }
  const history = state.history
  if (state.view === 'timeline' && history && !history.error) return [...out, ...timeline(listing, history)]
  for (const capture of listing.captures) out.push(captureCard(capture))
  return out
}

function render(): void {
  const { listing } = state
  const body: Child[] = []
  if (state.error) body.push(el('div', { class: 'callout' }, state.error))
  if (!listing) {
    body.push(el('p', { class: 'muted' }, state.error ? '' : 'Loading...'))
  } else if (!listing.workspace) {
    body.push(el('div', { class: 'empty' }, el('div', { class: 'title' }, 'No local workspace focused'),
      el('p', {}, 'Open a workspace on this machine to see what its agents finished.')))
  } else {
    const selected = listing.captures.find((capture) => capture.id === state.selected)
    if (!selected) {
      body.push(
        el(
          'div',
          { class: 'bar' },
          el('div', { class: 'grow' },
            el('div', { class: 'title', title: listing.workspace.path }, listing.workspace.name),
            listing.workspace.branch && el('div', { class: 'muted small mono' }, listing.workspace.branch)),
          button('Review', () => void requestScopeReview(), { class: 'ghost', title: `Review the work on this branch without drawing it. ${BILLED}`, ...disabledWhileBusy() }),
          button('Capture', () => void requestCapture(), { class: 'primary', title: 'Ask an agent to capture the work on this branch', ...disabledWhileBusy() }),
          button('Refresh', reload, { class: 'ghost', title: 'Read the captures and the history again' })
        )
      )
      if (state.history && !state.history.error) {
        const pressed = (view: ListView) => String(state.view === view)
        body.push(el('div', { class: 'bar' },
          el('div', { class: 'seg', role: 'group', 'aria-label': 'Show' },
            button('Timeline', () => { state.view = 'timeline'; render() }, { 'aria-pressed': pressed('timeline') }),
            button('All captures', () => { state.view = 'list'; render() }, { 'aria-pressed': pressed('list') }))))
      }
    }
    if (!selected) body.push(...state.jobs.map(jobCard))
    if (state.status && !selected) body.push(el('p', { class: 'status muted small' }, state.status))
    body.push(...(selected ? detail(listing, selected) : list(listing)))
  }
  app.classList.toggle('dark-diagrams', darkDiagrams())
  app.replaceChildren(...body.filter((node): node is Node | string => Boolean(node)))
}

document.head.append(el('style', {}, STYLE + LEGEND_CSS))
document.body.append(app)
document.addEventListener('keydown', (event) => {
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
  if (!typing && state.selected && flipping() && event.key.toLowerCase() === 'f') {
    state.flipped = !state.flipped
    render()
  }
})

new ResizeObserver(() => {
  const narrow = app.clientWidth > 0 && app.clientWidth < NARROW
  if (narrow !== state.narrow) {
    state.narrow = narrow
    render()
  }
}).observe(app)

orca.plugin.on('captures.changed', reload)
orca.plugin.on('jobs.changed', () => void loadJobs().then(render))
orca.on('theme', () => render())
orca.settings.onDidChange(({ key }) => {
  if (key === 'diagramTheme') void loadDiagramTheme()
})
orca.on('workspace.changed', () => {
  state.selected = null
  state.status = null
  state.reviewError = null
  reload()
})
orca.on('agent.status.changed', ({ state: agentState }) => {
  if (agentState === 'done' || agentState === 'waiting') reload()
})
render()
void loadDiagramTheme()
void load()
