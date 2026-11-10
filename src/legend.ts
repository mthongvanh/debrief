// The one legend the panel and the walkthrough show for every diagram. A D2 diagram draws its own
// legend; these helpers take it out of the picture and say which rows it had, then trim the space
// it held. Browser-only: they work on SVG DOM nodes.
import { d2IdOf } from './walkthrough.ts'

export const LEGEND_KEYS = ['unchanged', 'changed', 'added', 'removed', 'external'] as const
export type LegendKey = (typeof LEGEND_KEYS)[number]
export const LEGEND_LABEL: Record<LegendKey, string> = {
  unchanged: 'Unchanged', changed: 'Changed', added: 'New', removed: 'Removed', external: 'Outside this codebase'
}

/** Light swatch colours, the same as the D2 classes; dark mode filters them like the diagrams. */
export const LEGEND_CSS = `
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12px; color: var(--orca-muted-foreground); }
.legend:empty { display: none; }
.legend .key { display: inline-flex; align-items: center; gap: 6px; }
.legend .sw { width: 14px; height: 10px; border: 1.5px solid #2f3e4e; border-radius: 2px; }
.sw.unchanged { background: #ffffff; } .sw.changed { background: #f8c848; } .sw.added { background: #8cc63f; }
.sw.removed { background: #d9dfe5; } .sw.external { background: #fbfaf6; border-style: dashed; }
.dark-diagrams .legend .sw { filter: invert(.9) hue-rotate(180deg) saturate(1.4); }
`

/**
 * Removes the D2 legend (the `legend` box and everything under it) and the diagram's own paper,
 * since the frame behind it is the paper. Returns the legend rows the diagram had, in legend order.
 */
export function removeLegend(root: ParentNode): LegendKey[] {
  const keys = new Set<LegendKey>()
  for (const node of Array.from(root.querySelectorAll('[class]'))) {
    const id = d2IdOf((node.getAttribute('class') ?? '').split(/\s+/)[0])
    if (id === null || (id !== 'legend' && !id.startsWith('legend.'))) continue
    const key = id.slice('legend.'.length) as LegendKey
    if (LEGEND_KEYS.includes(key)) keys.add(key)
    node.remove()
  }
  const svg = root instanceof SVGSVGElement ? root : root.querySelector('svg')
  const inner = svg?.querySelector('svg') ?? svg
  inner?.querySelector(':scope > rect')?.remove()
  return LEGEND_KEYS.filter((key) => keys.has(key))
}

/**
 * Sets the SVG's view to its drawing plus a margin, so the space a removed legend held goes away.
 * The SVG must be in the page, since only a drawn element can be measured. Returns false when
 * there was nothing to measure.
 */
export function trimToContent(svg: SVGSVGElement, pad = 28): boolean {
  const inner = svg.querySelector('svg') ?? svg
  let box: { x0: number; y0: number; x1: number; y1: number } | null = null
  for (const child of Array.from(inner.children)) {
    if (!(child instanceof SVGGraphicsElement)) continue
    const b = child.getBBox()
    if (b.width === 0 && b.height === 0) continue
    box = box === null
      ? { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height }
      : { x0: Math.min(box.x0, b.x), y0: Math.min(box.y0, b.y), x1: Math.max(box.x1, b.x + b.width), y1: Math.max(box.y1, b.y + b.height) }
  }
  if (box === null) return false
  const x = box.x0 - pad
  const y = box.y0 - pad
  const w = box.x1 - box.x0 + pad * 2
  const h = box.y1 - box.y0 + pad * 2
  inner.setAttribute('viewBox', `${x} ${y} ${w} ${h}`)
  inner.setAttribute('width', String(w))
  inner.setAttribute('height', String(h))
  if (inner !== svg) svg.setAttribute('viewBox', `0 0 ${w} ${h}`)
  return true
}
