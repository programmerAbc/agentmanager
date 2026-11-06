// 运行：node --test tests/agyPlugin.test.ts（Node 24 原生剥离 TS 类型；上报脚本部分需要 Windows 的 cmd.exe 与 curl.exe）
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { AGY_PLUGIN_FILES, AGY_PLUGIN_NAME, agyEvent, writeAgyPlugin } from '../src/main/agyPlugin.ts'

const hooks = JSON.parse(AGY_PLUGIN_FILES['hooks.json'])[AGY_PLUGIN_NAME]
const commandOf = (event: string): string => (hooks[event][0].hooks ?? hooks[event])[0].command
const allCommands = (): string[] => Object.keys(hooks).map(commandOf)

test('hooks.json：只挂状态必需的事件，工具事件只匹配提问 / 申请权限', () => {
  assert.deepEqual(Object.keys(hooks).sort(), ['PostToolUse', 'PreInvocation', 'PreToolUse', 'SessionStart', 'Stop'])
  for (const event of ['SessionStart', 'PreInvocation', 'Stop']) {
    assert.equal(hooks[event].length, 1)
    assert.equal(hooks[event][0].type, 'command')
    assert.equal(hooks[event][0].command, `.\\report.cmd ${event}`)
  }
  for (const event of ['PreToolUse', 'PostToolUse']) {
    assert.equal(hooks[event][0].matcher, 'ask_question|ask_permission')
    assert.equal(hooks[event][0].hooks[0].command, `.\\report.cmd ${event}`)
  }
  // command 里不能有双引号（Go 转义后交给 cmd /c 解析不可靠）
  for (const command of allCommands()) assert.doesNotMatch(command, /"/)
  assert.equal(JSON.parse(AGY_PLUGIN_FILES['plugin.json']).name, AGY_PLUGIN_NAME)
  // 上报脚本只含 ASCII，CRLF 换行
  assert.match(AGY_PLUGIN_FILES['report.cmd'], /^[\x00-\x7f]*$/)
  assert.doesNotMatch(AGY_PLUGIN_FILES['report.cmd'], /[^\r]\n/)
})

test('事件换算', () => {
  assert.deepEqual(agyEvent('SessionStart', '{}'), { agent: 'agy', name: 'SessionStart' })
  assert.deepEqual(agyEvent('PreInvocation', ''), { agent: 'agy', name: 'PreInvocation' })
  assert.deepEqual(agyEvent('Stop', '{"terminationReason":"NO_TOOL_CALL","fullyIdle":true}'), { agent: 'agy', name: 'Stop' })
  assert.deepEqual(agyEvent('Stop', '{"terminationReason":"ERROR"}'), { agent: 'agy', name: 'Stop' })
  assert.deepEqual(agyEvent('Stop', '{"terminationReason":"USER_CANCELED"}'), { agent: 'agy', name: 'Interrupt' })
  assert.deepEqual(agyEvent('Stop', 'not json'), { agent: 'agy', name: 'Stop' })
  assert.deepEqual(agyEvent('SessionEnd', ''), { agent: 'agy', name: 'SessionEnd' })
  const tool = (name: string): string => JSON.stringify({ toolCall: { name, args: {} }, stepIdx: 3 })
  assert.deepEqual(agyEvent('PreToolUse', tool('ask_question')), { agent: 'agy', name: 'PermissionRequest' })
  assert.deepEqual(agyEvent('PreToolUse', tool('ask_permission')), { agent: 'agy', name: 'PermissionRequest' })
  assert.deepEqual(agyEvent('PostToolUse', tool('ask_question')), { agent: 'agy', name: 'PostToolUse' })
  // matcher 之外的工具（或请求体缺工具名）不改变状态
  assert.equal(agyEvent('PreToolUse', tool('run_command')), null)
  assert.equal(agyEvent('PreToolUse', '{}'), null)
  assert.equal(agyEvent('Bogus', '{}'), null)
  assert.equal(agyEvent('Interrupt', '{}'), null)
})

/** 与 agy 相同：工作目录为插件目录，`cmd /c <command>`，stdin 写入事件 JSON */
function runHook(dir: string, command: string, stdin: string, env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', command], { cwd: dir, env })
    let stdout = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout }))
    child.stdin.end(stdin)
  })
}

test('上报脚本：cmd /c 执行，设置了地址才上报，stdout 始终是合法 JSON', { skip: process.platform !== 'win32' }, async () => {
  const received: { url: string; body: string }[] = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push({ url: req.url ?? '', body })
      res.writeHead(204).end()
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  // 目录名带空格和中文，确认相对路径命令不受用户目录影响
  const dir = await mkdtemp(path.join(os.tmpdir(), 'agy plugin 测试-'))
  try {
    await writeAgyPlugin(dir)
    const base = { ...process.env }
    delete base.AGENT_DESK_AGY_URL
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook/x/s1/agy`
    const stopBody = '{"terminationReason":"USER_CANCELED","fullyIdle":true,"lastUserInput":"你好"}'
    const toolBody = '{"toolCall":{"name":"ask_question","args":{}}}'

    for (const [event, body] of [['Stop', stopBody], ['PreToolUse', toolBody]] as const) {
      const command = commandOf(event)
      const quiet = await runHook(dir, command, body, base)
      const loud = await runHook(dir, command, body, { ...base, AGENT_DESK_AGY_URL: url })
      for (const r of [quiet, loud]) {
        assert.equal(r.code, 0)
        const out = JSON.parse(r.stdout)
        assert.deepEqual(out, event === 'PreToolUse' ? { decision: 'allow' } : {})
      }
    }
    assert.deepEqual(received, [
      { url: '/hook/x/s1/agy/Stop', body: stopBody },
      { url: '/hook/x/s1/agy/PreToolUse', body: toolBody }
    ])
  } finally {
    server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
