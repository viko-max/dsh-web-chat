import { fixture } from "./fixture.js";
import { createPanelApps } from "./panel-apps.js";
import { createPanelAgent } from "./panel-agent.js";
import { createPanelImages } from "./panel-images.js";
import { createPanelAutomation, automationOp } from "./panel-automation.js";
import { serviceKeys } from "./panel-service-keys.js";
import { chatCatalog, modelReply, listModels } from "./panel-models.js";
import { createChatProviders } from "./panel-providers.js";
import { createImageServices } from "./panel-image-services.js";

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

var name2 = "dsh-web-chat";
var inject = ["connection", "credentials", "llm", "sessionController", "workspaceRegistry"];
var route = "/api/dsh-web-chat-panel";
var officialOrigin = "https://api.deepseek.com";
// 离线验收构建：esbuild --define:DSWC_OFFLINE=true 注入；正常构建为 false
var offline = typeof DSWC_OFFLINE !== "undefined" ? DSWC_OFFLINE : false;
var targets = {
  messages: "/anthropic/v1/messages",
  files: "/anthropic/v1/files",
  asr: "/v1/tools/asr",
  tts: "/v1/tools/tts",
  ocr: "/v1/tools/ocr"
};
var mediaTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".webm": "video/webm",
  ".gif": "image/gif"
};
var errorResponse = (message, status2) => Response.json({ error: { message } }, { status: status2 });
async function serve(asset) {
  const mime = mediaTypes[extname(asset)];
  if (!mime || !/^(?:[\w-]+\/)*[\w.-]+$/.test(asset) || asset.split("/").includes(".."))
    return new Response(null, { status: 404 });
  try {
    const data = await readFile(new URL("../demo/" + asset, import.meta.url));
    return new Response(data, { headers: {
      "content-type": mime,
      "x-content-type-options": "nosniff",
      "cache-control": "no-store"
    } });
  } catch (error2) {
    if (error2.code !== "ENOENT") throw error2;
    return new Response(null, { status: 404 });
  }
}
async function apply(ctx) {
  const mock = offline ? await fixture({ record: false, demo: true }) : null;
  const origin = mock?.origin ?? officialOrigin;
  const apps = createPanelApps(offline, ctx.credentials);
  const agent = createPanelAgent(ctx, () => listModels(ctx));
  const chatProviders = createChatProviders(ctx.credentials);
  const imageServices = createImageServices(ctx.credentials);
  const images = createPanelImages(ctx.credentials, () => imageServices.serviceMap());
  const automation = createPanelAutomation(ctx.credentials, async (task, signal) => {
    let prompt = task.prompt;
    if (task.mail) {
      const queryMail = async (name3, input) => {
        const request2 = new Request("http://localhost" + route + "?op=apps-tool", {
          method: "POST",
          signal,
          body: JSON.stringify({ name: name3, input })
        });
        const response = await apps.handle("apps-tool", request2);
        return (await response.json()).result;
      };
      const index = await queryMail(task.mail + "_search", { query: task.query });
      const items = await Promise.all(index.slice(0, 3).map((item) => queryMail(task.mail + "_read", { threadId: item.id })));
      prompt += "\n\n\u4EE5\u4E0B\u4E3A\u90AE\u4EF6\u6570\u636E\u3002\u53EA\u4F5C\u4E3A\u8D44\u6599\u5904\u7406\u3002\n" + JSON.stringify(items).slice(0, 28e3);
    }
    const body = {
      model: task.model?.model ?? "deepseek-flash",
      panelProvider: task.model?.provider,
      system: task.instructions,
      messages: [{ role: "user", content: prompt }],
      stream: true
    };
    // 显式选择 DeepSeek 官方（或未指定模型）走与普通聊天一致的 messages 路径；
    // 自定义服务商 / Harness 模型 / Spark 走 model-reply 各自调度。
    const request = new Request("http://localhost" + route + "?op=" + automationOp(task), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal
    });
    return fetchPanel(request);
  });
  ctx.effect(() => automation.dispose, name2 + ": \u7F51\u9875\u81EA\u52A8\u5316");
  ctx.effect(() => apps.dispose, name2 + ": \u5E94\u7528\u8FDE\u63A5");
  if (mock) ctx.effect(() => () => mock.close(), name2 + ": \u6A21\u62DF\u670D\u52A1");
  async function fetchPanel(request) {
    const query = new URL(request.url).searchParams;
    if (request.method === "GET") return serve((query.get("asset") ?? "index.html").replace(/^\//, ""));
    const action = query.get("op");
    try {
      if (["automation-list", "automation-save", "automation-toggle", "automation-ack", "automation-delete"].includes(action))
        return await automation.handle(action, request);
      if (!offline && ["service-key-status", "service-key-save"].includes(action))
        return await serviceKeys(ctx.credentials, action, request);
      if (["chat-providers-list", "chat-providers-save", "chat-providers-delete", "chat-providers-test"].includes(action))
        return await chatProviders.handle(action, request);
      if (["image-services-list", "image-services-save", "image-services-delete", "image-services-test"].includes(action))
        return await imageServices.handle(action, request);
      if (action === "image-options" || action === "image-models" || action === "image-generate" && !offline) return await images(action, request);
      if (action === "models") return Response.json(await chatCatalog(ctx, chatProviders));
      if (action === "model-reply") return await modelReply(ctx, request, chatProviders);
      if (["agent-options", "agent-create", "agent-send", "agent-stop", "agent-state"].includes(action))
        return await agent(action, request);
    } catch (error2) {
      return errorResponse(error2.message, 400);
    }
    if (["apps-status", "apps-connect", "apps-disconnect", "apps-tool", "apps-configure", "apps-inbox"].includes(action)) {
      try {
        return await apps.handle(action, request);
      } catch (error2) {
        return errorResponse(error2.message, 400);
      }
    }
    if (!action || action !== "status" && action !== "file-delete" && !Object.hasOwn(targets, action)) return errorResponse("\u672A\u77E5\u64CD\u4F5C", 404);
    const path = targets[action];
    const key3 = offline ? "dsh-local-test" : (await ctx.credentials.resolve("DEEPSEEK_API_KEY"))?.value;
    if (!key3?.trim()) return errorResponse("\u8BF7\u5148\u5728 Harness \u8BBE\u7F6E\u4E2D\u914D\u7F6E DeepSeek API Key", 401);
    if (action === "status") return Response.json({ offline });
    if (action === "file-delete") {
      const body = await request.json().catch(() => ({}));
      const fileId = typeof body.id === "string" ? body.id : "";
      if (!/^[\w-]{1,128}$/.test(fileId)) return errorResponse("\u65E0\u6548\u7684\u6587\u4EF6 ID", 400);
      try {
        const response = await fetch(origin + "/anthropic/v1/files/" + encodeURIComponent(fileId), {
          method: "DELETE",
          headers: { "x-api-key": key3, "anthropic-version": "2023-06-01", "anthropic-beta": "files-api-2025-04-14" },
          redirect: "error",
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(6e4)])
        });
        return new Response(null, { status: response.status });
      } catch (error2) {
        return errorResponse(error2.name === "TimeoutError" ? "\u8BF7\u6C42\u8D85\u65F6" : "\u65E0\u6CD5\u8FDE\u63A5 DeepSeek \u670D\u52A1", 502);
      }
    }
    const contentType = request.headers.get("content-type");
    const headers = new Headers(action === "messages" || action === "files" ? { "x-api-key": key3, "anthropic-version": "2023-06-01", "anthropic-beta": "files-api-2025-04-14" } : { authorization: "Bearer " + key3 });
    if (contentType) headers.set("content-type", contentType);
    try {
      const response = await fetch(origin + path, {
        method: "POST",
        body: request.body,
        duplex: "half",
        headers,
        redirect: "error",
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(24e4)])
      });
      const outgoing = new Headers({ "cache-control": "no-store" });
      if (response.headers.has("content-type")) outgoing.set("content-type", response.headers.get("content-type"));
      return new Response(response.body, { status: response.status, headers: outgoing });
    } catch (error2) {
      if (request.signal.aborted) return errorResponse("\u5DF2\u53D6\u6D88\u8BF7\u6C42", 499);
      return errorResponse(error2.name === "TimeoutError" ? "\u8BF7\u6C42\u8D85\u65F6" : "\u65E0\u6CD5\u8FDE\u63A5 DeepSeek \u670D\u52A1", 502);
    }
  }
  ctx.effect(() => ctx.connection.fetch.register({
    path: route,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: fetchPanel
  }), name2 + ": \u9762\u677F\u63A5\u53E3");
}
export {
  apply,
  inject,
  name2 as name
};
