import { upstreamErrorDetail, resolveBoundKey } from "./panel-adapters.js";

var maxBytes = 12 * 1024 * 1024;
var formats = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

// 每个提供商一个入口；route(model) 按所选模型决定端点/协议/响应解析。
// defaultModels 为下拉兜底；modelsUrl + modelFilter 用于动态拉取最新图像模型。
var services = {
  qwen: {
    name: "千问",
    key: "DASHSCOPE_API_KEY",
    generationModel: "qwen-image-3.0",
    editModel: "qwen-image-3.0",
    domains: ["aliyuncs.com", "alibaba-cloud.com"],
    defaultModels: [{ id: "qwen-image-3.0", name: "Qwen-Image 3.0" }, { id: "qwen-image-2.0", name: "Qwen-Image 2.0" }],
    modelsUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
    modelFilter: (id) => /image/i.test(id),
    route: (model) => ({
      endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/images/generations",
      payload: (prompt, image) => ({ model, prompt, ...image && { image }, n: 1 }),
      response: (result) => result.data?.[0] ?? result.output?.choices?.[0]?.message?.content?.find((item) => item.image)
    })
  },
  ark: {
    name: "火山引擎",
    key: "ARK_API_KEY",
    generationModel: "doubao-seedream-4-5-251128",
    editModel: "doubao-seedream-4-5-251128",
    domains: ["volces.com", "volccdn.com", "byteimg.com"],
    defaultModels: [{ id: "doubao-seedream-4-5-251128", name: "Seedream 4.5" }, { id: "doubao-seedream-4-0-250828", name: "Seedream 4.0" }],
    modelsUrl: "https://ark.cn-beijing.volces.com/api/v3/models",
    modelFilter: (id) => /seedream|image/i.test(id),
    route: (model) => ({
      endpoint: "https://ark.cn-beijing.volces.com/api/v3/images/generations",
      payload: (prompt, image) => ({ model, prompt, ...image && { image }, size: "2K", response_format: "b64_json", stream: false, watermark: true }),
      response: (result) => result.data?.[0]
    })
  },
  siliconflow: {
    name: "硅基流动",
    key: "SILICONFLOW_API_KEY",
    generationModel: "Qwen/Qwen-Image",
    editModel: "Qwen/Qwen-Image-Edit-2509",
    domains: ["siliconflow.cn", "siliconflow.com", "sf-maas-uat-prod-bucket.oss-cn-shanghai.aliyuncs.com"],
    defaultModels: [{ id: "Qwen/Qwen-Image", name: "Qwen-Image" }, { id: "Qwen/Qwen-Image-Edit-2509", name: "Qwen-Image-Edit" }],
    modelsUrl: "https://api.siliconflow.cn/v1/models",
    modelFilter: (id) => /image/i.test(id),
    route: (model, hasImage) => ({
      endpoint: "https://api.siliconflow.cn/v1/images/generations",
      payload: (prompt, image) => ({ model: hasImage && model === "Qwen/Qwen-Image" ? "Qwen/Qwen-Image-Edit-2509" : model, prompt, ...image ? { image } : { image_size: "1328x1328" } }),
      response: (result) => result.images?.[0] ?? result.data?.[0]
    })
  },
  hunyuan: {
    name: "腾讯混元 / TokenHub",
    key: "DSWC_HUNYUAN_API_KEY",
    generationModel: "hy-image-v3.5-preview",
    editModel: "hy-image-v3.5-preview",
    domains: ["tencentmaas.com", "myqcloud.com", "qcloud.com", "gtimg.com"],
    defaultModels: [
      { id: "hy-image-v3.5-preview", name: "Hy-Image 3.5 Preview" },
      { id: "hy-image-v3", name: "Hy-Image 3.0" },
      { id: "seedream-image-v5.0-pro", name: "Seedream 5.0 Pro" },
      { id: "wand-vega-image-1.5-pro", name: "WAND Vega 1.5 Pro" }
    ],
    modelsUrl: "https://tokenhub.tencentmaas.com/v1/models",
    modelFilter: (id) => /image|seedream|kling-image|wand-vega-image|vidu-image|hidream|minimax-image/i.test(id),
    route: (model) => {
      if (/^hy-image-v3\.5/.test(model)) {
        return {
          endpoint: "https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v35-generation",
          payload: (prompt, image) => {
            const content = [{ type: "text", text: prompt }];
            if (image) content.push({ type: "image_url", image_url: { url: image } });
            return { model, messages: [{ role: "user", content }] };
          },
          response: (result) => result.choices?.[0]?.delta?.image ?? result.data?.[0]
        };
      }
      if (model === "hy-image-v3") {
        return {
          endpoint: "https://tokenhub.tencentmaas.com/v1/wand/hunyuan-image/v3-generation",
          payload: (prompt, image) => ({ model, prompt, ...image && { images: [image] } }),
          response: (result) => result.data?.[0]
        };
      }
      return {
        endpoint: "https://tokenhub.tencentmaas.com/v1/images/generations",
        payload: (prompt, image) => ({ model, prompt, ...image && { image }, n: 1, response_format: "b64_json" }),
        response: (result) => result.data?.[0]
      };
    }
  }
};

export function mediaOf(buffer) {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("服务没有返回可显示的 PNG、JPEG 或 WebP 图片。");
}
export async function readLimited(response, limit) {
  if (!response.body) throw new Error("图像服务没有返回内容。");
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > limit) throw new Error("图像服务响应超过面板存储上限。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** 动态拉取提供商的最新图像模型；失败回退到默认列表。customService 为自定义服务定义（可选）。 */
export async function listImageModels(id, credentials, customService) {
  // 自定义服务：从端点来源推导 /v1/models，按 image 过滤；失败回退到配置的生图/编辑模型
  if (customService) {
    const fallback = [
      { id: customService.generationModel, name: customService.generationModel },
      ...(customService.editModel && customService.editModel !== customService.generationModel
        ? [{ id: customService.editModel, name: customService.editModel }]
        : [])
    ];
    const key = await resolveBoundKey(credentials, customService.key, customService.keyOrigin, customService.origin);
    const modelsUrl = customService.origin ? customService.origin + "/v1/models" : null;
    if (!modelsUrl || !key) return { models: fallback, source: "fallback" };
    try {
      const response = await fetch(modelsUrl, {
        headers: { authorization: "Bearer " + key },
        redirect: "error",
        signal: AbortSignal.timeout(15000)
      });
      if (!response.ok) return { models: fallback, source: "fallback" };
      const body = await response.json();
      const list = (body.data ?? body.models ?? []).map((m) => (typeof m === "string" ? { id: m, name: m } : { id: m.id, name: m.name ?? m.id }));
      const filtered = list.filter((m) => m.id && /image|seedream|dall|flux|stable|imagen|gpt-image/i.test(m.id));
      if (!filtered.length) return { models: fallback, source: "fallback" };
      const seen = new Set();
      const ordered = [];
      for (const m of [...fallback, ...filtered.sort((a, b) => a.id.localeCompare(b.id))]) {
        if (!seen.has(m.id)) { seen.add(m.id); ordered.push(m); }
      }
      return { models: ordered, source: "live" };
    } catch {
      return { models: fallback, source: "fallback" };
    }
  }
  const service = services[id];
  if (!service) return { models: [], source: "fallback" };
  const fallback = service.defaultModels ?? [{ id: service.generationModel, name: service.generationModel }];
  const key = (await credentials.resolve(service.key))?.value?.trim();
  if (!service.modelsUrl || !key) return { models: fallback, source: "fallback" };
  try {
    const response = await fetch(service.modelsUrl, {
      headers: { authorization: "Bearer " + key },
      redirect: "error",
      signal: AbortSignal.timeout(15000)
    });
    if (!response.ok) return { models: fallback, source: "fallback" };
    const body = await response.json();
    const list = (body.data ?? body.models ?? []).map((m) => (typeof m === "string" ? { id: m, name: m } : { id: m.id, name: m.name ?? m.id }));
    const filtered = list.filter((m) => m.id && (!service.modelFilter || service.modelFilter(m.id)));
    if (!filtered.length) return { models: fallback, source: "fallback" };
    // 默认模型置顶，其余按 id 排序，去重
    const seen = new Set();
    const ordered = [];
    for (const m of [...fallback, ...filtered.sort((a, b) => a.id.localeCompare(b.id))]) {
      if (!seen.has(m.id)) {
        seen.add(m.id);
        ordered.push(m);
      }
    }
    return { models: ordered, source: "live" };
  } catch {
    return { models: fallback, source: "fallback" };
  }
}

function createPanelImages(credentials, customLoader = async () => ({})) {
  // 凭据按来源绑定（自定义服务携带 keyOrigin/origin）；预设无来源标记，沿用原解析
  const keyFor = (service) => resolveBoundKey(credentials, service.key, service.keyOrigin, service.origin);
  const allServices = async () => ({ ...services, ...(await customLoader()) });
  return async (action, request) => {
    if (action === "image-options") {
      const all = await allServices();
      return Response.json(await Promise.all(Object.entries(all).map(async ([id3, service2]) => ({
        id: id3,
        name: service2.name,
        generationModel: service2.generationModel,
        editModel: service2.editModel,
        ready: Boolean(await keyFor(service2)),
        custom: !Object.hasOwn(services, id3)
      }))));
    }
    if (action === "image-models") {
      const body = await request.json().catch(() => ({}));
      const all = await allServices();
      const custom = typeof body.provider === "string" && !Object.hasOwn(services, body.provider) ? all[body.provider] : undefined;
      return Response.json(await listImageModels(body.provider, credentials, custom));
    }
    const form2 = await request.formData();
    const id2 = form2.get("provider");
    const all = await allServices();
    const service = typeof id2 === "string" && Object.hasOwn(all, id2) ? all[id2] : null;
    if (!service) throw new Error("请选择图像生成服务。");
    const key3 = await keyFor(service);
    if (!key3) throw new Error("请先配置 " + service.key + "。");
    const prompt = form2.get("prompt");
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > 2e3) throw new Error("图像描述须为 1 至 2000 字。");
    const file = form2.get("reference");
    let image;
    if (file) {
      if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024) throw new Error("参考图须在 10 MB 以内。");
      const buffer2 = Buffer.from(await file.arrayBuffer());
      const media = mediaOf(buffer2);
      image = "data:" + media + ";base64," + buffer2.toString("base64");
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(18e4)]);
    const modelForm = form2.get("model");
    if (modelForm !== null && (typeof modelForm !== "string" || !/^[\w./:-]{1,160}$/.test(modelForm)))
      throw new Error("请在模型设置中填写有效的图像模型 ID。");
    const model = modelForm || service.generationModel;
    // 自定义服务：校验所选模型属于该服务，且支持当前操作（文生图 / 参考图编辑）
    if (!service.route) {
      const known = new Set([service.generationModel, service.editModel]);
      if (modelForm && !known.has(model))
        throw new Error("所选模型不在该服务配置中，请选用其生图或编辑模型。");
      if (service.generationModel !== service.editModel) {
        if (image && model === service.generationModel)
          throw new Error("该模型不支持参考图编辑，请选用编辑模型。");
        if (!image && model === service.editModel)
          throw new Error("该模型用于参考图编辑，文生图请选用生图模型。");
      }
    }
    // 预设按模型路由；自定义服务用固定端点
    const route = service.route
      ? service.route(model, Boolean(image))
      : { endpoint: service.endpoint, payload: service.payload, response: service.response };
    if (id2 === "hunyuan" && model === "hy-image-v3" && image && image.startsWith("data:image/webp"))
      throw new Error("混元 3.0 的参考图请使用 PNG 或 JPEG。");
    const payload = route.payload(prompt.trim(), image, model);
    const actualModel = typeof payload.model === "string" && payload.model ? payload.model : model;
    const response = await fetch(route.endpoint, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { authorization: "Bearer " + key3, "content-type": "application/json" },
      body: JSON.stringify(payload)
    }).catch((error2) => {
      throw new Error(service.name + " 连接失败：" + (error2?.cause?.message ?? error2?.message ?? "网络错误"));
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(service.name + " 生图失败（HTTP " + response.status + "）" + upstreamErrorDetail(detail));
    }
    const item = route.response(JSON.parse((await readLimited(response, maxBytes * 1.4)).toString()));
    const encoded = item?.b64_json;
    let buffer;
    if (encoded && /^[\da-z+/]+={0,2}$/i.test(encoded)) {
      buffer = Buffer.from(encoded, "base64");
    } else {
      const address = item?.url || item?.image;
      if (!address) throw new Error(service.name + " 没有返回生成结果。");
      const url = new URL(address);
      if (url.protocol !== "https:" || url.username || url.password || url.port || !service.domains.some((domain) => url.hostname === domain || url.hostname.endsWith("." + domain)))
        throw new Error(service.name + " 返回了未授权的图片地址。");
      const asset = await fetch(url, { redirect: "error", signal });
      if (!asset.ok) throw new Error(service.name + " 的结果图下载失败（HTTP " + asset.status + "）。");
      buffer = await readLimited(asset, maxBytes);
    }
    if (buffer.length > maxBytes) throw new Error("图像超过面板存储上限。");
    const type = mediaOf(buffer);
    return new Response(buffer, { headers: {
      "content-type": type,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-image-model": actualModel,
      "content-disposition": 'inline; filename="image.' + formats[type] + '"'
    } });
  };
}

export { createPanelImages };