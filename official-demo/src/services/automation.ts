// 自动化：后台定时任务由 Host 执行；面板轮询收件箱，把结果写入目标网页对话。
import { create } from 'zustand'
import { API_ORIGIN } from './api/client.js'
import { deliverAssistantText } from './chat/store.js'

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

export type AutomationTask = {
  id: string
  title: string
  prompt: string
  instructions: string
  session: string
  next: number
  every: number
  enabled: boolean
  model?: { provider: string; model: string } | null
  mail?: string
  query?: string
  last?: { at: number; status: 'running' | 'done' | 'error'; id: string } | null
}

export type AutomationInboxItem = {
  id: string
  session: string
  title: string
  text: string
  at: number
  status: 'done' | 'error'
}

type AutomationState = {
  tasks: AutomationTask[]
  inbox: AutomationInboxItem[]
  loading: boolean
  error: string
}

export const useAutomation = create<AutomationState>(() => ({
  tasks: [],
  inbox: [],
  loading: false,
  error: '',
}))

export const refreshAutomation = async () => {
  try {
    const state = await op<{ tasks: AutomationTask[]; inbox: AutomationInboxItem[] }>('automation-list')
    useAutomation.setState({ ...state, error: '' })
  } catch (error) {
    useAutomation.setState({ error: error instanceof Error ? error.message : String(error) })
  }
}

export const saveAutomationTask = async (task: Partial<AutomationTask> & { title: string; prompt: string; session: string; next: number; every: number }) => {
  await op('automation-save', task)
  await refreshAutomation()
}

export const toggleAutomationTask = async (id: string) => {
  await op('automation-toggle', { id })
  await refreshAutomation()
}

export const deleteAutomationTask = async (id: string) => {
  await op('automation-delete', { id })
  await refreshAutomation()
}

const ackAutomation = async (ids: string[]) => {
  await op('automation-ack', { ids })
}

// 已投递的运行 ID（持久化），避免 ack 失败重试时同一结果重复写入会话
const DELIVERED_KEY = 'dsh-web-chat:delivered-runs'
const loadDelivered = (): Set<string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DELIVERED_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}
const deliveredRuns = loadDelivered()
const persistDelivered = () => {
  try {
    localStorage.setItem(DELIVERED_KEY, JSON.stringify([...deliveredRuns].slice(-500)))
  } catch {
    // 存储不可用时仅内存去重
  }
}

/**
 * 把收件箱结果写入目标会话：按运行 ID 去重，写盘成功后才确认收件。
 * 目标会话未打开仍可投递（从本地加载）；写盘失败保留收件箱条目以便重试。
 */
export const deliverInbox = async () => {
  const { inbox } = useAutomation.getState()
  if (!inbox.length) return
  const ackIds: string[] = []
  for (const item of inbox) {
    if (deliveredRuns.has(item.id)) {
      ackIds.push(item.id)
      continue
    }
    const text = item.status === 'error' ? `【自动化失败】${item.title}\n${item.text}` : item.text
    const ok = await deliverAssistantText(item.session, text)
    if (ok) {
      deliveredRuns.add(item.id)
      persistDelivered()
      ackIds.push(item.id)
    }
  }
  if (ackIds.length) {
    await ackAutomation(ackIds).catch(() => {})
    await refreshAutomation()
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null

/** 面板打开期间每 20 秒轮询并投递结果 */
export const startAutomationPolling = () => {
  if (pollTimer) return
  void refreshAutomation().then(deliverInbox)
  pollTimer = setInterval(() => {
    void refreshAutomation().then(deliverInbox)
  }, 20000)
}

export const stopAutomationPolling = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}