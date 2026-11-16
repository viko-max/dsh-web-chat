// 通用第三方对话适配器：OpenAI 兼容 / Anthropic 兼容 SSE -> 统一 chunk 流。
// chunk 形态与 ctx.llm.stream / sparkStream 一致：
//   { type: 'text-delta' | 'reasoning-delta', index, text }
//   { type: 'tool-call-delta', index, id, name, argumentsDelta }
//   { type: 'usage', usage: { inputTokens, outputTokens, cacheReadTokens } }
//   { type: 'finish', reason: { kind: 'stop' | 'max-tokens' | 'tool-calls' } }
import { EventSourceParserStream } from 'eventsource-parser/stream'

const parseEvents = (response) =>
  response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream())

/** 从上游错误响应体提取可读细节（截断），用于诊断透传 */
export const upstreamErrorDetail = (text) => {
  if (!text) return ''
  try {
    const body = JSON.parse(text)
    const message = body?.error?.message ?? body?.Msg ?? body?.message ?? body?.error?.code
    if (message) return '：' + String(message).slice(0, 200)
  } catch {
    // 非 JSON 响应体直接截断展示
  }
  return '：' + text.slice(0, 200)
}

const httpError = (label, status, detail = '') =>
  new Error(`${label} 请求失败（HTTP ${status}）${detail}。请检查密钥、模型权限及余额。`)

/** 规范化服务来源：协议 + 主机 + 端口（忽略路径）。用于把凭据绑定到具体地址。 */
export const serviceOrigin = (value) => {
  if (typeof value !== 'string') return null
  try {
    return new URL(value.trim()).origin
  } catch {
    return null
  }
}

/**
 * 统一的凭据解析：仅当凭据绑定的来源与当前来源一致时才返回密钥。
 * keyOrigin 缺省（旧配置）视为兼容当前来源；来源变更且未重新配钥时返回 null，
 * 确保旧密钥不会被带到新地址。回复、连接诊断、生图与生图诊断共用此逻辑。
 */
export const resolveBoundKey = async (credentials, ref, keyOrigin, origin) => {
  if (keyOrigin && origin && keyOrigin !== origin) return null
  const value = (await credentials.resolve(ref))?.value
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** OpenAI 兼容 /chat/completions 流式适配 */
export async function* openaiStream({ label, endpoint, key, model, messages, system, tools, maxTokens = 8192, signal }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: maxTokens,
      messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages],
      ...(tools.length ? { tools, tool_choice: 'auto' } : {}),
    }),
  })
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw httpError(label, response.status, upstreamErrorDetail(await response.text().catch(() => '')))
  let reason
  for await (const { data } of parseEvents(response)) {
    if (data === '[DONE]') break
    const event = JSON.parse(data)
    if (event.error) throw new Error(`${label} 返回流式错误：${event.error.message ?? '未知错误'}`)
    const choice = event.choices?.[0]
    if (choice?.delta?.reasoning_content)
      yield { type: 'reasoning-delta', index: 0, text: choice.delta.reasoning_content }
    if (choice?.delta?.content)
      yield { type: 'text-delta', index: 1, text: choice.delta.content }
    for (const call of choice?.delta?.tool_calls ?? []) {
      const index = 2 + (Number.isSafeInteger(call.index) ? call.index : 0)
      yield {
        type: 'tool-call-delta',
        index,
        id: call.id || '',
        name: call.function?.name || '',
        argumentsDelta: call.function?.arguments || '',
      }
    }
    if (choice?.finish_reason) reason = choice.finish_reason
    const usage = event.usage
    if (Number.isSafeInteger(usage?.prompt_tokens) && Number.isSafeInteger(usage?.completion_tokens)) {
      const cached = usage.prompt_tokens_details?.cached_tokens
      const cacheReadTokens = Number.isSafeInteger(cached) && cached >= 0 && cached <= usage.prompt_tokens ? cached : undefined
      yield {
        type: 'usage',
        usage: {
          inputTokens: usage.prompt_tokens - (cacheReadTokens ?? 0),
          outputTokens: usage.completion_tokens,
          cacheReadTokens,
        },
      }
    }
  }
  if (!reason) throw new Error(`${label} 的流式回复提前结束。`)
  const kind = reason === 'length' ? 'max-tokens' : reason === 'tool_calls' ? 'tool-calls' : 'stop'
  yield { type: 'finish', reason: { kind } }
}

/** Anthropic 兼容 /v1/messages 流式适配 */
export async function* anthropicStream({ label, endpoint, key, model, messages, system, tools, maxTokens = 8192, signal }) {
  const response = await fetch(endpoint, {
    method: 'POST',
    redirect: 'error',
    signal,
    headers: {
      'x-api-key': key,
      authorization: 'Bearer ' + key,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      accept: 'text/event-stream',
    },
    body: JSON.stringify({
      model,
      stream: true,
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
      ...(tools.length ? { tools } : {}),
    }),
  })
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw httpError(label, response.status, upstreamErrorDetail(await response.text().catch(() => '')))
  const blockTypes = new Map()
  let stopReason
  let inputTokens = 0
  let cacheReadTokens
  let cacheWriteTokens
  let outputTokens = 0
  let sawUsage = false
  for await (const { event: eventName, data } of parseEvents(response)) {
    if (eventName === 'ping' || data === '[DONE]') continue
    let payload
    try {
      payload = JSON.parse(data)
    } catch {
      continue
    }
    if (payload.type === 'error' || eventName === 'error')
      throw new Error(`${label} 返回流式错误：${payload.error?.message ?? data}`)
    switch (payload.type) {
      case 'message_start': {
        const usage = payload.message?.usage
        if (usage) {
          sawUsage = true
          inputTokens = usage.input_tokens ?? 0
          cacheReadTokens = usage.cache_read_input_tokens ?? undefined
          cacheWriteTokens = usage.cache_creation_input_tokens ?? undefined
        }
        break
      }
      case 'content_block_start': {
        const block = payload.content_block
        blockTypes.set(payload.index, block?.type)
        if (block?.type === 'tool_use')
          yield { type: 'tool-call-delta', index: payload.index, id: block.id ?? '', name: block.name ?? '', argumentsDelta: '' }
        break
      }
      case 'content_block_delta': {
        const delta = payload.delta
        if (delta?.type === 'text_delta')
          yield { type: 'text-delta', index: payload.index, text: delta.text ?? '' }
        else if (delta?.type === 'thinking_delta')
          yield { type: 'reasoning-delta', index: payload.index, text: delta.thinking ?? '' }
        else if (delta?.type === 'input_json_delta')
          yield { type: 'tool-call-delta', index: payload.index, id: '', name: '', argumentsDelta: delta.partial_json ?? '' }
        break
      }
      case 'message_delta': {
        if (payload.delta?.stop_reason) stopReason = payload.delta.stop_reason
        if (Number.isSafeInteger(payload.usage?.output_tokens)) {
          sawUsage = true
          outputTokens = payload.usage.output_tokens
        }
        break
      }
      case 'message_stop': {
        if (sawUsage)
          yield { type: 'usage', usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens } }
        const kind = stopReason === 'max_tokens' ? 'max-tokens' : stopReason === 'tool_use' ? 'tool-calls' : 'stop'
        yield { type: 'finish', reason: { kind } }
        return
      }
    }
  }
  throw new Error(`${label} 的流式回复提前结束。`)
}

/** 面板 Anthropic 风格消息 -> OpenAI 消息（文本 + 工具调用 + 工具结果 + 图片） */
export function toOpenaiMessages(bodyMessages) {
  const messages = []
  for (const message of bodyMessages ?? []) {
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? []
    if (message.role === 'assistant') {
      const text = []
      const calls = []
      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string') text.push(block.text)
        else if (block.type === 'tool_use' && block.id && block.name)
          calls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) } })
      }
      if (text.length || calls.length)
        messages.push({
          role: 'assistant',
          ...(text.length ? { content: text.join('\n') } : {}),
          ...(calls.length ? { tool_calls: calls } : {}),
        })
    } else if (message.role === 'user') {
      const parts = []
      const text = []
      for (const block of blocks) {
        if (block.type === 'text' && typeof block.text === 'string') text.push(block.text)
        else if (block.type === 'image' && block.source?.type === 'base64')
          parts.push({ type: 'image_url', image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` } })
        else if (block.type === 'tool_result' && block.tool_use_id) {
          const result = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
          messages.push({ role: 'tool', tool_call_id: block.tool_use_id, content: result.slice(0, 12000) })
        }
      }
      if (text.length) parts.unshift({ type: 'text', text: text.join('\n') })
      if (parts.length)
        messages.push({ role: 'user', content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts })
    }
  }
  return messages
}

/** 面板 Anthropic 风格消息 -> Anthropic 消息（过滤未知块，保留文本/图片/工具） */
export function toAnthropicMessages(bodyMessages) {
  const messages = []
  for (const message of bodyMessages ?? []) {
    const blocks = typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : message.content ?? []
    const content = []
    for (const block of blocks) {
      if (block.type === 'text' && typeof block.text === 'string') content.push({ type: 'text', text: block.text })
      else if (block.type === 'image' && block.source?.type === 'base64') content.push({ type: 'image', source: block.source })
      else if (block.type === 'document' && block.source?.type === 'base64') content.push({ type: 'document', source: block.source })
      else if (message.role === 'assistant' && block.type === 'tool_use' && block.id && block.name)
        content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} })
      else if (message.role === 'user' && block.type === 'tool_result' && block.tool_use_id)
        content.push({
          type: 'tool_result',
          tool_use_id: block.tool_use_id,
          content: (typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')).slice(0, 12000),
          ...(block.is_error ? { is_error: true } : {}),
        })
    }
    if (content.length) messages.push({ role: message.role === 'assistant' ? 'assistant' : 'user', content })
  }
  return messages
}

/** 面板工具声明（Anthropic 形态）-> OpenAI function 形态 */
export const toOpenaiTools = (tools) =>
  (tools ?? []).flatMap((tool) =>
    tool?.name && tool.input_schema
      ? [{ type: 'function', function: { name: tool.name, description: tool.description || tool.name, parameters: tool.input_schema } }]
      : []
  )

/** 统一 chunk 流 -> 面板 SSE Response（Anthropic 风格事件，与 modelReply 原实现一致） */
export function sseResponse(stream, { model, signal, errorMessage, onCancel }) {
  const encoder = new TextEncoder()
  const blocks = new Map()
  let usage
  return new Response(
    new ReadableStream({
      async start(controller) {
        const send = (type, fields = {}) => {
          if (!signal.aborted) controller.enqueue(encoder.encode('event: ' + type + '\ndata: ' + JSON.stringify({ ...fields, type }) + '\n\n'))
        }
        const closeBlock = (index) => {
          const block = blocks.get(index)
          if (block && !block.closed) {
            block.closed = true
            send('content_block_stop', { index: block.index })
          }
        }
        try {
          send('message_start', {
            message: { id: crypto.randomUUID(), type: 'message', role: 'assistant', model, content: [], stop_reason: null, stop_sequence: null },
          })
          for await (const chunk of stream) {
            if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
              const thinking = chunk.type === 'reasoning-delta'
              if (!blocks.has(chunk.index)) {
                const index = blocks.size
                blocks.set(chunk.index, { index, closed: false })
                send('content_block_start', {
                  index,
                  content_block: thinking ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' },
                })
              }
              send('content_block_delta', {
                index: blocks.get(chunk.index).index,
                delta: thinking ? { type: 'thinking_delta', thinking: chunk.text } : { type: 'text_delta', text: chunk.text },
              })
            } else if (chunk.type === 'tool-call-delta') {
              if (!blocks.has(chunk.index)) {
                const index = blocks.size
                blocks.set(chunk.index, { index, closed: false })
                send('content_block_start', { index, content_block: { type: 'tool_use', id: chunk.id, name: chunk.name || '', input: {} } })
              }
              send('content_block_delta', {
                index: blocks.get(chunk.index).index,
                delta: { type: 'input_json_delta', partial_json: chunk.argumentsDelta || '' },
              })
            } else if (chunk.type === 'block-end') {
              if (chunk.block?.type === 'tool-call' && !blocks.has(chunk.index)) {
                const index = blocks.size
                blocks.set(chunk.index, { index, closed: false })
                send('content_block_start', { index, content_block: { type: 'tool_use', id: chunk.block.id, name: chunk.block.name, input: {} } })
                send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: chunk.block.arguments || '{}' } })
              }
              closeBlock(chunk.index)
            } else if (chunk.type === 'usage') {
              const units = chunk.usage
              usage = {
                input_tokens: units.inputTokens,
                output_tokens: units.outputTokens,
                cache_read_input_tokens: units.cacheReadTokens ?? 0,
                cache_creation_input_tokens: units.cacheWriteTokens ?? 0,
                cache_reported: units.cacheReadTokens !== undefined,
              }
            } else if (chunk.type === 'finish') {
              if (!['stop', 'max-tokens', 'tool-calls'].includes(chunk.reason.kind))
                throw new Error('模型未返回完整回复。请检查服务商设置和连接。')
              for (const index of blocks.keys()) closeBlock(index)
              const stop = chunk.reason.kind === 'max-tokens' ? 'max_tokens' : chunk.reason.kind === 'tool-calls' ? 'tool_use' : 'end_turn'
              send('message_delta', { delta: { stop_reason: stop }, usage })
              send('message_stop')
            }
          }
        } catch (reason) {
          send('error', { error: { message: errorMessage(reason) } })
        } finally {
          if (!signal.aborted) controller.close()
        }
      },
      cancel() {
        onCancel?.()
      },
    }),
    { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' } }
  )
}

/** 诊断用内置测试工具 */
export const diagnosticTools = [
  {
    name: 'dswc_echo',
    description: 'Echo the input text back. Used to verify tool calling.',
    input_schema: { type: 'object', properties: { text: { type: 'string', description: 'Text to echo' } }, required: ['text'] },
  },
]

export const runDiagnosticTool = (name, input) => {
  if (name === 'dswc_echo') return { echoed: String(input?.text ?? '') }
  throw new Error(`未知测试工具 ${name}`)
}