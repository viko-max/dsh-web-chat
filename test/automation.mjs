// 项⑤自动化路由 + 项⑥取消/投递竞态 回归（内存测试，虚构数据，无真实 API）。
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
const esbuildBin = path.join(root, 'host-src/node_modules/esbuild/bin/esbuild')
const tmpDir = path.join(root, 'test/.tmp')
mkdirSync(tmpDir, { recursive: true })
const bundlePath = path.join(tmpDir, 'automation-bundle.mjs')

const build = spawnSync(
  node,
  [esbuildBin, path.join(root, 'test/automation-entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundlePath}`, '--log-level=warning'],
  { stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(root, 'host-src/node_modules') } }
)
if (build.status !== 0) { console.error('esbuild 打包失败'); process.exit(1) }

const { createPanelAutomation, automationOp } = await import(pathToFileURL(bundlePath).href)

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS ${name}`) } else { failed++; console.log(`FAIL ${name} ${detail}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const waitFor = async (fn, timeout = 4000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return true
    await sleep(20)
  }
  return false
}

// 内存凭据存储（modifyRecord 返回 undefined 表示不变）
const makeCredentials = () => {
  const records = new Map()
  return {
    readRecord: async (k) => records.get(k),
    modifyRecord: async (k, fn) => {
      const next = fn(records.get(k))
      if (next !== undefined) records.set(k, next)
      return next ?? records.get(k)
    },
    set: async () => {}, resolve: async () => undefined, unset: async () => {}, describe: async () => ({ configured: false }),
  }
}

// 构造模型 SSE 响应（collect 解析 text_delta + message_stop）
const sseResponse = (text) => {
  const frames = [
    `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
  ]
  return new Response(frames.join(''), { headers: { 'content-type': 'text/event-stream' } })
}

const saveTask = (automation, overrides = {}) =>
  automation.handle('automation-save', new Request('http://localhost/x', {
    method: 'POST',
    body: JSON.stringify({ title: 'T', prompt: 'P', session: 's1', next: Date.now() - 1000, every: 0, ...overrides }),
  }))
const list = (automation) => automation.handle('automation-list', new Request('http://localhost/x', { method: 'POST', body: '{}' })).then((r) => r.json())

try {
  // ===== 项⑤ 路由判定 =====
  check('route-default', automationOp({ model: null }) === 'messages')
  check('route-official', automationOp({ model: { provider: 'deepseek-official', model: 'deepseek-flash' } }) === 'messages')
  check('route-custom', automationOp({ model: { provider: 'dswc-chat-abc', model: 'm' } }) === 'model-reply')
  check('route-harness', automationOp({ model: { provider: 'qwen-token-plans', model: 'm' } }) === 'model-reply')
  check('route-spark', automationOp({ model: { provider: 'dswc-spark', model: 'spark-x2.6' } }) === 'model-reply')

  // ===== 项⑥ 正常完成 → 收件箱一条 =====
  {
    const credentials = makeCredentials()
    const automation = createPanelAutomation(credentials, async () => sseResponse('结果A'))
    await saveTask(automation)
    const ok = await waitFor(async () => (await list(automation)).inbox.length === 1)
    const state = await list(automation)
    check('complete-delivers-once', ok && state.inbox.length === 1 && state.inbox[0].text === '结果A' && state.inbox[0].status === 'done', JSON.stringify(state.inbox))
    check('complete-run-id', Boolean(state.inbox[0]?.id) && state.tasks[0].last?.id === state.inbox[0].id)
    automation.dispose()
  }

  // ===== 项⑥ 运行中删除 + 删除后上游仍返回 → 不投递 =====
  {
    const credentials = makeCredentials()
    let release
    const gate = new Promise((r) => (release = r))
    let started = false
    const automation = createPanelAutomation(credentials, async (task, signal) => {
      started = true
      await gate
      if (signal.aborted) throw new Error('aborted')
      return sseResponse('迟到的结果')
    })
    await saveTask(automation)
    await waitFor(() => started)
    const running = await waitFor(async () => (await list(automation)).tasks[0]?.last?.status === 'running')
    check('delete-while-running-setup', running)
    await automation.handle('automation-delete', new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ id: (await list(automation)).tasks[0].id }) }))
    release() // 删除后上游才返回
    await sleep(150)
    const state = await list(automation)
    check('delete-cancel-no-inbox', state.tasks.length === 0 && state.inbox.length === 0, JSON.stringify(state))
    automation.dispose()
  }

  // ===== 项⑥ 运行 ID 去重（同一运行不产生重复收件） =====
  {
    const credentials = makeCredentials()
    const automation = createPanelAutomation(credentials, async () => sseResponse('唯一结果'))
    await saveTask(automation)
    await waitFor(async () => (await list(automation)).inbox.length === 1)
    await sleep(120) // 让可能的额外 tick 运行
    const state = await list(automation)
    const ids = state.inbox.map((i) => i.id)
    check('inbox-unique-run-ids', ids.length === new Set(ids).size && ids.length === 1, JSON.stringify(ids))
    automation.dispose()
  }

  // ===== 项⑥ 上游失败 → 收件箱标记 error 但仍投递（供前端展示失败） =====
  {
    const credentials = makeCredentials()
    const automation = createPanelAutomation(credentials, async () => { throw new Error('boom') })
    await saveTask(automation)
    const ok = await waitFor(async () => (await list(automation)).inbox.length === 1)
    const state = await list(automation)
    check('error-runs-inbox', ok && state.inbox[0].status === 'error', JSON.stringify(state.inbox))
    automation.dispose()
  }
} finally {
  // 各 automation 已在用例内 dispose
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)