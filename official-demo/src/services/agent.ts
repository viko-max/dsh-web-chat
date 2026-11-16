// Agent 移交：把网页对话的任务交给 Harness 原生会话执行。
import { create } from 'zustand'
import { API_ORIGIN } from './api/client.js'
import type { CatalogModel } from './panel.js'

const op = async <T>(name: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
  const response = await fetch(`${API_ORIGIN}?op=${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    signal,
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

export type AgentOptions = {
  workspaces: { id: string; name: string }[]
  models: CatalogModel[]
  recent: { id: string; workspaceId: string | null }[]
}

export type AgentStateResult = {
  state: { cursor?: number; status?: string }
  replies: { seq: number; text: string }[]
  truncated: boolean
  lastTurn?: string
}

export const agentOptions = () => op<AgentOptions>('agent-options')
export const agentCreate = (workspaceId?: string) =>
  op<{ sessionId: string }>('agent-create', workspaceId ? { workspaceId } : {})
export const agentSend = (sessionId: string, requestId: string, text: string, selection?: [string, string]) =>
  op<{ accepted: boolean }>('agent-send', { sessionId, requestId, text, ...(selection ? { selection } : {}) })
export const agentStop = (sessionId: string) => op<{ accepted: boolean }>('agent-stop', { sessionId })
export const agentState = (sessionId: string, signal?: AbortSignal) =>
  op<AgentStateResult>('agent-state', { sessionId }, signal)

/** 打开 Harness 原生会话（经 DSH web 客户端桥接，需用户手势） */
export const openHarnessSession = (sessionId: string): boolean => {
  const bridge = (window.parent as Window & { __DSWC_OPEN_AGENT__?: (frame: Window, id: string) => boolean })
    .__DSWC_OPEN_AGENT__
  return bridge?.(window, sessionId) ?? false
}

type AgentHandoffState = {
  open: boolean
  prefill: string
}

export const useAgentHandoff = create<AgentHandoffState>(() => ({ open: false, prefill: '' }))

export const openAgentHandoff = (prefill = '') => useAgentHandoff.setState({ open: true, prefill })
export const closeAgentHandoff = () => useAgentHandoff.setState({ open: false, prefill: '' })