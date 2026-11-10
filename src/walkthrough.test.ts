import { assert, test } from 'orca/testing'
import { parseCapture } from './captures.ts'
import { MAX_CITE_LINES, capRows, diffWindow, sliceFile } from './cite.ts'
import { LIMITS, d2IdOf, edgeEnds, isEnvFile, litIds, parseWalkthrough } from './walkthrough.ts'

const valid = {
  version: 1,
  capture: '2026-11-10-gift-cards',
  title: 'How gift cards reach checkout',
  intro: 'Checkout now asks the card service first.',
  figure: { image: 'idea.svg', source: 'idea.d2', caption: 'Redeem, then charge the rest' },
  steps: [
    { title: 'Where it starts', points: ['`placeOrder` runs the steps.'], view: 1, focus: ['place'], code: [{ path: 'src/orders/place_order.ts', lines: [10, 20] }] },
    { title: 'Without a diagram', points: ['Just words.'] }
  ],
  decisions: [
    { decision: 'Redeem before charging', why: 'The card covers part.', evidence: 'stated', source: 'commit message', chosen: 'Redeem first', alternative: 'Charge, then refund', applyElsewhere: 'When a payment source is partial, run it first.' },
    { decision: 'No new service class', why: 'Fits the step list.', evidence: 'inferred', source: 'PaymentStep is reused', figure: { image: 'steps.svg' } }
  ]
}
const parse = (data: unknown) => parseWalkthrough(JSON.stringify(data))

test('reads a valid walkthrough, with defaults for the optional parts', () => {
  const walkthrough = parse(valid)
  assert.equal(walkthrough.steps.length, 2)
  assert.deepEqual(walkthrough.steps[1].focus, [])
  assert.deepEqual(walkthrough.steps[1].code, [])
  assert.equal(walkthrough.steps[0].code[0].show, 'diff')
  assert.equal(walkthrough.decisions[1].figure?.image, 'steps.svg')
  assert.equal(walkthrough.figure?.caption, 'Redeem, then charge the rest')
  assert.deepEqual(parse({ ...valid, decisions: undefined }).decisions, [])
})

test('a parsed cite is plain JSON, so the editor can send it to the worker as is', () => {
  const cites = parse(valid).steps[0].code
  assert.deepStrictEqual(cites, JSON.parse(JSON.stringify(cites)))
  assert.ok(!('note' in cites[0]))
})

test('names the bad field', () => {
  assert.throws(() => parseWalkthrough('{'), /not JSON/)
  assert.throws(() => parse({ ...valid, version: 2 }), /"version"/)
  assert.throws(() => parse({ ...valid, steps: [] }), /at least one step/)
  assert.throws(() => parse({ ...valid, steps: [{ ...valid.steps[0], view: -1 }] }), /steps\[0\]\.view/)
  assert.throws(() => parse({ ...valid, steps: [{ ...valid.steps[0], points: [] }] }), /at least one point/)
  assert.throws(() => parse({ ...valid, decisions: [{ ...valid.decisions[0], evidence: 'guessed' }] }), /stated or inferred/)
  assert.throws(() => parse({ ...valid, decisions: [{ decision: 'x', why: 'y', evidence: 'stated' }] }), /source/)
  assert.throws(() => parse({ ...valid, figure: { image: 'idea.gif' } }), /figure\.image/)
})

test('keeps the text short', () => {
  const long = 'x'.repeat(LIMITS.point + 1)
  assert.throws(() => parse({ ...valid, steps: [{ ...valid.steps[0], points: [long] }] }), /points\[0\]" is 141 characters; keep it to 140/)
  assert.throws(() => parse({ ...valid, steps: [{ ...valid.steps[0], points: ['a', 'b', 'c', 'd', 'e'] }] }), /5 items; keep it to 4/)
  assert.throws(() => parse({ ...valid, intro: 'y'.repeat(LIMITS.intro + 1) }), /"intro"/)
  const cites = [1, 2, 3].map(() => valid.steps[0].code[0])
  assert.throws(() => parse({ ...valid, steps: [{ ...valid.steps[0], code: cites }] }), /code" has 3 items/)
})

test('cites name a line range inside the workspace, never .env or .git', () => {
  const withCite = (cite: unknown) => ({ ...valid, steps: [{ ...valid.steps[0], code: [cite] }] })
  for (const path of ['../x.ts', '/etc/passwd', '.env', 'config/.env.test', '.git/config']) {
    assert.throws(() => parse(withCite({ path, lines: [1, 2] })), /code\[0\]\.path/)
  }
  for (const lines of [[0, 2], [5, 4], [1], [1, 2.5], 'all']) {
    assert.throws(() => parse(withCite({ path: 'a.ts', lines })), /lines/)
  }
  assert.throws(() => parse(withCite({ path: 'a.ts', lines: [1, 41] })), /at most 40/)
  assert.throws(() => parse(withCite({ path: 'a.ts', lines: [1, 2], show: 'both' })), /show/)
  assert.equal(isEnvFile('lib/env.dart'), false)
  assert.equal(isEnvFile('.envrc'), false)
})

test('a capture names its walkthrough file', () => {
  const capture = {
    version: 1, title: 't', kind: 'addition', summary: 's', createdAt: '2026-11-10T08:00:00Z',
    views: [{ role: 'flow', title: 'Flow', image: 'flow.svg' }]
  }
  const read = (walkthrough: unknown) => parseCapture('c1', JSON.stringify({ ...capture, walkthrough }))
  assert.equal(read('walkthrough.debrief.json').walkthrough, 'walkthrough.debrief.json')
  assert.equal(read(undefined).walkthrough, undefined)
  assert.throws(() => read('walkthrough.json'), /\.debrief\.json/)
  assert.throws(() => read('../walkthrough.debrief.json'), /inside the capture folder/)
})

const DIFF = [
  'diff --git a/a.dart b/a.dart',
  '--- a/a.dart',
  '+++ b/a.dart',
  '@@ -10,6 +10,8 @@ class A {',
  '   one();',
  '-  two();',
  '+  measure(',
  '+    two,',
  '+  );',
  '   three();',
  '   four();',
  '   five();',
  '@@ -40,3 +42,4 @@ class A {',
  '   forty();',
  '+  added();',
  '   last();',
  '\\ No newline at end of file'
].join('\n')

test('cuts a diff down to the cited lines of the new file, with deleted lines in place', () => {
  const rows = diffWindow(DIFF, 11, 13, 0)
  assert.deepEqual(rows.map((r) => [r.kind, r.line ?? null, r.text.trim()]), [
    ['deleted', null, 'two();'],
    ['added', 11, 'measure('],
    ['added', 12, 'two,'],
    ['added', 13, ');']
  ])
})

test('marks a jump between hunks as a gap', () => {
  const rows = diffWindow(DIFF, 14, 43, 0)
  assert.deepEqual(rows.map((r) => r.kind), ['context', 'context', 'context', 'gap', 'context', 'added'])
  assert.deepEqual(rows.map((r) => r.line ?? null), [14, 15, 16, null, 42, 43])
})

test('slices a file and caps long citations', () => {
  assert.deepEqual(sliceFile('a\nb\nc\nd', 2, 3), [{ kind: 'context', line: 2, text: 'b' }, { kind: 'context', line: 3, text: 'c' }])
  const many = sliceFile(Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n'), 1, 100)
  assert.equal(capRows(many).rows.length, MAX_CITE_LINES)
  assert.equal(capRows(many).truncated, true)
})

// Class names from `d2` 0.9 output for: box: { a; b; a -> b }, c, box.a -> c
const D2_CLASSES: Record<string, string> = {
  Ym94: 'box',
  'Ym94LmE=': 'box.a',
  'Ym94LmI=': 'box.b',
  'Yw==': 'c',
  'Ym94LihhIC0mZ3Q7IGIpWzBd': 'box.(a -> b)[0]',
  KGJveC5hIC0mZ3Q7IGMpWzBd: '(box.a -> c)[0]'
}

test('decodes the ids D2 writes as group classes, and skips its own classes', () => {
  for (const [className, id] of Object.entries(D2_CLASSES)) assert.equal(d2IdOf(className), id)
  assert.equal(d2IdOf('shape'), null)
  assert.equal(d2IdOf('changed'), null)
})

test('reads both ends of an edge, inside a container too', () => {
  assert.deepEqual(edgeEnds('(box.a -> c)[0]'), ['box.a', 'c'])
  assert.deepEqual(edgeEnds('box.(a -> b)[0]'), ['box.a', 'box.b'])
  assert.deepEqual(edgeEnds('(a <-> b)[2]'), ['a', 'b'])
  assert.equal(edgeEnds('box.a'), null)
})

test('lights the focused boxes, their container, and lines between focused boxes', () => {
  const ids = Object.values(D2_CLASSES)
  assert.deepEqual([...litIds(ids, ['box.a', 'c'])].sort(), ['(box.a -> c)[0]', 'box', 'box.a', 'c'])
  assert.deepEqual([...litIds(ids, ['box'])].sort(), ['box', 'box.(a -> b)[0]', 'box.a', 'box.b'])
  assert.equal(litIds(ids, []).size, 0)
})
