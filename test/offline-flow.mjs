// 离线全流程验收：用还原的 fixture（本机模拟 DeepSeek 服务）驱动离线构建，
// 覆盖消息/续聊/工具往返/语音 ASR/TTS/OCR/文件上传删除/应用连接与工具。
// 不连接任何外部服务。用法：node test/offline-flow.mjs
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeCtx, readSse, sseText } from './ctx-mock.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const BUNDLE = path.join(root, 'host-src/dist/lib/index.offline.js')

let passed = 0
let failed = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    passed++
    console.log(`PASS ${name}`)
  } else {
    failed++
    console.log(`FAIL ${name} ${detail}`)
  }
}

const module = await import(pathToFileURL(BUNDLE).href)
const { ctx, routes, disposers } = makeCtx()
await module.apply(ctx)
const handler = routes[0].fetch
const base = 'http://localhost/api/dsh-web-chat-panel'

const post = (op, body) =>
  handler(
    new Request(`${base}?op=${op}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  )
const postJson = async (op, body) => {
  const response = await post(op, body)
  return { status: response.status, body: await response.json().catch(() => null) }
}
const formPost = (op, form) => handler(new Request(`${base}?op=${op}`, { method: 'POST', body: form }))

/** 最小 WAV：44 字节头 + 采样 */
const wav = () => {
  const buffer = Buffer.alloc(44 + 1600)
  buffer.write('RIFF')
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(16000, 24)
  buffer.writeUInt32LE(32000, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(1600, 40)
  return buffer
}

const anthropicBody = (messages, tools) => ({
  model: 'deepseek-flash',
  stream: true,
  max_tokens: 1024,
  messages,
  ...(tools ? { tools } : {}),
})

try {
  // ---- 状态 ----
  const status = await postJson('status')
  check('offline-status', status.body?.offline === true, JSON.stringify(status.body))

  // ---- 基础消息 + 用量/缓存 ----
  const reply = await post('messages', anthropicBody([{ role: 'user', content: '你好' }]))
  const events = await readSse(reply)
  const usage = events.find((e) => e.data?.type === 'message_delta')?.data?.usage
  check(
    'offline-messages',
    sseText(events) === '这是第一条离线回复。' && events.some((e) => e.data?.type === 'message_stop'),
    sseText(events)
  )
  check(
    'offline-usage-cache',
    usage?.input_tokens === 60 && usage?.output_tokens === 12 && usage?.cache_read_input_tokens === 40,
    JSON.stringify(usage)
  )

  // ---- 续聊（历史暗号） ----
  const continueReply = await post(
    'messages',
    anthropicBody([
      { role: 'user', content: '记住暗号：橙色鲸鱼' },
      { role: 'assistant', content: '好的，暗号是橙色鲸鱼。' },
      { role: 'user', content: '续聊，暗号是什么？' },
    ])
  )
  const continueEvents = await readSse(continueReply)
  check('offline-continue', sseText(continueEvents).includes('橙色鲸鱼'), sseText(continueEvents))

  // ---- GitHub 工具往返 ----
  const githubTools = [
    { name: 'github_detail', description: 'Read a GitHub PR', input_schema: { type: 'object', properties: {} } },
  ]
  const gh1 = await post('messages', anthropicBody([{ role: 'user', content: '查 GitHub PR #7' }], githubTools))
  const gh1Events = await readSse(gh1)
  const ghTool = gh1Events.find(
    (e) => e.data?.type === 'content_block_start' && e.data.content_block?.type === 'tool_use'
  )
  const ghArgs = gh1Events
    .filter((e) => e.data?.type === 'content_block_delta' && e.data.delta?.type === 'input_json_delta')
    .map((e) => e.data.delta.partial_json)
    .join('')
  check(
    'offline-github-tool-call',
    ghTool?.data?.content_block?.name === 'github_detail' && JSON.parse(ghArgs || '{}').number === 7,
    ghArgs
  )
  const gh2 = await post(
    'messages',
    anthropicBody([
      { role: 'user', content: '查 GitHub PR #7' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'github-pr', name: 'github_detail', input: JSON.parse(ghArgs || '{}') }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'github-pr',
            content: JSON.stringify({ number: 7, files: [{ name: 'lib/panel.js', patch: '+ loadLocal()' }] }),
          },
        ],
      },
    ])
  )
  const gh2Events = await readSse(gh2)
  check('offline-github-tool-result', sseText(gh2Events).includes('PR #7'), sseText(gh2Events))

  // ---- Gmail 工具两轮往返 ----
  const gmailTools = [
    { name: 'gmail_search', description: 'Search Gmail', input_schema: { type: 'object', properties: {} } },
    { name: 'gmail_read', description: 'Read Gmail', input_schema: { type: 'object', properties: {} } },
  ]
  const gm1 = await post('messages', anthropicBody([{ role: 'user', content: '查 Gmail 最近一周的邮件' }], gmailTools))
  const gm1Events = await readSse(gm1)
  const gmSearch = gm1Events.find(
    (e) => e.data?.type === 'content_block_start' && e.data.content_block?.type === 'tool_use'
  )
  check('offline-gmail-search-call', gmSearch?.data?.content_block?.name === 'gmail_search', JSON.stringify(gmSearch?.data))
  const gm2 = await post(
    'messages',
    anthropicBody([
      { role: 'user', content: '查 Gmail 最近一周的邮件' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'gmail-search', name: 'gmail_search', input: { query: 'newer_than:7d' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'gmail-search', content: JSON.stringify([{ id: 'offline-thread', subject: '离线测试邮件' }]) },
        ],
      },
    ], gmailTools)
  )
  const gm2Events = await readSse(gm2)
  const gmRead = gm2Events.find(
    (e) => e.data?.type === 'content_block_start' && e.data.content_block?.type === 'tool_use'
  )
  check('offline-gmail-read-call', gmRead?.data?.content_block?.name === 'gmail_read', JSON.stringify(gmRead?.data))
  const gm3 = await post(
    'messages',
    anthropicBody([
      { role: 'user', content: '查 Gmail 最近一周的邮件' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'gmail-read', name: 'gmail_read', input: { threadId: 'offline-thread' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'gmail-read', content: JSON.stringify([{ text: '项目将在周五交付。' }]) },
        ],
      },
    ])
  )
  const gm3Events = await readSse(gm3)
  check('offline-gmail-final', sseText(gm3Events).includes('周五交付'), sseText(gm3Events))

  // ---- 语音 ASR ----
  const asrForm = new FormData()
  asrForm.set('file', new Blob([wav()], { type: 'audio/wav' }), 'recording.wav')
  const asr = await formPost('asr', asrForm)
  const asrBody = await asr.json()
  check('offline-asr', asr.status === 200 && asrBody.text === '这是离线语音转写', JSON.stringify(asrBody))

  // ---- 语音 TTS ----
  const tts = await post('tts', { text: '你好，世界', voice_id: 'stella', format: 'pcm', filter_markdown: true })
  const ttsBytes = Buffer.from(await tts.arrayBuffer())
  check(
    'offline-tts',
    tts.status === 200 && tts.headers.get('content-type') === 'application/octet-stream' && ttsBytes.length > 1000,
    `${tts.status} ${ttsBytes.length}`
  )

  // ---- OCR ----
  const ocrForm = new FormData()
  ocrForm.set('file', new Blob([Buffer.from('fake-image')], { type: 'image/png' }), 'test.png')
  const ocr = await formPost('ocr', ocrForm)
  const ocrBody = await ocr.json()
  check('offline-ocr', ocrBody.pages?.[0]?.text === '离线 OCR 识别结果', JSON.stringify(ocrBody))
  const badForm = new FormData()
  badForm.set('file', new Blob([Buffer.from('bad')], { type: 'application/pdf' }), 'bad.pdf')
  const badOcr = await formPost('ocr', badForm)
  const badBody = await badOcr.json()
  check('offline-ocr-invalid', badBody.error?.code === 'invalid_document', JSON.stringify(badBody))

  // ---- 文件上传 + 删除 ----
  const fileForm = new FormData()
  fileForm.set('purpose', 'user_data')
  fileForm.set('file', new Blob([Buffer.from('hello')], { type: 'text/plain' }), 'note.txt')
  const uploaded = await formPost('files', fileForm)
  const uploadedBody = await uploaded.json()
  check('offline-file-upload', /^file-api-mock-\d+$/.test(uploadedBody.id ?? ''), JSON.stringify(uploadedBody))
  const deleted = await post('file-delete', { id: uploadedBody.id })
  check('offline-file-delete', deleted.status === 204, String(deleted.status))

  // ---- 应用连接（离线账号）与工具 ----
  const appsBefore = await postJson('apps-status')
  check('offline-apps-configured', appsBefore.body.github.configured === true, JSON.stringify(appsBefore.body.github))
  const connect = await postJson('apps-connect', { provider: 'github' })
  check('offline-github-connect', connect.body.offline === true && Boolean(connect.body.url), JSON.stringify(connect.body))
  const appsAfter = await postJson('apps-status')
  check('offline-github-account', appsAfter.body.github.account === 'offline-reviewer', JSON.stringify(appsAfter.body.github))
  const ghToolResult = await postJson('apps-tool', {
    name: 'github_detail',
    input: { repo: 'demo/example', kind: 'pulls', number: 7 },
  })
  check(
    'offline-github-tool',
    ghToolResult.body.result?.files?.[0]?.patch?.includes('loadLocal'),
    JSON.stringify(ghToolResult.body)
  )
  await postJson('apps-connect', { provider: 'gmail' })
  const gmSearchTool = await postJson('apps-tool', { name: 'gmail_search', input: { query: 'newer_than:7d' } })
  check('offline-gmail-search-tool', gmSearchTool.body.result?.[0]?.id === 'offline-thread', JSON.stringify(gmSearchTool.body))
  const gmReadTool = await postJson('apps-tool', { name: 'gmail_read', input: { threadId: 'offline-thread' } })
  check('offline-gmail-read-tool', JSON.stringify(gmReadTool.body.result).includes('周五交付'), JSON.stringify(gmReadTool.body))
  await postJson('apps-disconnect', { provider: 'github' })
  await postJson('apps-disconnect', { provider: 'gmail' })

  // ---- 自动化（离线，含邮件资料任务保存） ----
  const autoSave = await postJson('automation-save', {
    title: '离线任务',
    prompt: '总结邮件',
    instructions: '',
    session: 'offline-session',
    next: Date.now() + 3600000,
    every: 0,
    mail: 'gmail',
    query: 'newer_than:7d',
    allowMail: true,
  })
  check('offline-automation-save', autoSave.status === 200 && autoSave.body.ok === true, JSON.stringify(autoSave.body))
  const autoList = await postJson('automation-list')
  check('offline-automation-list', autoList.body.tasks.length === 1, JSON.stringify(autoList.body.tasks.length))
} finally {
  for (const dispose of disposers) {
    try {
      await dispose()
    } catch {}
  }
}

console.log(`\n${passed} 通过，${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)