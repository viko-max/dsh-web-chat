// Phase 1 协议回归：自定义对话服务商（OpenAI/Anthropic）+ 图像服务 + 诊断。
// 用法：node test/providers.mjs
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeCtx, readSse, sseText } from './ctx-mock.mjs'
import { startMockLlm } from './mock-llm.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BUNDLE = path.join(root, 'host-src/dist/lib/index.js')

let passed = 0
let failed = 0
const check = (name, condition, detail = '') => {
  if (condition) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed++
    console.log(`FAIL ${name} ${detail}`)
  }
}

const mock = await startMockLlm()
const module = await import(pathToFileURL(BUNDLE).href)
const { ctx, routes, disposers } = makeCtx()
await module.apply(ctx)
const handler = routes[0].fetch
const base = 'http://localhost/api/dsh-web-chat-panel'

const call = async (op, body) => {
  const response = await handler(
    new Request(`${base}?op=${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  )
  return response
}
const callJson = async (op, body) => {
  const response = await call(op, body)
  return { status: response.status, body: await response.json() }
}

try {
  // ---- OpenAI 兼容服务商 ----
  const saveOpenai = await callJson('chat-providers-save', {
    provider: {
      name: 'Mock OpenAI',
      protocol: 'openai',
      baseUrl: mock.openaiOrigin + '/v1',
      models: [{ id: 'mock-chat', name: 'Mock Chat', tools: true }],
    },
    key: 'test-key',
  })
  check('openai-save', saveOpenai.status === 200 && saveOpenai.body.saved === true, JSON.stringify(saveOpenai))
  const openaiId = saveOpenai.body.id

  const list = await callJson('chat-providers-list')
  check(
    'providers-list',
    list.body.providers.length === 1 && list.body.keys[openaiId] === true && !JSON.stringify(list.body).includes('test-key'),
    JSON.stringify(list.body)
  )

  const catalog = await callJson('models')
  check(
    'catalog-includes-custom',
    catalog.body.models.some((item) => item.provider === 'dswc-chat-' + openaiId && item.model === 'mock-chat' && item.tools === true),
    JSON.stringify(catalog.body.models)
  )

  const reply = await call('model-reply', {
    panelProvider: 'dswc-chat-' + openaiId,
    model: 'mock-chat',
    messages: [{ role: 'user', content: '你好' }],
  })
  const events = await readSse(reply)
  check(
    'openai-reply-stream',
    reply.status === 200 && sseText(events) === '连接正常' && events.some((item) => item.data?.type === 'message_stop'),
    sseText(events)
  )
  const usageEvent = events.find((item) => item.data?.type === 'message_delta')
  check(
    'openai-usage-cache',
    usageEvent?.data?.usage?.input_tokens === 8 && usageEvent?.data?.usage?.cache_read_input_tokens === 4,
    JSON.stringify(usageEvent?.data?.usage)
  )

  const connect = await callJson('chat-providers-test', { id: openaiId, model: 'mock-chat', kind: 'connect' })
  check('openai-test-connect', connect.body.ok === true && connect.body.sample.includes('连接正常'), JSON.stringify(connect.body))

  const tools = await callJson('chat-providers-test', { id: openaiId, model: 'mock-chat', kind: 'tools' })
  check(
    'openai-test-tools',
    tools.body.ok === true && tools.body.trace?.toolCall?.name === 'dswc_echo' && tools.body.trace?.finalText?.includes('hello'),
    JSON.stringify(tools.body)
  )

  // ---- Anthropic 兼容服务商 ----
  const saveAnthropic = await callJson('chat-providers-save', {
    provider: {
      name: 'Mock Anthropic',
      protocol: 'anthropic',
      baseUrl: mock.anthropicOrigin,
      models: [{ id: 'mock-claude', name: 'Mock Claude', tools: true, thinking: true }],
    },
    key: 'test-key',
  })
  check('anthropic-save', saveAnthropic.status === 200, JSON.stringify(saveAnthropic))
  const anthropicId = saveAnthropic.body.id

  const replyA = await call('model-reply', {
    panelProvider: 'dswc-chat-' + anthropicId,
    model: 'mock-claude',
    messages: [{ role: 'user', content: [{ type: 'text', text: '你好' }] }],
  })
  const eventsA = await readSse(replyA)
  check('anthropic-reply-stream', sseText(eventsA) === '连接正常', sseText(eventsA))
  const usageA = eventsA.find((item) => item.data?.type === 'message_delta')
  check(
    'anthropic-usage-cache',
    usageA?.data?.usage?.input_tokens === 15 && usageA?.data?.usage?.cache_read_input_tokens === 5,
    JSON.stringify(usageA?.data?.usage)
  )

  const toolsA = await callJson('chat-providers-test', { id: anthropicId, model: 'mock-claude', kind: 'tools' })
  check(
    'anthropic-test-tools',
    toolsA.body.ok === true && toolsA.body.trace?.finalText?.includes('hello'),
    JSON.stringify(toolsA.body)
  )

  // ---- 工具调用在真实对话链路（model-reply 带 tools）----
  const replyTools = await call('model-reply', {
    panelProvider: 'dswc-chat-' + openaiId,
    model: 'mock-chat',
    messages: [{ role: 'user', content: '请调用 dswc_echo，text 为 hello' }],
    tools: [
      {
        name: 'dswc_echo',
        description: 'Echo text',
        input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      },
    ],
  })
  const eventsT = await readSse(replyTools)
  const toolBlock = eventsT.find((item) => item.data?.type === 'content_block_start' && item.data.content_block?.type === 'tool_use')
  const toolArgs = eventsT
    .filter((item) => item.data?.type === 'content_block_delta' && item.data.delta?.type === 'input_json_delta')
    .map((item) => item.data.delta.partial_json)
    .join('')
  const stopT = eventsT.find((item) => item.data?.type === 'message_delta')
  check(
    'openai-reply-tool-use',
    toolBlock?.data?.content_block?.name === 'dswc_echo' && JSON.parse(toolArgs).text === 'hello' && stopT?.data?.delta?.stop_reason === 'tool_use',
    toolArgs
  )

  // ---- 客户端式工具循环：model-reply 带 tools -> tool_use -> 续传 tool_result -> 最终回复 ----
  const loopTools = [
    {
      name: 'dswc_echo',
      description: 'Echo text',
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    },
  ]
  for (const [label, providerId, modelId] of [
    ['openai', openaiId, 'mock-chat'],
    ['anthropic', anthropicId, 'mock-claude'],
  ]) {
    const round1 = await call('model-reply', {
      panelProvider: 'dswc-chat-' + providerId,
      model: modelId,
      messages: [{ role: 'user', content: '请调用 dswc_echo，text 为 hello' }],
      tools: loopTools,
    })
    const events1 = await readSse(round1)
    const toolUse = events1.find(
      (item) => item.data?.type === 'content_block_start' && item.data.content_block?.type === 'tool_use'
    )
    const args = events1
      .filter((item) => item.data?.type === 'content_block_delta' && item.data.delta?.type === 'input_json_delta')
      .map((item) => item.data.delta.partial_json)
      .join('')
    const callId = toolUse?.data?.content_block?.id || 'call-1'
    const round2 = await call('model-reply', {
      panelProvider: 'dswc-chat-' + providerId,
      model: modelId,
      messages: [
        { role: 'user', content: '请调用 dswc_echo，text 为 hello' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: callId, name: 'dswc_echo', input: JSON.parse(args || '{}') }],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: callId, content: JSON.stringify({ echoed: 'hello' }) }],
        },
      ],
      tools: loopTools,
    })
    const events2 = await readSse(round2)
    check(
      `client-tool-loop-${label}`,
      sseText(events2).includes('hello') && events2.some((item) => item.data?.type === 'message_stop'),
      sseText(events2)
    )
  }

  // ---- 自定义图像服务 ----
  const saveImage = await callJson('image-services-save', {
    service: {
      name: 'Mock 生图',
      endpoint: mock.imagesOrigin + '/v1/images/generations',
      generationModel: 'mock-image',
      editModel: 'mock-image-edit',
      domains: [],
    },
    key: 'test-key',
  })
  check('image-save', saveImage.status === 200, JSON.stringify(saveImage))
  const imageId = saveImage.body.id

  const imageList = await callJson('image-services-list')
  check('image-list', imageList.body.services.length === 1 && imageList.body.keys[imageId] === true, JSON.stringify(imageList.body))

  const options = await callJson('image-options')
  const customOption = options.body.find((item) => item.id === imageId)
  check('image-options-custom', customOption?.custom === true && customOption?.ready === true, JSON.stringify(customOption))

  const imageTest = await callJson('image-services-test', { id: imageId })
  check('image-test', imageTest.body.ok === true && imageTest.body.mediaType === 'image/png' && imageTest.body.bytes > 0, JSON.stringify(imageTest.body))

  const form = new FormData()
  form.set('provider', imageId)
  form.set('prompt', '测试生图')
  const generated = await handler(new Request(`${base}?op=image-generate`, { method: 'POST', body: form }))
  const generatedBytes = Buffer.from(await generated.arrayBuffer())
  check(
    'image-generate-custom',
    generated.status === 200 && generated.headers.get('content-type') === 'image/png' && generatedBytes.length > 0,
    String(generated.status)
  )

  // ---- 校验与清理 ----
  const badUrl = await callJson('chat-providers-save', {
    provider: { name: '坏地址', protocol: 'openai', baseUrl: 'ftp://example.com', models: [{ id: 'x' }] },
    key: 'k',
  })
  check('reject-bad-url', badUrl.status === 400, JSON.stringify(badUrl))
  const noModels = await callJson('chat-providers-save', {
    provider: { name: '空模型', protocol: 'openai', baseUrl: 'https://example.com/v1', models: [] },
    key: 'k',
  })
  check('reject-empty-models', noModels.status === 400, JSON.stringify(noModels))

  await callJson('chat-providers-delete', { id: openaiId })
  await callJson('chat-providers-delete', { id: anthropicId })
  await callJson('image-services-delete', { id: imageId })
  const afterDelete = await callJson('chat-providers-list')
  const afterImageDelete = await callJson('image-services-list')
  check('delete-cleanup', afterDelete.body.providers.length === 0 && afterImageDelete.body.services.length === 0)
} finally {
  for (const dispose of disposers) {
    try {
      await dispose()
    } catch {}
  }
  await mock.close()
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)