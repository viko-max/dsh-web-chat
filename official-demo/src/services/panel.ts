// 面板 Host API 客户端：封装 /api/dsh-web-chat-panel?op= 调用。
// 仅面板模式可用；独立 demo 模式下这些 op 不存在。
import { API_ORIGIN } from './api/client.js'

const op = async <T>(name: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${API_ORIGIN}?op=${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error?: { message?: string } }).error?.message ?? '')
        : ''
    throw new Error(message || `请求失败（HTTP ${response.status}）`)
  }
  return data as T
}

// ---- 对话服务商 ----

export type ChatProviderModel = {
  id: string
  name: string
  tools: boolean
  vision: boolean
  thinking: boolean
}

export type ChatProvider = {
  id: string
  name: string
  protocol: 'openai' | 'anthropic'
  baseUrl: string
  models: ChatProviderModel[]
}

export type ChatProvidersState = {
  providers: ChatProvider[]
  keys: Record<string, boolean>
}

export type ChatTestResult = {
  ok: boolean
  kind: 'connect' | 'tools'
  latencyMs: number
  sample?: string
  error?: string
  trace?: {
    first?: unknown
    toolCall?: { name: string; input: unknown }
    toolResult?: unknown
    finalText?: string
  }
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number } | null
}

export const listChatProviders = () => op<ChatProvidersState>('chat-providers-list')
export const saveChatProvider = (provider: Omit<ChatProvider, 'id'> & { id?: string }, key?: string) =>
  op<{ saved: boolean; id: string }>('chat-providers-save', { provider, ...(key ? { key } : {}) })
export const deleteChatProvider = (id: string) => op<{ ok: boolean }>('chat-providers-delete', { id })
export const testChatProvider = (id: string, model: string, kind: 'connect' | 'tools') =>
  op<ChatTestResult>('chat-providers-test', { id, model, kind })

// ---- 图像服务 ----

export type ImageService = {
  id: string
  name: string
  endpoint: string
  generationModel: string
  editModel: string
  domains: string[]
}

export type ImageServicesState = {
  services: ImageService[]
  keys: Record<string, boolean>
}

export type ImageTestResult = {
  ok: boolean
  latencyMs: number
  bytes?: number
  mediaType?: string
  error?: string
}

export type ImageOption = {
  id: string
  name: string
  generationModel: string
  editModel: string
  ready: boolean
  custom?: boolean
}

export const listImageServices = () => op<ImageServicesState>('image-services-list')
export const saveImageService = (service: Omit<ImageService, 'id'> & { id?: string }, key?: string) =>
  op<{ saved: boolean; id: string }>('image-services-save', { service, ...(key ? { key } : {}) })
export const deleteImageService = (id: string) => op<{ ok: boolean }>('image-services-delete', { id })
export const testImageService = (id: string) => op<ImageTestResult>('image-services-test', { id })
export const imageOptions = () => op<ImageOption[]>('image-options')

export type ImageModelEntry = { id: string; name: string }
/** 动态拉取某图像提供商的最新模型列表（失败回退默认） */
export const imageModels = (provider: string) =>
  op<{ models: ImageModelEntry[]; source: 'live' | 'fallback' }>('image-models', { provider })

/** 预设图像服务凭据（千问/火山/硅基流动/混元）与 Spark 聊天 Key 的旧接口，保留兼容 */
export const serviceKeyStatus = () => op<Record<string, boolean>>('service-key-status')
export const saveServiceKey = (id: string, key: string) =>
  op<{ saved: boolean }>('service-key-save', { id, key })

// ---- 模型目录 ----

export type CatalogModel = {
  provider: string
  model: string
  name: string
  tools: boolean
  custom?: boolean
  /** 第三方协议（自定义服务商）；缺省按 Anthropic 形态处理 */
  protocol?: 'openai' | 'anthropic'
  /** 是否支持图片附件 */
  vision?: boolean
}

export const chatCatalog = () =>
  op<{ models: CatalogModel[]; unavailable: string[] }>('models')

/** DeepSeek 官方 Key 状态（Host 凭据）：ok=false 表示未配置 */
export const deepseekStatus = async (): Promise<{ ok: boolean; offline: boolean }> => {
  try {
    const result = await op<{ offline: boolean }>('status')
    return { ok: true, offline: result.offline }
  } catch {
    return { ok: false, offline: false }
  }
}

// ---- OCR 提取文字 ----

export type OcrResult = { pages: { index: number; text: string }[] }

/** 上传图片/PDF，经 Host op=ocr 提取文字 */
export const extractText = async (file: File, signal?: AbortSignal): Promise<string> => {
  const form = new FormData()
  form.append('file', file, file.name)
  const response = await fetch(`${API_ORIGIN}?op=ocr`, { method: 'POST', body: form, signal })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error?: { message?: string } }).error?.message ?? '')
        : ''
    throw new Error(message || `提取失败（HTTP ${response.status}）`)
  }
  if (typeof data === 'object' && data !== null && 'error' in data) {
    throw new Error('文档无法识别，请换一张图片或 PDF。')
  }
  const pages = (data as OcrResult)?.pages
  if (!Array.isArray(pages)) throw new Error('提取结果为空。')
  return pages.map((page) => page.text).join('\n\n').trim()
}