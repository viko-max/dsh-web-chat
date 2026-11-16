// 导入对话真实回归：用真实 schema/toLocal/zipReader 校验合成 v3 归档与用户提供的真实归档。
// 用法：node test/import-flow.mjs [真实归档.zip ...]
// 真实归档可放在 test/fixtures/*.zip，会自动一并校验。
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
const esbuildBin = path.join(root, 'host-src/node_modules/esbuild/bin/esbuild')
const tmpDir = path.join(root, 'test/.tmp')
mkdirSync(tmpDir, { recursive: true })
const bundlePath = path.join(tmpDir, 'import-bundle.mjs')

// esbuild 打包测试入口（.ts 导入器自动把 .js 解析到 .ts；NODE_PATH 提供 fflate）
const build = spawnSync(
  node,
  [esbuildBin, path.join(root, 'test/import-entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundlePath}`, '--define:__PANEL_MODE__=false', '--define:__API_ORIGIN__="/api/dsh-web-chat-panel"', '--log-level=warning'],
  { stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(root, 'official-demo/node_modules') } }
)
if (build.status !== 0) {
  console.error('esbuild 打包失败')
  process.exit(1)
}

// node 环境 shim：settings 初始化会读 localStorage
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}

const { buildFixtureZip, validateArchiveBytes } = await import(pathToFileURL(bundlePath).href)

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed++
    console.log(`FAIL ${name} ${detail}`)
  }
}

// 1. 合成 v3 归档：完整解析链路
const fixture = buildFixtureZip()
const r = await validateArchiveBytes(fixture)
check('fixture-is-zip', r.isZip)
check('fixture-manifest', r.manifestOk)
check('fixture-session-count', r.sessionCount === 1, `got ${r.sessionCount}`)
check('fixture-index-match', r.indexCount === r.sessionCount, `index ${r.indexCount}`)
check('fixture-message-count', r.messageCount === 2, `got ${r.messageCount}`)
check('fixture-image', r.imageCount === 1, `got ${r.imageCount}`)
check('fixture-title', r.title === '测试会话', `got ${r.title}`)
check('fixture-user-text', r.firstUserText === '你好', `got ${r.firstUserText}`)
check('fixture-answer-text', r.firstAnswerText.includes('有什么可以帮你'), `got ${r.firstAnswerText}`)
check('fixture-overall', r.ok, r.error ?? '')

// 2. 损坏归档应被拒绝
const bad = await validateArchiveBytes(Uint8Array.from([1, 2, 3, 4, 5]))
check('reject-non-zip', !bad.ok && !bad.isZip)

// 3. 用户提供的真实归档（命令行参数 + test/fixtures/*.zip）
const realFiles = [...process.argv.slice(2)]
const fixturesDir = path.join(root, 'test/fixtures')
if (existsSync(fixturesDir)) {
  for (const name of readdirSync(fixturesDir)) {
    if (name.endsWith('.zip')) realFiles.push(path.join(fixturesDir, name))
  }
}
for (const file of realFiles) {
  const bytes = new Uint8Array(readFileSync(file))
  const result = await validateArchiveBytes(bytes)
  check(
    `real:${path.basename(file)}`,
    result.ok,
    result.ok
      ? `会话 ${result.sessionCount} · 消息 ${result.messageCount} · 图片 ${result.imageCount}`
      : result.error ?? `manifest=${result.manifestOk} sessions=${result.sessionCount} index=${result.indexCount}`
  )
}
if (realFiles.length === 0) {
  console.log('（未提供真实归档；放入 test/fixtures/*.zip 或作为参数传入即可一并校验）')
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)