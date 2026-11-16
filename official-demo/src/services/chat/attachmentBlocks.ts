// 附件按目标协议准备请求块：DeepSeek 用 Files API file_id；第三方用自身 base64 格式。
// 纯函数，便于内存回归。不支持的组合在发送前返回具体错误，调用方保留草稿。
import type { FileBlockParam } from '../api/types.js'

export type AttachmentProtocol = 'deepseek' | 'openai' | 'anthropic'
export type AttachmentCaps = { vision: boolean; documents: boolean }

export type AttachmentSource = {
  id: string
  name: string
  isImage: boolean
  mimeType: string
  /** DeepSeek Files API 返回的 file_id（仅官方路径） */
  serverId?: string | null
  /** 本地原件的 base64 data URL（第三方路径） */
  dataUrl?: string | null
}

/** 拆解 data URL 为 media_type 与纯 base64 数据 */
export const parseDataUrl = (dataUrl: string): { media_type: string; data: string } | null => {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  return { media_type: match[1], data: match[2] }
}

/** 发送前的同步能力校验：仅检查模型/协议是否支持附件类型，不涉及原件读取 */
export const attachmentSupportError = (
  files: { name: string; isImage: boolean }[],
  protocol: AttachmentProtocol,
  caps: AttachmentCaps
): string | null => {
  if (protocol === 'deepseek') return null
  for (const file of files) {
    if (file.isImage && !caps.vision) {
      return `当前模型不支持图片附件（${file.name}）。请切换到支持视觉的模型，或移除该图片。`
    }
    if (!file.isImage && !caps.documents) {
      return `当前接口不支持文档附件（${file.name}）。OpenAI/Anthropic 兼容聊天仅支持图片，请移除文档或改用 DeepSeek 官方。`
    }
  }
  return null
}

/**
 * 构建附件内容块。
 * - deepseek：file_id 引用（缺 serverId 的附件跳过，由上传补齐）；
 * - openai：图片转 image_url 所需的 base64 image 块（需 vision）；文档默认不支持；
 * - anthropic：图片/文档转 base64 块（图片需 vision，文档需 documents）。
 * 任一附件不被支持时返回 error，blocks 为空，调用方据此阻止发送并保留草稿。
 */
export const buildAttachmentBlocks = (
  files: AttachmentSource[],
  protocol: AttachmentProtocol,
  caps: AttachmentCaps
): { blocks: FileBlockParam[]; error?: string } => {
  const blocks: FileBlockParam[] = []
  for (const file of files) {
    if (protocol === 'deepseek') {
      if (file.serverId) {
        blocks.push({ type: file.isImage ? 'image' : 'document', source: { type: 'file', file_id: file.serverId } })
      }
      continue
    }
    if (file.isImage) {
      if (!caps.vision) return { blocks: [], error: `当前模型不支持图片附件（${file.name}）。请切换到支持视觉的模型，或移除该图片。` }
    } else if (!caps.documents) {
      return { blocks: [], error: `当前接口不支持文档附件（${file.name}）。OpenAI/Anthropic 兼容聊天仅支持图片，请移除文档或改用 DeepSeek 官方。` }
    }
    if (!file.dataUrl) return { blocks: [], error: `附件缺少本地原件（${file.name}），请重新添加。` }
    const parsed = parseDataUrl(file.dataUrl)
    if (!parsed) return { blocks: [], error: `附件原件读取失败（${file.name}），请重新添加。` }
    blocks.push({
      type: file.isImage ? 'image' : 'document',
      source: { type: 'base64', media_type: parsed.media_type || file.mimeType || 'application/octet-stream', data: parsed.data },
    })
  }
  return { blocks }
}