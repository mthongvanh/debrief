import { assert, test } from 'orca/testing'
import { parseContext, parsePrList } from './pr.ts'

const pr = { number: 7, title: 'Seams', url: 'https://github.com/o/r/pull/7', isDraft: true, baseRefName: 'master', headRefName: 'feature/x' }

test('reads the first open pull request, or none', () => {
  assert.deepEqual(parsePrList(JSON.stringify([pr, { ...pr, number: 8 }])), pr)
  assert.equal(parsePrList('[]'), null)
  assert.equal(parsePrList('[{"title":"no number"}]'), null)
})

test('keeps the description, reviews and inline comments, clipped', () => {
  const view = JSON.stringify({
    body: 'b'.repeat(2500),
    reviews: [{ author: { login: 'ddikman' }, body: 'Looks fine' }, { author: { login: 'x' }, body: '' }],
    comments: [{ author: { login: 'ye' }, body: 'c'.repeat(400) }]
  })
  const inline = JSON.stringify([{ user: { login: 'rex' }, body: 'Double finish?', path: 'lib/a.dart', line: null, original_line: 12 }])
  const context = parseContext(pr, view, inline)
  assert.equal(context.body.length, 2003)
  assert.deepEqual(context.comments[0], { author: 'rex', body: 'Double finish?', path: 'lib/a.dart', line: 12 })
  assert.deepEqual(context.comments.map((c) => c.author), ['rex', 'ddikman', 'ye'])
  assert.equal(context.comments[2].body.length, 303)
  assert.deepStrictEqual(context, JSON.parse(JSON.stringify(context)))
})
