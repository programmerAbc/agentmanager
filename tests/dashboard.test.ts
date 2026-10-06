import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { JsonlTail } from '../src/main/jsonlTail'
import { applyClaudeStatus, applyCodexLine, emptyDashboard } from '../src/main/dashboardData'
import { AgentDashboardStore } from '../src/main/agentDashboardStore'
import { CODEX_HOOKS_TOML, CODEX_METADATA_COMMAND } from '../src/main/codexHooks'

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentmanager-dashboard-fixture-'))
const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))
async function until(check: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) { if (check()) return; await sleep(20) }
  assert.ok(check(), '等待采集结果超时')
}
const row = (type: string, payload: unknown): string => JSON.stringify({ type, payload }) + '\n'
const counts = { groups: 0 }
try {
  assert.equal(CODEX_HOOKS_TOML.includes('"'), false, 'TOML无双引号，cmd环境变量参数安全')
  assert.equal(CODEX_HOOKS_TOML.split(CODEX_METADATA_COMMAND).length - 1, 2, '只添加两个元数据handler')
  for (const event of ['SessionStart','UserPromptSubmit','PermissionRequest','PostToolUse','Stop']) {
    assert.ok(CODEX_HOOKS_TOML.includes(`command='$null = @($input); curl.exe -s -m 2 -d ${event} $env:AGENT_DESK_HOOK_URL'`), '原有状态handler文本保留')
  }
  if (process.platform === 'win32') {
    let payload: Record<string, unknown> | null = null
    const server = http.createServer((req, res) => {
      const parts: Buffer[] = []
      req.on('data', b => parts.push(b))
      req.on('end', () => { payload = JSON.parse(Buffer.concat(parts).toString('utf8')); res.writeHead(204); res.end() })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const port = (server.address() as { port: number }).port
      await new Promise<void>((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-Command',CODEX_METADATA_COMMAND], {
          windowsHide: true, env: { ...process.env, AGENT_DESK_HOOK_URL: `http://127.0.0.1:${port}/fixture`, CODEX_HOME: root }
        })
        let errors = ''
        child.stderr.on('data', b => errors += b)
        child.on('error', reject)
        child.on('close', code => code ? reject(new Error(errors)) : resolve())
        child.stdin.end(JSON.stringify({ session_id:'fixture',cwd:'D:\\中文目录',model:'fixture-model',permission_mode:'plan',tool_response:'x'.repeat(100000) }))
      })
      assert.equal((payload as Record<string,unknown> | null)?.cwd, 'D:\\中文目录', '真实PowerShell hook不损坏中文')
      assert.equal((payload as Record<string,unknown> | null)?.tool_response, undefined, '不上传工具输出')
    } finally { await new Promise<void>(resolve => server.close(() => resolve())) }
  }
  counts.groups++

  const tailFile = path.join(root, 'unicode.jsonl'), tail = new JsonlTail(), received: unknown[] = []
  const bytes = Buffer.from(JSON.stringify({ title: '会话中文' }) + '\n')
  const cut = bytes.indexOf(Buffer.from('会')) + 1
  await fs.writeFile(tailFile, bytes.subarray(0, cut))
  await tail.read(tailFile, v => received.push(v))
  assert.equal(received.length, 0)
  await fs.appendFile(tailFile, bytes.subarray(cut))
  await tail.read(tailFile, v => received.push(v))
  assert.deepEqual(received, [{ title: '会话中文' }])
  await tail.read(tailFile, v => received.push(v))
  assert.equal(received.length, 1, '没有追加不重复消费')
  await fs.writeFile(tailFile, '{}\n')
  await tail.read(tailFile, v => received.push(v))
  assert.deepEqual(received[1], {}, '截断重置游标')
  await fs.appendFile(tailFile, 'x'.repeat(1024 * 1024 + 20) + '\n{"after":true}\n')
  await tail.read(tailFile, v => received.push(v))
  assert.deepEqual(received[2], { after: true }, '超长行后仍可解析')
  counts.groups++

  const codex = emptyDashboard('codex')
  applyCodexLine(codex, { type: 'turn_context', payload: { cwd: root, model: 'model-fixture', effort: 'high', sandbox_policy: { type: 'workspace-write' }, approval_policy: 'on-request' } })
  applyCodexLine(codex, { type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { total_tokens: 250 } }, rate_limits: { primary: { used_percent: 20, window_minutes: 300, resets_at: 2000000000 }, secondary: { used_percent: 40, window_minutes: 10080 } } } })
  assert.equal(codex.permission, '工作区写入')
  assert.equal(codex.permissionDetail, 'workspace-write / on-request')
  assert.equal(codex.context?.remainingPercent, 75)
  assert.equal(codex.limits.primary?.usedPercent, 20)
  assert.equal(codex.fast, null, '不猜测未提供的Fast')
  applyCodexLine(codex, { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { model: 'changed-model', reasoning_effort: 'xhigh', service_tier: 'fast', permission_profile: { type: 'disabled' }, approval_policy: 'never' } } })
  assert.equal(codex.model, 'changed-model')
  assert.equal(codex.effort, 'xhigh')
  assert.equal(codex.fast, true)
  assert.equal(codex.permission, '完全访问')
  applyCodexLine(codex, { type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { permission_profile: { type: 'unknown-profile' } } } })
  assert.equal(codex.permission, null, '未知新权限不能保留旧完全访问标签')
  applyCodexLine(codex, { type: 'event_msg', payload: { type: 'token_count', info: { model_context_window: 0 }, rate_limits: null } })
  assert.equal(codex.limits.primary?.usedPercent, 20, 'null额度不覆盖最近有效值')
  const claude = emptyDashboard('claude')
  applyClaudeStatus(claude, { cwd: root, session_name: '真实名字', model: { display_name: 'Claude Fixture' }, effort: { level: 'medium' }, context_window: { used_percentage: 35, context_window_size: 200000, current_usage: { input_tokens: 5, cache_read_input_tokens: 20 } }, rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 30 } }, fast_mode: false, cost: { total_cost_usd: 1.2 } })
  assert.equal(claude.context?.remainingPercent, 65)
  assert.equal(claude.context?.usedTokens, 25)
  assert.equal(claude.title, '真实名字')
  assert.equal(claude.cost, 1.2)
  assert.equal(claude.limits.secondary?.windowMinutes, 10080)
  applyClaudeStatus(claude, { context_window: { used_percentage: -1 }, rate_limits: null })
  assert.equal(claude.limits.primary, null, '不适用的订阅额度清空')
  counts.groups++

  const repo = path.join(root, 'repo'), sub = path.join(repo, 'sub')
  await fs.mkdir(sub, { recursive: true })
  execFileSync('git', ['init', '--initial-branch=fixture-main', repo], { windowsHide: true, stdio: 'pipe' })
  const home = path.join(root, 'codex-home'); await fs.mkdir(home)
  const transcript = path.join(root, 'rollout-a.jsonl')
  await fs.writeFile(transcript, row('session_meta', { id: 'a' }) + row('turn_context', { cwd: sub, model: 'A', effort: 'low', sandbox_policy: { type: 'read-only' } }) + row('event_msg', { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { total_tokens: 100 } } }))
  await fs.writeFile(path.join(home, 'session_index.jsonl'), JSON.stringify({ id: 'a', thread_name: '会话 A' }) + '\n')
  const events: [string, unknown][] = []
  const store = new AgentDashboardStore((id, d) => events.push([id, d]))
  store.begin('pty-1', 'codex')
  store.accept('pty-1', 'codex', 'metadata', { session_id: 'a', cwd: sub, model: '实时模型', transcript_path: transcript, codex_home: home })
  await until(() => store.get('pty-1')?.git?.branch === 'fixture-main')
  assert.equal(store.get('pty-1')?.title, '会话 A')
  assert.equal(store.get('pty-1')?.model, '实时模型', '历史turn_context不覆盖实时hook模型')
  assert.equal(store.get('pty-1')?.context?.remainingPercent, 90)
  assert.equal(await fs.realpath(store.get('pty-1')!.git!.root), await fs.realpath(repo))
  const clone = store.get('pty-1')!; clone.title = '篡改'
  assert.equal(store.get('pty-1')?.title, '会话 A', 'getter不泄漏可变对象')
  store.accept('pty-1', 'claude', 'statusline', { session_id: 'wrong-agent', cwd: root })
  assert.equal(store.get('pty-1')?.sessionId, 'a')
  store.begin('pty-2', 'claude')
  store.accept('pty-2', 'claude', 'statusline', { session_id: 'b', cwd: root, session_name: '会话 B', context_window: { used_percentage: 20 } })
  await until(() => store.get('pty-2')?.title === '会话 B')
  assert.equal(store.get('pty-2')?.context?.remainingPercent, 80)
  assert.equal(store.get('pty-1')?.sessionId, 'a', '同目录其他会话不串数据')
  await fs.appendFile(transcript, JSON.stringify({ timestamp: new Date(Date.now() + 1000).toISOString(), type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { cwd: root } } }) + '\n')
  await until(() => { void store.poll(); return store.get('pty-1')?.cwd === root && store.get('pty-1')?.git === null })
  assert.equal(store.get('pty-1')?.git, null, '切到非Git目录立即清掉旧分支')
  counts.groups++

  const bFile = path.join(root, 'rollout-b.jsonl')
  await fs.writeFile(bFile, row('session_meta', { id: 'new-session' }) + row('event_msg', { type: 'token_count', info: { model_context_window: 1000, last_token_usage: { total_tokens: 500 } } }))
  store.accept('pty-1', 'codex', 'metadata', { session_id: 'new-session', cwd: root, transcript_path: bFile, codex_home: home })
  assert.equal(store.get('pty-1')?.context, null, '换会话立即清空旧上下文')
  assert.equal(store.get('pty-1')?.permission, null)
  await until(() => store.get('pty-1')?.context?.remainingPercent === 50)
  await fs.writeFile(bFile, row('session_meta', { id: 'someone-else' }))
  await until(() => { void store.poll(); return store.get('pty-1')?.context === null })
  assert.equal(store.get('pty-1')?.context, null, '不读取其他ID的文件')
  store.clear('pty-1')
  assert.equal(store.get('pty-1'), null)
  store.accept('pty-1', 'codex', 'metadata', { session_id: 'late', cwd: root })
  assert.equal(store.get('pty-1'), null, '停止后迟到上报不重建')
  counts.groups++

  const dbFile = path.join(home, 'state_5.sqlite'), db = new DatabaseSync(dbFile)
  db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, title TEXT)')
  db.prepare('INSERT INTO threads VALUES (?, ?)').run('sqlite-session', '数据库标题')
  db.close()
  const before = await fs.readFile(dbFile)
  const sqliteFile = path.join(root, 'rollout-sqlite.jsonl')
  await fs.writeFile(sqliteFile, row('session_meta', { id: 'sqlite-session' }))
  store.begin('pty-sqlite', 'codex')
  store.accept('pty-sqlite', 'codex', 'metadata', { session_id: 'sqlite-session', transcript_path: sqliteFile, cwd: root, codex_home: home })
  await until(() => store.get('pty-sqlite')?.title === '数据库标题')
  assert.deepEqual(await fs.readFile(dbFile), before, 'SQLite名称来源只读')
  store.begin('pty-race', 'codex')
  store.accept('pty-race', 'codex', 'metadata', { session_id: 'sqlite-session', transcript_path: sqliteFile, cwd: repo, codex_home: home })
  store.clear('pty-race')
  const marker = events.length
  await sleep(100)
  assert.equal(events.slice(marker).some(([id, d]) => id === 'pty-race' && d !== null), false, '停止后旧异步结果不写回')
  store.clearAll(); assert.equal(store.get('pty-2'), null)
  store.stop()
  counts.groups++
  console.log(`Dashboard：${counts.groups}组关键验证通过（JSONL、解析、绑定、换会话、只读与异步清理）`)
} finally { await fs.rm(root, { recursive: true, force: true }) }
