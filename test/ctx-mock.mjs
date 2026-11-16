// 最小 Cordis ctx mock：供冒烟与协议测试驱动 Host bundle。
export function makeCtx() {
  const disposers = []
  const routes = []
  const records = new Map()
  const keys = new Map()
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
    },
    connection: {
      fetch: {
        register(route) {
          routes.push(route)
          return () => {}
        },
      },
    },
    credentials: {
      async resolve(name) {
        return keys.has(name) ? { value: keys.get(name) } : undefined
      },
      async describe(name) {
        return { configured: keys.has(name) }
      },
      async set(name, value) {
        keys.set(name, value)
      },
      async unset(name) {
        keys.delete(name)
      },
      async readRecord(key) {
        return records.get(key)
      },
      async modifyRecord(key, fn) {
        // 官方语义：mutate 返回 undefined 表示保持不变（非删除）
        const next = await fn(records.get(key))
        if (next !== undefined) records.set(key, next)
        return next ?? records.get(key)
      },
      async deleteRecord(key) {
        records.delete(key)
      },
    },
    llm: {
      listProviders() {
        return [{ id: 'mock-provider', name: 'Mock' }]
      },
      async listModels() {
        return [{ id: 'mock-model', name: 'Mock Model' }]
      },
      async *stream() {
        yield { type: 'text-delta', index: 0, text: '你好' }
        yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }
        yield { type: 'finish', reason: { kind: 'stop' } }
      },
    },
    sessionController: {
      async create() {
        return { sessionId: 'mock-session' }
      },
      async selectModel() {},
      async prompt() {},
      async cancel() {},
      async wait() {
        return { state: { cursor: 0 }, output: { records: [], truncated: false } }
      },
      async events() {
        return { records: [] }
      },
    },
    workspaceRegistry: {
      list() {
        return []
      },
      get() {
        return undefined
      },
    },
  }
  return { ctx, routes, disposers, keys, records }
}

/** 解析面板 SSE 响应为事件数组 */
export async function readSse(response) {
  const text = await response.text()
  const events = []
  for (const frame of text.split('\n\n')) {
    const eventLine = frame.split('\n').find((line) => line.startsWith('event: '))
    const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
    if (!dataLine) continue
    try {
      events.push({ event: eventLine?.slice(7), data: JSON.parse(dataLine.slice(6)) })
    } catch {}
  }
  return events
}

export const sseText = (events) =>
  events
    .filter((item) => item.data?.type === 'content_block_delta' && item.data.delta?.type === 'text_delta')
    .map((item) => item.data.delta.text)
    .join('')