// 图像模型动态获取回归：预设（有 Key live / 无 Key fallback）+ 自定义服务（推导 /v1/models）。
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeCtx } from './ctx-mock.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const module = await import(pathToFileURL(path.join(root, 'host-src/dist/lib/index.js')).href)

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS ${name}`) } else { failed++; console.log(`FAIL ${name} ${detail}`) }
}

// 模拟服务：/v1/models 返回混合模型列表，/v1/images/generations 返回 PNG
const server = createServer((req, res) => {
  if (req.url.endsWith('/v1/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ id: 'gpt-image-1' }, { id: 'text-only-model' }, { id: 'flux-image-dev' }] }))
    return
  }
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ data: [{ b64_json: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') }] }))
  })
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const { ctx, routes, disposers } = makeCtx()
await module.apply(ctx)
const handler = routes[0].fetch
const base = 'http://localhost/api/dsh-web-chat-panel'
const callJson = async (op, body) => {
  const r = await handler(new Request(`${base}?op=${op}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }))
  return { status: r.status, body: await r.json().catch(() => null) }
}

try {
  // 自定义服务：动态拉取 /v1/models，按 image 过滤
  const save = await callJson('image-services-save', {
    service: { name: '自定义生图', endpoint: `${origin}/v1/images/generations`, generationModel: 'gpt-image-1', editModel: 'gpt-image-1', domains: [] },
    key: 'img-key',
  })
  const iid = save.body.id
  check('custom-save', save.status === 200 && Boolean(iid))
  const models = await callJson('image-models', { provider: iid })
  const ids = (models.body?.models ?? []).map((m) => m.id)
  check('custom-live-source', models.body?.source === 'live', models.body?.source)
  check('custom-image-filtered', ids.includes('gpt-image-1') && ids.includes('flux-image-dev') && !ids.includes('text-only-model'), JSON.stringify(ids))

  // 预设无 Key → fallback（不报错）
  const presetNoKey = await callJson('image-models', { provider: 'hunyuan' })
  check('preset-nokey-fallback', presetNoKey.body?.source === 'fallback' && Array.isArray(presetNoKey.body?.models), JSON.stringify(presetNoKey.body?.source))

  // 未知 provider → 空 fallback
  const unknown = await callJson('image-models', { provider: 'nonexistent' })
  check('unknown-fallback', unknown.body?.source === 'fallback' && unknown.body?.models?.length === 0)
} finally {
  for (const d of disposers) { try { await d() } catch {} }
  server.close(); server.closeAllConnections?.()
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)