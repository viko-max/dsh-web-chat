// 面板模型目录与选择：DeepSeek 官方 + Harness 模型 + Spark + 自定义服务商。
// 默认选择用于新对话；会话内选择只影响该会话后续回复。
import { create } from 'zustand'
import { chatCatalog, type CatalogModel } from './panel.js'

export type ModelSelection = { provider: string; model: string }

/** 客户端哨兵：DeepSeek 官方走原 op=messages 代理路径 */
export const DEEPSEEK_PROVIDER = 'deepseek-official'

export const defaultSelection: ModelSelection = { provider: DEEPSEEK_PROVIDER, model: 'deepseek-flash' }

const deepseekEntry: CatalogModel = {
  provider: DEEPSEEK_PROVIDER,
  model: 'deepseek-flash',
  name: 'DeepSeek-V4-Flash · DeepSeek',
  tools: true,
}

const STORAGE_KEY = 'dsh-web-chat:model-selections'

type Saved = { selection?: ModelSelection; sessionSelections?: Record<string, ModelSelection> }

const load = (): Saved => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null) return {}
    const saved = parsed as Saved
    const valid = (value: unknown): value is ModelSelection =>
      typeof value === 'object' && value !== null &&
      typeof (value as ModelSelection).provider === 'string' &&
      typeof (value as ModelSelection).model === 'string'
    return {
      selection: valid(saved.selection) ? saved.selection : undefined,
      sessionSelections: Object.fromEntries(
        Object.entries(saved.sessionSelections ?? {}).filter(([, value]) => valid(value))
      ),
    }
  } catch {
    return {}
  }
}

type PanelModelsState = {
  catalog: CatalogModel[]
  unavailable: string[]
  loading: boolean
  selection: ModelSelection
  sessionSelections: Record<string, ModelSelection>
}

const saved = load()

export const usePanelModels = create<PanelModelsState>(() => ({
  catalog: [deepseekEntry],
  unavailable: [],
  loading: false,
  selection: saved.selection ?? defaultSelection,
  sessionSelections: saved.sessionSelections ?? {},
}))

const persist = () => {
  try {
    const { selection, sessionSelections } = usePanelModels.getState()
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ selection, sessionSelections }))
  } catch {
    // 存储不可用时只在内存中生效
  }
}

let refreshPromise: Promise<void> | null = null

/** 拉取模型目录（去重）；失败时保留 DeepSeek 官方入口 */
export const refreshPanelModels = (): Promise<void> => {
  refreshPromise ??= (async () => {
    usePanelModels.setState({ loading: true })
    try {
      const result = await chatCatalog()
      const catalog = [deepseekEntry, ...result.models]
      const state = usePanelModels.getState()
      const exists = (value: ModelSelection) =>
        catalog.some((item) => item.provider === value.provider && item.model === value.model)
      usePanelModels.setState({
        catalog,
        unavailable: result.unavailable,
        loading: false,
        selection: exists(state.selection) ? state.selection : defaultSelection,
        sessionSelections: Object.fromEntries(
          Object.entries(state.sessionSelections).filter(([, value]) => exists(value))
        ),
      })
    } catch {
      usePanelModels.setState({ loading: false })
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

export const selectModel = (selection: ModelSelection) => {
  usePanelModels.setState({ selection })
  persist()
}

export const selectSessionModel = (sessionId: string, selection: ModelSelection) => {
  usePanelModels.setState((state) => ({
    sessionSelections: { ...state.sessionSelections, [sessionId]: selection },
  }))
  persist()
}

/** 会话生效选择：会话内选择 > 默认选择 */
export const selectionFor = (sessionId: string | null): ModelSelection => {
  const state = usePanelModels.getState()
  return (sessionId ? state.sessionSelections[sessionId] : undefined) ?? state.selection
}

export type AttachmentTarget = {
  protocol: 'deepseek' | 'openai' | 'anthropic'
  caps: { vision: boolean; documents: boolean }
}

/** 按当前选择决定附件协议与能力：DeepSeek 用文件接口，第三方用自身 base64 格式 */
export const attachmentTargetFor = (selection: ModelSelection): AttachmentTarget => {
  if (selection.provider === DEEPSEEK_PROVIDER) {
    return { protocol: 'deepseek', caps: { vision: true, documents: true } }
  }
  if (selection.provider === 'dswc-spark') {
    return { protocol: 'openai', caps: { vision: true, documents: false } }
  }
  const entry = usePanelModels
    .getState()
    .catalog.find((item) => item.provider === selection.provider && item.model === selection.model)
  const protocol = entry?.protocol ?? 'anthropic'
  const vision = entry?.vision ?? true
  return { protocol, caps: { vision, documents: protocol === 'anthropic' } }
}