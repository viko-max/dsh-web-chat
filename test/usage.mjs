// 项④用量统计回归（内存测试）：单次/累计分离、缓存口径、TPS 排除工具等待。
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
const esbuildBin = path.join(root, 'host-src/node_modules/esbuild/bin/esbuild')
const tmpDir = path.join(root, 'test/.tmp')
mkdirSync(tmpDir, { recursive: true })
const bundlePath = path.join(tmpDir, 'usage-bundle.mjs')

const build = spawnSync(
  node,
  [esbuildBin, path.join(root, 'test/usage-entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundlePath}`, '--log-level=warning'],
  { stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(root, 'official-demo/node_modules') } }
)
if (build.status !== 0) { console.error('esbuild 打包失败'); process.exit(1) }

const { createUsageAccumulator } = await import(pathToFileURL(bundlePath).href)

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS ${name}`) } else { failed++; console.log(`FAIL ${name} ${detail}`) }
}
const usage = (o) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...o })

// 1. 两轮分别输出 8 和 12 → 累计 20（输入也累计）
{
  const acc = createUsageAccumulator(0)
  acc.accumulate(usage({ input_tokens: 10, output_tokens: 8, cache_reported: true }))
  acc.accumulate(usage({ input_tokens: 5, output_tokens: 12, cache_reported: true }))
  const s = acc.stats()
  check('cumulative-output-20', s.outputTokens === 20, `got ${s.outputTokens}`)
  check('cumulative-input-15', s.inputTokens === 15, `got ${s.inputTokens}`)
}

// 2. 缓存未报告 → 命中率 null（显示 —）
{
  const acc = createUsageAccumulator(0)
  acc.accumulate({ input_tokens: 10, output_tokens: 5 }) // 无缓存字段、无 cache_reported
  const s = acc.stats()
  check('cache-not-reported-null', s.cacheHitRate === null, `got ${s.cacheHitRate}`)
}

// 3. 明确零命中 → 命中率 0（显示 0%）
{
  const acc = createUsageAccumulator(0)
  acc.accumulate(usage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_reported: true }))
  const s = acc.stats()
  check('cache-explicit-zero', s.cacheHitRate === 0, `got ${s.cacheHitRate}`)
}

// 4. 缓存命中率口径：cacheRead / (input + cacheRead)
{
  const acc = createUsageAccumulator(0)
  acc.accumulate(usage({ input_tokens: 60, output_tokens: 12, cache_read_input_tokens: 40, cache_creation_input_tokens: 8, cache_reported: true }))
  const s = acc.stats()
  check('cache-hit-rate-0.4', Math.abs(s.cacheHitRate - 0.4) < 1e-9, `got ${s.cacheHitRate}`)
  check('cache-write-tracked', s.cacheWriteTokens === 8, `got ${s.cacheWriteTokens}`)
}

// 5. TPS 排除工具等待：两轮各 500ms 生成（8+12=20 token），中间 5000ms 工具等待不计入
{
  const acc = createUsageAccumulator(0)
  acc.addGenerationTime(500)
  acc.accumulate(usage({ input_tokens: 10, output_tokens: 8, cache_reported: true }))
  // 工具等待 5000ms —— 不调用 addGenerationTime
  acc.addGenerationTime(500)
  acc.accumulate(usage({ input_tokens: 5, output_tokens: 12, cache_reported: true }))
  const s = acc.stats()
  check('tps-excludes-tool-wait', Math.abs(s.tps - 20) < 1e-6, `got ${s.tps} (期望 20 token / 1s)`)
}

// 6. 无有效生成时间 → tps null（避免除零/虚高）
{
  const acc = createUsageAccumulator(0)
  acc.accumulate(usage({ output_tokens: 5 }))
  const s = acc.stats()
  check('tps-null-no-generation', s.tps === null, `got ${s.tps}`)
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)