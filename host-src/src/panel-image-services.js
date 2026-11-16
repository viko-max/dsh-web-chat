// 自定义图像服务：与对话服务商完全隔离的凭据命名空间 DSWC_IMAGE_<id>。
// 预设 4 家（panel-images.js）保留；自定义服务走 OpenAI 兼容 images API。
import { randomBytes } from 'node:crypto'
import { mediaOf, readLimited } from './panel-images.js'
import { upstreamErrorDetail, serviceOrigin, resolveBoundKey } from './panel-adapters.js'

const recordKey = 'dsh-web-chat/image-services'
const modelIdPattern = /^[\w./:-]{1,160}$/
const domainPattern = /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i
const json = (value) => Response.json(value, { headers: { 'cache-control': 'no-store' } })

const validEndpoint = (value) => {
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
  if (url.pathname === '/' || url.pathname === '') return null
  return url.href
}

const validateService = (input) => {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > 60) throw new Error('请填写图像服务名称（1–60 字）。')
  const endpoint = validEndpoint(input.endpoint)
  if (!endpoint) throw new Error('端点须为含路径的 https 地址（本机回环可用 http）。')
  const generationModel = typeof input.generationModel === 'string' ? input.generationModel.trim() : ''
  const editModel = typeof input.editModel === 'string' && input.editModel.trim() ? input.editModel.trim() : generationModel
  if (!modelIdPattern.test(generationModel)) throw new Error('请填写有效的生图模型 ID。')
  if (!modelIdPattern.test(editModel)) throw new Error('请填写有效的编辑模型 ID。')
  const domains = Array.isArray(input.domains) ? input.domains.map((domain) => String(domain).trim().toLowerCase()).filter(Boolean) : []
  if (domains.length > 20 || domains.some((domain) => !domainPattern.test(domain)))
    throw new Error('结果图域名白名单格式无效（最多 20 个）。')
  return { name, endpoint, generationModel, editModel, domains }
}

export function createImageServices(credentials) {
  const read = async () => (await credentials.readRecord(recordKey))?.payload?.services ?? []
  const keyRef = (id) => 'DSWC_IMAGE_' + id
  const resolveKey = (service) =>
    resolveBoundKey(credentials, keyRef(service.id), service.keyOrigin, serviceOrigin(service.endpoint))
  const isConfigured = async (service) => Boolean(await resolveKey(service))

  /** 转成 panel-images 的服务定义形态（携带来源标记，供生图路径共用凭据校验） */
  const toServiceDef = (service) => ({
    name: service.name,
    key: keyRef(service.id),
    keyOrigin: service.keyOrigin ?? null,
    origin: serviceOrigin(service.endpoint),
    endpoint: service.endpoint,
    generationModel: service.generationModel,
    editModel: service.editModel,
    domains: service.domains,
    payload: (prompt, image, model) => ({
      model: model || (image ? service.editModel : service.generationModel),
      prompt,
      ...(image ? { image } : {}),
      n: 1,
      response_format: 'b64_json',
    }),
    response: (result) => result.data?.[0] ?? result.output?.choices?.[0]?.message?.content?.find((item) => item.image),
  })

  return {
    async serviceMap() {
      const services = await read()
      return Object.fromEntries(services.map((service) => [service.id, toServiceDef(service)]))
    },

    async handle(action, request) {
      if (action === 'image-services-list') {
        const services = await read()
        const keys = {}
        for (const service of services) keys[service.id] = await isConfigured(service)
        return json({ services, keys })
      }
      const body = await request.json()
      if (action === 'image-services-save') {
        const fields = validateService(body.service ?? {})
        const services = await read()
        const id = typeof body.service?.id === 'string' && /^i-[a-z0-9]{6,12}$/.test(body.service.id)
          ? body.service.id
          : 'i-' + randomBytes(5).toString('hex')
        const current = services.find((service) => service.id === id)
        if (!current && services.length >= 20) throw new Error('最多保存 20 个自定义图像服务。')
        const key = typeof body.key === 'string' ? body.key.trim() : ''
        if (key && (key.length > 512 || /\s/.test(key))) throw new Error('请输入有效的 API Key。')
        if (!key && !current) throw new Error('新图像服务必须填写 API Key。')
        const newOrigin = serviceOrigin(fields.endpoint)
        const originChanged = Boolean(current) && serviceOrigin(current.endpoint) !== newOrigin
        const next = { id, ...fields }
        if (key) {
          await credentials.set(keyRef(id), key)
          next.keyOrigin = newOrigin
        } else if (originChanged) {
          await credentials.unset?.(keyRef(id))
          next.keyOrigin = null
        } else {
          next.keyOrigin = current.keyOrigin ?? newOrigin
        }
        await credentials.modifyRecord(recordKey, (record) => ({
          kind: 'grant',
          payload: {
            services: current
              ? (record?.payload?.services ?? services).map((service) => (service.id === id ? next : service))
              : [...(record?.payload?.services ?? services), next],
          },
        }))
        return json({ saved: true, id })
      }
      if (action === 'image-services-delete') {
        const id = typeof body.id === 'string' ? body.id : ''
        await credentials.modifyRecord(recordKey, (record) => ({
          kind: 'grant',
          payload: { services: (record?.payload?.services ?? []).filter((service) => service.id !== id) },
        }))
        await credentials.unset?.(keyRef(id))
        return json({ ok: true })
      }
      if (action === 'image-services-test') {
        const service = (await read()).find((item) => item.id === body.id)
        if (!service) throw new Error('该图像服务不存在。')
        const key = await resolveKey(service)
        if (!key) throw new Error('请先配置 API Key（服务地址变更后需为新地址重新配置）。')
        const started = Date.now()
        const signal = AbortSignal.any([request.signal, AbortSignal.timeout(180000)])
        try {
          const definition = toServiceDef(service)
          const response = await fetch(service.endpoint, {
            method: 'POST',
            redirect: 'error',
            signal,
            headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
            body: JSON.stringify(definition.payload('测试图：白色背景上的蓝色圆形。', undefined)),
          })
          if (!response.ok) {
            const detail = await response.text().catch(() => '')
            throw new Error(`${service.name} 生图失败（HTTP ${response.status}）${upstreamErrorDetail(detail)}`)
          }
          const item = definition.response(JSON.parse((await readLimited(response, 12 * 1024 * 1024 * 1.4)).toString()))
          let buffer
          if (item?.b64_json && /^[\da-z+/]+={0,2}$/i.test(item.b64_json)) buffer = Buffer.from(item.b64_json, 'base64')
          else {
            const address = item?.url || item?.image
            if (!address) throw new Error(`${service.name} 没有返回生成结果。`)
            const url = new URL(address)
            if (
              url.protocol !== 'https:' || url.username || url.password || url.port ||
              !service.domains.some((domain) => url.hostname === domain || url.hostname.endsWith('.' + domain))
            )
              throw new Error(`${service.name} 返回了未授权的图片地址，请在服务设置中补充结果图域名白名单。`)
            const asset = await fetch(url, { redirect: 'error', signal })
            if (!asset.ok) throw new Error(`${service.name} 的结果图下载失败（HTTP ${asset.status}）。`)
            buffer = await readLimited(asset, 12 * 1024 * 1024)
          }
          const mediaType = mediaOf(buffer)
          return json({ ok: true, latencyMs: Date.now() - started, bytes: buffer.length, mediaType })
        } catch (reason) {
          return json({ ok: false, latencyMs: Date.now() - started, error: reason instanceof Error ? reason.message : String(reason) })
        }
      }
      throw new Error('未知操作')
    },
  }
}