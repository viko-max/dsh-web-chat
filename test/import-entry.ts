// 导入回归测试入口：用真实的 schema/toLocal/zipReader 校验 v3 归档。
// 由 esbuild 打包后在 node 运行（runner 会 shim localStorage）。
import { zipSync, strToU8 } from 'fflate'
import { checkManifest, readSessionFile, readSessionIndex } from '../official-demo/src/services/chat/history/schema.js'
import { toLocalSession } from '../official-demo/src/services/chat/history/toLocal.js'
import { isZipFile, readArchive, readEntry, skipEntry } from '../official-demo/src/services/chat/history/zipReader.js'
import { MANIFEST_PATH, INDEX_PATH, parseSessionPath } from '../official-demo/src/services/chat/history/paths.js'

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
const now = '2026-11-16T00:00:00.000Z'

/** 构造一个合法的 v3 导出归档（1 会话 / 2 消息 / 1 图片） */
export const buildFixtureZip = (): Uint8Array => {
  const session = {
    id: 's1',
    title: '测试会话',
    pinned: false,
    current_message_id: 2,
    inserted_at: now,
    updated_at: now,
    messages: [
      {
        id: 1, parent_id: null, role: 'USER', status: 'FINISHED',
        thinking_enabled: false, search_enabled: false, accumulated_token_usage: 0, inserted_at: now,
        fragments: [
          { type: 'REQUEST', content: '你好' },
          {
            type: 'FILE',
            files: [{
              id: 'img1', file_name: 'a.png', file_size: PNG.length, token_usage: null, inserted_at: now,
              export_path: 'chat_sessions/s1_files/img1_a.png', is_image: true, width: 1, height: 1,
            }],
          },
        ],
      },
      {
        id: 2, parent_id: 1, role: 'ASSISTANT', status: 'FINISHED',
        thinking_enabled: true, search_enabled: false, accumulated_token_usage: 10, inserted_at: now,
        fragments: [
          { type: 'THINK', content: '用户在打招呼', elapsed_secs: 2 },
          { type: 'RESPONSE', content: '你好！有什么可以帮你？' },
        ],
      },
    ],
  }
  const index = [{ id: 's1', title: '测试会话', pinned: false, message_count: 2, inserted_at: now, updated_at: now }]
  return zipSync({
    'manifest.json': strToU8(JSON.stringify({ export_format_version: 3 })),
    'chat_sessions/s1.json': strToU8(JSON.stringify(session)),
    'chat_session_index.json': strToU8(JSON.stringify(index)),
    'chat_sessions/s1_files/img1_a.png': PNG,
  })
}

const readJson = async (entry: { path: string }): Promise<unknown> => {
  const text = await (await readEntry(entry as never)).text()
  return JSON.parse(text)
}

export type ValidateResult = {
  ok: boolean
  isZip: boolean
  manifestOk: boolean
  sessionCount: number
  messageCount: number
  imageCount: number
  indexCount: number
  title: string | null
  firstUserText: string
  firstAnswerText: string
  error?: string
}

/** 用真实导入解析链路校验归档字节 */
export const validateArchiveBytes = async (bytes: Uint8Array): Promise<ValidateResult> => {
  const result: ValidateResult = {
    ok: false, isZip: false, manifestOk: false, sessionCount: 0, messageCount: 0,
    imageCount: 0, indexCount: 0, title: null, firstUserText: '', firstAnswerText: '',
  }
  try {
    const file = new File([bytes as BlobPart], 'test.zip', { type: 'application/zip' })
    result.isZip = await isZipFile(file)
    if (!result.isZip) return result
    let index: unknown = null
    const locals: ReturnType<typeof toLocalSession>[] = []
    for await (const entry of readArchive(file)) {
      if (entry.path === MANIFEST_PATH) {
        checkManifest(await readJson(entry))
        result.manifestOk = true
      } else if (parseSessionPath(entry.path) !== null) {
        const local = toLocalSession(readSessionFile(await readJson(entry)))
        locals.push(local)
      } else if (entry.path === INDEX_PATH) {
        index = readSessionIndex(await readJson(entry))
      } else {
        await skipEntry(entry)
        result.imageCount += 1
      }
    }
    result.sessionCount = locals.length
    result.indexCount = Array.isArray(index) ? index.length : 0
    const first = locals[0]
    if (first) {
      result.title = first.session.title
      result.messageCount = first.session.messages.length
      for (const message of first.session.messages) {
        if (message.role === 'user' && !result.firstUserText) result.firstUserText = message.content
        if (message.role === 'assistant' && !result.firstAnswerText) {
          result.firstAnswerText = message.blocks.map((b) => (b.type === 'text' ? b.text : '')).join('')
        }
      }
    }
    result.ok = result.manifestOk && result.sessionCount === result.indexCount && result.sessionCount > 0
    return result
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error)
    return result
  }
}