// 本机 mock：OpenAI 兼容 / Anthropic 兼容 / 图像生成服务。
// 支持工具调用往返（dswc_echo），用于 Phase 1 协议回归与 Phase 2 前的链路验证。
import { createServer } from 'node:http'

const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const readBody = async (req) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const sseHead = (res) => res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })

const lastUserText = (messages) => {
  const last = messages.at(-1)
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  return (last.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join(' ')
}

function openaiHandler(req, res) {
  readBody(req)
    .then((body) => {
      if (req.headers.authorization !== 'Bearer test-key') {
        res.writeHead(401).end(JSON.stringify({ error: { message: 'invalid key' } }))
        return
      }
      sseHead(res)
      const base = { id: 'chatcmpl-mock', object: 'chat.completion.chunk', model: body.model }
      const send = (choices, extra = {}) =>
        res.write('data: ' + JSON.stringify({ ...base, choices, ...extra }) + '\n\n')
      const hasToolResult = body.messages.some((message) => message.role === 'tool')
      const wantsTool = body.tools?.length && lastUserText(body.messages).includes('dswc_echo') && !hasToolResult
      if (wantsTool) {
        send([{ index: 0, delta: { role: 'assistant', tool_calls: [{ index: 0, id: 'call_mock1', type: 'function', function: { name: 'dswc_echo', arguments: '{"text":' } }] }, finish_reason: null }])
        send([{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"hello"}' } }] }, finish_reason: null }])
        send([{ index: 0, delta: {}, finish_reason: 'tool_calls' }])
        send([], { usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 } })
      } else {
        const answer = hasToolResult ? 'echo 结果：hello' : '连接正常'
        send([{ index: 0, delta: { role: 'assistant', content: answer.slice(0, 4) }, finish_reason: null }])
        send([{ index: 0, delta: { content: answer.slice(4) }, finish_reason: null }])
        send([{ index: 0, delta: {}, finish_reason: 'stop' }])
        send([], { usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18, prompt_tokens_details: { cached_tokens: 4 } } })
      }
      res.end('data: [DONE]\n\n')
    })
    .catch((error) => {
      if (!res.headersSent) res.writeHead(400)
      res.end(String(error))
    })
}

function anthropicHandler(req, res) {
  readBody(req)
    .then((body) => {
      if (req.headers['x-api-key'] !== 'test-key') {
        res.writeHead(401).end(JSON.stringify({ type: 'error', error: { message: 'invalid key' } }))
        return
      }
      sseHead(res)
      const send = (type, payload = {}) => res.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...payload }) + '\n\n')
      const hasToolResult = body.messages.some(
        (message) => Array.isArray(message.content) && message.content.some((block) => block.type === 'tool_result')
      )
      const wantsTool = body.tools?.length && lastUserText(body.messages).includes('dswc_echo') && !hasToolResult
      send('message_start', { message: { usage: { input_tokens: 15, cache_read_input_tokens: 5 } } })
      if (wantsTool) {
        send('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_mock1', name: 'dswc_echo', input: {} } })
        send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{"text":' } })
        send('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '"hello"}' } })
        send('content_block_stop', { index: 0 })
        send('message_delta', { delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 9 } })
      } else {
        const answer = hasToolResult ? 'echo 结果：hello' : '连接正常'
        send('content_block_start', { index: 0, content_block: { type: 'text', text: '' } })
        send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: answer.slice(0, 4) } })
        send('content_block_delta', { index: 0, delta: { type: 'text_delta', text: answer.slice(4) } })
        send('content_block_stop', { index: 0 })
        send('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 6 } })
      }
      send('message_stop')
      res.end()
    })
    .catch((error) => {
      if (!res.headersSent) res.writeHead(400)
      res.end(String(error))
    })
}

function imagesHandler(req, res) {
  readBody(req)
    .then((body) => {
      if (req.headers.authorization !== 'Bearer test-key') {
        res.writeHead(401).end(JSON.stringify({ error: { message: 'invalid key' } }))
        return
      }
      if (!body.prompt || !body.model) {
        res.writeHead(400).end(JSON.stringify({ error: { message: 'missing prompt/model' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: PNG_1x1.toString('base64') }] }))
    })
    .catch((error) => {
      if (!res.headersSent) res.writeHead(400)
      res.end(String(error))
    })
}

const listen = (server) =>
  new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port))
    server.once('error', reject)
  })

export async function startMockLlm() {
  const openaiServer = createServer(openaiHandler)
  const anthropicServer = createServer(anthropicHandler)
  const imagesServer = createServer(imagesHandler)
  const [openaiOrigin, anthropicOrigin, imagesOrigin] = await Promise.all([
    listen(openaiServer),
    listen(anthropicServer),
    listen(imagesServer),
  ])
  return {
    openaiOrigin,
    anthropicOrigin,
    imagesOrigin,
    close: () =>
      Promise.all(
        [openaiServer, anthropicServer, imagesServer].map(
          (server) =>
            new Promise((resolve) => {
              server.close(resolve)
              server.closeAllConnections()
            })
        )
      ),
  }
}