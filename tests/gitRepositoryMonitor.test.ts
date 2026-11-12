import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, rm, writeFile, rename, symlink } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { GitRepositoryMonitor, type MonitorOptions } from '../src/main/gitRepositoryMonitor.ts'
import type { GitSnapshot } from '../src/shared/types.ts'

const exec = promisify(execFile)
const base = path.resolve('.devtest')
const monitors = new WeakMap<object, GitRepositoryMonitor[]>()
const env = { ...process.env }
for (const key of Object.keys(env)) if (/^GIT_/i.test(key)) delete env[key]
async function git(cwd: string, ...args: string[]) {
  return (await exec('git', args, { cwd, env, windowsHide: true })).stdout.trim()
}
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  await mkdir(base, { recursive: true })
  const root = await mkdtemp(path.join(base, 'git-monitor-test-'))
  t.after(async () => {
    for (const monitor of monitors.get(t) ?? []) monitor.dispose()
    // 递归清理严格限定为本测试 mkdtemp 创建的目录。
    assert.equal(path.dirname(root), base)
    assert.ok(path.basename(root).startsWith('git-monitor-test-'))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })
  return root
}
async function init(dir: string, branch = 'main', commit = true) {
  await mkdir(dir, { recursive: true })
  await git(dir, 'init', '-b', branch)
  if (commit) await git(dir, '-c', 'user.name=Monitor Test', '-c', 'user.email=monitor@example.invalid', 'commit', '--allow-empty', '-m', 'fixture')
}
async function waitFor(predicate: () => boolean, timeout = 12000) {
  const end = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > end) throw new Error('等待监控结果超时')
    await delay(30)
  }
}
async function move(from: string, to: string) {
  // Windows 上 Git 子进程 cwd 的瞬时句柄会阻止移动目录；等只读命令完成。
  for (let i = 0; ; i++) {
    try { await rename(from, to); return }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EPERM' || i >= 100) throw err
      await delay(50)
    }
  }
}
function observe(t: { after(fn: () => void): void }, root: string, options: MonitorOptions = {}) {
  let latest: GitSnapshot | undefined
  let count = 0
  const monitor = new GitRepositoryMonitor('fixture-project', root, s => { latest = s; count++ }, options)
  monitors.set(t, [...(monitors.get(t) ?? []), monitor])
  monitor.start()
  return { monitor, snapshot: () => latest!, emissions: () => count,
    ready: () => waitFor(() => latest?.scanState === 'ready') }
}

test('递归发现独立仓库、根仓库、同名目录，普通目录不重复计入；未提交与 detached', async t => {
  const root = await fixture(t)
  await init(root)
  await init(path.join(root, 'a', 'same'))
  await init(path.join(root, 'b', 'same'), 'feature/未提交', false)
  await mkdir(path.join(root, 'ordinary', 'deep'), { recursive: true })
  await git(path.join(root, 'a', 'same'), 'checkout', '--detach')
  const o = observe(t, root, { watch: false })
  await o.ready()
  const rows = o.snapshot().repositories
  assert.deepEqual(rows.map(r => r.relativePath), ['.', 'a/same', 'b/same'])
  assert.equal(rows[0].branch, 'main')
  assert.equal(rows[1].state, 'detached')
  assert.match(rows[1].shortOid!, /^[0-9a-f]{7,}$/)
  assert.equal(rows[2].state, 'unborn')
  assert.equal(rows[2].branch, 'feature/未提交')
})

test('外部 git switch 与 HEAD 原子替换由文件事件更新，dispose 后不再通知', async t => {
  const root = await fixture(t)
  await init(root)
  await git(root, 'branch', 'feature/external')
  const o = observe(t, root, { pollMs: 60000, scanMs: 60000 })
  await o.ready()
  assert.equal(o.snapshot().monitorState, 'watching')
  await git(root, 'switch', 'feature/external')
  await waitFor(() => o.snapshot().repositories[0]?.branch === 'feature/external', 4000)
  const head = path.join(root, '.git', 'HEAD')
  await writeFile(head + '.lock', 'ref: refs/heads/main\n')
  await rename(head + '.lock', head)
  await waitFor(() => o.snapshot().repositories[0]?.branch === 'main', 4000)
  o.monitor.dispose()
  const count = o.emissions()
  await git(root, 'switch', 'feature/external')
  await delay(300)
  assert.equal(o.emissions(), count)
})

test('禁用 watcher 的轮询发现分支、commit 后不再 unborn、仓库增删和根目录恢复', async t => {
  const outer = await fixture(t)
  const root = path.join(outer, 'workspace')
  await init(root, 'main', false)
  const o = observe(t, root, { watch: false, pollMs: 200, scanMs: 500 })
  await o.ready()
  assert.equal(o.snapshot().repositories[0].state, 'unborn')
  await git(root, '-c', 'user.name=Monitor Test', '-c', 'user.email=monitor@example.invalid', 'commit', '--allow-empty', '-m', 'first')
  await waitFor(() => o.snapshot().repositories[0]?.state === 'branch')
  await git(root, 'switch', '-c', 'external-poll')
  await waitFor(() => o.snapshot().repositories[0]?.branch === 'external-poll')
  await init(path.join(root, 'deep', 'new repo'), 'new-branch')
  await waitFor(() => o.snapshot().repositories.some(r => r.relativePath === 'deep/new repo'))
  const moved = path.join(outer, 'moved')
  await move(root, moved)
  await waitFor(() => o.snapshot().scanState === 'error' && o.snapshot().repositories.length === 0)
  await move(moved, root)
  await waitFor(() => o.snapshot().scanState === 'ready' && o.snapshot().repositories.length === 2)
})

test('worktree 与 submodule 的 .git 指针正确读取，common dir 相同不合并', async t => {
  const outer = await fixture(t)
  const source = path.join(outer, 'source')
  const root = path.join(outer, 'workspace')
  await init(source)
  await mkdir(root)
  await git(source, 'worktree', 'add', '-b', 'worktree-a', path.join(root, 'a'))
  await git(source, 'worktree', 'add', '-b', 'worktree-b', path.join(root, 'b'))
  await git(path.join(root, 'a'), '-c', 'protocol.file.allow=always', 'submodule', 'add', source, 'modules/shared')
  const o = observe(t, root, { pollMs: 200, scanMs: 60000 })
  await o.ready()
  assert.deepEqual(o.snapshot().repositories.map(r => [r.relativePath, r.branch]), [
    ['a', 'worktree-a'], ['a/modules/shared', 'main'], ['b', 'worktree-b']
  ])
  await git(path.join(root, 'b'), 'switch', '-c', 'worktree-external')
  await waitFor(() => o.snapshot().repositories.find(r => r.id === 'b')?.branch === 'worktree-external')
  assert.equal(o.snapshot().repositories.find(r => r.id === 'a')?.branch, 'worktree-a')
})

test('HEAD 损坏保留旧分支并报错，恢复后消除错误；packed refs 正常读取', async t => {
  const root = await fixture(t)
  await init(root)
  await git(root, 'pack-refs', '--all')
  const o = observe(t, root, { watch: false, pollMs: 200, scanMs: 60000 })
  await o.ready()
  await writeFile(path.join(root, '.git', 'HEAD'), 'bad-head\n')
  await waitFor(() => o.snapshot().repositories[0]?.state === 'error')
  assert.equal(o.snapshot().repositories[0].branch, 'main')
  await writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  await waitFor(() => o.snapshot().repositories[0]?.state === 'branch')
})

test('Git 不可用明确报错，不把空目录显示为已完成', async t => {
  const root = await fixture(t)
  const o = observe(t, root, { gitExecutable: path.join(root, 'missing-git.exe') })
  await waitFor(() => o.snapshot()?.scanState === 'missing-git')
  assert.equal(o.snapshot().repositories.length, 0)
})

test('不跟随越界 junction，也不把 .gitignore 中的真实子仓库漏掉', async t => {
  const outer = await fixture(t)
  const root = path.join(outer, 'workspace')
  const outside = path.join(outer, 'outside')
  await init(root)
  await init(outside, 'outside-branch')
  await writeFile(path.join(root, '.gitignore'), 'node_modules/\n')
  await init(path.join(root, 'node_modules', 'independent'), 'ignored-repo')
  await symlink(outside, path.join(root, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir')
  const o = observe(t, root, { watch: false })
  await o.ready()
  assert.deepEqual(o.snapshot().repositories.map(r => r.id), ['.', 'node_modules/independent'])
})

test('.git 指针变化会使定位缓存失效；父进程 GIT_* 环境不污染读取', async t => {
  const outer = await fixture(t)
  const first = path.join(outer, 'first')
  const second = path.join(outer, 'second')
  const root = path.join(outer, 'workspace')
  await init(first, 'first-branch')
  await init(second, 'second-branch')
  await mkdir(root)
  const pointer = (dir: string) => 'gitdir: ' + path.join(dir, '.git').split(path.sep).join('/') + '\n'
  await writeFile(path.join(root, '.git'), pointer(first))
  const before = process.env.GIT_DIR
  process.env.GIT_DIR = path.join(second, '.git')
  t.after(() => { if (before === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = before })
  const o = observe(t, root, { watch: false, scanMs: 200 })
  await o.ready()
  assert.equal(o.snapshot().repositories[0].branch, 'first-branch')
  await writeFile(path.join(root, '.git'), pointer(second))
  await waitFor(() => o.snapshot().repositories[0]?.branch === 'second-branch')
})

test('Windows 大写 .GIT 也识别，且不遍历元数据目录', { skip: process.platform !== 'win32' }, async t => {
  const root = await fixture(t)
  await init(root)
  await rename(path.join(root, '.git'), path.join(root, 'metadata-tmp'))
  await rename(path.join(root, 'metadata-tmp'), path.join(root, '.GIT'))
  const o = observe(t, root, { watch: false })
  await o.ready()
  assert.equal(o.snapshot().repositories[0].branch, 'main')
  assert.equal(o.snapshot().scannedDirectories, 1)
})
