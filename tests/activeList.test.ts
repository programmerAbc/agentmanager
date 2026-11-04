// 运行：node --test tests/activeList.test.ts（Node 24 原生剥离 TS 类型）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ActiveList } from '../src/renderer/activeList.ts'

function clock() {
  let t = 0
  return { now: () => t, tick: (d = 1) => (t += d) }
}

test('开始工作才加入，新加入的排最前，已在其中的不挪位置', () => {
  const c = clock()
  const list = new ActiveList(10, c.now)
  assert.equal(list.update('a', false), false)
  assert.deepEqual(list.ids(), [])
  assert.equal(list.update('a', true), true)
  c.tick()
  list.update('b', true)
  c.tick()
  assert.equal(list.update('a', true), false)
  assert.deepEqual(list.ids(), ['b', 'a'])
})

test('满 10 个时移出静默最久的，不动正在工作的', () => {
  const c = clock()
  const list = new ActiveList(3, c.now)
  for (const id of ['a', 'b', 'c']) {
    list.update(id, true)
    c.tick()
  }
  // a 一直在工作；c 先静默，b 后静默 → c 静默最久
  list.update('c', false)
  c.tick()
  list.update('b', false)
  c.tick()
  list.update('d', true)
  assert.deepEqual(list.ids(), ['d', 'b', 'a'])
})

test('全部在工作时移出最久没有新活动的', () => {
  const c = clock()
  const list = new ActiveList(2, c.now)
  list.update('a', true)
  c.tick()
  list.update('b', true)
  c.tick()
  list.update('a', true) // a 有新活动
  c.tick()
  list.update('c', true)
  assert.deepEqual(list.ids(), ['c', 'a'])
})

test('remove / retain', () => {
  const list = new ActiveList(10, () => 0)
  list.update('a', true)
  list.update('b', true)
  assert.equal(list.remove('a'), true)
  assert.equal(list.remove('a'), false)
  assert.equal(list.retain((id) => id !== 'b'), true)
  assert.deepEqual(list.ids(), [])
})
