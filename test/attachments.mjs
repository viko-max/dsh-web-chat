// 项②附件回归（内存测试）：按协议准备、能力校验、第三方不带 DeepSeek file_id。
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const node = process.execPath
const esbuildBin = path.join(root, 'host-src/node_modules/esbuild/bin/esbuild')
const tmpDir = path.join(root, 'test/.tmp')
mkdirSync(tmpDir, { recursive: true })
const bundlePath = path.join(tmpDir, 'attachments-bundle.mjs')

const build = spawnSync(
  node,
  [esbuildBin, path.join(root, 'test/attachments-entry.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${bundlePath}`, '--log-level=warning'],
  { stdio: 'inherit', env: { ...process.env, NODE_PATH: path.join(root, 'host-src/node_modules') } }
)
if (build.status !== 0) { console.error('esbuild 打包失败'); process.exit(1) }

const { buildAttachmentBlocks, attachmentSupportError, parseDataUrl, toOpenaiMessages, toAnthropicMessages } =
  await import(pathToFileURL(bundlePath).href)

let passed = 0, failed = 0
const check = (name, ok, detail = '') => {
  if (ok) { passed++; console.log(`PASS ${name}`) } else { failed++; console.log(`FAIL ${name} ${detail}`) }
}
const DATA_URL = 'data:image/png;base64,iVBORw0KGgo='
const img = { id: 'f1', name: 'a.png', isImage: true, mimeType: 'image/png', serverId: 'ds-file-123', dataUrl: DATA_URL }
const doc = { id: 'f2', name: 'b.pdf', isImage: false, mimeType: 'application/pdf', serverId: 'ds-file-456', dataUrl: 'data:application/pdf;base64,JVBERi0=' }
const hasFileId = (blocks) => blocks.some((b) => b.source?.type === 'file')

// 1. DeepSeek：file_id 引用
{
  const { blocks, error } = buildAttachmentBlocks([img, doc], 'deepseek', { vision: true, documents: true })
  check('deepseek-file-id', !error && blocks.length === 2 && blocks.every((b) => b.source.type === 'file' && b.source.file_id.startsWith('ds-file')), JSON.stringify(blocks))
}

// 2. OpenAI 图片：base64，不带 DeepSeek file_id
{
  const { blocks, error } = buildAttachmentBlocks([img], 'openai', { vision: true, documents: false })
  check('openai-image-base64', !error && blocks.length === 1 && blocks[0].source.type === 'base64' && blocks[0].source.media_type === 'image/png' && !hasFileId(blocks), JSON.stringify(blocks))
}

// 3. OpenAI 文档：不支持 → 具体错误
{
  const { blocks, error } = buildAttachmentBlocks([doc], 'openai', { vision: true, documents: false })
  check('openai-doc-unsupported', blocks.length === 0 && /文档/.test(error ?? ''), error)
}

// 4. Anthropic 图片 + 文档：base64
{
  const { blocks, error } = buildAttachmentBlocks([img, doc], 'anthropic', { vision: true, documents: true })
  check('anthropic-image-doc-base64', !error && blocks.length === 2 && blocks.every((b) => b.source.type === 'base64') && !hasFileId(blocks), JSON.stringify(blocks))
}

// 5. 非视觉模型图片 → 错误
{
  const { error } = buildAttachmentBlocks([img], 'openai', { vision: false, documents: false })
  check('non-vision-image-error', /图片/.test(error ?? ''), error)
}

// 6. 同步能力校验
{
  check('support-deepseek-ok', attachmentSupportError([img, doc], 'deepseek', { vision: true, documents: true }) === null)
  check('support-openai-doc', /文档/.test(attachmentSupportError([doc], 'openai', { vision: true, documents: false }) ?? ''))
  check('support-non-vision', /图片/.test(attachmentSupportError([img], 'anthropic', { vision: false, documents: true }) ?? ''))
}

// 7. parseDataUrl 往返
{
  const parsed = parseDataUrl(DATA_URL)
  check('parse-data-url', parsed?.media_type === 'image/png' && parsed?.data === 'iVBORw0KGgo=', JSON.stringify(parsed))
}

// 8. toOpenaiMessages：base64 图片 → image_url，无 file_id
{
  const { blocks } = buildAttachmentBlocks([img], 'openai', { vision: true, documents: false })
  const messages = toOpenaiMessages([{ role: 'user', content: [...blocks, { type: 'text', text: '看图' }] }])
  const parts = messages[0].content
  const imagePart = Array.isArray(parts) && parts.find((p) => p.type === 'image_url')
  check('openai-msg-image-url', Boolean(imagePart) && imagePart.image_url.url === DATA_URL && !JSON.stringify(messages).includes('ds-file'), JSON.stringify(messages))
}

// 9. toAnthropicMessages：base64 图片/文档保留；file_id 图片不泄漏给第三方
{
  const { blocks } = buildAttachmentBlocks([img, doc], 'anthropic', { vision: true, documents: true })
  const messages = toAnthropicMessages([{ role: 'user', content: blocks }])
  const content = messages[0].content
  check('anthropic-msg-base64', content.length === 2 && content.every((b) => b.source.type === 'base64'), JSON.stringify(content))
  // 直接喂 DeepSeek file_id 块（旧历史）→ 不应转发 file_id
  const leak = toAnthropicMessages([{ role: 'user', content: [{ type: 'image', source: { type: 'file', file_id: 'ds-file-123' } }] }])
  check('anthropic-no-file-id-leak', !JSON.stringify(leak).includes('ds-file'), JSON.stringify(leak))
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)