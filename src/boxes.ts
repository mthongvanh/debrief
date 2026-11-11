// Counts the boxes a capture's diagrams mark as changed or added, read from their .d2 sources.
// The skill owes a walkthrough to every capture with more than one, so the worker uses this to
// flag a capture that skipped it. Pure: no Node or Orca calls here.

/** A capture with more touched boxes than this must have a walkthrough. */
export const WALKTHROUGH_AFTER_BOXES = 1

/** The box classes that mean "this work touched it". A `removed` box is gone, so it does not count. */
const TOUCHED = new Set(['changed', 'added'])
/** Blocks that hold settings, not boxes. */
const SETTINGS_BLOCKS = new Set(['classes', 'vars', 'style'])
/** D2 keywords: a key ending in one sets a property of a box rather than declaring one. */
const KEYWORDS = new Set([
  'label', 'shape', 'icon', 'near', 'width', 'height', 'top', 'left', 'tooltip', 'link', 'direction',
  'constraint', 'source-arrowhead', 'target-arrowhead', 'grid-rows', 'grid-columns', 'grid-gap',
  'vertical-gap', 'horizontal-gap', 'layers', 'scenarios', 'steps', 'title', 'imports'
])

/** `line` with its quoted strings blanked out, so braces, colons, `#` and arrows in labels are ignored. */
const unquoted = (line: string) => line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""')

const isEdge = (key: string) => /<->|->|<-|--/.test(key)

/** The class names in a `class:` value: `changed`, or `[changed; key]`. */
const classNames = (value: string) =>
  value.replace(/[[\]{}]/g, '').split(';').map((name) => name.trim()).filter(Boolean)

/** A box counts when a class of its is changed or added; a legend swatch carries `key` as well. */
const touched = (value: string) => {
  const names = classNames(value)
  return !names.includes('key') && names.some((name) => TOUCHED.has(name))
}

/**
 * The ids of the boxes one .d2 source marks `changed` or `added`, nested ids joined with dots.
 * Edges, their classes such as `changed-line`, and legend swatches (class `key`) are not boxes.
 */
export function touchedBoxes(source: string): string[] {
  // One entry per open block: the box id it belongs to, or null for an edge, a settings block or
  // anything inside one.
  const stack: (string | null)[] = []
  const found = new Set<string>()
  const inBox = () => stack.every((part) => part !== null)
  const idOf = (key: string) => [...stack, ...(key ? [key] : [])].join('.')

  for (const raw of source.split('\n')) {
    const line = unquoted(raw).replace(/(^|\s)#.*$/, '').trim()
    if (line === '') continue
    if (line.startsWith('}')) {
      stack.pop()
      continue
    }
    const colon = line.indexOf(':')
    const key = (colon === -1 ? line.replace(/\{.*$/, '') : line.slice(0, colon)).trim()
    const rest = colon === -1 ? line.slice(key.length) : line.slice(colon + 1)
    const opens = rest.includes('{') && !rest.includes('}')
    const parts = key.split('.')
    const last = parts.at(-1) ?? ''

    let box: string | null = null
    if (inBox() && !isEdge(key) && !key.startsWith('*') && !key.startsWith('...')) {
      if (last === 'class') {
        // `class: changed` inside a box's block, or `a.class: changed`.
        const owner = idOf(parts.slice(0, -1).join('.'))
        if (owner && touched(rest)) found.add(owner)
      } else if (!parts.some((part) => SETTINGS_BLOCKS.has(part)) && !KEYWORDS.has(last)) {
        box = key
        const inline = /\{([^}]*)\}/.exec(rest)?.[1] ?? ''
        const declared = /(?:^|;)\s*class\s*:\s*(\[[^\]]*\]|[^;]+)/.exec(inline)
        if (declared && touched(declared[1])) found.add(idOf(key))
      }
    }
    if (opens) stack.push(box)
  }
  return [...found]
}

/** The boxes a capture's views mark changed or added; a box drawn in both before and after counts once. */
export function capturedBoxes(sources: string[]): string[] {
  return [...new Set(sources.flatMap(touchedBoxes))]
}
