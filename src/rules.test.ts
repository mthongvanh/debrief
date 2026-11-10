import { assert, test } from 'orca/testing'
import { MAX_RULES_CHARS, clipRules } from './rules.ts'

test('keeps a short rules file whole and says nothing for an empty one', () => {
  assert.deepEqual(clipRules('.debrief/review.md', 'abc', '\n- Skip lib/l10n/\n\n'), { path: '.debrief/review.md', from: 'abc', text: '- Skip lib/l10n/' })
  assert.equal(clipRules('.debrief/review.md', 'abc', '  \n\n'), undefined)
})

test('cuts a long rules file at a line break and marks it', () => {
  const line = `- ${'x'.repeat(98)}\n`
  const rules = clipRules('.debrief/review.md', 'abc', line.repeat(60))
  assert.equal(rules?.truncated, true)
  assert.ok((rules?.text.length ?? 0) <= MAX_RULES_CHARS)
  assert.ok(rules?.text.endsWith('x'))
  assert.equal(rules?.text.split('\n').length, Math.floor(MAX_RULES_CHARS / line.length))
})
