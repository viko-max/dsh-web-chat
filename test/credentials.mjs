// 项①凭据来源隔离 + 项⑦生图模型传递 回归测试。
// 用两个本机回环端口模拟两个服务来源（协议+主机+端口），记录上游实际收到的密钥与模型。
// 全部使用虚构密钥与合成数据，不连接真实账号。
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeCtx } from './ctx-mock.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BUNDLE = path.join(root, 'host-src/dist/lib/index.js')

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])
const PNG_B64 = PNG.toString('base64')

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS ${name}`) }
  else { failed++; console.log(`FAIL ${name} ${detail}`) }
}

// 记录型模拟服务：记录每次请求的 host/密钥/模型/路径，按路径返回对话 SSE 或生图结果
const records = []
const server = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let parsed = {}
    try { parsed = JSON.parse(body || '{}') } catch {}
    records.push({ host: req.headers.host, auth: req.headers.authorization ?? null, path: req.url, model: parsed.model ?? null })
    if (req.url.includes('/images/generations')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const base = { id: 'c1', object: 'chat.completion.chunk', model: parsed.model }
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: '连接正常' }, finish_reason: null }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ ...base, choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }) + '\n\n')
    res.end('data: [DONE]\n\n')
  })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const portA = server.address().port
// 第二个来源用同一服务器的不同端口（origin 含端口，足以验证来源隔离）
const serverB = createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    let parsed = {}
    try { parsed = JSON.parse(body || '{}') } catch {}
    records.push({ host: req.headers.host, auth: req.headers.authorization ?? null, path: req.url, model: parsed.model ?? null })
    if (req.url.includes('/images/generations')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: PNG_B64 }] }))
      return
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const base = { id: 'c2', object: 'chat.completion.chunk', model: parsed.model }
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: '连接正常' }, finish_reason: null }] }) + '\n\n')
    res.write('data: ' + JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + '\n\n')
    res.end('data: [DONE]\n\n')
  })
})
await new Promise((resolve) => serverB.listen(0, '127.0.0.1', resolve))
const portB = serverB.address().port
const originA = `http://127.0.0.1:${portA}`
const originB = `http://127.0.0.1:${portB}`

const module = await import(pathToFileURL(BUNDLE).href)
const { ctx, routes, disposers } = makeCtx()
await module.apply(ctx)
const handler = routes[0].fetch
const base = 'http://localhost/api/dsh-web-chat-panel'
const callJson = async (op, body) => {
  const response = await handler(new Request(`${base}?op=${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }))
  return { status: response.status, body: await response.json().catch(() => null), headers: response.headers }
}
const lastRecord = () => records[records.length - 1]

try {
  // ===== 项① 对话服务商凭据来源隔离 =====
  const saveA = await callJson('chat-providers-save', {
    provider: { name: '来源A', protocol: 'openai', baseUrl: `${originA}/v1`, models: [{ id: 'm1', name: 'M1', tools: true }] },
    key: 'key-A',
  })
  const pid = saveA.body.id
  check('chat-save-A', saveA.status === 200 && Boolean(pid))

  const replyA = await callJson('model-reply', { panelProvider: 'dswc-chat-' + pid, model: 'm1', messages: [{ role: 'user', content: 'hi' }] })
  check('chat-reply-A-key', replyA.status === 200 && lastRecord().auth === 'Bearer key-A' && lastRecord().host === `127.0.0.1:${portA}`, JSON.stringify(lastRecord()))

  // 编辑名称/模型（同来源），留空密钥 → 原密钥仍可用
  await callJson('chat-providers-save', { provider: { id: pid, name: '来源A改名', protocol: 'openai', baseUrl: `${originA}/v1`, models: [{ id: 'm1', name: '新名', tools: true }, { id: 'm2', name: 'M2', tools: true }] } })
  const replyEdit = await callJson('model-reply', { panelProvider: 'dswc-chat-' + pid, model: 'm2', messages: [{ role: 'user', content: 'hi' }] })
  check('chat-edit-keeps-key', replyEdit.status === 200 && lastRecord().auth === 'Bearer key-A', JSON.stringify(lastRecord()))

  // 换域名（端口）+ 留空密钥 → 旧密钥不得带到新来源
  const before = records.length
  await callJson('chat-providers-save', { provider: { id: pid, name: '来源A改名', protocol: 'openai', baseUrl: `${originB}/v1`, models: [{ id: 'm1', name: 'M1', tools: true }] } })
  const replyB = await callJson('model-reply', { panelProvider: 'dswc-chat-' + pid, model: 'm1', messages: [{ role: 'user', content: 'hi' }] })
  const leaked = records.slice(before).some((r) => r.host === `127.0.0.1:${portB}` && r.auth === 'Bearer key-A')
  check('chat-origin-change-no-leak', replyB.status === 400 && !leaked, `status=${replyB.status} leaked=${leaked} err=${replyB.body?.error?.message}`)

  // 为新来源配置新密钥 → 新来源收到新密钥
  await callJson('chat-providers-save', { provider: { id: pid, name: '来源A改名', protocol: 'openai', baseUrl: `${originB}/v1`, models: [{ id: 'm1', name: 'M1', tools: true }] }, key: 'key-B' })
  const replyB2 = await callJson('model-reply', { panelProvider: 'dswc-chat-' + pid, model: 'm1', messages: [{ role: 'user', content: 'hi' }] })
  check('chat-new-origin-new-key', replyB2.status === 200 && lastRecord().auth === 'Bearer key-B' && lastRecord().host === `127.0.0.1:${portB}`, JSON.stringify(lastRecord()))

  // 连接诊断同样走来源校验
  const testNoKey = await callJson('chat-providers-save', { provider: { id: pid, name: 'x', protocol: 'openai', baseUrl: `${originA}/v1`, models: [{ id: 'm1', name: 'M1', tools: true }] } })
  const diag = await callJson('chat-providers-test', { id: pid, model: 'm1', kind: 'connect' })
  const diagErr = diag.body?.error?.message ?? diag.body?.error ?? ''
  check('chat-diag-origin-guard', testNoKey.status === 200 && diag.status === 400 && /API Key/.test(diagErr), JSON.stringify(diag.body))

  // ===== 项① 图像服务凭据来源隔离 + 项⑦ 模型传递 =====
  const imgA = await callJson('image-services-save', {
    service: { name: '图A', endpoint: `${originA}/v1/images/generations`, generationModel: 'gen-model', editModel: 'edit-model', domains: [] },
    key: 'img-A',
  })
  const iid = imgA.body.id
  check('img-save-A', imgA.status === 200 && Boolean(iid))

  const genForm = (model, reference) => {
    const form = new FormData()
    form.set('provider', iid)
    form.set('prompt', '蓝色圆形')
    if (model) form.set('model', model)
    if (reference) form.set('reference', new Blob([PNG], { type: 'image/png' }), 'ref.png')
    return form
  }
  const genA = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: genForm('gen-model') }))
  check('img-gen-A-key-model', genA.status === 200 && lastRecord().auth === 'Bearer img-A' && lastRecord().model === 'gen-model', JSON.stringify(lastRecord()))
  check('img-gen-A-actual-model-header', genA.headers.get('x-image-model') === 'gen-model', genA.headers.get('x-image-model'))

  // 参考图编辑用编辑模型 → 上游收到 edit-model
  const genEdit = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: genForm('edit-model', true) }))
  check('img-edit-model-passthrough', genEdit.status === 200 && lastRecord().model === 'edit-model' && genEdit.headers.get('x-image-model') === 'edit-model', JSON.stringify(lastRecord()))

  // 不支持的组合：文生图选编辑模型 → 拒绝
  const badCombo = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: genForm('edit-model') }))
  const badBody = await badCombo.json().catch(() => null)
  check('img-unsupported-combo', badCombo.status === 400 && /编辑/.test(badBody?.error?.message ?? ''), JSON.stringify(badBody))

  // 编辑名称（同来源）留空密钥 → 原密钥仍可用
  await callJson('image-services-save', { service: { id: iid, name: '图A改名', endpoint: `${originA}/v1/images/generations`, generationModel: 'gen-model', editModel: 'edit-model', domains: [] } })
  const genEdit2 = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: genForm('gen-model') }))
  check('img-edit-keeps-key', genEdit2.status === 200 && lastRecord().auth === 'Bearer img-A', JSON.stringify(lastRecord()))

  // 换域名 + 留空密钥 → 旧密钥不得带到新来源
  const beforeImg = records.length
  await callJson('image-services-save', { service: { id: iid, name: '图A改名', endpoint: `${originB}/v1/images/generations`, generationModel: 'gen-model', editModel: 'edit-model', domains: [] } })
  const genB = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: genForm('gen-model') }))
  const leakedImg = records.slice(beforeImg).some((r) => r.host === `127.0.0.1:${portB}` && r.auth === 'Bearer img-A')
  check('img-origin-change-no-leak', genB.status === 400 && !leakedImg, `status=${genB.status} leaked=${leakedImg}`)

  // 新来源新密钥
  await callJson('image-services-save', { service: { id: iid, name: '图A改名', endpoint: `${originB}/v1/images/generations`, generationModel: 'gen-model', editModel: 'edit-model', domains: [] }, key: 'img-B' })
  const genB2 = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: genForm('gen-model') }))
  check('img-new-origin-new-key', genB2.status === 200 && lastRecord().auth === 'Bearer img-B' && lastRecord().host === `127.0.0.1:${portB}`, JSON.stringify(lastRecord()))
} finally {
  for (const dispose of disposers) { try { await dispose() } catch {} }
  server.close(); serverB.close()
  server.closeAllConnections?.(); serverB.closeAllConnections?.()
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)