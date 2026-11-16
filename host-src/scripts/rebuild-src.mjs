// 一次性还原脚本：extracted/*.raw.js + 模块接线 -> src/*.js
// 模块体与原始 bundle 逐字节一致（高保真），仅补充 import/export 接线。
// 还原完成后 src/ 即为规范源码，后续阶段直接编辑 src/。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const srcDir = path.join(root, 'src')
mkdirSync(srcDir, { recursive: true })

const wiring = [
  {
    raw: 'lib__panel-host.js',
    out: 'panel-host.js',
    imports: [
      'import { fixture } from "./fixture.js";',
      'import { createPanelApps } from "./panel-apps.js";',
      'import { createPanelAgent } from "./panel-agent.js";',
      'import { createPanelImages } from "./panel-images.js";',
      'import { createPanelAutomation } from "./panel-automation.js";',
      'import { serviceKeys } from "./panel-service-keys.js";',
      'import { chatCatalog, modelReply, listModels } from "./panel-models.js";',
    ],
    exports: null, // raw 已含 export { apply, inject, name2 as name }
  },
  {
    raw: 'lib__panel-apps.js',
    out: 'panel-apps.js',
    imports: [
      'import { qqMail } from "./panel-qqmail.js";',
      'import { createQQBot } from "./panel-qqbot.js";',
    ],
    exports: 'export { createPanelApps };',
  },
  {
    raw: 'lib__panel-qqmail.js',
    out: 'panel-qqmail.js',
    imports: ['import { ImapFlow } from "imapflow";'],
    exports: 'export { qqMail };',
  },
  {
    raw: 'lib__panel-qqbot.js',
    out: 'panel-qqbot.js',
    imports: [],
    exports: 'export { createQQBot };',
  },
  {
    raw: 'lib__panel-models.js',
    out: 'panel-models.js',
    imports: ['import { EventSourceParserStream } from "eventsource-parser/stream";'],
    exports: 'export { listModels, chatModels, chatCatalog, modelReply };',
  },
  {
    raw: 'lib__panel-agent.js',
    out: 'panel-agent.js',
    imports: [],
    exports: 'export { createPanelAgent };',
  },
  {
    raw: 'lib__panel-images.js',
    out: 'panel-images.js',
    imports: [],
    exports: 'export { createPanelImages };',
  },
  {
    raw: 'lib__panel-service-keys.js',
    out: 'panel-service-keys.js',
    imports: [],
    exports: 'export { serviceKeys };',
  },
  {
    raw: 'lib__panel-automation.js',
    out: 'panel-automation.js',
    imports: ['import { EventSourceParserStream } from "eventsource-parser/stream";'],
    exports: 'export { createPanelAutomation };',
  },
  {
    raw: 'test__fixture.mjs',
    out: 'fixture.js',
    imports: [],
    exports: 'export { fixture };',
  },
]

for (const module of wiring) {
  const raw = readFileSync(path.join(root, 'extracted', module.raw + '.raw.js'), 'utf8')
  const body = raw
    .split('\n')
    .filter((line) => !line.startsWith('// ---- fragment:'))
    .join('\n')
    .trim()
  const parts = []
  if (module.imports.length) parts.push(module.imports.join('\n'))
  parts.push(body)
  if (module.exports) parts.push(module.exports)
  writeFileSync(path.join(srcDir, module.out), parts.join('\n\n') + '\n')
  console.log(`src/${module.out}: ${body.length} chars body`)
}