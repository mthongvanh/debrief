import { readFileSync } from 'node:fs'
import { assert, test } from 'orca/testing'
import { capturedBoxes, touchedBoxes } from './boxes.ts'

const fixture = (path: string) => readFileSync(new URL(`./fixtures/${path}`, import.meta.url), 'utf8')

test('counts the changed and added boxes of a capture that skipped its walkthrough, not its legend or lines', () => {
  // The shape of a capture that a 2026-11-11 run left without a walkthrough "to save budget";
  // labels renamed.
  assert.deepEqual(touchedBoxes(fixture('seven-boxes/flow.d2')).sort(),
    ['btn', 'flags', 'hidden', 'model', 'row', 'sheet', 'store'])
})

test('a before and after that change one box count one, however many lines changed', () => {
  // Its sibling from the same run: only the socket box changed, plus two of its lines.
  const sources = ['before.d2', 'after.d2'].map((name) => fixture(`one-box/${name}`))
  assert.deepEqual(capturedBoxes(sources), ['socket'])
})

test('reads classes set in a block, through a dotted key, and on nested boxes', () => {
  const source = [
    '...@_style',
    'app: "App" {',
    '  class: area',
    '  login: "Log in\\nsignIn" {',
    '    class: changed',
    '  }',
    '  cart: "Cart {beta}" {class: [added]}',
    '  old: "Old" {class: removed}',
    '}',
    'svc: "Service"',
    'svc.class: added',
    'svc -> app.login: "calls {x}" {class: changed-line}',
    '(svc -> app.cart)[0].class: added-line',
    'classes: {',
    '  changed: {style.fill: "#fff"}',
    '}',
    'legend: "" {',
    '  grid-rows: 2',
    '  style: {fill: "#f3f1ea"; stroke-width: 1}',
    '  changed: "" {class: [changed; key]}',
    '  added: "" {class: [added; key]}',
    '}'
  ].join('\n')
  assert.deepEqual(touchedBoxes(source).sort(), ['app.cart', 'app.login', 'svc'])
})
