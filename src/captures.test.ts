import { assert, test } from 'orca/testing'
import { CaptureError, parseCapture, pickWorkspace } from './captures.ts'

const valid = {
  version: 1,
  title: 'Log the session id',
  kind: 'modification',
  summary: 'Socket errors now name the session.',
  createdAt: '2026-11-10T08:00:00Z',
  files: [{ path: 'lib/a.dart', status: 'modified' }],
  views: [
    { role: 'before', title: 'Before', image: 'before.svg', source: 'before.d2' },
    { role: 'after', title: 'After', image: 'after.svg' }
  ]
}
const parse = (data: unknown) => parseCapture('c1', JSON.stringify(data))

test('reads a valid capture and takes the id from the folder', () => {
  const capture = parse(valid)
  assert.equal(capture.id, 'c1')
  assert.equal(capture.views.length, 2)
  assert.equal(capture.views[0].source, 'before.d2')
})

test('a modification needs both a before and an after', () => {
  assert.throws(() => parse({ ...valid, views: [valid.views[1]] }), /modification needs/)
})

test('an addition needs a flow', () => {
  assert.throws(() => parse({ ...valid, kind: 'addition' }), /addition needs a "flow"/)
  const addition = parse({ ...valid, kind: 'addition', views: [{ role: 'flow', title: 'Flow', image: 'flow.svg' }] })
  assert.equal(addition.kind, 'addition')
})

test('a review-only capture has no views, and only it may have none', () => {
  assert.equal(parse({ ...valid, kind: 'review', views: [] }).views.length, 0)
  assert.throws(() => parse({ ...valid, kind: 'review' }), /review capture has no views/)
  assert.throws(() => parse({ ...valid, views: [] }), /at least one view/)
})

test('refuses image paths that leave the capture folder', () => {
  for (const image of ['../x.svg', '/etc/x.svg', 'a\\b.svg']) {
    const views = [{ ...valid.views[0], image }, valid.views[1]]
    assert.throws(() => parse({ ...valid, views }), CaptureError)
  }
  assert.throws(() => parse({ ...valid, views: [{ ...valid.views[0], image: 'x.gif' }, valid.views[1]] }), /image must be/)
})

test('names the bad field', () => {
  assert.throws(() => parseCapture('c1', '{'), /not JSON/)
  assert.throws(() => parse({ ...valid, version: 2 }), /"version"/)
  assert.throws(() => parse({ ...valid, createdAt: 'yesterday' }), /createdAt/)
  assert.throws(() => parse({ ...valid, files: [{ path: 'a', status: 'moved' }] }), /files\[0\]\.status/)
})

const ws = (id: string, branch: string | null, name = id, hostId: string | null = null) => ({ id, name, path: `/w/${id}`, branch, hostId })

test('picks the workspace by branch, then by name, local only', () => {
  const all = [ws('a', 'main'), ws('b', 'feature/x'), ws('c', 'feature/x', 'other'), ws('r', 'feature/y', 'r', 'ssh-1')]
  assert.equal(pickWorkspace({ branch: 'main', displayName: 'zzz' }, all)?.id, 'a')
  assert.equal(pickWorkspace({ branch: 'refs/heads/feature/x', displayName: 'other' }, all)?.id, 'c')
  assert.equal(pickWorkspace({ branch: '', displayName: 'b' }, all)?.id, 'b')
  assert.equal(pickWorkspace({ branch: 'feature/y', displayName: 'r' }, all), null)
  assert.equal(pickWorkspace(null, all), null)
  const orcaLocal = [ws('s', 'someone/feature-x', 'Feature x', 'local'), ws('o', 'main', 'main', 'local')]
  assert.equal(pickWorkspace({ branch: 'someone/feature-x', displayName: 'Feature x' }, orcaLocal)?.id, 's')
})
