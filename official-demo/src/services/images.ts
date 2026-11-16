// 生图工作台服务：生成/编辑请求 + 本地图像库（IndexedDB）。
// 图像按来源会话保存；会话删除后其图库条目一并清理。
import { create } from 'zustand'
import { openDB, type IDBPDatabase } from 'idb'
import { API_ORIGIN } from './api/client.js'
import { imageOptions, type ImageOption } from './panel.js'
import { useSettings } from './settings.js'

export type GeneratedImage = {
  id: string
  sessionId: string | null
  prompt: string
  provider: string
  providerName: string
  model: string
  createdAt: number
  /** 编辑来源图像 id */
  parentId?: string
  blob: Blob
}

type ImageRow = Omit<GeneratedImage, 'blob'> & { blob: Blob }

const DB_NAME = 'dsh-web-chat-images'
const STORE = 'images'

let dbPromise: Promise<IDBPDatabase> | null = null
const db = () => {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'id' })
      }
    },
  })
  return dbPromise
}

type ImagesState = {
  images: GeneratedImage[]
  options: ImageOption[]
  loading: boolean
  generating: boolean
  error: string
}

export const useImages = create<ImagesState>(() => ({
  images: [],
  options: [],
  loading: false,
  generating: false,
  error: '',
}))

export const refreshImageOptions = async () => {
  try {
    useImages.setState({ options: await imageOptions() })
  } catch {
    useImages.setState({ options: [] })
  }
}

export const loadImages = async () => {
  useImages.setState({ loading: true })
  try {
    const database = await db()
    const rows = (await database.getAll(STORE)) as ImageRow[]
    rows.sort((a, b) => b.createdAt - a.createdAt)
    useImages.setState({ images: rows, loading: false })
  } catch {
    useImages.setState({ loading: false })
  }
}

/** 生成或编辑图像；reference 为参考图（编辑） */
export const generateImage = async (params: {
  provider: string
  prompt: string
  model?: string
  reference?: File | Blob
  sessionId: string | null
  parentId?: string
  signal?: AbortSignal
}): Promise<GeneratedImage> => {
  useImages.setState({ generating: true, error: '' })
  try {
    const form = new FormData()
    form.set('provider', params.provider)
    form.set('prompt', params.prompt)
    if (params.model) form.set('model', params.model)
    if (params.reference) form.set('reference', params.reference, 'reference.png')
    const response = await fetch(`${API_ORIGIN}?op=image-generate`, { method: 'POST', body: form, signal: params.signal })
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null)
      const message =
        typeof data === 'object' && data !== null && 'error' in data
          ? String((data as { error?: { message?: string } }).error?.message ?? '')
          : ''
      throw new Error(message || `生图失败（HTTP ${response.status}）`)
    }
    const blob = await response.blob()
    const option = useImages.getState().options.find((item) => item.id === params.provider)
    // 记录后端实际请求使用的模型（预设可能按操作路由到不同模型）
    const actualModel = response.headers.get('x-image-model') || params.model || option?.generationModel || ''
    const image: GeneratedImage = {
      id: crypto.randomUUID(),
      sessionId: params.sessionId,
      prompt: params.prompt,
      provider: params.provider,
      providerName: option?.name ?? params.provider,
      model: actualModel,
      createdAt: Date.now(),
      ...(params.parentId ? { parentId: params.parentId } : {}),
      blob,
    }
    const database = await db()
    await database.put(STORE, image)
    useImages.setState((state) => ({ images: [image, ...state.images], generating: false }))
    return image
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    useImages.setState({ generating: false, error: message })
    throw error
  }
}

export const deleteImage = async (id: string) => {
  const database = await db()
  await database.delete(STORE, id)
  useImages.setState((state) => ({ images: state.images.filter((image) => image.id !== id) }))
}

/** 工具调用生图：自动选一个已配置 Key 的图像服务 */
export const generateImageAuto = async (
  prompt: string,
  sessionId: string | null,
  signal?: AbortSignal
): Promise<GeneratedImage> => {
  let options = useImages.getState().options
  if (!options.length) {
    options = await imageOptions()
    useImages.setState({ options })
  }
  const ready = options.find((option) => option.ready)
  if (!ready) throw new Error('尚未配置图像服务，请先在「设置 → 图像服务」填写 API Key。')
  const preferred = useSettings.getState().imageModelPrefs[ready.id]
  return generateImage({ provider: ready.id, prompt, sessionId, signal, ...(preferred ? { model: preferred } : {}) })
}

/** 会话删除后清理其图库条目（含编辑派生图） */
export const purgeSessionImages = async (sessionIds: Set<string>) => {
  const { images } = useImages.getState()
  const removed = images.filter((image) => image.sessionId !== null && sessionIds.has(image.sessionId))
  if (!removed.length) return
  const database = await db()
  for (const image of removed) await database.delete(STORE, image.id)
  const removedIds = new Set(removed.map((image) => image.id))
  useImages.setState((state) => ({ images: state.images.filter((image) => !removedIds.has(image.id)) }))
}

export const imageUrl = (image: GeneratedImage) => URL.createObjectURL(image.blob)

/** 按 id 读取单张图像（聊天卡片/查看器用，先查内存再查 IndexedDB） */
export const getImageById = async (id: string): Promise<GeneratedImage | null> => {
  const cached = useImages.getState().images.find((image) => image.id === id)
  if (cached) return cached
  try {
    const database = await db()
    return ((await database.get(STORE, id)) as ImageRow | undefined) ?? null
  } catch {
    return null
  }
}

/** 历史导入恢复生成图：写入图库（含编辑派生 parentId），幂等覆盖同 id */
export const restoreGeneratedImage = async (
  meta: Omit<GeneratedImage, 'blob'>,
  blob: Blob
): Promise<void> => {
  const image: GeneratedImage = { ...meta, blob }
  const database = await db()
  await database.put(STORE, image)
  useImages.setState((state) => ({
    images: [image, ...state.images.filter((item) => item.id !== image.id)],
  }))
}