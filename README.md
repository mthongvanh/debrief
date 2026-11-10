# Debrief

![A walkthrough open in an editor tab: step 1 of 4, its points, the cited code as a diff, and the flow diagram with that step's box lit up](docs/walkthrough.png)

An Orca plugin that shows what an agent finished in a workspace as diagrams, in a right-sidebar
panel:

- **Changed behaviour:** a before and an after diagram drawn on the same layout. View them side
  by side, or flip between them in place (`F`) to see what moved. A panel narrower than 560px
  always flips. Click a diagram to open it full size (`Esc` closes it).
- **New code:** a flow or sequence diagram of how the new path joins the existing one.
- **Walkthrough:** a capture can carry a guided tour that opens in a full editor tab (the
  sidebar's Open walkthrough button), with the review's status at the top. Two tabs:
  - *Walkthrough* goes through the diagrams in the order the code runs. Each step has a few
    short points, the cited code as a diff, and the diagram with that step's boxes lit up
    (`←`/`→` or `j`/`k` moves between steps).
  - *Design decisions* shows chosen against not chosen, with a code cite or a small idea
    figure. Each decision is marked stated (a commit body, a comment or a doc says so) or
    inferred from the code, and ends with a rule to follow next time.

  A walkthrough names line ranges and the worker reads the code from git at the capture's
  commits, so cited code always matches what was drawn.
- **Code review:** Review code (on a capture in the sidebar, or in its walkthrough) queues a
  background run that reviews the capture's change for bugs: logic, async, state, error
  handling and broken callers, not style. It checks each finding by tracing the code from an
  input to the wrong outcome, and drops it if it can't name both. The findings open in the
  same editor tab: severity, confirmed or plausible, what breaks, why, a fix, and the cited
  diff. Copy as Markdown puts the summary and findings on the clipboard, to paste into a pull
  request comment yourself. The run's instructions are `skills/debrief/REVIEW.md`; it reads
  the walkthrough, if there is one, as a claim to check. It does not build or run tests.

  A review doesn't need a capture first. Review, next to Capture at the top of the panel, on
  each timeline row and in Capture between two commits, reviews that scope without drawing it.
  The review lands in a review-only capture (kind `review`, no diagrams) on the same timeline
  row; reviewing the same range again reuses it. A later capture of that range draws a capture
  of its own.

  A repository can give its reviews rules of its own; see [Repository rules](#repository-rules).

  When the workspace's branch has an open pull request (found with your own `gh` login), the
  capture shows `PR #N`, and a review of a commit on that branch also reads the pull request:
  its description, whose claims it checks against the code, and the comments reviewers already
  left, so it does not repeat them. The plugin only reads pull requests; it never comments on,
  approves or edits one.
- **Capture:** the Capture button at the top of the panel, or **Debrief: Capture completed
  work** in the command palette, draws the whole branch: from where it left the trunk to the
  working tree, uncommitted changes included. Review next to it reviews the same work without drawing it.
- **Timeline:** the branch's commits, newest first (up to 60), down to where it left the trunk,
  with each capture on the commit it was drawn at. The trunk is the first of `origin/master`,
  `origin/main`, `master` and `main` that the branch has left; on the trunk itself the timeline
  shows recent history. Uncommitted changes sit on top, with their own Capture and Review
  buttons. Each commit has Capture and Review buttons for just that commit. **All captures** lists them without
  the timeline.
- **Between two commits:** open Capture between two commits, pick From and To and press Capture
  range (or Review range). Before is drawn from From, after from To, never from the working tree. The capture
  lands on To's row, with a `from..to` chip.
- **Runs:** each queued or running run shows in the panel with what it is doing now, and when
  it ends, its cost, tokens, turns and time. Log shows its steps; Cancel stops it; Dismiss
  clears a finished one. A failed review has Try again.

Colours say what the work did to each box: green new, yellow changed, white unchanged, grey
removed, dashed outside the codebase. The panel shows one legend above the diagrams and takes
each D2 diagram's own legend out of the picture it shows; the files on disk keep theirs. In
dark mode the panel shows the diagrams in soft dark colours (yellow reads as amber); the files
on disk stay light, for PRs and docs.

## Screenshots

<img src="docs/panel.png" width="320" alt="The Debrief sidebar: Review and Capture at the top, a finished run with its cost, and the branch's timeline with a flow capture and a review-only capture on one commit">

The sidebar on this repository's own branch. At the top are Review and Capture for the whole
branch, then a finished run with its cost, tokens, turns and time. Below that is the timeline:
each commit has its own Review and Capture, and one commit holds a flow capture with a
walkthrough and a review-only capture.

![A review open in an editor tab: the verdict, the range and basis it read, Review again and Copy as Markdown, no findings, and the list of what it also checked](docs/review.png)

A review that found nothing. It still lists what it checked, so "no findings" says what was
looked at.

## Repository rules

Background runs start without CLAUDE.md, so they don't know a repository's conventions. A
repository can commit its own rules for them, in plain Markdown:

| File                  | Read by  | Read at                      | For example                                                    |
| --------------------- | -------- | ---------------------------- | -------------------------------------------------------------- |
| `.debrief/review.md`  | reviews  | the commit before the change | what to look for, paths to skip, what counts as high severity  |
| `.debrief/capture.md` | captures | `HEAD`                       | what to call parts of the system, what to leave out            |

Both are read from git, never from the working tree, so an edit counts once it is committed. A
review reads its rules from before the change, so a branch can't loosen the rules of its own
review. Each file is cut to its first 4,000 characters. The rules can't change where a run
writes, the file formats, the diagram colours or the commands a run may use. When review rules
applied, the review's basis ends with `with .debrief/review.md`.

## How it fits together

```
panel ──Capture──▶ worker ──git──▶ brief.json (range, files, commit ids; no tokens spent)
      ──Review───▶   │      ──gh───▶ open pull request: description, comments (read-only)
                     │
                     ├─ background (default): claude -p, one run at a time
                     │     capture runs: SKILL.md as the system prompt, queued requests batched
                     │     review runs:  REVIEW.md as the system prompt, one capture each
                     └─ idle-agent setting: types the capture prompt into an idle Claude
                                   │
                                   ▼
     .context/debrief/<id>/{*.d2, *.svg, capture.json, walkthrough.debrief.json, review.debrief.json}
                                   │
                     worker watches ◀┘ ──▶ panel timeline, walkthrough editor
```

- `src/git.ts` works out each scope from git: before and after commits, changed files with line
  counts (generated files and lockfiles dropped, at most 300 files), commit subjects and bodies,
  and the `base`/`commit` values the capture must carry. The agent reads this instead of
  exploring. It also reads the timeline and checks that a range's From is an ancestor of its To.
- `src/rules.ts` reads a repository's own run rules (`.debrief/review.md`,
  `.debrief/capture.md`) from git at a commit, never from the working tree, and cuts them to
  4,000 characters.
- `src/pr.ts` finds the branch's open pull request with `gh` and reads its description and
  comments for a review run. It never writes to GitHub.
- `src/jobs.ts` keeps the queue and runs as files in `.context/debrief/.jobs/`, so a run
  outlives the worker. A background run is a headless `claude -p` kept lean, because every turn
  re-reads its whole base context: its instructions go in as the system prompt
  (`--append-system-prompt-file`), with no skill listing (`--disable-slash-commands`), no MCP
  servers (`--strict-mcp-config`), six built-in tools (`--tools`), no CLAUDE.md or memory index
  (`CLAUDE_CODE_DISABLE_CLAUDE_MDS`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY`), read-only git (plus d2
  for captures) in `--allowedTools`, a cost cap, and `--output-format stream-json`, which the
  panel turns into steps, tokens and cost.
- `skills/debrief/` holds the run instructions: `SKILL.md` for captures and walkthroughs,
  `REVIEW.md` for reviews, `references/capture-format.md` for the file formats, the D2
  templates, the house D2 style (a copy of the `d2` skill's `style.d2`) and `scripts/look.sh`,
  which screenshots SVGs with an installed Chrome.
- `src/worker.ts` answers the panel and the walkthrough editor. The only capture it writes is a
  review-only one, so a review can run before anything is drawn. `src/panel.ts` is the sidebar
  (HTML, Orca's colours). `src/editor.ts` is the custom editor for `*.debrief.json` files: a
  walkthrough or a review. It puts each SVG inline (scripts and event attributes removed) so a
  step can dim every D2 box it does not name.
- The file formats: `src/captures.ts` (`capture.json`), `src/walkthrough.ts`, `src/review.ts`,
  and `src/cite.ts`, which cuts cited lines out of git diffs. `src/legend.ts` swaps each
  diagram's own legend for one shared legend; `src/icons.ts` holds the stroke icons.

## Install

Needs macOS or Linux and Orca 1.4.248 or later with plugins on (Settings → Plugins → Turn on
plugins), plus on the same machine: `git`, `d2` (`brew install d2`) and the Claude Code CLI,
signed in (run `claude` once), all on the PATH (`~/.local/bin`, Homebrew and `/usr/local/bin`
are added). Optional: the GitHub CLI `gh`, signed in, for pull requests; Chrome or Chromium,
which runs use to look at what they drew (without it, runs say the diagrams were not looked
at).

1. Install from GitHub, or from a folder holding this plugin:
   ```sh
   orca plugin install https://github.com/mthongvanh/debrief.git --json
   orca plugin install /path/to/debrief --json
   ```
   Orca stops with `approval_required` and lists the access the plugin asks for (below).
2. Read that list, then run the same command again with the fingerprint it printed:
   ```sh
   orca plugin install <same source> --approve <fingerprint> --json
   ```
3. Open **Debrief** in the right sidebar (the book icon).

A Git install takes the newest `vX.Y.Z` tag, else the default branch; `orca plugin update` moves
it forward, asking again only when the plugin asks for new access.

The skill ships inside the plugin and background runs read it from there, so there is nothing
else to install. To also type `/debrief` yourself in a Claude session, link it:
`ln -s <plugin folder>/skills/debrief ~/.claude/skills/debrief`.

Access asked for: read workspaces and agent status, open files in Orca (Open, Source and a
walkthrough's code links, never `.env` or `.git`), a custom editor for `*.debrief.json`, type
into an idle agent's terminal (only with the idle-agent setting), and its own settings. The
worker also reads and writes the captures folder and adds it to `.git/info/exclude` when nothing
ignores it.

## What leaves your machine, and what stays

- **Sent to Anthropic, under your own Claude login:** each background run (capture or review)
  sends the diff and the code it reads to Claude (a review also sends the pull request's
  description and comments, clipped; each run also sends the repository's rules file, when
  there is one), like any Claude Code session, and is billed to you
  (capped by the cost setting, $1 by default). The run cannot read `.env` files (deny rules,
  tested) and has no MCP servers, CLAUDE.md or memory.
- **Stays in the worktree, under `.context/debrief/`** (kept out of Git through
  `.git/info/exclude`): captures (D2 sources, SVGs, `capture.json`, `walkthrough.debrief.json`,
  `review.debrief.json`), and per run a brief, a log
  of every step (code excerpts, file paths, a session id) and look-check screenshots. Run files
  are deleted a week after the run finished; captures stay until you delete them.
- **The plugin itself** holds no keys, accounts or personal data. Its only setting values are
  the ones in Settings → Plugins → Debrief.

GitHub: the sidebar asks `gh pr list` for the branch's open pull request at most once a minute
per workspace; a review makes two more read-only calls (`gh pr view`, and the inline comments
through `gh api`). Without `gh`, or signed out, there is simply no pull request shown.

## Settings

In Settings → Plugins → Debrief.

| Setting                           | Default                     | What it does                                                                                       |
| --------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| Diagram colours                   | Follow Orca                 | Light or dark diagrams in the panel and walkthrough; the files are unchanged.                      |
| Captures folder                   | `.context/debrief`          | Where captures live, relative to the workspace root. Keep it out of Git.                           |
| Who draws a capture               | A background run            | Or an idle Claude already in the workspace, falling back to a background run when none is idle.    |
| Model for background runs         | `sonnet`                    | Passed to `claude --model`.                                                                        |
| Cost cap per background run (USD) | 1                           | Passed to `claude --max-budget-usd`; 0.1 to 20.                                                    |
| Claude command                    | `claude`                    | Run with the workspace as its folder.                                                              |
| GitHub CLI command                | `gh`                        | Finds the branch's open pull request and reads it for reviews.                                     |

## Develop

```sh
orca plugin test . --json
orca plugin validate . --json
orca plugin dev watch . --json
```

Tests sit beside the code as `src/*.test.ts`.

## License

MIT; see [LICENSE](LICENSE). `skills/debrief/templates/_style.d2` is a copy of the house D2
style and keeps its own MIT notice, in `skills/debrief/templates/STYLE-LICENSE`.
