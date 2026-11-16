import * as db from '../db.js'
import { BackupError, fail } from './errors.js'
import type { GeneratedImageMeta, SessionIndexEntry } from './format.js'
import { GENERATED_PATH, INDEX_PATH, MANIFEST_PATH, USER_PATH, parseSessionPath, sessionFilesDir } from './paths.js'
import { checkManifest, readSessionFile, readSessionIndex } from './schema.js'
import { toLocalSession } from './toLocal.js'
import {
  ArchiveError,
  isZipFile,
  readArchive,
  readEntry,
  skipEntry,
  type ArchiveEntry,
} from './zipReader.js'

/** 从原件字节补充图片 MIME；无法识别时为空字符串，图片身份仍由归档的 is_image 决定。 */
const imageType = (bytes: Uint8Array): string => {
  const startsWith = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  const header = new TextDecoder('ascii').decode(bytes.subarray(0, 12))
  if (startsWith(0xff, 0xd8, 0xff)) {
    return 'image/jpeg'
  }
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return 'image/png'
  }
  if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) {
    return 'image/gif'
  }
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'image/webp'
  }
  if (startsWith(0x42, 0x4d)) {
    return 'image/bmp'
  }
  if (startsWith(0x49, 0x49, 0x2a, 0) || startsWith(0x4d, 0x4d, 0, 0x2a)) {
    return 'image/tiff'
  }
  if (header.slice(4, 8) === 'ftyp' && ['avif', 'avis'].includes(header.slice(8, 12))) {
    return 'image/avif'
  }
  return ''
}

const readJson = async (entry: ArchiveEntry): Promise<unknown> => {
  const text = await (await readEntry(entry)).text()
  try {
    return JSON.parse(text)
  } catch {
    return fail('backupInvalidJson')
  }
}

/**
 * 检查 ZIP 格式、首个 manifest 条目及格式版本。
 * 校验失败时保留正在生成的回答和现有暂存数据。
 */
export const checkArchiveFormat = async (file: File): Promise<void> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  try {
    for await (const entry of readArchive(file)) {
      if (entry.path !== MANIFEST_PATH) {
        fail('backupUnrecognized')
      }
      checkManifest(await readJson(entry))
      return
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  fail('backupUnrecognized')
}

/**
 * 流式导入：manifest → user（不导入）→ 全部会话 JSON → index → 生成图侧车 → 全部图片。
 * 会话先暂存原始结构，待生成图侧车读取后再统一转换（还原生成图卡片），随后读取图片原件。
 * 返回生成图元数据，调用方在写盘成功后据此恢复图库；失败时现有会话与图库不受影响。
 */
export const importArchive = async (file: File): Promise<Record<string, GeneratedImageMeta>> => {
  if (!(await isZipFile(file))) {
    fail('backupUnrecognized')
  }
  const sessionFiles = new Map<string, ReturnType<typeof readSessionFile>>()
  const imported = new Set<string>()
  const images = new Map<string, string>()
  const stored = new Map<string, string>()
  let generated: Record<string, GeneratedImageMeta> = {}
  let manifest = false
  let index: SessionIndexEntry[] | undefined
  let currentSessionId: string | undefined
  let converted = false

  const convertSessions = async () => {
    if (converted) return
    converted = true
    for (const [sessionId, sessionFile] of sessionFiles) {
      const local = toLocalSession(sessionFile, generated)
      if (local.session.id !== sessionId || imported.has(sessionId)) {
        fail('backupIncomplete')
      }
      imported.add(sessionId)
      for (const [imagePath, id] of local.images) {
        images.set(imagePath, id)
      }
      await db.addStagingSession(local.session)
    }
  }

  const saveImage = async (entry: ArchiveEntry, id: string) => {
    if (stored.has(id)) {
      await skipEntry(entry)
      return
    }
    const data = await readEntry(entry)
    const type = imageType(new Uint8Array(await data.slice(0, 16).arrayBuffer()))
    await db.saveStagingFiles([{ id, blob: new Blob([data], { type }) }])
    stored.set(id, type)
  }

  try {
    for await (const entry of readArchive(file)) {
      const { path } = entry
      const sessionId = parseSessionPath(path)
      if (!manifest) {
        if (path !== MANIFEST_PATH) {
          fail('backupUnrecognized')
        }
        checkManifest(await readJson(entry))
        manifest = true
      } else if (path === USER_PATH && !index && sessionFiles.size === 0) {
        await skipEntry(entry)
      } else if (sessionId !== null && !index) {
        if (sessionFiles.has(sessionId)) {
          fail('backupIncomplete')
        }
        sessionFiles.set(sessionId, readSessionFile(await readJson(entry)))
        currentSessionId = sessionId
      } else if (path === INDEX_PATH && !index) {
        index = readSessionIndex(await readJson(entry))
      } else if (path === GENERATED_PATH) {
        const sidecar = (await readJson(entry)) as { images?: Record<string, GeneratedImageMeta> }
        generated = sidecar && typeof sidecar === 'object' && sidecar.images ? sidecar.images : {}
      } else if (
        index
          ? sessionFiles.has(/^chat_sessions\/([^/]+)_files\//.exec(path)?.[1] ?? '')
          : currentSessionId && path.startsWith(sessionFilesDir(currentSessionId))
      ) {
        await convertSessions()
        const id = images.get(path)
        await (id === undefined ? skipEntry(entry) : saveImage(entry, id))
      } else {
        fail('backupIncomplete')
      }
    }
  } catch (error) {
    throw error instanceof ArchiveError ? new BackupError('backupIncomplete') : error
  }
  if (!manifest) {
    fail('backupUnrecognized')
  }
  await convertSessions()
  const listed = new Set(index?.map((entry) => entry.id))
  if (
    !index ||
    listed.size !== index.length ||
    listed.size !== imported.size ||
    [...imported].some((id) => !listed.has(id))
  ) {
    fail('backupIncomplete')
  }
  await db.updateStagingFileTypes(stored)
  return generated
}
