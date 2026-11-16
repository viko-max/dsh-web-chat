import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { ApiError, PANEL_MODE, streamMessage, streamPanelReply } from '../api/client.js'
import { DEEPSEEK_PROVIDER, attachmentTargetFor, selectionFor, type AttachmentTarget } from '../panelModels.js'
import type { ChatModel, CreateMessageRequest, FileBlockParam, MessageParam } from '../api/types.js'
import { availableAppTools, executeAppTool, useApps } from '../apps.js'
import { generateImageAuto, useImages } from '../images.js'
import { extractFileIds, getFileErrorCode, isRetryableApiError } from '../api/errors.js'
import { cancelUpload, describeUploadError, uploadAttachment, useUploads } from '../attachments.js'
import { attachmentSupportError, buildAttachmentBlocks } from './attachmentBlocks.js'
import { isDrawingIntent } from './drawingIntent.js'
import { showToast } from '../../components/base/toastState.js'
import { useSettings } from '../settings.js'
import { appendBranch, getVisibleMessages, normalizeSession, selectVersion } from './branches.js'
import * as db from './db.js'
import {
  clearAllDrafts,
  clearDraft,
  clearSentDraft,
  getDraft,
  prepareDraftMessage,
} from './drafts.js'
import { createLatestReminder } from './latestReminder.js'
import { buildCompactedMessages } from './compact.js'
import { buildPersonalizationPrompt, mergePersonalization } from '../personalization.js'
import { translate } from '../../i18n/index.js'
import {
  applyEvent,
  canContinueReply,
  createUsageAccumulator,
  getContextRounds,
  settleReply,
} from './reply.js'
import {
  toSessionSummary,
  type AppToolBlock,
  type AssistantMessage,
  type FileAttachment,
  type GeneratedImageBlock,
  type Message,
  type Session,
  type SessionSummary,
  type UserMessage,
} from './types.js'

/** deepseek-flash 同时支持深度思考与图片输入 */
const MODEL: ChatModel = 'deepseek-flash'

/** 生图工具：模型在用户要求画图时自行调用（ChatGPT 式），客户端执行图像 API 并 inline 出图 */
const GENERATE_IMAGE_TOOL = {
  name: 'generate_image',
  description:
    'Generate an image from a text description and show it to the user. Call this whenever the user asks to draw, create, generate or design an image, picture, illustration, poster, avatar or wallpaper. Write the prompt in detail.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Detailed description of the image to generate' },
    },
    required: ['prompt'],
  },
}
/** 所有生成请求统一携带的助手身份说明 */
const SYSTEM_PROMPT = '该助手为DeepSeek，由深度求索公司创造。'
/** 保留最近打开的详情；当前会话、生成中及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5
/** 安全审核固定开启，所有请求都走扩展模式 */
const SAFETY_CHECK = { level: 'high' } as const
/** 服务端判定 file_id 失效后，重新补传并重发的最多次数（不含首次请求） */
const FILE_RETRY_LIMIT = 2
/** 退避基数，第 n 次重试等待 2^n 倍；连续失败达到上限就放弃，把原始报错展示出来 */
const FILE_RETRY_BASE_DELAY = 1000

/** 阅读链接始终开启，智能搜索开关控制是否另行声明搜索工具（含边想边搜）。 */
const serverTools = (search: boolean): CreateMessageRequest['tools'] => {
  const tools: CreateMessageRequest['tools'] = [
    { type: 'deepseek_read_url', name: 'deepseek_read_url' },
  ]
  if (search) {
    tools.push({ type: 'deepseek_web_search', name: 'deepseek_web_search' })
  }
  return tools
}

/** 允许自动补标题的请求；手动重命名后取消本轮标题写入，包含主动清空标题的情况。 */
const titleRequests = new Set<AbortController>()

/** 组装系统提示：身份 + 回复风格 + 个性化（全局与会话覆盖合并） */
const buildSystem = (sessionId: string): string => {
  const { replyStyle, personalization, sessionPersonalization } = useSettings.getState()
  let system = SYSTEM_PROMPT
  if (replyStyle.text?.trim()) {
    system += '\n\n【回复风格】' + replyStyle.text.trim()
  }
  system += buildPersonalizationPrompt(mergePersonalization(personalization, sessionPersonalization[sessionId]))
  // 已配置图像服务时，明确引导模型用工具实际出图，而非仅文字描述（第三方模型尤其需要）
  if (PANEL_MODE && useImages.getState().options.some((option) => option.ready)) {
    system +=
      '\n\n【图像生成】你拥有 generate_image 工具。当用户要求绘画、画一张、生成/设计/制作图片、图像、插画、海报、头像、壁纸等任何视觉创作时，必须调用 generate_image 工具实际生成图片，禁止只用文字描述画面或声称无法生成。prompt 参数用细节丰富的描述。生成成功后用一两句话简短说明即可。'
  }
  return system
}

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 仅列表元数据，按 updatedAt 降序；流式消息更新不会改变此数组。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示新对话（欢迎页） */
  activeId: string | null
  /** 正在生成回复的会话 */
  streaming: Record<string, AbortController>
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  streaming: {},
}))

const { getState: get, setState: set } = useChatStore

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const getStreamController = (id: string) => {
  const streams = get().streaming
  return Object.hasOwn(streams, id) ? streams[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const pendingFiles = new Map<string, db.StoredFile[]>()
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
const streamFlushes = new Map<string, () => void>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter(
      (id) =>
        id !== state.activeId &&
        !Object.hasOwn(state.streaming, id) &&
        !unsavedSessions.has(id) &&
        !deletingSessions.has(id)
    )
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const updateReply = (sessionId: string, reply: AssistantMessage) =>
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.id === reply.id
        ? { ...reply, parentId: message.parentId, selectedChildId: message.selectedChildId }
        : message
    ),
  }))

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    const files = pendingFiles.get(sessionId)
    void db
      .saveSession(session, files)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (pendingFiles.get(sessionId) === files) {
          pendingFiles.delete(sessionId)
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前先合并尚未绘制的增量；隐藏期间浏览器可能暂停动画帧。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const [id, flush] of streamFlushes) {
      flush()
      persist(id)
    }
    for (const id of unsavedSessions) {
      if (!streamFlushes.has(id)) {
        persist(id)
      }
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 按当前开关创建回复：深度思考对应 thinking，智能搜索控制 deepseek_web_search。 */
const createReply = (sessionId?: string | null): AssistantMessage => {
  const { thinking, search } = useSettings.getState()
  const selection = PANEL_MODE ? selectionFor(sessionId ?? null) : null
  const panelRoute = selection && selection.provider !== DEEPSEEK_PROVIDER
  return {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: panelRoute ? null : MODEL,
    ...(panelRoute ? { panelProvider: selection.provider, panelModel: selection.model } : {}),
    thinking,
    search,
    prefix: true,
    status: 'pending',
    blocks: [],
  }
}

/** 仍在生成中的回复（页面关闭或导出时未结束）按「已停止」处理 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) =>
      m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
        ? settleReply(m, 'stopped', session.updatedAt)
        : m
    ),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      const summaries = await db.loadSessionSummaries()
      if (epoch === historyEpoch) {
        set({ ready: true, sessions: sortSessions(summaries) })
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/** 等所有回复的收尾（落盘）完成 */
const waitForIdle = (sessionId?: string) =>
  new Promise<void>((resolve) => {
    const isIdle = (state: ChatState) =>
      sessionId === undefined
        ? Object.keys(state.streaming).length === 0
        : !Object.hasOwn(state.streaming, sessionId)
    if (isIdle(get())) {
      resolve()
      return
    }
    const unsubscribe = useChatStore.subscribe((state) => {
      if (isIdle(state)) {
        unsubscribe()
        resolve()
      }
    })
  })

/**
 * 替换历史对话：先写入暂存，成功后原子替换旧记录；写入为空即删除全部会话与附件。
 * 期间停止生成并禁止修改会话；失败时清除暂存，保留原有记录。
 */
export const replaceHistory = async (write: () => Promise<void>): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History replacement is already in progress')
  }
  set({ importingHistory: true })
  try {
    for (const controller of Object.values(get().streaming)) {
      controller.abort()
    }
    // 已开始的单条删除先同步到内存，避免本次替换失败后列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await waitForIdle()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStaging()
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history replacement'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    pendingFiles.clear()
    clearAllDrafts()
    set({
      ready: true,
      initError: false,
      sessions: sortSessions(summaries),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
    })
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    // 替换失败时恢复被取消的详情读取，原有记录继续可用。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  const controller = getStreamController(id)
  if (controller) {
    titleRequests.delete(controller)
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
  }
}

/**
 * 删除会话；本地原件仅在没有其他会话引用时清理。远端文件不删：导入、编辑、重新生成都会复用同一个附件，
 * 同一服务端文件可能被多个会话引用，不维护引用计数。
 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    getStreamController(id)?.abort()
    // 等本会话的流收尾，避免删除之后又被收尾保存写回来。
    await waitForIdle(id)
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    pendingFiles.delete(id)
    clearDraft(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存停止生成后的最新状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

export const stopReply = (sessionId: string) => getStreamController(sessionId)?.abort()

/** 追加一条已完成的助手文本消息（自动化结果写入网页对话用） */
export const appendAssistantText = (sessionId: string, text: string): boolean => {
  const session = getSession(sessionId)
  if (!session || get().importingHistory) {
    return false
  }
  const reply: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: null,
    prefix: false,
    status: 'done',
    blocks: [{ type: 'text', text }],
    stopReason: 'end_turn',
  }
  const last = getVisibleMessages(session).at(-1)
  updateSession(sessionId, (current) => ({
    ...appendBranch(current, last?.id ?? null, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  return true
}

/**
 * 自动化结果投递：异步追加助手文本并等待写盘成功。
 * 目标会话未打开时先从 IndexedDB 加载；写盘失败返回 false（收件箱保留可重试）。
 */
export const deliverAssistantText = async (sessionId: string, text: string): Promise<boolean> => {
  if (get().importingHistory) return false
  let session = getSession(sessionId)
  if (!session) {
    session = await db.loadSession(sessionId)
    if (!session) return false
    const loaded = session
    set((state) => ({ sessionCache: { ...state.sessionCache, [sessionId]: loaded } }))
  }
  const reply: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: null,
    prefix: false,
    status: 'done',
    blocks: [{ type: 'text', text }],
    stopReason: 'end_turn',
  }
  const last = getVisibleMessages(session).at(-1)
  const updated = { ...appendBranch(session, last?.id ?? null, [reply]), updatedAt: Date.now() }
  try {
    await db.saveSession(updated)
  } catch {
    return false
  }
  set((state) => ({
    sessionCache: { ...state.sessionCache, [sessionId]: updated },
    sessions: sortSessions(
      state.sessions.some((summary) => summary.id === sessionId)
        ? state.sessions.map((summary) => (summary.id === sessionId ? toSessionSummary(updated) : summary))
        : [toSessionSummary(updated), ...state.sessions]
    ),
  }))
  return true
}

/** 追加一条生成图像消息（ChatGPT 式聊天内卡片） */
export const appendImageMessage = (sessionId: string, block: GeneratedImageBlock): boolean => {
  const session = getSession(sessionId)
  if (!session || get().importingHistory) {
    return false
  }
  const reply: AssistantMessage = {
    id: createId(),
    role: 'assistant',
    createdAt: Date.now(),
    model: null,
    prefix: false,
    status: 'done',
    blocks: [block],
    stopReason: 'end_turn',
  }
  const last = getVisibleMessages(session).at(-1)
  updateSession(sessionId, (current) => ({
    ...appendBranch(current, last?.id ?? null, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  return true
}

/**
 * 提交指定会话的最新草稿；null 表示新建会话。
 * 同步接收成功才清空草稿，附件原件由会话接管；保存失败仍通过保存入口重试。
 */
/** 绘画请求：直接调用图像服务出图并作为回复卡片，绕过不可靠的模型工具调用 */
const generateImageReply = async (sessionId: string, initial: AssistantMessage, prompt: string) => {
  const controller = new AbortController()
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  const startedAt = Date.now()
  let reply: AssistantMessage = { ...initial, status: 'streaming' }
  updateReply(sessionId, reply)
  try {
    const image = await generateImageAuto(prompt, sessionId, controller.signal)
    reply = {
      ...reply,
      status: 'done',
      stopReason: 'end_turn',
      blocks: [
        {
          type: 'generated_image',
          imageId: image.id,
          prompt: image.prompt,
          provider: image.provider,
          providerName: image.providerName,
          model: image.model,
          createdAt: image.createdAt,
        },
      ],
      stats: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheHitRate: null,
        tps: null,
        durationMs: Date.now() - startedAt,
      },
    }
    updateReply(sessionId, reply)
    persist(sessionId)
  } catch (error) {
    reply = controller.signal.aborted
      ? settleReply(reply, 'stopped', Date.now())
      : settleReply(reply, 'error', Date.now(), {
          kind: 'protocol',
          message: error instanceof Error ? error.message : String(error),
        })
    updateReply(sessionId, reply)
    persist(sessionId)
  } finally {
    set((state) => ({
      streaming: Object.fromEntries(Object.entries(state.streaming).filter(([id]) => id !== sessionId)),
    }))
  }
}

export const sendMessage = (targetSessionId: string | null) => {
  if (get().importingHistory || !get().ready) {
    return false
  }
  const prepared = prepareDraftMessage(getDraft(targetSessionId), useUploads.getState().tasks)
  if (!prepared) {
    return false
  }
  const { text, files } = prepared
  // 发送前按当前模型能力校验附件；不支持时提示具体限制并保留草稿供用户处理
  if (PANEL_MODE && files.length > 0) {
    const target = attachmentTargetFor(selectionFor(targetSessionId))
    const supportError = attachmentSupportError(files, target.protocol, target.caps)
    if (supportError) {
      showToast(supportError)
      return false
    }
  }
  const now = Date.now()
  let sessionId = targetSessionId
  if (
    sessionId !== null &&
    (deletingSessions.has(sessionId) || getStreamController(sessionId) || !getSession(sessionId))
  ) {
    return false
  }
  if (sessionId === null) {
    const session: Session = {
      id: createId(),
      title: '',
      createdAt: now,
      updatedAt: now,
      messages: [],
      rootMessageId: null,
    }
    sessionId = session.id
    touchSession(session.id)
    set((state) => ({
      sessions: [toSessionSummary(session), ...state.sessions],
      sessionCache: { ...state.sessionCache, [session.id]: session },
      activeId: session.id,
    }))
  }
  const current = getSession(sessionId)
  if (!current) {
    return false
  }
  const history = getVisibleMessages(current)
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: files.map(({ id, serverId, name, size, isImage, mimeType }) => ({
      id,
      serverId,
      name,
      size,
      isImage,
      mimeType,
    })),
    createdAt: now,
  }
  const reply = createReply(sessionId)
  updateSession(sessionId, (session) => ({
    ...appendBranch(session, history.at(-1)?.id ?? null, [question, reply]),
    updatedAt: now,
  }))
  if (files.length > 0) {
    pendingFiles.set(sessionId, [
      ...(pendingFiles.get(sessionId) ?? []),
      ...files.map(({ id, blob }) => ({ id, blob })),
    ])
  }
  persist(sessionId)
  clearSentDraft(targetSessionId)
  // 绘画意图 + 已配置图像服务：客户端直接出图（可靠），否则走正常对话
  if (PANEL_MODE && isDrawingIntent(text) && useImages.getState().options.some((option) => option.ready)) {
    void generateImageReply(sessionId, reply, text)
  } else {
    void streamReply(sessionId, reply, { history, question })
  }
  return true
}

/** 重新生成当前路径上的回答：在原问题下新增版本，不覆盖旧回答和后续对话。 */
export const regenerateReply = (sessionId: string, messageId?: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index =
    messageId === undefined ? path.length - 1 : path.findIndex((m) => m.id === messageId)
  const question = path[index - 1]
  if (question?.role !== 'user' || path[index]?.role !== 'assistant') {
    return
  }
  const history = path.slice(0, index - 1)
  const reply = createReply(sessionId)
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, question.id, [reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history, question })
}

/** 编辑提问后新增同父版本，保留原文件；旧问题的所有回答与后续对话仍可切回。 */
export const editMessage = (sessionId: string, messageId: string, content: string): boolean => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return false
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return false
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const previous = path[index]
  const text = content.trim()
  if (previous?.role !== 'user' || (!text && previous.files.length === 0)) {
    return false
  }
  const question: UserMessage = {
    id: createId(),
    role: 'user',
    content: text,
    files: previous.files,
    createdAt: Date.now(),
  }
  const reply = createReply(sessionId)
  updateSession(sessionId, (s) => ({
    ...appendBranch(s, path[index - 1]?.id ?? null, [question, reply]),
    updatedAt: Date.now(),
  }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index), question })
  return true
}

export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  if (getStreamController(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

/** 继续最后一条未完成的回答：保留原消息与开关，仅将新流的内容追加到原块之后。 */
export const continueReply = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const question = path.at(-2)
  const previous = path.at(-1)
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.id !== messageId ||
    !canContinueReply(previous)
  ) {
    return
  }
  const { thinking, search } = useSettings.getState()
  const reply: AssistantMessage = {
    ...previous,
    // 未记录请求配置的回复，续写时使用默认模型和当前开关。
    model: previous.model ?? MODEL,
    thinking: previous.thinking ?? thinking,
    search: previous.search ?? search,
    status: 'pending',
    stopReason: undefined,
    stopDetails: undefined,
    error: undefined,
  }
  updateReply(sessionId, reply)
  updateSession(sessionId, (s) => ({ ...s, updatedAt: Date.now() }))
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, -2), question, prefix: previous })
}

/** 附件补传失败后重试：保留原回答位置，重新补传并请求 */
export const retryUpload = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  const session = getSession(sessionId)
  if (!session || getStreamController(sessionId)) {
    return
  }
  const path = getVisibleMessages(session)
  const index = path.findIndex((message) => message.id === messageId)
  const question = path[index - 1]
  const previous = path[index]
  if (
    question?.role !== 'user' ||
    previous?.role !== 'assistant' ||
    previous.error?.kind !== 'upload'
  ) {
    return
  }
  const reply: AssistantMessage = { ...previous, status: 'pending', error: undefined }
  updateReply(sessionId, reply)
  persist(sessionId)
  void streamReply(sessionId, reply, { history: path.slice(0, index - 1), question })
}

type Request = { history: Message[]; question: UserMessage; prefix?: AssistantMessage }

/** 把补传得到的 serverId 写回会话里所有引用同一附件的消息（编辑、重新生成会共用附件） */
const saveServerIds = (sessionId: string, serverIds: Map<string, string>) => {
  if (serverIds.size === 0) {
    return
  }
  updateSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) =>
      message.role === 'user' && message.files.some((file) => serverIds.has(file.id))
        ? {
            ...message,
            files: message.files.map((file) =>
              serverIds.has(file.id) ? { ...file, serverId: serverIds.get(file.id) ?? null } : file
            ),
          }
        : message
    ),
  }))
  persist(sessionId)
}

/**
 * 附件的服务端 id：已有直接用；正在上传的等待同一任务；否则读取本地原件补传。
 * 本地也没有原件（导入的文档附件只有元数据）时返回 null，该附件只展示、不进入请求。
 */
const ensureServerId = async (apiKey: string, file: FileAttachment): Promise<string | null> => {
  if (file.serverId) {
    return file.serverId
  }
  const task = useUploads.getState().tasks[file.id]
  if (task?.status === 'done') {
    return task.serverId
  }
  const blob = await db.loadFile(file.id)
  if (!blob) {
    return null
  }
  return uploadAttachment(apiKey, file.id, blob, file.name, file.isImage)
}

/** 用会话里的最新消息替换请求快照：重传前会重置附件的 serverId，快照必须跟着更新 */
const refreshRequest = (sessionId: string, request: Request): Request => {
  const session = getSession(sessionId)
  if (!session) {
    return request
  }
  const byId = new Map(session.messages.map((message) => [message.id, message]))
  const pick = <T extends Message>(message: T): T =>
    (byId.get(message.id) as T | undefined) ?? message
  return {
    history: request.history.map(pick),
    question: pick(request.question),
    prefix: request.prefix,
  }
}

/**
 * 发送前补齐附件的 serverId。
 * - 本轮提问的附件并行补齐，任一失败则整体失败，已成功的照常写回，重试时复用成功结果；
 * - 历史轮次（仅进入上下文的）中没有 serverId 的附件，多为导入的图片：从最新的消息往前逐张补传，
 *   失败静默跳过，该附件不进入本次请求，下次发送时再试。
 */
const prepareFiles = async (sessionId: string, request: Request, signal: AbortSignal) => {
  const epoch = historyEpoch
  // 服务端判定 file_id 失效时会清掉会话里的 serverId，先用最新消息替换请求快照，
  // 否则快照里仍是旧 id，补传会直接复用它。
  request = refreshRequest(sessionId, request)
  const apiKey = useSettings.getState().apiKey ?? ''
  const serverIds = new Map<string, string>()
  // 停止生成立即生效；上传本身不取消（输入框与其他消息可能共用同一任务），完成后照常写回 serverId
  const aborted = new Promise<never>((_, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
  const uploads = Promise.allSettled(
    request.question.files.map(async (file) => {
      const serverId = await ensureServerId(apiKey, file)
      if (serverId) {
        serverIds.set(file.id, serverId)
      }
    })
  )
  void uploads.then(() => {
    if (epoch === historyEpoch) {
      saveServerIds(sessionId, serverIds)
    }
  })
  const results = await Promise.race([uploads, aborted])
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) {
    throw failed.reason
  }

  const pending = new Map<string, FileAttachment>()
  for (const [user] of getContextRounds(request.history).toReversed()) {
    for (const file of user.files) {
      if (!file.serverId && !serverIds.has(file.id) && !pending.has(file.id)) {
        pending.set(file.id, file)
      }
    }
  }
  for (const file of pending.values()) {
    signal.throwIfAborted()
    try {
      const serverId = await Promise.race([ensureServerId(apiKey, file), aborted])
      if (serverId) {
        serverIds.set(file.id, serverId)
        saveServerIds(sessionId, new Map([[file.id, serverId]]))
      }
    } catch {
      signal.throwIfAborted()
    }
  }

  // 用补齐后的会话重新取历史与提问，保证请求里都是 serverId
  const session = getSession(sessionId)
  const resolve = <T extends Message>(message: T): T =>
    (session?.messages.find((m) => m.id === message.id) as T | undefined) ?? message
  return {
    history: request.history.map(resolve),
    question: resolve(request.question),
    prefix: request.prefix,
  }
}

/** 本地原件转 base64 data URL */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('读取附件原件失败'))
    reader.readAsDataURL(blob)
  })

/**
 * 第三方协议的附件解析器：从本地原件（草稿暂存或 IndexedDB）生成 base64 块，
 * 不携带 DeepSeek file_id。历史附件切换模型后也按目标服务重新准备。
 */
const createBase64Resolver = async (
  sessionId: string,
  request: Request,
  target: AttachmentTarget
): Promise<((files: FileAttachment[]) => FileBlockParam[])> => {
  const dataUrls = new Map<string, string>()
  const pending = pendingFiles.get(sessionId) ?? []
  const allFiles = [
    ...request.question.files,
    ...request.history.flatMap((message) => (message.role === 'user' ? message.files : [])),
  ]
  for (const file of allFiles) {
    if (dataUrls.has(file.id)) continue
    const blob = pending.find((item) => item.id === file.id)?.blob ?? (await db.loadFile(file.id))
    if (blob) dataUrls.set(file.id, await blobToDataUrl(blob))
  }
  const resolver = (files: FileAttachment[]): FileBlockParam[] => {
    const result = buildAttachmentBlocks(
      files.map((file) => ({ ...file, dataUrl: dataUrls.get(file.id) ?? null })),
      target.protocol,
      target.caps
    )
    if (result.error) throw new Error(result.error)
    return result.blocks
  }
  resolver(request.question.files) // 预校验原件齐全
  return resolver
}

/** 本次请求实际会用到的服务端 file_id */
const collectServerFileIds = (request: Request): Set<string> => {
  const ids = new Set<string>()
  const add = (files: FileAttachment[]) => {
    for (const file of files) {
      if (file.serverId) {
        ids.add(file.serverId)
      }
    }
  }
  add(request.question.files)
  for (const [user] of getContextRounds(request.history)) {
    add(user.files)
  }
  return ids
}

/**
 * 服务端判定 file_id 失效时，清掉对应附件的 serverId 并丢弃旧的上传任务，
 * 下一次补齐会重新读取本地原件上传。报错里点名了 file_id 就只重置这些，
 * 没点名（如 invalid file_id）则重置本次请求用到的全部附件。
 */
const reuploadInvalidatedFiles = (sessionId: string, request: Request, error: unknown): boolean => {
  if (!(error instanceof ApiError) || !getFileErrorCode(error)) {
    return false
  }
  const mentioned = extractFileIds(error.message)
  // 重试时原始快照里还是上一轮已被清掉的 serverId，先换成会话里的最新消息
  const targets =
    mentioned.length > 0
      ? new Set(mentioned)
      : collectServerFileIds(refreshRequest(sessionId, request))
  const session = getSession(sessionId)
  if (targets.size === 0 || !session) {
    return false
  }
  const localIds: string[] = []
  const messages = session.messages.map((message) => {
    if (message.role !== 'user') {
      return message
    }
    let changed = false
    const files = message.files.map((file) => {
      if (!file.serverId || !targets.has(file.serverId)) {
        return file
      }
      localIds.push(file.id)
      changed = true
      return { ...file, serverId: null }
    })
    return changed ? { ...message, files } : message
  })
  if (localIds.length === 0) {
    return false
  }
  updateSession(sessionId, (current) => ({ ...current, messages }))
  // 上传任务里可能还留着同一个失效的 serverId，清掉后 ensureServerId 才会重新上传
  localIds.forEach(cancelUpload)
  persist(sessionId)
  return true
}

/** 重传前的退避等待；停止生成时立即返回，由调用方按已停止收尾 */
const waitForRetry = (attempt: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    function onAbort() {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(
      () => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      },
      FILE_RETRY_BASE_DELAY * 2 ** attempt
    )
    signal.addEventListener('abort', onAbort, { once: true })
  })

/**
 * 请求并消费流：先补齐附件的 serverId，再发请求；流式增量按动画帧刷新内存，完成、失败或停止后落盘。
 * 补传失败时回复记为 upload 错误，可重试。
 * 服务端判定 file_id 失效时重新补传后重发，退避重试且次数有上限，超过则按原始报错收尾。
 */
const streamReply = async (sessionId: string, initial: AssistantMessage, request: Request) => {
  const controller = new AbortController()
  if (!getSession(sessionId)?.title) {
    titleRequests.add(controller)
  }
  set((state) => ({ streaming: { ...state.streaming, [sessionId]: controller } }))
  let reply = initial
  let frame = 0
  const flush = () => {
    cancelAnimationFrame(frame)
    frame = 0
    updateReply(sessionId, reply)
  }
  streamFlushes.set(sessionId, flush)

  // 应用工具往返：本轮捕获的 tool_use 经 Host 执行后，结果追加进上下文继续生成
  let toolRounds = 0
  let continuation: MessageParam[] = []
  const startedAt = Date.now()
  // 用量累计器：跨工具往返各请求求和；同请求累计用量取最终值；TPS 排除工具等待
  const usageAcc = createUsageAccumulator(startedAt)
  const parseToolInput = (raw: string): Record<string, unknown> => {
    try {
      const value: unknown = JSON.parse(raw || '{}')
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  try {
    for (let attempt = 0; ; attempt += 1) {
      /** 附件补齐前出错属于上传失败，请求还没有发出 */
      let preparing = true
      let receivedContent = false
      try {
        // DeepSeek 官方走 Files API 补齐 file_id；第三方按目标协议用本地原件 base64，不带 DeepSeek file_id
        const isOfficial = !initial.panelProvider || initial.panelProvider === DEEPSEEK_PROVIDER
        let resolveFiles: ((files: FileAttachment[]) => FileBlockParam[]) | undefined
        let prepared: Request
        if (isOfficial) {
          prepared = await prepareFiles(sessionId, request, controller.signal)
        } else {
          prepared = request
          resolveFiles = await createBase64Resolver(sessionId, request, attachmentTargetFor(selectionFor(sessionId)))
        }
        preparing = false
        // 附件就绪后获取本轮信息；续写沿用原回答快照，重新生成的快照独立保存。
        const latestReminder = prepared.prefix
          ? prepared.prefix.latestReminder
          : createLatestReminder(useSettings.getState())
        reply = { ...reply, latestReminder }
        updateReply(sessionId, reply)
        persist(sessionId)
        const imageReady = useImages.getState().options.some((option) => option.ready)
        const appTools = PANEL_MODE
          ? [...availableAppTools(useApps.getState().status), ...(imageReady ? [GENERATE_IMAGE_TOOL] : [])]
          : []
        const compacted = await buildCompactedMessages({
          sessionId,
          history: prepared.history,
          question: prepared.question,
          prefix: prepared.prefix,
          thinking: initial.thinking ?? false,
          latestReminder,
          resolveFiles,
        })
        if (compacted.compacted && !reply.blocks.some((block) => block.type === 'text' && block.isTemplate)) {
          reply = {
            ...reply,
            blocks: [{ type: 'text', text: translate('compactedNotice'), isTemplate: true }, ...reply.blocks],
          }
        }
        const messages = [...compacted.messages, ...continuation]
        const toolCalls: { id: string; name: string; input: string }[] = []
        const toolByIndex = new Map<number, { id: string; name: string; input: string }>()
        const events =
          PANEL_MODE && initial.panelProvider && initial.panelProvider !== DEEPSEEK_PROVIDER
            ? streamPanelReply(
                {
                  panelProvider: initial.panelProvider,
                  model: initial.panelModel ?? MODEL,
                  system: buildSystem(sessionId),
                  messages,
                  tools: [...serverTools(initial.search ?? false), ...appTools],
                },
                controller.signal
              )
            : streamMessage(
                useSettings.getState().apiKey ?? '',
                {
                  model: initial.model ?? MODEL,
                  system: buildSystem(sessionId),
                  messages,
                  thinking: { type: initial.thinking ? 'enabled' : 'disabled' },
                  safety_check: SAFETY_CHECK,
                  tools: [...serverTools(initial.search ?? false), ...appTools],
                  ...(titleRequests.has(controller) ? { title: { enabled: true } } : {}),
                },
                controller.signal
              )
        const blockIndexes = new Map<number, number>()
        let roundFirstToken = 0
        let roundLastToken = 0
        for await (const event of events) {
          receivedContent ||= event.type === 'content_block_start'
          if (
            event.type === 'content_block_delta' &&
            (event.delta.type === 'text_delta' || event.delta.type === 'thinking_delta')
          ) {
            const tokenAt = Date.now()
            if (!roundFirstToken) roundFirstToken = tokenAt
            roundLastToken = tokenAt
          }
          if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
            const call = { id: event.content_block.id, name: event.content_block.name, input: '' }
            toolCalls.push(call)
            toolByIndex.set(event.index, call)
          } else if (event.type === 'content_block_delta' && event.delta.type === 'input_json_delta') {
            const call = toolByIndex.get(event.index)
            if (call) call.input += event.delta.partial_json
          }
          if (
            event.type === 'message_delta' &&
            (event.delta.stop_reason === 'end_turn' || event.delta.stop_reason === 'max_tokens') &&
            event.delta.title?.trim() &&
            titleRequests.has(controller) &&
            !controller.signal.aborted &&
            !get().importingHistory
          ) {
            const title = event.delta.title.trim()
            updateSession(sessionId, (session) => (session.title ? session : { ...session, title }))
            titleRequests.delete(controller)
          }
          reply = applyEvent(reply, event, Date.now(), blockIndexes)
          if (document.visibilityState === 'hidden') {
            flush()
          } else {
            frame ||= requestAnimationFrame(flush)
          }
        }
        // 本轮有效生成时间（首→末 token）累加；工具执行在循环之外，自然被排除
        if (roundFirstToken && roundLastToken > roundFirstToken) {
          usageAcc.addGenerationTime(roundLastToken - roundFirstToken)
        }
        usageAcc.accumulate(reply.usage)
        reply = settleReply(reply, 'done', Date.now())
        reply = { ...reply, stats: usageAcc.stats() }
        // 应用工具往返：执行捕获的 tool_use，结果回传后继续生成（最多 6 轮）
        if (PANEL_MODE && reply.stopReason === 'tool_use' && toolCalls.length > 0 && toolRounds < 6) {
          toolRounds += 1
          const appCalls = toolCalls.filter((call) => call.name !== 'generate_image')
          const toolBlocks: AppToolBlock[] = appCalls.map((call) => ({
            type: 'app_tool',
            id: call.id,
            name: call.name,
            input: parseToolInput(call.input),
            status: 'running',
          }))
          reply = { ...reply, blocks: [...reply.blocks, ...toolBlocks], prefix: false }
          flush()
          const results: { id: string; content: string; isError: boolean }[] = []
          for (const call of toolCalls) {
            const input = parseToolInput(call.input)
            let text: string
            let isError = false
            if (call.name === 'generate_image') {
              try {
                const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
                if (!prompt) throw new Error('缺少图像描述。')
                const image = await generateImageAuto(prompt, sessionId, controller.signal)
                reply = {
                  ...reply,
                  blocks: [
                    ...reply.blocks,
                    {
                      type: 'generated_image',
                      imageId: image.id,
                      prompt: image.prompt,
                      provider: image.provider,
                      providerName: image.providerName,
                      model: image.model,
                      createdAt: image.createdAt,
                    },
                  ],
                }
                text = '图像已生成并展示给用户。请用一两句话简短说明即可。'
              } catch (error) {
                text = error instanceof Error ? error.message : String(error)
                isError = true
                // 在聊天时间线显示真实失败原因（而非仅模型道歉），便于用户排查
                reply = {
                  ...reply,
                  blocks: [
                    ...reply.blocks,
                    { type: 'app_tool', id: call.id, name: 'generate_image', input, status: 'error', result: text },
                  ],
                }
              }
            } else {
              try {
                const result = await executeAppTool(call.name, input, controller.signal)
                text = JSON.stringify(result).slice(0, 12000)
              } catch (error) {
                text = error instanceof Error ? error.message : String(error)
                isError = true
              }
              reply = {
                ...reply,
                blocks: reply.blocks.map((block) =>
                  block.type === 'app_tool' && block.id === call.id
                    ? { ...block, status: isError ? 'error' : 'done', result: text }
                    : block
                ),
              }
            }
            results.push({ id: call.id, content: text, isError })
            flush()
            if (controller.signal.aborted) break
          }
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continuation = [
            ...continuation,
            {
              role: 'assistant',
              content: toolCalls.map((call) => ({
                type: 'tool_use' as const,
                id: call.id,
                name: call.name,
                input: parseToolInput(call.input),
              })),
            },
            {
              role: 'user',
              content: results.map((result) => ({
                type: 'tool_result' as const,
                tool_use_id: result.id,
                content: result.content,
                ...(result.isError ? { is_error: true } : {}),
              })),
            },
          ]
          reply = { ...reply, status: 'pending', stopReason: undefined }
          continue
        }
        break
      } catch (error) {
        if (controller.signal.aborted) {
          reply = settleReply(reply, 'stopped', Date.now())
          break
        }
        if (preparing) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'upload',
            message: '',
            localMessage: describeUploadError(error),
            retryable: isRetryableApiError(error),
          })
          break
        }
        // 附件失效：重新补传后重发。收到过内容块（含丢弃的客户端工具）后不自动重发。
        if (
          attempt < FILE_RETRY_LIMIT &&
          !receivedContent &&
          reuploadInvalidatedFiles(sessionId, request, error)
        ) {
          await waitForRetry(attempt, controller.signal)
          if (controller.signal.aborted) {
            reply = settleReply(reply, 'stopped', Date.now())
            break
          }
          continue
        }
        if (error instanceof ApiError && error.kind === 'interrupted' && reply.stopReason) {
          // 已收到 message_delta 的结束原因，只是缺了结尾的 message_stop
          reply = settleReply(reply, 'done', Date.now())
        } else if (error instanceof ApiError) {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: error.kind,
            message: error.message,
            status: error.status,
            localMessage: error.localMessage,
          })
        } else {
          reply = settleReply(reply, 'error', Date.now(), {
            kind: 'protocol',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        break
      }
    }
  } finally {
    titleRequests.delete(controller)
    streamFlushes.delete(sessionId)
    cancelAnimationFrame(frame)
    updateReply(sessionId, reply)
    set((state) => ({
      streaming: Object.fromEntries(
        Object.entries(state.streaming).filter(([id]) => id !== sessionId)
      ),
    }))
    persist(sessionId)
  }
}
