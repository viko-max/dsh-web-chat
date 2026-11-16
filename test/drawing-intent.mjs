// 绘画意图识别回归（内存测试）：命中生图、排除普通聊天与"画面/动画"等误判。
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
const esbuildBin = path.join(root, 'host-src/node_modules/esbuild/bin/esbuild')
const tmpDir = path.join(root, 'test/.tmp')
mkdirSync(tmpDir, { recursive: true })
const bundlePath = path.join(tmpDir, 'drawing-intent-bundle.mjs')
const build = spawnSync(
  node,
  [esbuildBin, path.join(root, 'official-demo/src/services/chat/drawingIntent.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundlePath}`, '--log-level=warning'],
  { stdio: 'inherit' }
)
if (build.status !== 0) { console.error('esbuild 打包失败'); process.exit(1) }
const { isDrawingIntent } = await import(pathToFileURL(bundlePath).href)

let passed = 0, failed = 0
const check = (text, expected) => {
  const got = isDrawingIntent(text)
  if (got === expected) { passed++; console.log(`PASS ${JSON.stringify(text)} → ${got}`) }
  else { failed++; console.log(`FAIL ${JSON.stringify(text)} → ${got} (期望 ${expected})`) }
}

// 应命中
check('画一只猫', true)
check('帮我画一张动漫女孩', true)
check('生成图片：白色背景上的蓝色圆形', true)
check('设计一张海报', true)
check('给我画个头像', true)
check('做一张壁纸', true)
check('draw a cat', true)
check('generate an image of a girl', true)
check('illustration of a girl with pigtails', true)
check('请画一幅插画', true)
// 不应命中
check('画面很好', false)
check('今天天气怎么样', false)
check('解释一下量子力学', false)
check('动画推荐', false)
check('这个计划不错', false)
check('', false)

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)