---
name: debrief
description: >-
  Capture finished work as D2 diagrams for the Orca "Debrief" panel: a before and an after
  diagram on the same layout for code whose behaviour changed, and a flow diagram for new code
  showing where it joins the existing flow, plus a walkthrough of how the change runs step by
  step, with its code, and the design decisions behind it. Use when the user runs /debrief (often
  with brief=<path> from the panel), presses Capture in the panel, or asks to "capture",
  "visualise" or "draw what was done", or for "a before and after of this change". Writes only
  under the captures folder; never edits code, commits or pushes.
argument-hint: "[brief=<path> | <from>..<to> | <sha> | uncommitted | a topic]"
---

# Debrief

Draw each finished change as a capture: a folder of D2 sources, their SVGs, a walkthrough and a
`capture.json` written last. The panel lists them on a commit timeline. Everything needed is in this file; read
`references/capture-format.md` only when a `capture.json` is refused.

## 1. Scope

**With `brief=<path>`** (the panel sends this): read that JSON and nothing else to scope. It has
`capturesDir`, `skillDir`, `lookDir` and `scopes[]`. Each scope gives `before` and `after` (full
shas; `after` may be `working-tree`), `capture.base` / `capture.commit` to copy into
`capture.json` exactly, `commits` (subjects: the intent; bodies, when present: the why), and `files` with status and line counts,
generated files already removed, and `existing`: capture folders already drawn for this range.
Check an existing capture against the diff and fix only what is wrong, in its folder; leave it
alone when it is right. Do not run git to re-derive any of it.

**Without a brief**, work it out:

| Argument            | before            | after              | capture base / commit                 |
| ------------------- | ----------------- | ------------------ | ------------------------------------- |
| `<from>..<to>`      | `<from>`          | `<to>`             | full shas of both                     |
| one sha             | its parent        | that commit        | parent / commit                       |
| `uncommitted`       | `HEAD`            | working tree       | `HEAD` / `HEAD+dirty`                 |
| none, or a topic    | branch base       | working tree       | base / `HEAD` (`+dirty` if uncommitted) |

Branch base: `git merge-base HEAD origin/master` (or `origin/main`). Files:
`git diff --name-status -M <before> [<after>]`. Captures folder: `.context/debrief`; skill
folder: the folder holding this file.

In a background run only these shell commands are allowed: read-only `git` (`show`, `diff`,
`log`, `rev-parse`, `ls-files`, `grep`, `cat-file`), `d2`, `mkdir`, `cp`, `ls`, `cd`, `wc`,
`file`, `diff`, `echo` and `look.sh`; read files with Read and search with Grep. `.env` files
are off limits. Write every file with the Write tool and change it with Edit; heredocs
and `>` redirects are refused there.

Then, either way: read old code with `git show <before>:<path>` and new code with
`git show <after>:<path>` (or the file itself when after is the working tree). Read only the files
the change is about; the line counts say where the weight is. If a capture in the captures folder
already has the same `base` and `commit`, redraw it in its folder.

## 2. Split and classify

One capture per behaviour a reviewer would name ("gift cards now pay part of an order"), at most
three per scope. Skip copy, formatting, renames, dependency bumps and config-only changes; say so.

- **modification** (existing behaviour changed, including a refactor): views `before` + `after`.
- **addition** (new path, screen, service): one view, `flow`.

Pick the diagram from the question: flow for branches and outcomes, sequence for who calls whom
in order, state machine for a lifecycle, component for structure. Before and after use the same
type.

## 3. Draw

Folder `<capturesDir>/<yyyy-mm-dd>-<slug>/` (today's date, slug from the behaviour, at most 40
characters). Copy `<skillDir>/templates/_style.d2` and `_classes.d2` in, then start from the
template that fits (`before.d2`, `after.d2`, `flow.d2`). The templates draw a made-up shop:
replace every box; nothing from them may reach a capture.

Each file starts `...@_style` then `...@_classes`. Colour by what the work did, using only these
classes:

| Box class   | Line class     | Look                        | Legend row            |
| ----------- | -------------- | --------------------------- | --------------------- |
| `unchanged` |                | white                       | Unchanged             |
| `changed`   | `changed-line` | yellow                      | Changed by this work  |
| `added`     | `added-line`   | green                       | New in this work      |
| `removed`   | `removed-line` | grey italic / grey dashed   | Removed by this work  |
| `external`  |                | dashed pale (other systems) | Outside this codebase |
| `area`      |                | containers, no legend row   |                       |

A line gets a class only when the line is the change (new call, new target, a label that now says
something else). Keep the template's legend, delete rows the diagram does not use, and set
`grid-rows` to the rows left. If the legend lands on edges, add `near: top-right`.

**Before and after are one picture drawn twice**; the panel flips between them in place. Same
type, `direction`, node ids, nesting and declaration order: write `after.d2` by copying
`before.d2` and changing only what the work changed. A box is `changed` (in both files) only when its own code changed;
when only the calls into it changed, colour those lines and leave the box `unchanged`. One only
in after is `added`, only in before `removed`. Keep a changed label near its old length,
or the layout shifts.

**A flow shows where new code joins**: the existing entry point (`unchanged`), the existing code
edited to call the new path (`changed`), the new path and its outcomes (`added`), including the
failure branch; other systems `external`.

Readable at 850 px: at most about 15 boxes, `direction: down`, three or four words per label, a
label on every edge. Real names go on a second line: `"Redeem gift card\nredeemCard"`. Keep
labels to ASCII plus `·`.

## 4. Render and look

In the capture folder, per view:

```sh
d2 fmt before.d2 && d2 before.d2 before.svg
```

d2 prints `file:line:col: message` on errors. Then look once at all views together:

```sh
<skillDir>/scripts/look.sh <lookDir> before.svg after.svg
```

It prints each PNG's path and the text size at 850 px. Read the PNGs. Fix colliding edge labels,
a legend on edges, text under about 60 %, and for a modification any box that moved between
before and after. Re-render only what you fixed; one look after fixes is enough. No Chrome: say
the diagrams were not looked at.

## 5. Walkthrough

Write `walkthrough.debrief.json` in the capture folder: a guided tour for a reader who did not do the
work, opened in a full editor tab. It answers how the change runs step by step, and which
choices are worth copying or questioning.

**Short and concrete.** Points, not paragraphs: one idea per point, `backticks` around code names.
The editor refuses text over its limits (point 140 characters, at most 4 points a step, `why`
160) and says which field to cut. Show, then say: cite the code a point is about.

```json
{
  "version": 1, "capture": "<capture folder>", "title": "How <the behaviour> works",
  "intro": "One sentence: the idea to hold on to.",
  "figure": { "image": "idea-turn.svg", "source": "idea-turn.d2", "caption": "..." },
  "steps": [{ "title": "...", "points": ["...", "..."], "view": 1, "focus": ["ctrl"], "code": [{ "path": "lib/x.dart", "lines": [88, 96], "note": "..." }] }],
  "decisions": [{ "decision": "...", "why": "...", "evidence": "stated", "source": "...", "chosen": "...", "alternative": "...", "applyElsewhere": "When ..., ...", "code": { "path": "...", "lines": [1, 9], "show": "after" } }]
}
```

- **Code cites** name lines; the editor reads them from git at the capture's commits, so never
  paste code. `show`: `diff` (default; lines in the after file, shown with the removed lines),
  `after` or `before` (lines in that file). Get numbers with `git grep -n <text> <sha> -- <path>`
  and cite 3 to 15 lines around the point, at most 40. A step takes up to two cites.
- **Steps, 3 to 6,** in the order the code runs, entry point first. `view` is an index into
  `views` (0-based); `focus` lists node ids from that view's `.d2`, and the editor dims the rest.
  End with what is not done yet or what to check.
- **Decisions, 2 to 4:** choices a reader would copy or push back on. `stated` only when a commit
  body, a comment or a doc says so; quote a few words in `source`. Otherwise `inferred`, and
  `source` names the code that shows it. `chosen` and `alternative` (a few words each) only when
  the alternative is named or visible, such as an existing helper or pattern the change did not
  use (grep for one before saying none exists). `applyElsewhere` is a rule for next time, not
  praise.
  Give each decision a cite or a figure.
- **Idea figures, at most 2,** for an idea a reader cannot see in one place: the shape of a
  whole flow (`figure` on the walkthrough), or chosen against not chosen (`figure` on a
  decision). Start from `<skillDir>/templates/idea.d2`; file names start `idea-`. Render and look
  at them with the views.

Paths are workspace-relative; never `.env` files. Skip the walkthrough only for a capture with
one box changed; say so in the report.

## 6. capture.json, last

```json
{
  "version": 1,
  "title": "Gift cards pay part of an order",
  "kind": "modification",
  "summary": "One or two plain sentences: what changed, for whom.",
  "createdAt": "<ISO 8601 now>",
  "base": "<capture.base>",
  "commit": "<capture.commit>",
  "basis": "code reading of <before>..<after>; <tests run, or not run>",
  "files": [{ "path": "src/orders/place_order.ts", "status": "modified" }],
  "views": [
    { "role": "before", "title": "Before", "image": "before.svg", "source": "before.d2", "caption": "What to look at." },
    { "role": "after", "title": "After", "image": "after.svg", "source": "after.d2", "caption": "The yellow line now ..." }
  ],
  "walkthrough": "walkthrough.debrief.json"
}
```

`kind` is `modification` (needs before and after) or `addition` (needs `flow`). File status:
`added`, `modified`, `deleted`, `renamed`. Paths stay inside the folder. Be honest in `basis`.

## 7. Report

One line per capture (title, kind, folder, walkthrough or not) and what you skipped and why. Do not paste diagrams.
