# capture.json

One file per capture folder, written after every image it names exists. The Orca panel refuses a
file that breaks a rule below and shows the reason above the list, so fix and rewrite it.

| Field       | Type                       | Rule                                                                        |
| ----------- | -------------------------- | --------------------------------------------------------------------------- |
| `version`   | `1`                        | required                                                                    |
| `title`     | string                     | required; the behaviour, as a reviewer would name it                        |
| `kind`      | `modification`, `addition` | required; `review` is the plugin's own review-only capture, never drawn     |
| `summary`   | string                     | required; one or two plain sentences: what changed for whom                 |
| `createdAt` | ISO 8601 string            | required; the panel sorts newest first                                      |
| `commit`    | string                     | full SHA of HEAD when drawn (`git rev-parse HEAD`), plus `+dirty` if uncommitted work was drawn; the panel shows 9 characters |
| `base`      | string                     | full SHA the before views were read from; with `commit`, places the capture on the panel's timeline |
| `basis`     | string                     | what the diagrams rest on, and what was not run                             |
| `files`     | `{path, status}[]`         | `status`: `added`, `modified`, `deleted` or `renamed`; tests included       |
| `views`     | view[]                     | required; a modification needs a `before` and an `after`, an addition a `flow` |
| `walkthrough` | string                   | optional; the walkthrough file in the folder, ending in `.debrief.json`          |

A view:

| Field     | Rule                                                                  |
| --------- | --------------------------------------------------------------------- |
| `role`    | `before`, `after` or `flow`                                           |
| `title`   | short, shown above the image                                          |
| `caption` | optional; one sentence under the image: what to look at               |
| `image`   | path inside the folder: `.svg` (preferred), `.png`, `.jpg` or `.webp` |
| `source`  | optional; the `.d2` file, opened by the panel's Source button         |

Paths are relative to the capture folder, with no `..`. The panel pairs the first `before` with
the first `after`, the second with the second, and so on; `flow` views and unpaired views follow.
Two pairs suit a change that touches two separate paths.

## Example

A made-up shop, to show the shape only. Every value in a real capture comes from the repo.

```json
{
  "version": 1,
  "title": "Gift cards pay part of an order",
  "kind": "modification",
  "summary": "Placing an order now redeems a gift card first and charges the card provider only for the rest. The manual check on big orders is gone.",
  "createdAt": "2026-11-10T09:12:00Z",
  "commit": "4f1c2a9e0b7d3c58a6e2f1b0c9d8e7f6a5b4c3d2",
  "base": "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d",
  "basis": "code reading of 9e8d7c6..4f1c2a9; unit tests pass, not tried in the app",
  "files": [
    { "path": "src/orders/place_order.ts", "status": "modified" },
    { "path": "src/giftcards/redeem.ts", "status": "added" },
    { "path": "src/orders/manual_check.ts", "status": "deleted" },
    { "path": "test/orders/place_order.test.ts", "status": "modified" }
  ],
  "views": [
    { "role": "before", "title": "Before", "image": "before.svg", "source": "before.d2",
      "caption": "Every order charged the full total; big orders waited for a manual check." },
    { "role": "after", "title": "After", "image": "after.svg", "source": "after.d2",
      "caption": "The green line is the new redeem step; the yellow line now charges only the rest." }
  ]
}
```

## walkthrough.debrief.json

The walkthrough editor refuses a file that breaks a rule and shows the reason at the top of its
tab. Lists may be left out, except `steps` and each step's `points`.

| Field         | Rule                                                                                  |
| ------------- | ------------------------------------------------------------------------------------- |
| `version`     | `1`                                                                                   |
| `capture`     | the capture folder's name; its views are the diagrams the steps show                  |
| `title`, `intro` | non-empty; at most 70 and 200 characters                                           |
| `figure`      | optional `{image, source?, caption?}`, image inside the capture folder                |
| `steps`       | 1 to 8 `{title, points, view?, focus?, code?}`; 1 to 4 points of at most 140 characters; `view` is a 0-based index into `views`; `focus` is D2 node ids; at most 2 cites |
| `decisions`   | at most 5 `{decision, why, evidence, source, chosen?, alternative?, applyElsewhere?, figure?, code?}`; `evidence` is `stated` or `inferred` |

A cite is `{path, lines: [first, last], show?, note?}`: at most 40 lines; `show` is `diff`
(default: lines of the after file, with the removed lines), `after` or `before`. The editor reads
the lines from git at the capture's `base` and `commit` (the working tree for a `+dirty` commit);
a `diff` cite with no change in its lines shows the after file instead.

Paths are relative to the workspace root, with no `..`, never under `.git` and never a `.env`
file. Backticks in any text mark code names. A focus id is the full D2 id (`box.inner` for a box
nested in `box`); edges between two focused boxes light up too, and the legend always stays.

## review.debrief.json

Written by a review run (`REVIEW.md`) beside `capture.json`; the panel counts its findings and
the walkthrough editor shows it. `{version: 1, kind: "review", capture, createdAt, summary,
basis, findings, checked?}`. Each finding is `{severity: high|medium|low, confidence:
confirmed|plausible, title, failure, why, fix?, code}`, where `code` is a cite as above. At most
10 findings and 6 `checked` entries; title 90 characters, failure and why 220, fix 160.
