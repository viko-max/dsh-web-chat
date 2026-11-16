// 从原始 bundle 中按 `// lib/*.js` / `// test/*.mjs` 标记提取插件自有模块。
// 同一模块的多个片段按出现顺序拼接；vendor 段不提取（改为真实 npm 依赖）。
// 产物 host-src/extracted/*.raw.js 供人工重建 import/export。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const bundle = readFileSync(
  path.join(root, '..', '..', '_inspect', 'dsh-web-chat', 'package', 'lib', 'index.js'),
  'utf8'
)
const lines = bundle.split('\n')
const marker = /^\/\/ ((?:lib|test)\/[\w.-]+\.(?:js|mjs))\s*$/
const anyComment = /^\/\/ \S/

const sections = [] // { name, start, end }
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(marker)
  if (m) sections.push({ name: m[1], start: i })
}
for (let s = 0; s < sections.length; s++) {
  let end = lines.length
  for (let i = sections[s].start + 1; i < lines.length; i++) {
    if (anyComment.test(lines[i]) && !/^\s/.test(lines[i])) {
      // 只有行首的路径注释才是模块边界（代码内的普通注释不算）
      if (/^\/\/ (?:lib|test|\.runtime|node_modules)\//.test(lines[i])) {
        end = i
        break
      }
    }
  }
  sections[s].end = end
}

const byName = new Map()
for (const s of sections) {
  const body = lines.slice(s.start + 1, s.end).join('\n').trim()
  if (!body) continue
  const list = byName.get(s.name) ?? []
  list.push({ start: s.start + 1, end: s.end, body })
  byName.set(s.name, list)
}

const outDir = path.join(root, 'extracted')
mkdirSync(outDir, { recursive: true })
for (const [name, parts] of byName) {
  const file = name.replace(/[\\/]/g, '__') + '.raw.js'
  const header = parts.map((p) => `// ---- fragment: bundle lines ${p.start}-${p.end} ----`).join('\n')
  const body = parts.map((p) => p.body).join('\n\n')
  writeFileSync(path.join(outDir, file), header + '\n\n' + body + '\n')
  console.log(`${file}: ${parts.length} fragment(s), ${body.length} chars`)
}