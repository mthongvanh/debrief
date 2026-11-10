import { assert, test } from 'orca/testing'
import { isReviewText, parseReview, reviewMarkdown, summarize } from './review.ts'

const finding = (severity: string, title = 'Turn finishes twice') => ({
  severity, confidence: 'confirmed', title,
  failure: 'A turn whose audio plays calls `finish` again in `finally`.',
  why: 'The `finally` block always runs.',
  code: { path: 'lib/a.dart', lines: [10, 14] }
})
const valid = {
  version: 1, kind: 'review', capture: 'c1', createdAt: '2026-11-10T12:00:00Z',
  summary: 'One bug to fix.', basis: 'code reading of a..b; tests not run',
  findings: [finding('low', 'Small'), finding('high', 'Big')],
  checked: ['Retry naming']
}
const parse = (data: unknown) => parseReview(JSON.stringify(data))

test('reads a review, most severe first, and counts it', () => {
  const review = parse(valid)
  assert.deepEqual(review.findings.map((f) => f.title), ['Big', 'Small'])
  assert.equal(review.findings[0].code.show, 'diff')
  assert.ok(!('fix' in review.findings[0]))
  assert.deepEqual(summarize(review), {
    createdAt: valid.createdAt, findings: 2, high: 1, medium: 0, low: 1, summary: valid.summary,
    ...(valid.pr ? { pr: valid.pr.number } : {})
  })
  assert.deepEqual(parse({ ...valid, findings: [], checked: undefined }).findings, [])
})

test('tells a review from a walkthrough', () => {
  assert.equal(isReviewText(JSON.stringify(valid)), true)
  assert.equal(isReviewText('{"version":1,"steps":[]}'), false)
  assert.equal(isReviewText('{'), false)
})

test('names the bad field and keeps findings short', () => {
  assert.throws(() => parse({ ...valid, kind: 'walkthrough' }), /"kind"/)
  assert.throws(() => parse({ ...valid, findings: [finding('urgent')] }), /severity/)
  assert.throws(() => parse({ ...valid, findings: [{ ...finding('high'), confidence: 'maybe' }] }), /confidence/)
  assert.throws(() => parse({ ...valid, findings: [{ ...finding('high'), code: undefined }] }), /findings\[0\]\.code/)
  assert.throws(() => parse({ ...valid, findings: [{ ...finding('high'), code: { path: '.env', lines: [1, 2] } }] }), /\.env/)
  assert.throws(() => parse({ ...valid, findings: [{ ...finding('high'), failure: 'x'.repeat(221) }] }), /keep it to 220/)
  assert.throws(() => parse({ ...valid, findings: Array.from({ length: 11 }, () => finding('low')) }), /keep it to 10/)
  assert.throws(() => parse({ ...valid, createdAt: 'today' }), /createdAt/)
})

test('writes a review as Markdown to paste into a pull request', () => {
  const review = parse({
    ...valid,
    findings: [
      { ...finding('high', 'Big'), fix: 'Return before `finally` runs.' },
      { ...finding('low', 'Gone'), code: { path: 'lib/b.dart', lines: [3, 3], show: 'before' } }
    ],
    checked: ['Retry naming', 'Callers of `play`']
  })
  const base = 'a'.repeat(40)
  const markdown = reviewMarkdown(review, { title: 'Turns finish once', base, commit: `${'b'.repeat(40)}+dirty` })
  assert.equal(markdown, [
    '### Review: Turns finish once',
    '',
    'One bug to fix.',
    '',
    '**1 high · 1 low** · `aaaaaaa..bbbbbbb + uncommitted` · code reading of a..b; tests not run',
    '',
    '1. **Big** (high, confirmed) at `lib/a.dart` lines 10–14',
    '   - What breaks: A turn whose audio plays calls `finish` again in `finally`.',
    '   - Why: The `finally` block always runs.',
    '   - Fix: Return before `finally` runs.',
    '',
    '2. **Gone** (low, confirmed) at `lib/b.dart` line 3 (before the change)',
    '   - What breaks: A turn whose audio plays calls `finish` again in `finally`.',
    '   - Why: The `finally` block always runs.',
    '',
    'Also checked, nothing wrong: Retry naming; Callers of `play`.',
    ''
  ].join('\n'))
  assert.ok(reviewMarkdown(parse({ ...valid, findings: [] }), { title: 'T' }).includes('**No findings** · code reading'))
})
