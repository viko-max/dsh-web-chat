// 应用连接：GitHub / Gmail / Outlook / QQ 邮箱 / QQ 机器人。
// 状态与凭据由 Host 管理；Gmail 数据须用户预览确认后才回传给模型。
import { create } from 'zustand'
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

export type AppProvider = 'github' | 'gmail' | 'outlook' | 'qqmail' | 'qqbot'

export type AppStatus = {
  account: string | null
  configured: boolean
  pending: boolean
  error: string | null
  phase?: 'ready' | 'pending' | 'connected' | 'expired' | 'failed'
  authorizeUrl?: string | null
  userCode?: string | null
}

export type AppsStatus = Record<AppProvider, AppStatus>

type AppsState = {
  status: AppsStatus | null
  loading: boolean
  error: string
}

export const useApps = create<AppsState>(() => ({ status: null, loading: false, error: '' }))

export const refreshApps = async () => {
  useApps.setState({ loading: true })
  try {
    const status = await op<AppsStatus>('apps-status')
    useApps.setState({ status, loading: false, error: '' })
  } catch (error) {
    useApps.setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null

const stopPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

/** 连接中轮询状态，直到授权完成/失败/超时（6 分钟） */
const pollUntilSettled = (provider: AppProvider) => {
  stopPolling()
  const started = Date.now()
  pollTimer = setInterval(() => {
    void (async () => {
      await refreshApps()
      const status = useApps.getState().status?.[provider]
      const settled = status && !status.pending
      if (settled || Date.now() - started > 360000) stopPolling()
    })()
  }, 2500)
}

/** 发起连接：OAuth 类打开授权页并轮询；QQ 类直接提交凭据 */
export const connectApp = async (provider: AppProvider, extra?: Record<string, string>) => {
  useApps.setState({ error: '' })
  try {
    const result = await op<{ url?: string; offline?: boolean }>('apps-connect', { provider, ...extra })
    if (result.url) {
      window.open(result.url, '_blank', 'noopener')
      pollUntilSettled(provider)
    }
    await refreshApps()
  } catch (error) {
    useApps.setState({ error: error instanceof Error ? error.message : String(error) })
    await refreshApps()
    throw error
  }
}

export const disconnectApp = async (provider: AppProvider) => {
  stopPolling()
  await op('apps-disconnect', { provider })
  await refreshApps()
}

/** Outlook 等需要自定义 OAuth 应用编号 */
export const configureApp = async (provider: AppProvider, clientId: string, clientSecret?: string) => {
  await op('apps-configure', { provider, clientId, ...(clientSecret ? { clientSecret } : {}) })
  await refreshApps()
}

export type QQBotMessage = { id: string; kind: string; text: string; at: number }

export const qqBotInbox = () => op<QQBotMessage[]>('apps-inbox', { provider: 'qqbot' })

// ---- 工具目录与执行 ----

export type AppToolDeclaration = {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

const repoSchema = {
  type: 'object',
  properties: {
    repo: { type: 'string', description: 'Repository in owner/repo format' },
    kind: { type: 'string', enum: ['issues', 'pulls'], description: 'Issue or pull request' },
  },
  required: ['repo', 'kind'],
}

const declarations: Record<string, AppToolDeclaration> = {
  github_list: {
    name: 'github_list',
    description: 'List recent issues or pull requests of a GitHub repository. Public repos work without connecting.',
    input_schema: repoSchema,
  },
  github_detail: {
    name: 'github_detail',
    description: 'Read a GitHub issue or pull request detail, including changed files for PRs.',
    input_schema: {
      type: 'object',
      properties: {
        ...(repoSchema.properties as Record<string, unknown>),
        number: { type: 'integer', description: 'Issue or PR number' },
      },
      required: ['repo', 'kind', 'number'],
    },
  },
  gmail_search: {
    name: 'gmail_search',
    description: 'Search Gmail threads with a query (supports Gmail search operators like newer_than:7d).',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  gmail_read: {
    name: 'gmail_read',
    description: 'Read a Gmail thread by id. Results require user confirmation before being sent to the model.',
    input_schema: { type: 'object', properties: { threadId: { type: 'string' } }, required: ['threadId'] },
  },
  outlook_search: {
    name: 'outlook_search',
    description: 'Search Outlook mailbox messages.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  outlook_read: {
    name: 'outlook_read',
    description: 'Read an Outlook message by id.',
    input_schema: { type: 'object', properties: { threadId: { type: 'string' } }, required: ['threadId'] },
  },
  qqmail_search: {
    name: 'qqmail_search',
    description: 'Search QQ Mail inbox by subject.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
  },
  qqmail_read: {
    name: 'qqmail_read',
    description: 'Read a QQ Mail message by id.',
    input_schema: { type: 'object', properties: { threadId: { type: 'string' } }, required: ['threadId'] },
  },
}

/** 当前可用的应用工具：GitHub 公开查询始终可用；邮箱类需已连接 */
export const availableAppTools = (status: AppsStatus | null): AppToolDeclaration[] => {
  if (!status) return [declarations.github_list, declarations.github_detail]
  const tools = [declarations.github_list, declarations.github_detail]
  const connected = (provider: AppProvider) =>
    status[provider]?.account != null || status[provider]?.phase === 'connected'
  if (connected('gmail')) tools.push(declarations.gmail_search, declarations.gmail_read)
  if (connected('outlook')) tools.push(declarations.outlook_search, declarations.outlook_read)
  if (connected('qqmail')) tools.push(declarations.qqmail_search, declarations.qqmail_read)
  return tools
}

// ---- Gmail 预览确认 ----

type GmailPreview = {
  name: string
  input: unknown
  resultText: string
  resolve: (confirmed: boolean) => void
}

export const useGmailPreview = create<{ pending: GmailPreview | null }>(() => ({ pending: null }))

export const resolveGmailPreview = (confirmed: boolean) => {
  const { pending } = useGmailPreview.getState()
  useGmailPreview.setState({ pending: null })
  pending?.resolve(confirmed)
}

const confirmGmailData = (
  name: string,
  input: unknown,
  result: unknown,
  signal?: AbortSignal
): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }
    // 停止生成时关闭预览并按未确认处理，避免流式循环挂起
    const onAbort = () => {
      useGmailPreview.setState({ pending: null })
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    useGmailPreview.setState({
      pending: {
        name,
        input,
        resultText: JSON.stringify(result, null, 2).slice(0, 20000),
        resolve: (confirmed: boolean) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(confirmed)
        },
      },
    })
  })

/** 执行应用工具；Gmail 结果先预览，用户确认后才返回给模型 */
export const executeAppTool = async (name: string, input: unknown, signal?: AbortSignal): Promise<unknown> => {
  const response = await fetch(`${API_ORIGIN}?op=apps-tool`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, input }),
    signal,
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data
        ? String((data as { error?: { message?: string } }).error?.message ?? '')
        : ''
    throw new Error(message || `工具执行失败（HTTP ${response.status}）`)
  }
  const result = (data as { result?: unknown })?.result
  if (name.startsWith('gmail_')) {
    const confirmed = await confirmGmailData(name, input, result, signal)
    if (!confirmed) throw new Error('用户未确认发送，邮件数据未交给模型。')
  }
  return result
}