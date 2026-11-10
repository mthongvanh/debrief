import { assert, test } from 'orca/testing'
import { isReviewText, parseReview, summarize } from './review.ts'

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
