// The walkthrough editor: Orca opens a capture's `.debrief.json` file here, in a full editor tab.
// It steps through the capture's diagrams next to the code each step is about, then lays out the
// design decisions. It only reads the file.
import { CaptureError } from './captures.ts'
import type { Cite, CiteRow } from './cite.ts'
import type { Job, ListedCapture } from './protocol.ts'
import { isReviewText, parseReview, reviewMarkdown, type Finding, type Review } from './review.ts'
import { parseWalkthrough, d2IdOf, litIds, type Decision, type Figure, type Walkthrough, type WalkthroughStep } from './walkthrough.ts'
import { icon, type IconName } from './icons.ts'
import type { Note } from './notes.ts'
import { LEGEND_CSS, LEGEND_LABEL, removeLegend, trimToContent, type LegendKey } from './legend.ts'

const STYLE = `
:root {
  color-scheme: light dark;
  --debrief-added-bg: #e6f4ea; --debrief-added-fg: #1e7a3c; --debrief-deleted-bg: #fbeae7; --debrief-deleted-fg: #a8402c;
  --debrief-code-bg: #f7f6f2; --debrief-keyword: #7a4fb5; --debrief-string: #2f7d4f; --debrief-number: #b5651d;
  --debrief-type: #1f6fb2; --debrief-comment: #8a857a; --debrief-stated: #2f7d4f; --debrief-inferred: #a66a14;
  --debrief-chosen: #2f7d4f; --debrief-paper: #f3f1ea;
}
html.dark {
  --debrief-added-bg: #1f3326; --debrief-added-fg: #8fd1a3; --debrief-deleted-bg: #3a2420; --debrief-deleted-fg: #f0a596;
  --debrief-code-bg: #22211e; --debrief-keyword: #c7a8ef; --debrief-string: #9fd3a8; --debrief-number: #e8b47e;
  --debrief-type: #8cc4f0; --debrief-comment: #8f8a7f; --debrief-stated: #8fd1a3; --debrief-inferred: #e3b46a;
  --debrief-chosen: #8fd1a3; --debrief-paper: #f3f1ea;
}
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font: 14px/1.6 system-ui, sans-serif; color: var(--orca-foreground); background: var(--orca-background); }
#app { max-width: 1280px; margin: 0 auto; padding: 32px 40px 80px; }
h1 { font-size: 22px; line-height: 1.3; margin: 0 0 8px; }
h2 { font-size: 17px; margin: 0 0 4px; }
h3 { font-size: 15px; line-height: 1.35; margin: 0; }
p { margin: 0; }
section { margin-top: 44px; scroll-margin-top: 16px; }
#walkthrough, #decisions { margin-top: 0; }
.lede { color: var(--orca-muted-foreground); margin-bottom: 16px; }
.intro { font-size: 16px; max-width: 70ch; }
.muted { color: var(--orca-muted-foreground); }
.small { font-size: 12.5px; }
.mono, code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
p code, li code, h1 code, h3 code, .rule code, .versus code, figcaption code, .why code, .source code {
  font-size: .88em; padding: 1px 5px; border-radius: 4px; background: var(--debrief-code-bg);
  border: 1px solid var(--orca-border); white-space: nowrap;
}
button {
  font: inherit; color: var(--orca-secondary-foreground); background: var(--orca-secondary);
  border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px); padding: 4px 12px; cursor: pointer;
}
button:hover:not(:disabled) { background: var(--orca-accent); color: var(--orca-accent-foreground); }
button:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 1px; }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--orca-primary); color: var(--orca-primary-foreground); border-color: transparent; }
button.ghost { background: transparent; border-color: transparent; padding: 2px 8px; }
.code { border: 1px solid var(--orca-border); border-radius: 10px; overflow: hidden; background: var(--debrief-code-bg); }
.code-head { display: flex; gap: 10px; align-items: center; min-height: 40px; padding: 4px 6px 4px 14px; border-bottom: 1px solid var(--orca-border); font-size: 12px; background: var(--orca-card, transparent); }
.code-head .file { font-weight: 600; font-size: 12.5px; }
.code-head .grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.code pre { margin: 0; padding: 6px 0; font-size: 12.5px; line-height: 1.65; }
.row { display: grid; grid-template-columns: 48px 20px minmax(0, 1fr); padding-right: 14px; }
.row code { white-space: pre-wrap; overflow-wrap: anywhere; padding-left: 2ch; text-indent: -2ch; }
.row .ln { text-align: right; padding-right: 10px; color: var(--debrief-comment); user-select: none; }
.row .sg { color: var(--debrief-comment); user-select: none; text-align: center; }
.row.added { background: var(--debrief-added-bg); }
.row.added .sg, .row.added .ln { color: var(--debrief-added-fg); }
.row.deleted { background: var(--debrief-deleted-bg); }
.row.deleted .sg { color: var(--debrief-deleted-fg); }
.row.deleted code { opacity: .75; }
.row.gap { color: var(--debrief-comment); }
.code .fold { display: block; width: 100%; border: 0; border-top: 1px solid var(--orca-border); border-radius: 0; padding: 8px; background: var(--orca-card, transparent); color: var(--orca-muted-foreground); font-size: 12.5px; }
.code .note { padding: 8px 14px 10px; border-top: 1px solid var(--orca-border); font-size: 12.5px; color: var(--orca-muted-foreground); }
.code .msg { padding: 10px 14px; font-size: 12.5px; color: var(--orca-muted-foreground); }
.code-head .actions-end { display: flex; gap: 2px; }
dialog.diff-view {
  width: min(1100px, calc(100vw - 48px)); max-width: none; max-height: calc(100vh - 48px); padding: 0; border: 0;
  background: transparent; color: inherit; overflow: visible;
}
dialog.diff-view::backdrop { background: rgb(0 0 0 / .45); }
dialog.diff-view .code { display: flex; flex-direction: column; max-height: calc(100vh - 48px); box-shadow: 0 12px 40px rgb(0 0 0 / .3); }
dialog.diff-view .code-head .file { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
dialog.diff-view .scroll { flex: 1; min-height: 0; overflow: auto; }
.row.cited { box-shadow: inset 3px 0 0 var(--orca-primary); }
.row.cited.context { background: color-mix(in srgb, var(--orca-primary) 10%, transparent); }
.diff-view .row[data-line] { cursor: pointer; }
.diff-view .row[data-line]:hover .ln { color: var(--orca-foreground); text-decoration: underline; }
.diff-view .row.picked { background: color-mix(in srgb, var(--orca-primary) 22%, transparent); }
.diff-view .row.noted .ln { color: var(--orca-primary); font-weight: 600; }
.diff-view .send-slot:empty { display: none; }
.diff-view .send-slot { display: flex; gap: 6px; }
.diff-view .small-btn { padding: 3px 10px; font-size: 12px; white-space: nowrap; }
.diff-view .note-bar { display: flex; flex-direction: column; gap: 6px; padding: 6px 14px; border-bottom: 1px solid var(--orca-border); font-size: 12px; color: var(--orca-muted-foreground); background: var(--orca-card, transparent); }
.diff-view .note-bar .markdown { margin-top: 0; min-height: 120px; }
.note-card, .composer, .note-group {
  margin: 6px 14px 10px 68px; padding: 8px 12px; border: 1px solid var(--orca-border); border-radius: 8px;
  background: var(--orca-card, var(--orca-background)); font: 13px/1.5 system-ui, sans-serif; white-space: normal; color: var(--orca-foreground);
}
.note-card { border-left: 3px solid var(--orca-primary); }
.note-card.sent { border-left-color: var(--orca-border); }
.note-card.sent .note-body { color: var(--orca-muted-foreground); }
.note-group { border-style: dashed; }
.note-group .note-card { margin: 8px 0 0; }
.note-meta { display: flex; align-items: center; gap: 8px; font-size: 11.5px; color: var(--orca-muted-foreground); margin-bottom: 4px; }
.note-meta .grow, .composer-actions .grow { flex: 1; }
.note-body { white-space: pre-wrap; overflow-wrap: anywhere; }
.icon-btn.tiny { width: 22px; height: 22px; }
.composer textarea {
  display: block; width: 100%; min-height: 64px; resize: vertical; padding: 6px 8px; font: 13px/1.5 system-ui, sans-serif;
  color: var(--orca-foreground); background: var(--orca-background); border: 1px solid var(--orca-border); border-radius: 6px;
}
.composer textarea:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: 0; }
.composer-actions { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.icon-btn.counted { position: relative; color: var(--orca-primary); }
.count-badge {
  position: absolute; top: 1px; right: 0; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px;
  font: 600 9.5px/14px system-ui, sans-serif; background: var(--orca-primary); color: var(--orca-primary-foreground);
}
.tk-k { color: var(--debrief-keyword); } .tk-s { color: var(--debrief-string); } .tk-n { color: var(--debrief-number); }
.tk-t { color: var(--debrief-type); } .tk-c { color: var(--debrief-comment); font-style: italic; }

.diagram { border: 1px solid var(--orca-border); border-radius: 12px; background: var(--debrief-paper); padding: 16px; overflow: auto; max-height: 78vh; }
.diagram svg, .diagram img { display: block; max-width: 100%; height: auto; margin: 0 auto; }
.diagram g.debrief-dim { opacity: .2; transition: opacity .2s; }
.diagram g.debrief-lit { transition: opacity .2s; }
.diagram .msg { padding: 24px; text-align: center; color: #6b675e; }
.dark-diagrams .diagram { background: #2a2823; }
.dark-diagrams .diagram .art { filter: invert(.9) hue-rotate(180deg) saturate(1.4); }
figure { margin: 0; display: flex; flex-direction: column; gap: 8px; }
figcaption { font-size: 13px; color: var(--orca-muted-foreground); }
.icon { display: inline-flex; flex-shrink: 0; }
.icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0;
  background: transparent; color: var(--orca-muted-foreground); border: 1px solid var(--orca-border); border-radius: 8px;
}
.icon-btn.bare { border-color: transparent; width: 30px; height: 30px; }
.label { font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--orca-muted-foreground); }

header.top { display: flex; gap: 32px; align-items: flex-start; }
header.top .text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.eyebrow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12.5px; color: var(--orca-muted-foreground); }
.eyebrow .sep { opacity: .5; }
header.top h1 { font-size: 26px; line-height: 1.2; letter-spacing: -.015em; margin: 0; }
.intro { font-size: 15px; line-height: 1.6; max-width: 72ch; color: var(--orca-muted-foreground); }
.basis { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--orca-muted-foreground); }
.review-box {
  width: 300px; flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; padding: 14px;
  background: var(--orca-card, transparent); border: 1px solid var(--orca-border); border-radius: 10px;
}
.review-box .head { display: flex; align-items: center; gap: 8px; }
.review-box .head > .icon { color: var(--orca-primary); }
.review-box .head b { flex: 1; font-size: 13px; }
.review-box .meta { font-size: 12px; color: var(--orca-muted-foreground); }
.review-box .foot { display: flex; justify-content: flex-end; gap: 6px; }
.review-box .foot:empty { display: none; }
.review-box .activity { font: 11.5px ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--orca-muted-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pill {
  display: inline-flex; align-items: center; gap: 5px; min-height: 22px; padding: 0 9px; border-radius: 999px; white-space: nowrap;
  font-size: 12px; font-weight: 500; border: 1px solid var(--orca-border); color: var(--orca-muted-foreground);
}
.pill.on { background: var(--orca-accent); color: var(--orca-accent-foreground); border-color: transparent; }
.pill.bad { color: var(--orca-destructive, #c0392b); border-color: currentColor; }
.pill.stated { background: var(--orca-accent); color: var(--orca-accent-foreground); border-color: transparent; }
.pill.inferred { border-style: dashed; color: var(--orca-foreground); }
.live-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: .35; } }

.tabs { display: flex; gap: 24px; border-bottom: 1px solid var(--orca-border); margin: 24px 0 28px; }
.tabs button {
  display: inline-flex; align-items: center; gap: 8px; height: 40px; padding: 0; margin-bottom: -1px; border: 0; border-radius: 0;
  border-bottom: 2px solid transparent; background: transparent; color: var(--orca-muted-foreground); font-weight: 500;
}
.tabs button:hover:not(:disabled) { background: transparent; color: var(--orca-foreground); }
.tabs button[aria-selected="true"] { color: var(--orca-foreground); font-weight: 600; border-bottom-color: var(--orca-primary); }
.tabs .count { font-size: 12px; font-weight: 500; color: var(--orca-muted-foreground); }
.idea { margin-bottom: 36px; }
.idea .diagram { max-height: none; }

.section-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; margin-bottom: 12px; }
.section-head h2 { margin: 0; font-size: 18px; }
.stepper { display: grid; gap: 6px; margin-bottom: 24px; }
.stepper button {
  display: flex; flex-direction: column; gap: 10px; min-width: 0; padding: 0 0 8px; border: 0; border-radius: 0;
  background: transparent; color: var(--orca-muted-foreground); text-align: left;
}
.stepper button:hover:not(:disabled) { background: transparent; color: var(--orca-foreground); }
.stepper .bar { display: block; height: 3px; border-radius: 2px; background: var(--orca-border); }
.stepper .seen .bar { background: var(--orca-muted-foreground); opacity: .6; }
.stepper [aria-current="step"] .bar { background: var(--orca-primary); opacity: 1; }
.stepper .name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; font-weight: 500; }
.stepper .name span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.stepper .n {
  flex-shrink: 0; display: inline-grid; place-items: center; width: 20px; height: 20px; border-radius: 50%;
  font-size: 11px; font-weight: 600; border: 1px solid var(--orca-border); font-variant-numeric: tabular-nums;
}
.stepper [aria-current="step"] { color: var(--orca-foreground); }
.stepper [aria-current="step"] .name { font-weight: 600; }
.stepper [aria-current="step"] .n { background: var(--orca-primary); color: var(--orca-primary-foreground); border-color: transparent; }
.step-picker { display: none; gap: 8px; align-items: center; margin-bottom: 18px; }
.step-picker select {
  flex: 1; min-width: 0; height: 38px; padding: 0 10px; font: inherit; font-weight: 600;
  color: var(--orca-foreground); background: var(--orca-card, transparent); border: 1px solid var(--orca-border); border-radius: 8px;
}
.step-picker .icon-btn { width: 38px; height: 38px; }

.stage { display: grid; gap: 32px; grid-template-columns: minmax(0, 1fr) minmax(280px, 400px); align-items: start; }
.stage .words { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.stage .picture { position: sticky; top: 12px; }
.step-head { display: flex; align-items: center; gap: 10px; }
.step-head .grow { flex: 1; min-width: 0; }
.step-head h3 { font-size: 20px; margin: 2px 0 0; }
ul.points { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; font-size: 14.5px; line-height: 1.55; }
ul.points li { display: flex; gap: 10px; }
ul.points li::before { content: ''; flex-shrink: 0; width: 5px; height: 5px; margin-top: 9px; border-radius: 50%; background: var(--orca-primary); }
.step-nav { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 4px; }
.step-nav button { display: flex; flex-direction: column; gap: 2px; padding: 10px 14px; border-radius: 10px; background: transparent; text-align: left; color: var(--orca-foreground); }
.step-nav button.next { align-items: flex-end; text-align: right; grid-column: 2; }
.step-nav .dir { font-size: 12px; color: var(--orca-muted-foreground); }
.step-nav .title { font-weight: 500; }
.picture .label-row { display: flex; align-items: center; gap: 8px; }
.picture .label-row .label { flex: 1; }
.picture .unfold { display: none; }

.dec-list { display: flex; flex-direction: column; }
.dec { display: grid; gap: 32px; grid-template-columns: minmax(0, 1fr) minmax(0, 560px); align-items: start; padding: 28px 0; border-top: 1px solid var(--orca-border); }
.dec:first-child { border-top: 0; padding-top: 8px; }
.dec.solo { grid-template-columns: minmax(0, 720px); }
.dec .words { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.dec .title-row { display: flex; align-items: flex-start; gap: 12px; }
.dec .num {
  flex-shrink: 0; display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 6px;
  background: var(--orca-muted, transparent); color: var(--orca-muted-foreground); font-size: 12px; font-weight: 600;
}
.dec h3 { flex: 1; font-size: 17px; }
.dec .indent { margin-left: 36px; }
.dec .why { font-size: 14.5px; line-height: 1.55; color: var(--orca-muted-foreground); }
.dec .versus { display: flex; flex-direction: column; gap: 6px; }
.dec .versus > div { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; }
.dec .versus .tag { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; letter-spacing: .04em; color: var(--orca-muted-foreground); }
.dec .versus .chosen .tag { color: var(--orca-primary); }
.dec .versus .other span:last-child { color: var(--orca-muted-foreground); }
.dec .rule { display: flex; flex-direction: column; gap: 4px; padding: 12px 14px; border-radius: 10px; background: color-mix(in srgb, var(--orca-primary) 12%, transparent); }
.dec .rule .label { color: var(--orca-primary); }
.dec .rule span:last-child { font-size: 14.5px; line-height: 1.5; }
.source { font-size: 12.5px; color: var(--orca-muted-foreground); }
.evidence-key { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 20px; margin-bottom: 20px; font-size: 12.5px; color: var(--orca-muted-foreground); }
.evidence-key > span { display: inline-flex; align-items: center; gap: 8px; }

@media (max-width: 900px) {
  #app { padding: 24px 20px 64px; }
  header.top { flex-direction: column; gap: 16px; }
  .review-box { width: 100%; }
  .stepper { display: none; }
  .step-picker { display: flex; }
  .stage { grid-template-columns: minmax(0, 1fr); gap: 20px; }
  .stage .picture { position: static; order: -1; }
  .picture.folded .diagram { overflow: hidden; }
  .picture.folded .diagram svg, .picture.folded .diagram img { max-height: 180px; width: auto; }
  .picture .unfold { display: inline-flex; }
  .dec, .dec.solo { grid-template-columns: minmax(0, 1fr); gap: 18px; }
}
.decisions { display: flex; flex-direction: column; gap: 16px; }
.decision { display: grid; gap: 24px; grid-template-columns: minmax(0, 5fr) minmax(0, 6fr); align-items: start; }
.decision.solo { grid-template-columns: minmax(0, 720px); }
@media (max-width: 980px) { .decision { grid-template-columns: 1fr; } }
.decision .words { display: flex; flex-direction: column; gap: 12px; }
.decision .head { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
.markdown { display: block; width: 100%; min-height: 160px; margin-top: 10px; font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--orca-foreground); background: var(--orca-card); border: 1px solid var(--orca-border); border-radius: var(--orca-radius, 6px); padding: 8px; }
.counts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.sev { font-size: 11px; padding: 1px 8px; border-radius: 999px; border: 1px solid; white-space: nowrap; font-weight: 600; }
.sev.high { color: var(--debrief-deleted-fg); background: var(--debrief-deleted-bg); border-color: transparent; }
.sev.medium { color: var(--debrief-inferred); border-color: currentColor; }
.sev.low { color: var(--orca-muted-foreground); border-color: var(--orca-border); }
.conf { font-size: 11px; color: var(--orca-muted-foreground); }
.finding .words { display: flex; flex-direction: column; gap: 10px; }
.finding .tags { display: flex; gap: 8px; align-items: center; }
.finding dl { margin: 0; display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 6px 12px; }
.finding dt { font-size: 11px; letter-spacing: .04em; text-transform: uppercase; color: var(--orca-muted-foreground); padding-top: 3px; }
.finding dd { margin: 0; }
.checked { margin: 0; padding-left: 20px; color: var(--orca-muted-foreground); }
.clean { border: 1px solid var(--debrief-chosen); border-radius: 10px; padding: 14px 18px; color: var(--debrief-chosen); }
.callout { border: 1px solid var(--orca-destructive, #c0392b); border-radius: 8px; padding: 10px 12px; margin: 12px 0; }
`

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
function button(children: Child[], onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  const node = el('button', { type: 'button', ...attrs }, ...children)
  node.addEventListener('click', onClick)
  return node
}
const describe = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String(error.message) : String(error)

/** Text with `backticks` around code names, as text and <code> nodes. */
function rich(text: string): Node[] {
  return text.split('`').map((part, index) => (index % 2 === 1 ? el('code', {}, part) : document.createTextNode(part)))
}

const KEYWORDS = new Set(
  ('abstract as async await break case catch class const continue default do else enum export extends false final finally for ' +
    'function get if implements import in interface is late let new null override required return set static super switch this ' +
    'throw true try typedef var void while with yield').split(' ')
)
const TOKEN = /(\/\/.*$)|('(?:[^'\\]|\\.)*'?|"(?:[^"\\]|\\.)*"?)|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_$][\w$]*)\b/g

/** One line of Dart or TypeScript with comments, strings, numbers, keywords and types coloured. */
function highlight(line: string): Node[] {
  const out: Node[] = []
  let last = 0
  for (const match of line.matchAll(TOKEN)) {
    const [token, comment, string, number, word] = match
    const kind = comment ? 'c' : string ? 's' : number ? 'n' : word && KEYWORDS.has(word) ? 'k' : word && /^[A-Z]/.test(word) ? 't' : null
    if (!kind) continue
    if (match.index > last) out.push(document.createTextNode(line.slice(last, match.index)))
    out.push(el('span', { class: `tk-${kind}` }, token))
    last = match.index + token.length
  }
  if (last < line.length) out.push(document.createTextNode(line.slice(last)))
  return out
}

/** Drops the indent every cited line shares, so deep code still fits beside the diagram. */
function dedent(rows: CiteRow[]): CiteRow[] {
  const indent = (text: string) => text.length - text.trimStart().length
  const widths = rows.filter((r) => r.kind !== 'gap' && r.text.trim() !== '').map((r) => indent(r.text))
  const cut = widths.length > 0 ? Math.min(...widths) : 0
  return rows.map((row) => ({ ...row, text: row.text.slice(Math.min(cut, indent(row.text))) }))
}

type Tab = 'walkthrough' | 'decisions'

const state = {
  walkthrough: null as Walkthrough | null,
  review: null as Review | null,
  capture: null as ListedCapture | null,
  jobs: [] as Job[],
  status: null as string | null,
  error: null as string | null,
  step: 0,
  seen: new Set<number>([0]),
  dark: false,
  tab: 'walkthrough' as Tab,
  /** Narrow layout: the step diagram shows in full instead of as a strip. */
  diagramOpen: false,
  /** The review as Markdown, shown to copy by hand when the clipboard refused it. */
  markdown: null as string | null,
  /** Notes left for the agent on the capture's diff. */
  notes: [] as Note[]
}
type CiteAnswer = { rows: CiteRow[]; truncated: boolean; from: string }
type Picture = { node: Node; keys: LegendKey[] }
const pictures = new Map<string, Promise<Picture>>()
const cites = new Map<string, Promise<CiteAnswer>>()
const diffs = new Map<string, Promise<CiteAnswer>>()
const app = el('div', { id: 'app' })

/** A cited block longer than this folds after FOLD_AT lines. */
const FOLD_OVER = 16
const FOLD_AT = 12

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

function iconButton(name: IconName, label: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement {
  return button([icon(name, 15)], onClick, { class: 'icon-btn', 'aria-label': label, title: label, ...attrs })
}

function openFile(path: string): void {
  orca.plugin.request('code.open', { path }).catch((error) => {
    state.error = describe(error)
    render()
  })
}

function readCite(captureId: string, cite: Cite): Promise<CiteAnswer> {
  const key = JSON.stringify([captureId, cite])
  const cached = cites.get(key)
  if (cached) return cached
  // Plain JSON only: Orca refuses a request with an undefined field.
  const pending = orca.plugin.request('code.cite', { captureId, cite: JSON.parse(JSON.stringify(cite)) as Cite })
  pending.catch(() => cites.delete(key))
  cites.set(key, pending)
  return pending
}

function readDiff(captureId: string, path: string): Promise<CiteAnswer> {
  const key = JSON.stringify([captureId, path])
  const cached = diffs.get(key)
  if (cached) return cached
  const pending = orca.plugin.request('code.diff', { captureId, path })
  pending.catch(() => diffs.delete(key))
  diffs.set(key, pending)
  return pending
}

/** Repaints the open diff dialog after its notes changed elsewhere; null when none is open. */
let repaintDiff: (() => void) | null = null

const lineSpan = ([from, to]: [number, number]) => (from === to ? `line ${from}` : `lines ${from}–${to}`)

/**
 * The whole diff of the cited file across the capture's range, in a dialog over the page, scrolled
 * to the cited lines and marked. A click on a numbered line (shift-click for a range) opens a box
 * for a note to the agent; notes show under their lines. Copy puts every note not handed off yet
 * on the clipboard as Markdown; Start Claude opens a new Claude on them. Neither types into a
 * running agent. Esc drops an open note box first, then the dialog.
 * It lives outside #app, so the page re-rendering underneath leaves it open.
 */
function openDiff(cite: Cite): void {
  const capture = state.capture
  if (!capture) return
  document.querySelector('dialog.diff-view')?.remove()
  const marks = cite.show !== 'before'
  const view = {
    answer: null as CiteAnswer | null,
    anchor: null as number | null,
    pick: null as [number, number] | null,
    draft: '',
    busy: false,
    status: '',
    /** The notes as Markdown, shown to copy by hand when the clipboard refused them. */
    markdown: null as string | null
  }
  const inCite = (row: CiteRow) => marks && row.line !== undefined && row.line >= cite.lines[0] && row.line <= cite.lines[1]
  const range = el('span', { class: 'grow muted' }, 'Reading the diff...')
  const send = el('span', { class: 'send-slot' })
  const bar = el('div', { class: 'note-bar' })
  const body = el('div', { class: 'scroll' }, el('div', { class: 'msg' }, 'Reading the diff...'))
  const dialog = el('dialog', { class: 'diff-view', 'aria-label': `Diff of ${cite.path}` },
    el('div', { class: 'code' },
      el('div', { class: 'code-head', title: cite.path },
        el('span', { class: 'file mono' }, cite.path), range, send,
        el('span', { class: 'actions-end' },
          iconButton('external', `Open ${cite.path}`, () => { dialog.close(); openFile(cite.path) }, { class: 'icon-btn bare' }),
          iconButton('cross', 'Close', () => dialog.close(), { class: 'icon-btn bare', autofocus: '' }))),
      bar,
      body))
  dialog.addEventListener('close', () => { dialog.remove(); repaintDiff = null })
  // Esc drops a note being written before it closes the dialog.
  dialog.addEventListener('cancel', (event) => {
    if (!view.pick) return
    event.preventDefault()
    view.pick = null
    view.anchor = null
    paint()
  })
  // A click on the backdrop lands on the dialog itself, outside its box.
  dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close() })

  const fileNotes = () => state.notes.filter((note) => note.path === cite.path)

  function paintBar(): void {
    const unsent = state.notes.filter((note) => !note.sentAt).length
    const n = `${unsent} note${unsent === 1 ? '' : 's'}`
    const idle: Record<string, string> = view.busy ? { disabled: '' } : {}
    send.replaceChildren(...(unsent > 0
      ? [
          button([`Copy ${n}`], () => void copyNotes(), {
            class: 'small-btn', title: 'Copies every note not handed off yet, in every file, as Markdown to paste into an agent', ...idle }),
          button([`Start Claude with ${n}`], () => void launchClaude(), {
            class: 'primary small-btn', title: 'Starts a new Claude in a terminal of this workspace and asks it to work through every note not handed off yet', ...idle })
        ]
      : []))
    bar.replaceChildren(
      el('span', {}, view.status || 'Click a line number to leave a note for the agent. Shift-click picks a range.'),
      view.markdown ? markdownArea(view.markdown) : '')
  }

  function quoteOf(pick: [number, number]): string[] {
    return (view.answer?.rows ?? []).filter((row) => row.kind !== 'deleted' && row.line !== undefined && row.line >= pick[0] && row.line <= pick[1]).map((row) => row.text)
  }

  async function addNote(text: string): Promise<void> {
    const pick = view.pick
    if (!capture || !pick || text.trim() === '' || view.busy) return
    view.busy = true
    paintBar()
    try {
      const { note } = await orca.plugin.request('notes.add', {
        captureId: capture.id,
        note: { path: cite.path, lines: pick, body: text, quote: quoteOf(pick) }
      })
      state.notes = [...state.notes.filter((n) => n.id !== note.id), note]
      view.pick = null
      view.anchor = null
      view.draft = ''
      view.status = `Saved a note on ${lineSpan(note.lines)}. Copy it, or start Claude with it, when you're done.`
    } catch (error) {
      view.status = `Could not save the note: ${describe(error)}`
    }
    view.busy = false
    paint()
    render()
  }

  async function removeNote(id: string): Promise<void> {
    if (!capture) return
    try {
      await orca.plugin.request('notes.remove', { captureId: capture.id, id })
      state.notes = state.notes.filter((note) => note.id !== id)
      view.status = 'Removed the note.'
    } catch (error) {
      view.status = `Could not remove the note: ${describe(error)}`
    }
    paint()
    render()
  }

  const handed = (count: number) => (count === 1 ? 'the note' : `the ${count} notes`)

  async function copyNotes(): Promise<void> {
    if (!capture || view.busy) return
    view.busy = true
    view.markdown = null
    paintBar()
    try {
      const answer = await orca.plugin.request('notes.copy', { captureId: capture.id })
      if (answer.copied) {
        await loadNotes()
        view.status = `Copied ${handed(answer.count)} as Markdown: paste into an agent.`
      } else {
        view.status = `Could not write the clipboard (${answer.error ?? 'no reason given'}): copy ${handed(answer.count)} below.`
        view.markdown = answer.markdown
      }
    } catch (error) {
      view.status = `Could not copy the notes: ${describe(error)}`
    }
    view.busy = false
    paint()
    render()
  }

  async function launchClaude(): Promise<void> {
    if (!capture || view.busy) return
    view.busy = true
    view.markdown = null
    view.status = 'Starting Claude...'
    paintBar()
    try {
      const { count } = await orca.plugin.request('notes.launch', { captureId: capture.id })
      await loadNotes()
      view.status = `Started a new Claude in a terminal tab of this workspace with ${handed(count)}.`
    } catch (error) {
      view.status = `Could not start Claude: ${describe(error)}`
    }
    view.busy = false
    paint()
    render()
  }

  function noteCard(note: Note): HTMLElement {
    return el('div', { class: `note-card${note.sentAt ? ' sent' : ''}` },
      el('div', { class: 'note-meta' },
        el('span', {}, lineSpan(note.lines)),
        el('span', { class: 'pill' }, !note.sentAt ? 'not handed off yet' : `${note.sentVia === 'claude' ? 'given to Claude' : note.sentVia === 'copy' ? 'copied' : 'sent'} ${ago(note.sentAt)}`),
        el('span', { class: 'grow' }),
        iconButton('cross', 'Remove this note', () => void removeNote(note.id), { class: 'icon-btn bare tiny' })),
      el('div', { class: 'note-body' }, note.body))
  }

  function composer(pick: [number, number]): HTMLElement {
    const area = el('textarea', { 'aria-label': `Note for the agent on ${lineSpan(pick)}`, placeholder: 'What should the agent change or explain here?', rows: '3' })
    area.value = view.draft
    area.addEventListener('input', () => { view.draft = area.value })
    area.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        void addNote(area.value)
      }
    })
    requestAnimationFrame(() => area.focus())
    return el('div', { class: 'composer' },
      el('div', { class: 'note-meta' }, el('span', {}, `Note for the agent on ${lineSpan(pick)}`)),
      area,
      el('div', { class: 'composer-actions' },
        el('span', { class: 'muted small grow' }, '⌘↩ saves · Esc cancels'),
        button(['Cancel'], () => { view.pick = null; view.anchor = null; paint() }, { class: 'ghost' }),
        button(['Add note'], () => void addNote(area.value), { class: 'primary', ...(view.busy ? { disabled: '' } : {}) })))
  }

  function pickLine(line: number, extend: boolean): void {
    if (extend && view.anchor !== null) {
      view.pick = [Math.min(view.anchor, line), Math.max(view.anchor, line)]
    } else {
      view.anchor = line
      view.pick = [line, line]
    }
    paint()
  }

  function paint(): void {
    paintBar()
    const answer = view.answer
    if (!answer) return
    if (answer.rows.length === 0) {
      body.replaceChildren(el('div', { class: 'msg' }, `${cite.path} did not change in ${answer.from}.`))
      return
    }
    const notes = fileNotes()
    const shown = new Set(answer.rows.flatMap((row) => (row.line === undefined ? [] : [row.line])))
    const after = new Map<number, Note[]>()
    const unplaced: Note[] = []
    for (const note of notes) {
      if (shown.has(note.lines[1])) after.set(note.lines[1], [...(after.get(note.lines[1]) ?? []), note])
      else unplaced.push(note)
    }
    const pick = view.pick
    const noted = (line: number) => notes.some((note) => line >= note.lines[0] && line <= note.lines[1])
    const out: Node[] = []
    if (unplaced.length > 0) {
      out.push(el('div', { class: 'note-group' }, el('div', { class: 'label' }, 'Notes on lines this diff does not show'), ...unplaced.map(noteCard)))
    }
    for (const row of answer.rows) {
      const node = codeRow(row)
      if (inCite(row)) node.classList.add('cited')
      const line = row.line
      if (line !== undefined && row.kind !== 'deleted') {
        node.dataset.line = String(line)
        node.title = 'Click to leave a note for the agent; shift-click picks a range'
        if (pick && line >= pick[0] && line <= pick[1]) node.classList.add('picked')
        if (noted(line)) node.classList.add('noted')
      }
      out.push(node)
      if (line !== undefined && row.kind !== 'deleted') {
        for (const note of after.get(line) ?? []) out.push(noteCard(note))
        if (pick && line === pick[1]) out.push(composer(pick))
      }
    }
    if (answer.truncated) out.push(el('div', { class: 'row gap' }, el('span', { class: 'ln' }), el('span', { class: 'sg' }, '⋯'), el('code', {}, 'cut here')))
    const top = body.scrollTop
    const pre = el('pre', {}, ...out)
    pre.addEventListener('click', (event) => {
      const target = event.target as Element
      // Clicks inside a note or the note box are theirs, not a line pick.
      if (target.closest('.note-card, .composer, .note-group')) return
      const row = target.closest<HTMLElement>('.row[data-line]')
      if (row) pickLine(Number(row.dataset.line), event.shiftKey)
    })
    body.replaceChildren(pre)
    body.scrollTop = top
  }

  repaintDiff = () => { if (!view.pick) paint() }
  document.body.append(dialog)
  dialog.showModal()
  paintBar()

  readDiff(capture.id, cite.path).then(
    (answer) => {
      view.answer = answer
      range.textContent = `${marks ? `lines ${cite.lines[0]}–${cite.lines[1]} marked · ` : ''}${answer.from}`
      paint()
      const first = body.querySelector('.row.cited')
      if (first) first.scrollIntoView({ block: 'center' })
      else if (marks && answer.rows.length > 0) range.textContent = `lines ${cite.lines[0]}–${cite.lines[1]} unchanged · ${answer.from}`
    },
    (error) => { body.replaceChildren(el('div', { class: 'msg' }, describe(error))) }
  )
}

/** Text in a box, selected, to copy by hand. */
function markdownArea(text: string): HTMLTextAreaElement {
  const area = document.createElement('textarea')
  area.className = 'markdown'
  area.value = text
  area.setAttribute('readonly', '')
  area.setAttribute('aria-label', 'The notes as Markdown')
  requestAnimationFrame(() => area.select())
  return area
}

function codeRow(row: CiteRow): HTMLElement {
  return el('div', { class: `row ${row.kind}` },
    el('span', { class: 'ln' }, row.kind === 'gap' ? '' : String(row.line ?? '')),
    el('span', { class: 'sg' }, row.kind === 'added' ? '+' : row.kind === 'deleted' ? '−' : row.kind === 'gap' ? '⋯' : ''),
    el('code', {}, ...highlight(row.text)))
}

/** Opens the whole diff, where notes for the agent are left; it counts the notes on this file. */
function diffButton(cite: Cite): HTMLButtonElement {
  const count = state.notes.filter((note) => note.path === cite.path).length
  const label = `Show the whole diff of ${cite.path} and leave notes for the agent${count > 0 ? ` (${count} note${count === 1 ? '' : 's'})` : ''}`
  const node = iconButton('diff', label, () => openDiff(cite), { class: `icon-btn bare${count > 0 ? ' counted' : ''}`, ...(state.capture ? {} : { disabled: '' }) })
  if (count > 0) node.append(el('span', { class: 'count-badge', 'aria-hidden': 'true' }, String(count)))
  return node
}

/** A cited block of code, filled when git answers. Long blocks fold, and open in place. */
function codeBlock(cite: Cite): HTMLElement {
  const name = cite.path.split('/').pop() ?? cite.path
  const body = el('div', { class: 'msg' }, 'Reading the code...')
  const range = el('span', { class: 'grow muted' }, `lines ${cite.lines[0]}–${cite.lines[1]}`)
  const block = el('div', { class: 'code' },
    el('div', { class: 'code-head', title: cite.path },
      el('span', { class: 'file mono' }, name), range,
      el('span', { class: 'actions-end' },
        diffButton(cite),
        iconButton('external', `Open ${cite.path}`, () => openFile(cite.path), { class: 'icon-btn bare' }))),
    body,
    cite.note && el('div', { class: 'note' }, ...rich(cite.note)))
  if (!state.capture) {
    body.textContent = 'The capture could not be read, so there is no code to show.'
    return block
  }
  readCite(state.capture.id, cite).then(
    ({ rows, truncated, from }) => {
      const kind = from.includes('..') ? 'the change' : cite.show === 'before' ? 'before' : 'after'
      range.textContent = `lines ${cite.lines[0]}–${cite.lines[1]} · ${kind} · ${from}`
      const lines = dedent(rows).map(codeRow)
      if (truncated) lines.push(el('div', { class: 'row gap' }, el('span', { class: 'ln' }), el('span', { class: 'sg' }, '⋯'), el('code', {}, 'cut here')))
      const pre = el('pre', {})
      if (lines.length <= FOLD_OVER) {
        pre.append(...lines)
        body.replaceWith(pre)
        return
      }
      const fold = el('button', { type: 'button', class: 'fold', 'aria-expanded': 'false' })
      const show = (all: boolean) => {
        pre.replaceChildren(...(all ? lines : lines.slice(0, FOLD_AT)))
        fold.textContent = all ? 'Show less' : `Show ${lines.length - FOLD_AT} more lines`
        fold.setAttribute('aria-expanded', String(all))
      }
      fold.addEventListener('click', () => show(fold.getAttribute('aria-expanded') !== 'true'))
      show(false)
      body.replaceWith(pre, fold)
    },
    (error) => { body.textContent = describe(error) }
  )
  return block
}

/**
 * An image as live nodes: an SVG goes inline (so its boxes can be dimmed), others an <img>. A D2
 * SVG loses its own legend; `keys` says which rows it had, for the legend the page draws.
 */
function picture(key: string, label: string, load: () => Promise<{ url: string }>): Promise<Picture> {
  const cached = pictures.get(key)
  if (cached) return cached
  const loading = load().then(({ url }): Picture => {
    if (!url.startsWith('data:image/svg+xml;base64,')) return { node: el('img', { src: url, alt: label }), keys: [] }
    const binary = atob(url.slice(url.indexOf(',') + 1))
    const svgText = new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
    const svg = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement
    if (svg.nodeName !== 'svg') return { node: el('div', { class: 'msg' }, 'The diagram is not a readable SVG.'), keys: [] }
    // The SVG comes from the workspace: keep its drawing, drop anything that could run.
    for (const node of Array.from(svg.querySelectorAll('script, foreignObject iframe'))) node.remove()
    for (const node of [svg, ...Array.from(svg.querySelectorAll('*'))]) {
      for (const attr of Array.from(node.attributes)) {
        if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) node.removeAttribute(attr.name)
      }
    }
    const keys = removeLegend(svg)
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', label)
    return { node: document.importNode(svg, true), keys }
  })
  const safe = loading.catch((error): Picture => {
    pictures.delete(key)
    return { node: el('div', { class: 'msg' }, describe(error)), keys: [] }
  })
  pictures.set(key, safe)
  return safe
}

/** Trims an inline SVG to its drawing once it is in the page and its fonts have loaded. */
function trimOnce(node: Node): void {
  if (!(node instanceof SVGSVGElement) || node.dataset.debriefTrimmed) return
  void document.fonts.ready.then(() => {
    if (node.isConnected && trimToContent(node)) node.dataset.debriefTrimmed = '1'
  })
}

function legendRow(keys: readonly LegendKey[]): HTMLElement {
  return el('div', { class: 'legend' }, ...keys.map((key) =>
    el('span', { class: 'key' }, el('span', { class: `sw ${key}` }), LEGEND_LABEL[key])))
}

/** A diagram box that fills itself; `prepare` runs on the nodes before they show. */
function frame(pending: Promise<Picture> | null, prepare?: (node: Node) => void, legend?: HTMLElement): HTMLElement {
  const box = el('div', { class: 'diagram' }, el('div', { class: 'msg' }, pending ? 'Loading diagram...' : 'No diagram for this.'))
  void pending?.then(({ node, keys }) => {
    prepare?.(node)
    box.replaceChildren(el('div', { class: 'art' }, node))
    trimOnce(node)
    legend?.replaceWith(legendRow(keys))
  })
  return box
}

function figure(fig: Figure, extra: Record<string, string> = {}): HTMLElement {
  const capture = state.capture
  const pending = capture
    ? picture(`asset:${capture.id}:${fig.image}`, fig.caption ?? fig.image, () =>
        orca.plugin.request('captures.asset', { captureId: capture.id, path: fig.image }))
    : null
  const legend = el('div', { class: 'legend' })
  return el('figure', extra, frame(pending, undefined, legend), fig.caption && el('figcaption', {}, ...rich(fig.caption)), legend)
}

/** Dims every D2 box and line not in `focus`. */
function dimOutside(root: Node, focus: readonly string[]): void {
  if (!(root instanceof Element)) return
  const groups = Array.from(root.querySelectorAll('g[class]')).flatMap((group) => {
    const id = d2IdOf(group.classList[0] ?? '')
    return id === null ? [] : [{ group, id }]
  })
  const lit = litIds(groups.map((g) => g.id), focus)
  for (const { group, id } of groups) {
    const on = focus.length === 0 || lit.has(id)
    group.classList.toggle('debrief-dim', !on)
    group.classList.toggle('debrief-lit', on && focus.length > 0)
  }
}

function goStep(next: number): void {
  const total = state.walkthrough?.steps.length ?? 0
  state.step = Math.max(0, Math.min(total - 1, next))
  state.seen.add(state.step)
  render()
}

function stepper(all: readonly WalkthroughStep[], index: number): HTMLElement[] {
  const bar = el('nav', { class: 'stepper', 'aria-label': 'Steps', style: `grid-template-columns: repeat(${all.length}, minmax(0, 1fr))` },
    ...all.map((s, i) => button(
      [el('span', { class: 'bar' }), el('span', { class: 'name' }, el('span', { class: 'n' }, String(i + 1)), el('span', {}, s.title))],
      () => goStep(i),
      { ...(i === index ? { 'aria-current': 'step' } : {}), ...(state.seen.has(i) && i !== index ? { class: 'seen' } : {}), title: s.title })))
  const select = el('select', { 'aria-label': 'Step' }, ...all.map((s, i) => {
    const option = el('option', { value: String(i) }, `Step ${i + 1} of ${all.length} · ${s.title}`)
    option.selected = i === index
    return option
  }))
  select.addEventListener('change', () => goStep(Number(select.value)))
  const picker = el('div', { class: 'step-picker' },
    iconButton('prev', 'Previous step', () => goStep(index - 1), index === 0 ? { disabled: '' } : {}),
    select,
    iconButton('next', 'Next step', () => goStep(index + 1), index === all.length - 1 ? { disabled: '' } : {}))
  return [bar, picker]
}

function steps(walkthrough: Walkthrough): HTMLElement {
  const all = walkthrough.steps
  const total = all.length
  const index = Math.min(state.step, total - 1)
  const step = all[index]
  const capture = state.capture
  const viewIndex = step.view
  const view = viewIndex !== undefined ? capture?.views[viewIndex] : undefined
  const pending = capture && view && viewIndex !== undefined
    ? picture(`view:${capture.id}:${viewIndex}`, view.caption ?? view.title, () =>
        orca.plugin.request('captures.image', { captureId: capture.id, view: viewIndex }))
    : null
  const prev = index > 0 ? all[index - 1] : null
  const next = index < total - 1 ? all[index + 1] : null
  const legend = el('div', { class: 'legend' })
  return el('section', { id: 'walkthrough', 'aria-label': 'Walkthrough' },
    el('div', { class: 'section-head' },
      el('h2', {}, 'Walkthrough'),
      el('span', { class: 'muted small' }, 'In the order the code runs. The diagram lights up what each step is about.')),
    ...stepper(all, index),
    el('div', { class: 'stage' },
      el('div', { class: 'words' },
        el('div', { class: 'step-head' },
          el('div', { class: 'grow' }, el('div', { class: 'muted small' }, `Step ${index + 1} of ${total}`), el('h3', {}, ...rich(step.title))),
          iconButton('prev', prev ? `Previous step: ${prev.title} (←)` : 'Previous step', () => goStep(index - 1), prev ? {} : { disabled: '' }),
          iconButton('next', next ? `Next step: ${next.title} (→)` : 'Next step', () => goStep(index + 1), next ? {} : { disabled: '' })),
        el('ul', { class: 'points' }, ...step.points.map((point) => el('li', {}, el('span', {}, ...rich(point))))),
        ...step.code.map(codeBlock),
        (prev || next) && el('div', { class: 'step-nav' },
          prev && button([el('span', { class: 'dir' }, '← Previous'), el('span', { class: 'title' }, `${index}. `, ...rich(prev.title))], () => goStep(index - 1)),
          next && button([el('span', { class: 'dir' }, 'Next →'), el('span', { class: 'title' }, `${index + 2}. `, ...rich(next.title))], () => goStep(index + 1), { class: 'next' }))),
      viewIndex !== undefined &&
        el('aside', { class: `picture${state.diagramOpen ? '' : ' folded'}`, 'aria-label': 'Diagram for this step' },
          el('figure', {},
            el('div', { class: 'label-row' },
              el('span', { class: 'label' }, `${view?.title ?? 'Diagram'} · lit for this step`),
              button([state.diagramOpen ? 'Fold' : 'Show all'], () => { state.diagramOpen = !state.diagramOpen; render() },
                { class: 'ghost small unfold', 'aria-expanded': String(state.diagramOpen) })),
            frame(pending, (node) => dimOutside(node, step.focus), legend),
            view?.caption && el('figcaption', {}, ...rich(view.caption)),
            legend))))
}

const EVIDENCE_TITLE = {
  stated: 'A commit, a comment or a doc says so',
  inferred: 'Read from the shape of the code; check with the author'
} as const

function evidencePill(evidence: Decision['evidence']): HTMLElement {
  return evidence === 'stated'
    ? el('span', { class: 'pill stated', title: EVIDENCE_TITLE.stated }, icon('quote', 11), 'Stated')
    : el('span', { class: 'pill inferred', title: EVIDENCE_TITLE.inferred }, 'Inferred')
}

function decisionRow(d: Decision, index: number): HTMLElement {
  const side = d.figure ? figure(d.figure) : d.code ? codeBlock(d.code) : null
  return el('article', { class: `dec${side ? '' : ' solo'}` },
    el('div', { class: 'words' },
      el('div', { class: 'title-row' },
        el('span', { class: 'num' }, String(index + 1)),
        el('h3', {}, ...rich(d.decision)),
        evidencePill(d.evidence)),
      el('p', { class: 'why indent' }, ...rich(d.why)),
      (d.chosen || d.alternative) && el('div', { class: 'versus indent' },
        el('div', { class: 'chosen' }, el('span', { class: 'tag' }, icon('check', 13), 'CHOSEN'), el('span', {}, ...rich(d.chosen ?? d.decision))),
        d.alternative && el('div', { class: 'other' }, el('span', { class: 'tag' }, icon('cross', 13), 'NOT CHOSEN'), el('span', {}, ...rich(d.alternative)))),
      d.applyElsewhere && el('div', { class: 'rule indent' }, el('span', { class: 'label' }, 'Next time'), el('span', {}, ...rich(d.applyElsewhere))),
      el('p', { class: 'source indent' }, d.evidence === 'stated' ? 'Source · ' : 'Read from · ', ...rich(d.source))),
    side)
}

function decisions(walkthrough: Walkthrough): HTMLElement {
  return el('section', { id: 'decisions', 'aria-label': 'Design decisions' },
    el('div', { class: 'section-head' }, el('h2', {}, 'Design decisions')),
    el('div', { class: 'evidence-key' },
      el('span', {}, evidencePill('stated'), 'a commit, comment or doc says so'),
      el('span', {}, evidencePill('inferred'), 'read from the code, so check with the author')),
    el('div', { class: 'dec-list' }, ...walkthrough.decisions.map(decisionRow)))
}

function tabs(walkthrough: Walkthrough): HTMLElement {
  const tab = (id: Tab, label: string, count: string) => {
    const node = button([label, el('span', { class: 'count' }, count)], () => { state.tab = id; render(); window.scrollTo({ top: 0 }) },
      { role: 'tab', 'aria-selected': String(state.tab === id), 'aria-controls': id })
    return node
  }
  const steps = walkthrough.steps.length
  return el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Sections' },
    tab('walkthrough', 'Walkthrough', `${steps} step${steps === 1 ? '' : 's'}`),
    walkthrough.decisions.length > 0 && tab('decisions', 'Design decisions', String(walkthrough.decisions.length)))
}

/** The review's state for this capture, with the one action that fits it. */
function reviewBox(): HTMLElement | false {
  const capture = state.capture
  if (!capture) return false
  const job = reviewJob()
  const review = capture.review
  const openReview = () =>
    void orca.plugin.request('review.open', { captureId: capture.id }).catch((error) => { state.status = describe(error); render() })
  const billed = 'Starts a background Claude run that reviews this change for bugs. Billed to your Claude login, capped by the cost setting.'
  let pill: HTMLElement
  let meta: string
  let foot: Child[]
  if (job) {
    pill = job.status === 'running'
      ? el('span', { class: 'pill on' }, el('span', { class: 'live-dot' }), 'Reviewing')
      : el('span', { class: 'pill' }, 'Queued')
    meta = job.status === 'running' ? `Started ${ago(job.startedAt ?? job.createdAt)}` : 'Starts after the current background run'
    foot = []
  } else if (review) {
    pill = review.findings === 0
      ? el('span', { class: 'pill on' }, icon('check', 11), 'No findings')
      : el('span', { class: `pill${review.high > 0 ? ' bad' : ''}` },
        (['high', 'medium', 'low'] as const).filter((s) => review[s] > 0).map((s) => `${review[s]} ${s}`).join(' · '))
    meta = [`Reviewed ${ago(review.createdAt)}`, review.pr !== undefined && `read PR #${review.pr}`].filter(Boolean).join(' · ')
    foot = [
      button(['Run again'], startReview, { class: 'ghost', title: billed }),
      button(['Open'], openReview, { title: 'Opens the review in this editor' })
    ]
  } else {
    pill = el('span', { class: 'pill' }, 'Not run')
    meta = 'A background run checks this change for bugs'
    foot = [button(['Review code'], startReview, { class: 'primary', title: billed })]
  }
  return el('div', { class: 'review-box' },
    el('div', { class: 'head' }, icon('shield', 15), el('b', {}, 'Code review'), pill),
    job?.activity && el('div', { class: 'activity' }, job.activity),
    el('div', { class: 'meta' }, meta),
    el('div', { class: 'foot' }, ...foot),
    state.status && !job && el('div', { class: 'muted small' }, state.status))
}

function walkthroughView(walkthrough: Walkthrough): Child[] {
  const capture = state.capture
  const base = (capture?.base ?? '').slice(0, 7)
  const commit = (capture?.commit ?? '').replace(/\+.*$/, '').slice(0, 7)
  return [
    el('header', { class: 'top' },
      el('div', { class: 'text' },
        el('div', { class: 'eyebrow' },
          icon('walk', 14), 'Walkthrough',
          capture && el('span', { class: 'sep' }, '/'), capture && el('span', {}, ...rich(capture.title)),
          commit && el('span', { class: 'sep' }, '•'), commit && el('span', { class: 'mono' }, base ? `${base} → ${commit}` : commit)),
        el('h1', {}, ...rich(walkthrough.title)),
        el('p', { class: 'intro' }, ...rich(walkthrough.intro)),
        capture?.basis && el('div', { class: 'basis' }, icon('info', 13), `From ${capture.basis}`)),
      reviewBox()),
    tabs(walkthrough),
    ...(state.tab === 'decisions' && walkthrough.decisions.length > 0
      ? [decisions(walkthrough)]
      : [
          walkthrough.figure && el('div', { class: 'idea' },
            el('div', { class: 'label', style: 'margin-bottom: 10px' }, 'The idea'), figure(walkthrough.figure)),
          steps(walkthrough)
        ])
  ]
}

/** The review run for this capture that is queued or running, if any. */
function reviewJob(): Job | undefined {
  const id = state.capture?.id
  return state.jobs.find((job) => job.kind === 'review' && job.captureId === id && (job.status === 'queued' || job.status === 'running'))
}

function startReview(): void {
  const capture = state.capture
  if (!capture) return
  state.status = 'Queueing a review...'
  render()
  orca.plugin.request('captures.review', { captureId: capture.id }).then(
    () => { state.status = 'Review queued: a background Claude run reads the change. It opens here when it is done.'; return loadJobs() },
    (error) => { state.status = `Could not start the review: ${describe(error)}` }
  ).then(render)
}

/**
 * Puts text on the clipboard through the worker. Orca gives this isolated frame no clipboard of
 * its own, and the old select-and-copy-command trick can report success without copying, so a
 * false here is honest: the caller shows the text to copy by hand.
 */
async function copyText(text: string): Promise<boolean> {
  return orca.plugin.request('clipboard.write', { text }).then(() => true, () => false)
}

/** Copies the open review as Markdown, or shows it to copy by hand when the clipboard refuses. */
async function copyReview(): Promise<void> {
  const review = state.review
  if (!review) return
  const markdown = reviewMarkdown(review, state.capture ?? { title: review.capture })
  const copied = await copyText(markdown)
  state.markdown = copied ? null : markdown
  state.status = copied ? 'Copied the review as Markdown.' : 'The clipboard is not available here: select the text below and copy it.'
  render()
}

/** Review code, open the review, or the run's progress. */
function reviewActions(): HTMLElement | false {
  const capture = state.capture
  if (!capture) return false
  const job = reviewJob()
  const review = capture.review
  return el('div', { class: 'actions' },
    !state.review && review && button([`Open review · ${review.findings === 0 ? 'no findings' : `${review.findings} finding${review.findings === 1 ? '' : 's'}`}`],
      () => void orca.plugin.request('review.open', { captureId: capture.id }).catch((error) => { state.status = describe(error); render() })),
    state.review && capture.walkthrough && button(['Open walkthrough'],
      () => void orca.plugin.request('walkthrough.open', { captureId: capture.id }).catch((error) => { state.status = describe(error); render() })),
    button([job ? (job.status === 'running' ? 'Reviewing...' : 'Review queued') : review ? 'Review again' : 'Review code'], startReview, {
      ...(review ? {} : { class: 'primary' }),
      title: 'A background Claude run reviews this change for bugs. Billed to your Claude login, capped by the cost setting.',
      ...(job ? { disabled: '' } : {})
    }),
    state.review && button(['Copy as Markdown'], () => void copyReview(), { title: 'Copies the summary and findings, to paste into a pull request comment' }),
    job?.activity && el('span', { class: 'muted small' }, job.activity),
    state.status && !job && el('span', { class: 'muted small' }, state.status))
}

/** The review's Markdown in a box, selected, after the clipboard refused it. */
function markdownBox(): HTMLElement | false {
  if (!state.markdown) return false
  const area = document.createElement('textarea')
  area.className = 'markdown'
  area.value = state.markdown
  area.setAttribute('readonly', '')
  area.setAttribute('aria-label', 'The review as Markdown')
  requestAnimationFrame(() => area.select())
  return area
}

function findingCard(f: Finding): HTMLElement {
  return el('div', { class: 'card decision finding' },
    el('div', { class: 'words' },
      el('div', { class: 'tags' },
        el('span', { class: `sev ${f.severity}` }, f.severity),
        el('span', { class: 'conf', title: f.confidence === 'confirmed' ? 'Traced end to end through the code' : 'One step of the path is assumed; see why' },
          f.confidence)),
      el('h3', {}, ...rich(f.title)),
      el('dl', {},
        el('dt', {}, 'What breaks'), el('dd', {}, ...rich(f.failure)),
        el('dt', {}, 'Why'), el('dd', {}, ...rich(f.why)),
        f.fix && el('dt', {}, 'Fix'), f.fix && el('dd', {}, ...rich(f.fix)))),
    codeBlock(f.code))
}

function reviewView(review: Review): Child[] {
  const capture = state.capture
  const count = (s: Finding['severity']) => review.findings.filter((f) => f.severity === s).length
  return [
    el('header', {},
      el('h1', {}, 'Review: ', ...rich(capture?.title ?? review.capture)),
      el('p', { class: 'intro' }, ...rich(review.summary)),
      el('p', { class: 'meta muted small' },
        `Reviewed ${new Date(review.createdAt).toLocaleString()}`,
        review.pr && ` · read with pull request #${review.pr.number} and its comments`,
        ` · ${review.basis}`),
      review.findings.length > 0 && el('div', { class: 'counts' },
        ...(['high', 'medium', 'low'] as const).filter((s) => count(s) > 0).map((s) => el('span', { class: `sev ${s}` }, `${count(s)} ${s}`))),
      reviewActions(),
      markdownBox()),
    el('section', { id: 'findings' },
      el('h2', {}, 'Findings'),
      el('p', { class: 'lede small' }, 'Confirmed: every step read in the code. ',
        review.findings.some((f) => f.confidence === 'plausible') && 'Plausible (an older review): one step is assumed. ', 'Nothing was run.'),
      review.findings.length === 0
        ? el('div', { class: 'clean' }, 'Nothing survived verification.')
        : el('div', { class: 'decisions' }, ...review.findings.map(findingCard))),
    review.walkthroughErrors && el('section', { id: 'walkthrough-errors' },
      el('h2', {}, 'Walkthrough errors'),
      el('p', { class: 'lede small' }, 'Where the walkthrough misreads the code. Fix the walkthrough, not the code.'),
      el('ul', { class: 'checked' }, ...review.walkthroughErrors.map((w) => el('li', {}, ...rich(w))))),
    review.checked.length > 0 && el('section', { id: 'checked' },
      el('h2', {}, 'Also checked'),
      el('p', { class: 'lede small' }, 'Looked at, and nothing was wrong.'),
      el('ul', { class: 'checked' }, ...review.checked.map((c) => el('li', {}, ...rich(c)))))
  ]
}

function render(): void {
  const { walkthrough, review } = state
  const body: Child[] = []
  if (state.error) body.push(el('div', { class: 'callout' }, state.error))
  if (review) {
    body.push(...reviewView(review))
  } else if (!walkthrough) {
    body.push(el('p', { class: 'muted' }, state.error ? '' : 'Loading...'))
  } else {
    body.push(...walkthroughView(walkthrough))
  }
  app.classList.toggle('dark-diagrams', state.dark)
  app.replaceChildren(...body.filter((node): node is Node | string => Boolean(node)))
}

async function loadCapture(captureId: string): Promise<void> {
  if (state.capture?.id === captureId) return
  pictures.clear()
  cites.clear()
  diffs.clear()
  state.capture = await orca.plugin.request('captures.get', { captureId }).catch((error) => {
    state.error = `Could not read capture ${captureId}: ${describe(error)}. It shows without its diagrams or code.`
    return null
  })
  await loadNotes()
}

async function loadNotes(): Promise<void> {
  const capture = state.capture
  state.notes = capture
    ? await orca.plugin.request('notes.list', { captureId: capture.id }).then(({ notes }) => notes, () => state.notes)
    : []
}

async function loadJobs(): Promise<void> {
  state.jobs = await orca.plugin.request('jobs.list').catch(() => state.jobs)
}

async function loadDocument(text: string): Promise<void> {
  try {
    state.error = null
    if (isReviewText(text)) {
      const review = parseReview(text)
      await loadCapture(review.capture)
      state.review = review
      state.walkthrough = null
    } else {
      const walkthrough = parseWalkthrough(text)
      await loadCapture(walkthrough.capture)
      // Set only now, so no render shows the steps before their capture is known.
      state.walkthrough = walkthrough
      state.review = null
    }
  } catch (error) {
    state.walkthrough = null
    state.review = null
    state.error = error instanceof CaptureError ? `This file is not valid: ${error.message}` : describe(error)
  }
  render()
}

async function loadDiagramTheme(): Promise<void> {
  const value = await orca.settings.get('diagramTheme').catch(() => 'auto')
  state.dark = value === 'dark' || (value !== 'light' && document.documentElement.classList.contains('dark'))
  render()
}

document.head.append(el('style', {}, STYLE + LEGEND_CSS))
document.body.append(app)
document.addEventListener('keydown', (event) => {
  const total = state.walkthrough?.steps.length ?? 0
  if (total === 0 || state.tab !== 'walkthrough' || event.metaKey || event.ctrlKey || event.altKey) return
  if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement) return
  if (document.querySelector('dialog[open]')) return
  if (event.key === 'ArrowRight' || event.key === 'j') goStep(state.step + 1)
  else if (event.key === 'ArrowLeft' || event.key === 'k') goStep(state.step - 1)
  else return
  event.preventDefault()
})
orca.on('theme', () => void loadDiagramTheme())
orca.settings.onDidChange(({ key }) => {
  if (key === 'diagramTheme') void loadDiagramTheme()
})
orca.plugin.on('jobs.changed', () => void loadJobs().then(render))
orca.plugin.on('captures.changed', () => {
  pictures.clear()
  cites.clear()
  diffs.clear()
  const id = state.capture?.id
  if (id) {
    void orca.plugin.request('captures.get', { captureId: id }).then(async (capture) => {
      state.capture = capture
      await loadNotes()
      render()
      repaintDiff?.()
    }, () => undefined)
  }
})

const textOf = (content: { kind: string; text?: string }) => (content.kind === 'text' ? content.text ?? '' : '')
if (orca.document) {
  orca.document.onDidChange((doc) => void loadDocument(textOf(doc.content)))
  void orca.document.get().then((doc) => loadDocument(textOf(doc.content)), (error) => {
    state.error = describe(error)
    render()
  })
} else {
  state.error = 'Open a .debrief.json file to see its walkthrough.'
}
render()
void loadDiagramTheme()
void loadJobs().then(render)
