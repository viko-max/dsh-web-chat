// 自定义对话服务商：存储、校验、诊断与回复分发。
// 与图像服务完全隔离：凭据命名空间 DSWC_CHAT_<id>，记录 dsh-web-chat/chat-providers。
import { randomBytes } from 'node:crypto'
import {
  openaiStream,
  anthropicStream,
  toOpenaiMessages,
  toAnthropicMessages,
  toOpenaiTools,
  sseResponse,
  diagnosticTools,
  runDiagnosticTool,
  serviceOrigin,
  resolveBoundKey,
} from './panel-adapters.js'

const recordKey = 'dsh-web-chat/chat-providers'
const providerPrefix = 'dswc-chat-'
const modelIdPattern = /^[\w./:-]{1,160}$/
const json = (value) => Response.json(value, { headers: { 'cache-control': 'no-store' } })
const error = (message, status = 400) => Response.json({ error: { message } }, { status })

export const isCustomProvider = (provider) => typeof provider === 'string' && provider.startsWith(providerPrefix)

const validBaseUrl = (value) => {
  if (typeof value !== 'string') return null
  let url
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.username || url.password) return null
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) return null
  return url.href.replace(/\/+$/, '')
}

export const chatEndpoint = (provider) =>
  provider.protocol === 'anthropic'
    ? provider.baseUrl + (provider.baseUrl.endsWith('/v1') ? '/messages' : '/v1/messages')
    : provider.baseUrl + '/chat/completions'

const validateProvider = (input) => {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 60) throw new Error('请填写服务商名称（1–60 字）。')
  if (!['openai', 'anthropic'].includes(input.protocol)) throw new Error('协议须为 OpenAI 兼容或 Anthropic 兼容。')
  const baseUrl = validBaseUrl(input.baseUrl)
  if (!baseUrl) throw new Error('Base URL 须为 https 地址（本机回环可用 http），且不含账号密码。')
  if (!Array.isArray(input.models) || !input.models.length || input.models.length > 50)
    throw new Error('请配置 1–50 个模型。')
  const models = input.models.map((model) => {
    const id = typeof model?.id === 'string' ? model.id.trim() : ''
    if (!modelIdPattern.test(id)) throw new Error(`模型 ID 无效：${id || '(空)'}。`)
    const modelName = typeof model.name === 'string' && model.name.trim() ? model.name.trim().slice(0, 80) : id
    return { id, name: modelName, tools: model.tools !== false, vision: model.vision === true, thinking: model.thinking === true }
  })
  const ids = new Set(models.map((model) => model.id))
  if (ids.size !== models.length) throw new Error('模型 ID 不能重复。')
  return { name, protocol: input.protocol, baseUrl, models }
}

/** 收集一次流式回复，用于诊断 */
async function collect(stream) {
  const result = { text: '', reasoning: '', calls: [], usage: null, finish: null }
  const args = new Map()
  for await (const chunk of stream) {
    if (chunk.type === 'text-delta') result.text += chunk.text
    else if (chunk.type === 'reasoning-delta') result.reasoning += chunk.text
    else if (chunk.type === 'tool-call-delta') {
      let call = result.calls.find((item) => item.index === chunk.index)
      if (!call) {
        call = { index: chunk.index, id: '', name: '', arguments: '' }
        result.calls.push(call)
      }
      if (chunk.id) call.id = chunk.id
      if (chunk.name) call.name = chunk.name
      call.arguments += chunk.argumentsDelta || ''
    } else if (chunk.type === 'usage') result.usage = chunk.usage
    else if (chunk.type === 'finish') result.finish = chunk.reason.kind
  }
  for (const call of result.calls) {
    try {
      call.input = JSON.parse(call.arguments || '{}')
    } catch {
      call.input = null
    }
  }
  return result
}

export function createChatProviders(credentials) {
  const read = async () => (await credentials.readRecord(recordKey))?.payload?.providers ?? []
  const keyRef = (id) => 'DSWC_CHAT_' + id
  const find = async (id) => (await read()).find((provider) => provider.id === id)
  // 凭据绑定到规范化来源；地址变更后旧密钥失效，需为新地址重新配钥
  const resolveKey = (provider) =>
    resolveBoundKey(credentials, keyRef(provider.id), provider.keyOrigin, serviceOrigin(provider.baseUrl))
  const isConfigured = async (provider) => Boolean(await resolveKey(provider))

  const streamFor = (provider, model, { messages, system, tools, maxTokens, signal }) => {
    const key = provider.key
    const label = provider.name
    const endpoint = chatEndpoint(provider)
    return provider.protocol === 'anthropic'
      ? anthropicStream({ label, endpoint, key, model, messages, system, tools, maxTokens, signal })
      : openaiStream({ label, endpoint, key, model, messages, system, tools, maxTokens, signal })
  }

  return {
    /** 模型目录条目（并入 chatCatalog） */
    async catalog() {
      const providers = await read()
      const entries = []
      for (const provider of providers) {
        const configured = await isConfigured(provider)
        if (!configured) continue
        for (const model of provider.models)
          entries.push({
            provider: providerPrefix + provider.id,
            model: model.id,
            name: `${model.name} · ${provider.name}`,
            tools: model.tools,
            custom: true,
            protocol: provider.protocol,
            vision: model.vision,
          })
      }
      return entries
    },

    /** 自定义服务商回复：body 为面板 Anthropic 风格请求 */
    async reply(body, signal, onCancel) {
      const id = body.panelProvider.slice(providerPrefix.length)
      const provider = await find(id)
      if (!provider) return error('该服务商不存在，请在设置中重新选择。')
      const model = provider.models.find((item) => item.id === body.model)
      if (!model) return error('该模型未配置，请在服务商设置中添加。')
      const key = await resolveKey(provider)
      if (!key) return error(`请先配置 ${provider.name} 的 API Key（服务地址变更后需为新地址重新配置）。`)
      const named = (body.tools ?? []).flatMap((tool) => (tool?.name && tool.input_schema ? [tool] : []))
      const tools = model.tools ? named : []
      const withKey = { ...provider, key }
      const stream =
        provider.protocol === 'anthropic'
          ? streamFor(withKey, model.id, {
              messages: toAnthropicMessages(body.messages),
              system: body.system,
              tools,
              signal,
            })
          : streamFor(withKey, model.id, {
              messages: toOpenaiMessages(body.messages),
              system: body.system,
              tools: toOpenaiTools(tools),
              signal,
            })
      return sseResponse(stream, {
        model: model.id,
        signal,
        onCancel,
        errorMessage: (reason) =>
          reason instanceof Error && reason.message.startsWith(provider.name)
            ? reason.message
            : '模型请求中断。请检查服务商设置和网络后重试。',
      })
    },

    async handle(action, request) {
      if (action === 'chat-providers-list') {
        const providers = await read()
        const keys = {}
        for (const provider of providers) keys[provider.id] = await isConfigured(provider)
        return json({ providers, keys })
      }
      const body = await request.json()
      if (action === 'chat-providers-save') {
        const fields = validateProvider(body.provider ?? {})
        const providers = await read()
        const id = typeof body.provider?.id === 'string' && /^p-[a-z0-9]{6,12}$/.test(body.provider.id)
          ? body.provider.id
          : 'p-' + randomBytes(5).toString('hex')
        const current = providers.find((provider) => provider.id === id)
        if (!current && providers.length >= 20) throw new Error('最多保存 20 个对话服务商。')
        const key = typeof body.key === 'string' ? body.key.trim() : ''
        if (key && (key.length > 512 || /\s/.test(key))) throw new Error('请输入有效的 API Key。')
        if (!key && !current) throw new Error('新服务商必须填写 API Key。')
        const newOrigin = serviceOrigin(fields.baseUrl)
        const originChanged = Boolean(current) && serviceOrigin(current.baseUrl) !== newOrigin
        const next = { id, ...fields }
        if (key) {
          // 提供新密钥：绑定到当前来源（覆盖旧密钥）
          await credentials.set(keyRef(id), key)
          next.keyOrigin = newOrigin
        } else if (originChanged) {
          // 来源变更且未填新密钥：清除旧密钥，要求为新地址重新配置
          await credentials.unset?.(keyRef(id))
          next.keyOrigin = null
        } else {
          // 同来源编辑名称/模型/路径：保留原密钥（旧配置惰性迁移来源标记）
          next.keyOrigin = current.keyOrigin ?? newOrigin
        }
        await credentials.modifyRecord(recordKey, (record) => ({
          kind: 'grant',
          payload: {
            providers: current
              ? (record?.payload?.providers ?? providers).map((provider) => (provider.id === id ? next : provider))
              : [...(record?.payload?.providers ?? providers), next],
          },
        }))
        return json({ saved: true, id })
      }
      if (action === 'chat-providers-delete') {
        const id = typeof body.id === 'string' ? body.id : ''
        await credentials.modifyRecord(recordKey, (record) => ({
          kind: 'grant',
          payload: { providers: (record?.payload?.providers ?? []).filter((provider) => provider.id !== id) },
        }))
        await credentials.unset?.(keyRef(id))
        return json({ ok: true })
      }
      if (action === 'chat-providers-test') {
        const provider = await find(body.id)
        if (!provider) throw new Error('该服务商不存在。')
        const model = provider.models.find((item) => item.id === body.model) ?? provider.models[0]
        const key = await resolveKey(provider)
        if (!key) throw new Error('请先配置 API Key（服务地址变更后需为新地址重新配置）。')
        const withKey = { ...provider, key }
        const kind = body.kind === 'tools' ? 'tools' : 'connect'
        const started = Date.now()
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(90000)])
        try {
          if (kind === 'connect') {
            const messages =
              provider.protocol === 'anthropic'
                ? [{ role: 'user', content: [{ type: 'text', text: '回复「连接正常」即可。' }] }]
                : [{ role: 'user', content: '回复「连接正常」即可。' }]
            const result = await collect(streamFor(withKey, model.id, { messages, tools: [], maxTokens: 64, signal }))
            return json({ ok: true, kind, latencyMs: Date.now() - started, sample: result.text.slice(0, 200), usage: result.usage })
          }
          // 工具调用往返：第一轮期望模型调用 dswc_echo，本地执行后回传第二轮
          const prompt = '请调用 dswc_echo 工具，text 参数填 hello。不要直接回答。'
          const first = await collect(
            streamFor(withKey, model.id, {
              messages:
                provider.protocol === 'anthropic'
                  ? [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
                  : [{ role: 'user', content: prompt }],
              system: '你是工具调用测试助手。必须调用提供的工具。',
              tools: provider.protocol === 'anthropic' ? diagnosticTools : toOpenaiTools(diagnosticTools),
              maxTokens: 1024,
              signal,
            })
          )
          const call = first.calls[0]
          if (!call || call.name !== 'dswc_echo' || call.input === null)
            return json({ ok: false, kind, latencyMs: Date.now() - started, error: '模型未发起有效的 dswc_echo 工具调用。', trace: { first } })
          const toolResult = runDiagnosticTool(call.name, call.input)
          const resultText = JSON.stringify(toolResult)
          const secondMessages =
            provider.protocol === 'anthropic'
              ? [
                  { role: 'user', content: [{ type: 'text', text: prompt }] },
                  { role: 'assistant', content: [{ type: 'tool_use', id: call.id || 'call-1', name: call.name, input: call.input }] },
                  { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id || 'call-1', content: resultText }] },
                ]
              : [
                  { role: 'user', content: prompt },
                  { role: 'assistant', tool_calls: [{ id: call.id || 'call-1', type: 'function', function: { name: call.name, arguments: call.arguments } }] },
                  { role: 'tool', tool_call_id: call.id || 'call-1', content: resultText },
                ]
          const second = await collect(streamFor(withKey, model.id, { messages: secondMessages, tools: [], maxTokens: 512, signal }))
          const ok = second.text.toLowerCase().includes('hello')
          return json({
            ok,
            kind,
            latencyMs: Date.now() - started,
            error: ok ? undefined : '工具结果回传后，模型回复未包含 hello。',
            trace: { toolCall: { name: call.name, input: call.input }, toolResult, finalText: second.text.slice(0, 400) },
            usage: second.usage,
          })
        } catch (reason) {
          return json({ ok: false, kind, latencyMs: Date.now() - started, error: reason instanceof Error ? reason.message : String(reason) })
        }
      }
      throw new Error('未知操作')
    },
  }
}