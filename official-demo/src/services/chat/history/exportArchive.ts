import * as db from '../db.js'
import { getImageById } from '../../images.js'
import type { Session } from '../types.js'
import { EXPORT_FORMAT_VERSION, type GeneratedImageMeta, type Manifest, type SessionIndexEntry } from './format.js'
import { GENERATED_PATH, INDEX_PATH, MANIFEST_PATH, imagePath, sessionPath } from './paths.js'
import { toIndexEntry, toSessionFile } from './toArchive.js'
import { writeArchive } from './zipWriter.js'

const json = (value: unknown) => new Blob([JSON.stringify(value)], { type: 'application/json' })

/**
 * 按导出格式生成 ZIP：manifest → 全部会话 JSON → index → 生成图元数据侧车 → 全部图片。
 * 用户附件与助手生成图都写出本地原件；生成图另存元数据侧车以恢复卡片与图库派生关系。
 */
export const exportArchive = async (
  sessions: Iterable<Session> | AsyncIterable<Session>
): Promise<Blob> => {
  const manifest: Manifest = { export_format_version: EXPORT_FORMAT_VERSION }
  const entries = [{ name: MANIFEST_PATH, blob: json(manifest) }]
  const imageEntries: { name: string; blob: Blob }[] = []
  const index: SessionIndexEntry[] = []
  const originals = new Map<string, Blob | undefined>()
  const generatedMeta: Record<string, GeneratedImageMeta> = {}
  for await (const session of sessions) {
    for (const message of session.messages) {
      if (message.role === 'user') {
        for (const file of message.files) {
          if (file.isImage && !originals.has(file.id)) {
            originals.set(file.id, await db.loadFile(file.id))
          }
        }
      }
    }
    const images = new Map<string, Blob>()
    // 助手生成图：读取图库原件，记录元数据（含编辑派生 parentId）
    const generatedPaths = new Map<string, string>()
    for (const message of session.messages) {
      if (message.role !== 'assistant') continue
      for (const block of message.blocks) {
        if (block.type !== 'generated_image' || generatedPaths.has(block.imageId)) continue
        const image = await getImageById(block.imageId)
        if (!image) continue
        const path = imagePath(session.id, block.imageId, `${block.imageId}.png`)
        generatedPaths.set(block.imageId, path)
        images.set(path, image.blob)
        generatedMeta[block.imageId] = {
          sessionId: session.id,
          prompt: block.prompt,
          provider: block.provider,
          providerName: block.providerName,
          model: block.model,
          createdAt: block.createdAt,
          ...(image.parentId ? { parentId: image.parentId } : {}),
        }
      }
    }
    const data = toSessionFile(
      session,
      ({ id, name, isImage }) => {
        const blob = originals.get(id)
        if (!blob || !isImage) {
          return null
        }
        const path = imagePath(session.id, id, name)
        images.set(path, blob)
        return path
      },
      (imageId) => generatedPaths.get(imageId) ?? null
    )
    entries.push({ name: sessionPath(session.id), blob: json(data) })
    for (const [name, blob] of images) {
      imageEntries.push({ name, blob })
    }
    index.push(toIndexEntry(data))
  }
  entries.push({ name: INDEX_PATH, blob: json(index) })
  if (Object.keys(generatedMeta).length > 0) {
    entries.push({ name: GENERATED_PATH, blob: json({ images: generatedMeta }) })
  }
  return writeArchive(entries.concat(imageEntries))
}
