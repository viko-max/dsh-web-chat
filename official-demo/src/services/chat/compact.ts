// 长上下文自动压缩：超过阈值时把较早的对话轮次摘要为一段背景，
// 仅影响发送给模型的上下文，本地完整历史不变。摘要按会话缓存。
import type { FileBlockParam, MessageParam } from '../api/types.js'
import { PANEL_MODE, streamMessage, streamPanelReply } from '../api/client.js'
import { DEEPSEEK_PROVIDER, selectionFor, type ModelSelection } from '../panelModels.js'
import { useSettings } from '../settings.js'
import { getContextRounds, toRequestMessages } from './reply.js'
import type { AssistantMessage, FileAttachment, Message, UserMessage } from './types.js'

const SUMMARY_PREFIX = '【早期对话摘要 · 已由系统自动压缩，作为背景参考】\n'
const KEEP_RECENT = 3

const cache = new Map<string, { count: number; summary: string }>()

const contentText = (content: MessageParam['content']): string => {
  if (typeof content === 'string') return content
  return content
    .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
    .join('')
}

const estimateTokens = (messages: MessageParam[]): number =>
  Math.ceil(messages.reduce((sum, message) => sum + contentText(message.content).length, 0) / 2)

const roundText = (user: UserMessage, reply: AssistantMessage): string => {
  const answer = reply.blocks.map((block) => (block.type === 'text' ? block.text : '')).join('')
  return `用户：${user.content}\n助手：${answer}`
}

async function summarize(older: [UserMessage, AssistantMessage][], selection: ModelSelection): Promise<string> {
  const transcript = older.map(([user, reply]) => roundText(user, reply)).join('\n\n').slice(0, 24000)
  const system = '你是对话摘要助手。请把下面的早期对话压缩成简洁的中文背景摘要，保留关键事实、决定、偏好与未完成事项，省略寒暄。直接输出摘要正文。'
  const messages: MessageParam[] = [{ role: 'user', content: `请摘要以下对话：\n\n${transcript}` }]
  const controller = new AbortController()
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)])
  const events =
    PANEL_MODE && selection.provider !== DEEPSEEK_PROVIDER
      ? streamPanelReply({ panelProvider: selection.provider, model: selection.model, system, messages }, signal)
      : streamMessage(useSettings.getState().apiKey ?? '', {
          model: 'deepseek-flash',
          system,
          messages,
          thinking: { type: 'disabled' },
          safety_check: { level: 'high' },
          tools: [],
        }, signal)
  let text = ''
  for await (const event of events) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') text += event.delta.text
    if (event.type === 'message_stop') break
  }
  return text.trim() || '（早期对话摘要生成失败，已省略。）'
}

export type CompactResult = { messages: MessageParam[]; compacted: boolean }

/** 构建（必要时压缩的）请求上下文 */
export async function buildCompactedMessages(params: {
  sessionId: string
  history: Message[]
  question: UserMessage
  prefix?: AssistantMessage
  thinking: boolean
  latestReminder?: string
  resolveFiles?: (files: FileAttachment[]) => FileBlockParam[]
}): Promise<CompactResult> {
  const { sessionId, history, question, prefix, thinking, latestReminder, resolveFiles } = params
  const full = toRequestMessages(history, question, prefix, thinking, latestReminder, resolveFiles)
  const { autoCompact, compactThreshold } = useSettings.getState()
  if (!autoCompact || estimateTokens(full) <= compactThreshold) {
    return { messages: full, compacted: false }
  }
  const rounds = getContextRounds(history)
  if (rounds.length <= KEEP_RECENT) return { messages: full, compacted: false }
  const older = rounds.slice(0, rounds.length - KEEP_RECENT)
  const recent = rounds.slice(rounds.length - KEEP_RECENT)
  const cached = cache.get(sessionId)
  let summary = cached && cached.count === older.length ? cached.summary : null
  if (!summary) {
    try {
      summary = await summarize(older, selectionFor(sessionId))
    } catch {
      return { messages: full, compacted: false }
    }
    cache.set(sessionId, { count: older.length, summary })
  }
  const recentHistory = recent.flatMap(([user, reply]) => [user, reply])
  const recentMessages = toRequestMessages(recentHistory, question, prefix, thinking, latestReminder, resolveFiles)
  return {
    messages: [
      { role: 'user', content: SUMMARY_PREFIX + summary },
      { role: 'assistant', content: [{ type: 'text', text: '好的，我已知晓上述背景，我们继续。' }] },
      ...recentMessages,
    ],
    compacted: true,
  }
}

/** 会话删除时清理摘要缓存 */
export const clearCompactCache = (sessionId: string) => cache.delete(sessionId)