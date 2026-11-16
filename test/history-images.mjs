// 项③历史生成图 ZIP 往返回归（内存测试，合成数据）：导出→导入还原卡片与派生关系，损坏归档失败路径。
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
const esbuildBin = path.join(root, 'host-src/node_modules/esbuild/bin/esbuild')
const tmpDir = path.join(root, 'test/.tmp')
mkdirSync(tmpDir, { recursive: true })
const bundlePath = path.join(tmpDir, 'history-images-bundle.mjs')

const build = spawnSync(
  node,
  [esbuildBin, path.join(root, 'test/history-images-entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundlePath}`, '--define:__PANEL_MODE__=false', '--define:__API_ORIGIN__="/api/dsh-web-chat-panel"', '--log-level=warning'],
  { stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(root, 'official-demo/node_modules') } }
)
if (build.status !== 0) { console.error('esbuild 打包失败'); process.exit(1) }

// settings 初始化读 localStorage
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}

const M = await import(pathToFileURL(bundlePath).href)

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS ${name}`) } else { failed++; console.log(`FAIL ${name} ${detail}`) }
}
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const jsonBlob = (v) => new Blob([JSON.stringify(v)], { type: 'application/json' })

// 构造含生成图 + 编辑派生图的会话
const session = {
  id: 's1', title: '生图会话', createdAt: 1700000000000, updatedAt: 1700000003000, rootMessageId: 'u1',
  messages: [
    { id: 'u1', role: 'user', content: '画一只猫', files: [], createdAt: 1700000000000, parentId: null, selectedChildId: 'a1' },
    { id: 'a1', role: 'assistant', createdAt: 1700000001000, model: null, thinking: false, search: false, prefix: false, status: 'done', stopReason: 'end_turn', parentId: 'u1',
      blocks: [{ type: 'generated_image', imageId: 'gen-1', prompt: '一只猫', provider: 'hunyuan', providerName: '混元', model: 'hy-image-v3.5-preview', createdAt: 1700000001000 }] },
    { id: 'u2', role: 'user', content: '改成蓝色', files: [], createdAt: 1700000002000, parentId: 'a1', selectedChildId: 'a2' },
    { id: 'a2', role: 'assistant', createdAt: 1700000003000, model: null, thinking: false, search: false, prefix: false, status: 'done', stopReason: 'end_turn', parentId: 'u2',
      blocks: [{ type: 'generated_image', imageId: 'gen-2', prompt: '蓝色的猫', provider: 'hunyuan', providerName: '混元', model: 'hy-image-v3.5-preview', createdAt: 1700000003000 }] },
  ],
}
const generatedMeta = {
  'gen-1': { sessionId: 's1', prompt: '一只猫', provider: 'hunyuan', providerName: '混元', model: 'hy-image-v3.5-preview', createdAt: 1700000001000 },
  'gen-2': { sessionId: 's1', prompt: '蓝色的猫', provider: 'hunyuan', providerName: '混元', model: 'hy-image-v3.5-preview', createdAt: 1700000003000, parentId: 'gen-1' },
}

// 导出：toSessionFile + 组装 ZIP（manifest → 会话 → index → 侧车 → 图片）
const sessionFile = M.toSessionFile(session, () => null, (id) => M.imagePath('s1', id, `${id}.png`))
const assistantFileFragments = sessionFile.messages.filter((m) => m.role === 'ASSISTANT').flatMap((m) => m.fragments.filter((f) => f.type === 'FILE'))
check('export-assistant-file-fragments', assistantFileFragments.length === 2, `got ${assistantFileFragments.length}`)

const zipBlob = await M.writeArchive([
  { name: M.MANIFEST_PATH, blob: jsonBlob({ export_format_version: M.EXPORT_FORMAT_VERSION }) },
  { name: M.sessionPath('s1'), blob: jsonBlob(sessionFile) },
  { name: M.INDEX_PATH, blob: jsonBlob([M.toIndexEntry(sessionFile)]) },
  { name: M.GENERATED_PATH, blob: jsonBlob({ images: generatedMeta }) },
  { name: M.imagePath('s1', 'gen-1', 'gen-1.png'), blob: new Blob([PNG], { type: 'image/png' }) },
  { name: M.imagePath('s1', 'gen-2', 'gen-2.png'), blob: new Blob([PNG], { type: 'image/png' }) },
])
const zipBytes = new Uint8Array(await zipBlob.arrayBuffer())

// 导入：读 ZIP → 校验 → toLocalSession（带侧车）还原卡片
const file = new File([zipBytes], 'test.zip', { type: 'application/zip' })
check('import-is-zip', await M.isZipFile(file))
let manifestOk = false, parsedSession = null, parsedIndex = null, generated = {}, imageCount = 0
for await (const entry of M.readArchive(file)) {
  const text = await (await M.readEntry(entry)).text()
  if (entry.path === M.MANIFEST_PATH) { M.checkManifest(JSON.parse(text)); manifestOk = true }
  else if (M.parseSessionPath(entry.path)) parsedSession = M.readSessionFile(JSON.parse(text))
  else if (entry.path === M.INDEX_PATH) parsedIndex = M.readSessionIndex(JSON.parse(text))
  else if (entry.path === M.GENERATED_PATH) generated = JSON.parse(text).images
  else imageCount++
}
check('import-manifest', manifestOk)
check('import-index', Array.isArray(parsedIndex) && parsedIndex.length === 1)
check('import-image-count', imageCount === 2, `got ${imageCount}`)

const local = M.toLocalSession(parsedSession, generated)
const allBlocks = local.session.messages.flatMap((m) => (m.role === 'assistant' ? m.blocks : []))
const genBlocks = allBlocks.filter((b) => b.type === 'generated_image')
check('import-generated-cards', genBlocks.length === 2, `got ${genBlocks.length}`)
check('import-card-prompt', genBlocks.some((b) => b.imageId === 'gen-1' && b.prompt === '一只猫') && genBlocks.some((b) => b.imageId === 'gen-2' && b.prompt === '蓝色的猫'), JSON.stringify(genBlocks))
check('import-card-model', genBlocks.every((b) => b.model === 'hy-image-v3.5-preview'))
check('import-derivation', generated['gen-2']?.parentId === 'gen-1', JSON.stringify(generated['gen-2']))
check('import-image-refs', local.images.size === 2, `got ${local.images.size}`)

// 旧版/官方归档兼容：无侧车时助手 FILE 片段不还原为生成图（无元数据），但不报错
const localNoSidecar = M.toLocalSession(parsedSession, undefined)
const genNoSidecar = localNoSidecar.session.messages.flatMap((m) => (m.role === 'assistant' ? m.blocks : [])).filter((b) => b.type === 'generated_image')
check('import-no-sidecar-compat', genNoSidecar.length === 0 && localNoSidecar.session.messages.length === 4)

// 损坏归档失败路径
check('corrupt-non-zip', !(await M.isZipFile(new File([new Uint8Array([1, 2, 3, 4])], 'bad.zip'))))
let corruptFailed = false
try {
  const truncated = new File([zipBytes.slice(0, 40)], 'trunc.zip', { type: 'application/zip' })
  for await (const entry of M.readArchive(truncated)) { await M.readEntry(entry) }
} catch { corruptFailed = true }
check('corrupt-truncated-throws', corruptFailed)

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)