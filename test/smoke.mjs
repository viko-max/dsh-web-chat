// 重建等价冒烟测试：用最小 Cordis ctx mock 分别驱动原版与重建版 bundle，
// 执行同一请求矩阵并对比响应（规范化随机 ID 后逐字段比较）。
// 用法：node test/smoke.mjs [--solo <bundlePath> --demo <dir>]
import { cpSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const workspace = path.dirname(root)

const ORIGINAL = path.join(workspace, '_inspect/dsh-web-chat/package/lib/index.js')
const ORIGINAL_DEMO = path.join(workspace, '_inspect/dsh-web-chat/package/demo')
const REBUILT = path.join(root, 'host-src/dist/lib/index.js')
const REBUILT_DEMO_SRC = path.join(root, 'official-demo/dist')
const REBUILT_DEMO = path.join(root, 'host-src/dist/demo')

function makeCtx() {
  const disposers = []
  const routes = []
  const records = new Map()
  const keys = new Map()
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    },
    credentials: {
      async resolve(name) {
        return keys.has(name) ? { value: keys.get(name) } : undefined
      },
      async describe(name) {
        return { configured: keys.has(name) }
      },
      async set(name, value) {
        keys.set(name, value)
      },
      async unset(name) {
        keys.delete(name)
      },
      async readRecord(key) {
        return records.get(key)
      },
      async modifyRecord(key, fn) {
        // 官方语义：mutate 返回 undefined 表示保持不变（非删除）
        const next = await fn(records.get(key))
        if (next !== undefined) records.set(key, next)
        return next ?? records.get(key)
      },
      async deleteRecord(key) {
        records.delete(key)
      },
    },
    llm: {
      listProviders() {
        return [{ id: 'mock-provider', name: 'Mock' }]
      },
      async listModels() {
        return [{ id: 'mock-model', name: 'Mock Model' }]
      },
      async *stream() {
        yield { type: 'text-delta', index: 0, text: '你好' }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    sessionController: {
      async create() {
        return { sessionId: 'mock-session' }
      },
      async selectModel() {},
      async prompt() {},
      async cancel() {},
      async wait() {
        return { state: { cursor: 0 }, output: { records: [], truncated: false } }
      },
      async events() {
        return { records: [] }
      },
    },
    workspaceRegistry: {
      list() {
        return []
      },
      get() {
        return undefined
      },
    },
  }
  return { ctx, routes, disposers, keys }
}

const normalize = (text) =>
  text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/"id":"[^"]*"/g, '"id":"<id>"')

async function runMatrix(bundlePath, demoDir) {
  const module = await import(pathToFileURL(bundlePath).href)
  if (typeof module.apply !== 'function') throw new Error('bundle 缺少 apply 导出')
  const { ctx, routes, disposers, keys } = makeCtx()
  await module.apply(ctx)
  if (routes.length !== 1) throw new Error(`期望 1 条路由，实际 ${routes.length}`)
  const handler = routes[0].fetch
  const base = 'http://localhost/api/dsh-web-chat-panel'
  const results = []

  const call = async (name, method, query, body, headers = {}) => {
    const init = { method, headers: { ...headers } }
    if (body !== undefined) {
      init.body = JSON.stringify(body)
      init.headers['content-type'] = 'application/json'
    }
    const response = await handler(new Request(`${base}?${query}`, init))
    const text = await response.text()
    results.push({
      name,
      status: response.status,
      contentType: response.headers.get('content-type'),
      body: normalize(text).slice(0, 2000),
    })
  }

  try {
    await call('static-index', 'GET', 'asset=index.html')
    await call('static-traversal', 'GET', 'asset=../package.json')
    await call('static-missing', 'GET', 'asset=nope.js')
    await call('status-nokey', 'POST', 'op=status', {})
    keys.set('DEEPSEEK_API_KEY', 'sk-test')
    await call('status', 'POST', 'op=status', {})
    await call('models', 'POST', 'op=models', {})
    await call('apps-status', 'POST', 'op=apps-status', {})
    await call('image-options', 'POST', 'op=image-options', {})
    await call('service-key-status', 'POST', 'op=service-key-status', {})
    await call('automation-list', 'POST', 'op=automation-list', {})
    await call('unknown-op', 'POST', 'op=bogus', {})
    await call('agent-options', 'POST', 'op=agent-options', {})
    await call('model-reply', 'POST', 'op=model-reply', {
      panelProvider: 'mock-provider',
      model: 'mock-model',
      messages: [{ role: 'user', content: '测试' }],
    })
    await call('model-reply-unknown', 'POST', 'op=model-reply', {
      panelProvider: 'nope',
      model: 'nope',
      messages: [{ role: 'user', content: '测试' }],
    })
    // 自动化 CRUD
    await call('automation-save', 'POST', 'op=automation-save', {
      title: '冒烟任务',
      prompt: '测试指令',
      instructions: '',
      session: 'smoke-session',
      next: Date.now() + 3600000,
      every: 60,
    })
    const listResponse = await handler(new Request(`${base}?op=automation-list`, { method: 'POST', body: '{}' }))
    const taskList = await listResponse.json()
    const taskId = taskList.tasks[0]?.id
    results.push({ name: 'automation-list-after-save', status: 200, contentType: 'application/json', body: normalize(JSON.stringify({ count: taskList.tasks.length, hasId: Boolean(taskId) })) })
    if (taskId) {
      await call('automation-toggle', 'POST', 'op=automation-toggle', { id: taskId })
      await call('automation-delete', 'POST', 'op=automation-delete', { id: taskId })
    }
    // Agent 移交流程（mock sessionController）
    await call('agent-create', 'POST', 'op=agent-create', {})
    await call('agent-send', 'POST', 'op=agent-send', {
      sessionId: 'mock-session',
      requestId: 'req-smoke-1',
      text: '测试任务',
    })
    await call('agent-state', 'POST', 'op=agent-state', { sessionId: 'mock-session' })
    // file-delete 非法 ID 校验（不触发网络）
    await call('file-delete-invalid', 'POST', 'op=file-delete', { id: '../bad' })
  } finally {
    for (const dispose of disposers) {
      try {
        await dispose()
      } catch {}
    }
  }
  return { name: module.name, inject: module.inject, results }
}

const soloIndex = process.argv.indexOf('--solo')
if (soloIndex !== -1) {
  const bundlePath = process.argv[soloIndex + 1]
  const demoIndex = process.argv.indexOf('--demo')
  const demoDir = demoIndex !== -1 ? process.argv[demoIndex + 1] : undefined
  const report = await runMatrix(bundlePath, demoDir)
  console.log(JSON.stringify(report, null, 2))
} else {
  // 重建版的 serve() 相对 bundle 位置读 ../demo，先把面板产物布过去
  mkdirSync(path.dirname(REBUILT_DEMO), { recursive: true })
  cpSync(REBUILT_DEMO_SRC, REBUILT_DEMO, { recursive: true })
  const original = await runMatrix(ORIGINAL, ORIGINAL_DEMO)
  const rebuilt = await runMatrix(REBUILT, REBUILT_DEMO)
  let failures = 0
  // 有意变更：错误文案更新（Phase 1 引入自定义服务商后措辞调整），仅比状态码
  const intentionalDiffs = new Set(['model-reply-unknown'])
  console.log(`plugin name: original=${original.name} rebuilt=${rebuilt.name}`)
  console.log(`inject: ${JSON.stringify(original.inject)} vs ${JSON.stringify(rebuilt.inject)}`)
  if (JSON.stringify(original.inject) !== JSON.stringify(rebuilt.inject)) failures++
  for (let i = 0; i < original.results.length; i++) {
    const a = original.results[i]
    const b = rebuilt.results[i]
    // 静态资源内容随面板构建不同而不同，只比状态与类型
    // image-options：预设合并为 4 家（混元不再拆分）+ custom 字段（有意变更）：
    // 校验原有 4 个提供商 id 齐全、含 ready/custom 字段；service-key-status 键集合一致
    let bodySame = a.body === b.body
    if (a.name === 'image-options') {
      try {
        const originalOptions = JSON.parse(a.body)
        const rebuiltOptions = JSON.parse(b.body)
        // id 在规范化时被抹去，按名称比对；混元更名为「腾讯混元 / TokenHub」
        const baseNames = ['千问', '火山引擎', '硅基流动']
        bodySame =
          baseNames.every((n) => rebuiltOptions.some((e) => e.name === n && typeof e.ready === 'boolean' && typeof e.custom === 'boolean')) &&
          rebuiltOptions.some((e) => String(e.name).startsWith('腾讯混元') && typeof e.ready === 'boolean') &&
          rebuiltOptions.filter((e) => !e.custom).length === 4 &&
          originalOptions.length === 4
      } catch {
        bodySame = false
      }
    }
    if (a.name === 'service-key-status') {
      try {
        bodySame = JSON.stringify(JSON.parse(a.body)) === JSON.stringify(JSON.parse(b.body))
      } catch {
        bodySame = false
      }
    }
    const same =
      a.name === b.name &&
      a.status === b.status &&
      a.contentType === b.contentType &&
      (a.name.startsWith('static-') || intentionalDiffs.has(a.name) || bodySame)
    // file-delete 为重建版新增 op：原版 404、重建版 400，均属拒绝非法请求
    const fileDeleteOk = a.name === 'file-delete-invalid' && a.status >= 400 && a.status < 500 && b.status >= 400 && b.status < 500
    if (!(same || fileDeleteOk)) {
      failures++
      console.log(`FAIL ${a.name}`)
      console.log(`  original: ${a.status} ${a.contentType} ${a.body.slice(0, 300)}`)
      console.log(`  rebuilt : ${b.status} ${b.contentType} ${b.body.slice(0, 300)}`)
    } else {
      console.log(`PASS ${a.name} (${a.status})`)
    }
  }
  console.log(failures === 0 ? '\n等价性验证通过 ✓' : `\n${failures} 项不一致 ✗`)
  process.exit(failures === 0 ? 0 : 1)
}