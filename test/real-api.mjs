// Phase 2 第三方实测：用真实 API 验证流式对话、工具调用往返、生图与编辑。
// 凭据从工作区 .env 读取（git 忽略），不进代码、不进聊天。
//
// .env 示例（按需填写，缺省的项自动跳过）：
//   DSWC_TEST_OPENAI_BASE_URL=https://api.example.com/v1
//   DSWC_TEST_OPENAI_KEY=sk-...
//   DSWC_TEST_OPENAI_MODEL=gpt-4o-mini
//   DSWC_TEST_ANTHROPIC_BASE_URL=https://api.anthropic.com
//   DSWC_TEST_ANTHROPIC_KEY=sk-ant-...
//   DSWC_TEST_ANTHROPIC_MODEL=claude-sonnet-4-5
//   DSWC_TEST_IMAGE_ENDPOINT=https://api.example.com/v1/images/generations
//   DSWC_TEST_IMAGE_KEY=sk-...
//   DSWC_TEST_IMAGE_MODEL=gpt-image-1
//
// 用法：node test/real-api.mjs
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeCtx, readSse, sseText } from './ctx-mock.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BUNDLE = path.join(root, 'host-src/dist/lib/index.js')

// ---- 读取 .env ----
const env = {}
const envPath = path.join(root, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
}

const report = []
const log = (name, ok, detail) => {
  report.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
}

const module = await import(pathToFileURL(BUNDLE).href)
const { ctx, routes, disposers, keys } = makeCtx()
await module.apply(ctx)
const handler = routes[0].fetch
const base = 'http://localhost/api/dsh-web-chat-panel'
const call = async (op, body) => {
  const response = await handler(
    new Request(`${base}?op=${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  )
  return response
}
const callJson = async (op, body) => {
  const response = await call(op, body)
  return { status: response.status, body: await response.json() }
}

const testChatProvider = async (label, protocol, baseUrl, key, model, fallback) => {
  if (!baseUrl || !key || !model) {
    log(`${label}-skip`, true, '未配置，跳过')
    return
  }
  const models = [{ id: model, name: model, tools: true }]
  if (fallback && fallback !== model) models.push({ id: fallback, name: fallback, tools: true })
  const save = await callJson('chat-providers-save', {
    provider: {
      name: `实测 ${label}`,
      protocol,
      baseUrl,
      models,
    },
    key,
  })
  if (save.status !== 200) {
    log(`${label}-save`, false, JSON.stringify(save.body))
    return
  }
  const id = save.body.id
  let activeModel = model
  let connect = await callJson('chat-providers-test', { id, model: activeModel, kind: 'connect' })
  if (!connect.body.ok && fallback && fallback !== model) {
    log(`${label}-connect-primary(${model})`, false, connect.body.error)
    activeModel = fallback
    connect = await callJson('chat-providers-test', { id, model: activeModel, kind: 'connect' })
  }
  log(`${label}-connect(${activeModel})`, connect.body.ok === true, connect.body.ok ? `${connect.body.latencyMs}ms · ${connect.body.sample?.slice(0, 60)}` : connect.body.error)

  const reply = await call('model-reply', {
    panelProvider: 'dswc-chat-' + id,
    model: activeModel,
    messages: [{ role: 'user', content: '用一句话介绍你自己。' }],
  })
  const events = await readSse(reply)
  const text = sseText(events)
  log(`${label}-stream`, reply.status === 200 && text.length > 0 && events.some((e) => e.data?.type === 'message_stop'), text.slice(0, 80))

  const tools = await callJson('chat-providers-test', { id, model: activeModel, kind: 'tools' })
  log(`${label}-tools`, tools.body.ok === true, tools.body.ok ? `${tools.body.latencyMs}ms · ${tools.body.trace?.finalText?.slice(0, 60)}` : tools.body.error)

  await callJson('chat-providers-delete', { id })
}

const testImageService = async () => {
  const endpoint = env.DSWC_TEST_IMAGE_ENDPOINT
  const key = env.DSWC_TEST_IMAGE_KEY
  const model = env.DSWC_TEST_IMAGE_MODEL
  const preset = env.DSWC_TEST_IMAGE_PRESET
  if (!key || (!endpoint && !preset)) {
    log('image-skip', true, '未配置，跳过')
    return
  }
  // 预设路径：service-key-save 写入预设凭据，image-generate 带模型覆盖
  if (preset) {
    const keySave = await callJson('service-key-save', { id: preset, key })
    if (keySave.status !== 200) {
      log('image-preset-key', false, JSON.stringify(keySave.body))
      return
    }
    const form = new FormData()
    form.set('provider', preset)
    form.set('prompt', '测试图：白色背景上的蓝色圆形。')
    if (model) form.set('model', model)
    const started = Date.now()
    const generated = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: form }))
    if (generated.status !== 200) {
      log('image-generate-preset', false, `${generated.status} ${(await generated.text()).slice(0, 300)}`)
      return
    }
    const blob = await generated.blob()
    log('image-generate-preset', true, `${Date.now() - started}ms · ${blob.size} bytes · ${blob.type}`)
    const editForm = new FormData()
    editForm.set('provider', preset)
    editForm.set('prompt', '把这张图改成暖色调。')
    editForm.set('reference', blob, 'reference.png')
    if (env.DSWC_TEST_IMAGE_EDIT_MODEL || model) editForm.set('model', env.DSWC_TEST_IMAGE_EDIT_MODEL || model)
    const editStarted = Date.now()
    const edited = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: editForm }))
    log('image-edit-preset', edited.status === 200, edited.status === 200 ? `${Date.now() - editStarted}ms · ${(await edited.blob()).size} bytes` : `${edited.status} ${(await edited.text()).slice(0, 300)}`)
    return
  }
  const save = await callJson('image-services-save', {
    service: {
      name: '实测生图',
      endpoint,
      generationModel: model,
      editModel: env.DSWC_TEST_IMAGE_EDIT_MODEL || model,
      domains: [],
    },
    key,
  })
  if (save.status !== 200) {
    log('image-save', false, JSON.stringify(save.body))
    return
  }
  const id = save.body.id
  const test = await callJson('image-services-test', { id })
  log('image-generate', test.body.ok === true, test.body.ok ? `${test.body.latencyMs}ms · ${test.body.bytes} bytes · ${test.body.mediaType}` : test.body.error)

  // 编辑：用生成的图作为参考（需要 edit 模型支持；失败单独记录）
  const form = new FormData()
  form.set('provider', id)
  form.set('prompt', '把这张图改成暖色调。')
  const generated = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: form }))
  if (generated.status === 200) {
    const blob = await generated.blob()
    const editForm = new FormData()
    editForm.set('provider', id)
    editForm.set('prompt', '把这张图改成暖色调。')
    editForm.set('reference', blob, 'reference.png')
    if (env.DSWC_TEST_IMAGE_EDIT_MODEL) editForm.set('model', env.DSWC_TEST_IMAGE_EDIT_MODEL)
    const edited = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: editForm }))
    log('image-edit', edited.status === 200, edited.status === 200 ? `${(await edited.blob()).size} bytes` : await edited.text())
  }
  await callJson('image-services-delete', { id })
}

try {
  await testChatProvider('openai', 'openai', env.DSWC_TEST_OPENAI_BASE_URL, env.DSWC_TEST_OPENAI_KEY, env.DSWC_TEST_OPENAI_MODEL, env.DSWC_TEST_OPENAI_MODEL_FALLBACK)
  await testChatProvider('anthropic', 'anthropic', env.DSWC_TEST_ANTHROPIC_BASE_URL, env.DSWC_TEST_ANTHROPIC_KEY, env.DSWC_TEST_ANTHROPIC_MODEL)
  await testImageService()
} finally {
  for (const dispose of disposers) {
    try {
      await dispose()
    } catch {}
  }
}

const failed = report.filter((item) => !item.ok)
const dir = path.join(root, 'docs/test-reports')
mkdirSync(dir, { recursive: true })
const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
const file = path.join(dir, `real-api-${stamp}.md`)
writeFileSync(
  file,
  `# 第三方实测报告 ${new Date().toLocaleString('zh-CN')}\n\n` +
    report.map((item) => `- ${item.ok ? '✅' : '❌'} **${item.name}**${item.detail ? '：' + item.detail : ''}`).join('\n') +
    `\n\n${failed.length === 0 ? '全部通过。' : `${failed.length} 项失败。`}\n`
)
console.log(`\n报告已写入 ${file}`)
console.log(failed.length === 0 ? '实测全部通过 ✓' : `${failed.length} 项失败 ✗`)
process.exit(failed.length === 0 ? 0 : 1)