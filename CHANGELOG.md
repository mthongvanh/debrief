# Changelog

What changed in each version of Debrief. Orca installs the newest `vX.Y.Z` tag, and the
manifest's `version` matches it. Add to **Unreleased** as you go; a release renames it.

## Unreleased

## 0.2.0 - 2026-11-11

### Added

- **Whole diff of cited code.** Every cited block in a walkthrough or a review has a **±**
  button next to **Open**. It shows the file's whole diff across the capture's range in a
  dialog, scrolled to the cited lines with them marked. Orca doesn't let a plugin open its own
  diff view, so Debrief draws it.
- **Notes for the agent.** In that dialog, click a line number to leave a note on the line, or
  shift-click to note a range. Notes show under their lines, the **±** button counts them, and
  they're kept in the capture's `notes.json`. Hand off every note not handed off yet with:
  - **Copy notes**: the notes as Markdown on the clipboard, each under the code it quotes.
  - **Start Claude with notes**: writes them to `notes-<time>.md` in the capture folder and
    starts a new Claude in a terminal tab of the workspace to work through them.

  Debrief never types into an agent that's already running.

### Changed

- Debrief asks for one more permission, `agent:launch` ("Start agents in your workspaces"),
  used only by **Start Claude with notes**. Updating from 0.1.0 needs your approval again.
- Copying, for notes and a review's **Copy as Markdown**, goes through the plugin's worker
  (`pbcopy` on macOS, `clip` on Windows, `wl-copy`, `xclip` or `xsel` on Linux). The editor's
  frame has no clipboard access of its own. The old fallback could report "Copied" without
  copying, inside a dialog every time. When the clipboard can't be written, Debrief now says
  why and shows the text to copy by hand.

## 0.1.0 - 2026-11-10

First release.

- Captures draw what an agent finished as D2 diagrams in a sidebar panel. Changed behaviour
  gets before and after diagrams on one layout. New code gets a flow or sequence diagram.
- Walkthroughs open in an editor tab. They step through the diagrams in the order the code
  runs, beside the cited code. They also lay out the design decisions behind the change.
- Code review runs in the background on a capture, a commit, a range or uncommitted changes,
  with or without a capture first. It reads the pull request and the repository's own review
  rules, and checks each finding before keeping it.
- A timeline of the branch's commits, with a capture or review per commit or range.
- **Copy as Markdown** for a review.
