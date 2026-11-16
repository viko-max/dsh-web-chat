import { EventSourceParserStream } from "eventsource-parser/stream";

import { randomUUID } from "node:crypto";
import { isCustomProvider } from "./panel-providers.js";

var spark = { provider: "dswc-spark", model: "spark-x2.6", name: "Spark X2.6 \xB7 \u8BAF\u98DE\u661F\u8FB0 MaaS", tools: true };
var sparkEndpoint = "https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions";
var error = (message, status2) => Response.json({ error: { message } }, { status: status2 });
async function listModels(ctx) {
  const providers2 = ctx.llm?.listProviders() ?? [];
  return (await Promise.allSettled(providers2.map(async (provider) => (await ctx.llm.listModels(provider.id)).map((model) => ({
    provider: provider.id,
    model: model.id,
    name: model.name + " \xB7 " + provider.name,
    tools: true
  }))))).flatMap((result) => result.status === "fulfilled" ? result.value : []);
}
async function chatModels(ctx, chatProviders) {
  const key3 = (await ctx.credentials.resolve("DSWC_SPARK_API_KEY"))?.value;
  const models = await listModels(ctx);
  const custom = chatProviders ? await chatProviders.catalog() : [];
  return [...key3 ? [spark] : [], ...custom, ...models];
}
async function chatCatalog(ctx, chatProviders) {
  const providers2 = ctx.llm.listProviders();
  const results = await Promise.allSettled(providers2.map(async (provider) => {
    const models = await ctx.llm.listModels(provider.id);
    if (!models.length) throw new Error("\u7A7A\u6A21\u578B\u5217\u8868");
    return models.map((model) => ({ provider: provider.id, model: model.id, name: model.name + " \xB7 " + provider.name, tools: true }));
  }));
  const key3 = (await ctx.credentials.resolve("DSWC_SPARK_API_KEY"))?.value;
  const custom = chatProviders ? await chatProviders.catalog() : [];
  return { models: [...key3 ? [spark] : [], ...custom, ...results.flatMap((result) => result.status === "fulfilled" ? result.value : [])], unavailable: providers2.flatMap((provider, index) => results[index].status === "rejected" ? [provider.name] : []) };
}
async function* sparkStream(key3, messages, system, tools, signal) {
  const response = await fetch(sparkEndpoint, {
    method: "POST",
    redirect: "error",
    signal,
    headers: { authorization: "Bearer " + key3, "content-type": "application/json" },
    body: JSON.stringify({
      model: spark.model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 8192,
      messages: [...system ? [{ role: "system", content: system }] : [], ...messages],
      ...tools.length ? { tools, tool_choice: "auto" } : {}
    })
  });
  if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("text/event-stream"))
    throw new Error("\u8BAF\u98DE\u661F\u8FB0 MaaS \u8BF7\u6C42\u5931\u8D25\uFF08HTTP " + response.status + "\uFF09\u3002\u8BF7\u68C0\u67E5\u5BC6\u94A5\u3001\u6A21\u578B\u6743\u9650\u53CA\u4F59\u989D\u3002");
  const events = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream());
  let reason;
  for await (const { data } of events) {
    if (data === "[DONE]") break;
    const event = JSON.parse(data);
    if (event.error) throw new Error("\u8BAF\u98DE\u661F\u8FB0 MaaS \u8FD4\u56DE\u6D41\u5F0F\u9519\u8BEF\u3002");
    const choice = event.choices?.[0];
    if (choice?.delta?.reasoning_content)
      yield { type: "reasoning-delta", index: 0, text: choice.delta.reasoning_content };
    if (choice?.delta?.content)
      yield { type: "text-delta", index: 1, text: choice.delta.content };
    for (const call of choice?.delta?.tool_calls ?? []) {
      const index = 2 + (Number.isSafeInteger(call.index) ? call.index : 0);
      const name3 = call.function?.name || "";
      yield { type: "tool-call-delta", index, id: call.id || "", name: name3, argumentsDelta: call.function?.arguments || "" };
    }
    if (choice?.finish_reason) reason = choice.finish_reason;
    const usage = event.usage;
    if (Number.isSafeInteger(usage?.prompt_tokens) && Number.isSafeInteger(usage?.completion_tokens)) {
      const cached = usage.prompt_tokens_details?.cached_tokens;
      const cacheReadTokens = Number.isSafeInteger(cached) && cached >= 0 && cached <= usage.prompt_tokens ? cached : void 0;
      yield { type: "usage", usage: {
        inputTokens: usage.prompt_tokens - (cacheReadTokens ?? 0),
        outputTokens: usage.completion_tokens,
        cacheReadTokens
      } };
    }
  }
  if (!reason) throw new Error("\u8BAF\u98DE\u661F\u8FB0 MaaS \u7684\u6D41\u5F0F\u56DE\u590D\u63D0\u524D\u7ED3\u675F\u3002");
  const kind = reason === "length" ? "max-tokens" : reason === "tool_calls" ? "tool-calls" : "stop";
  yield { type: "finish", reason: { kind } };
}
async function modelReply(ctx, request, chatProviders) {
  const body = await request.json();
  const provider = body.panelProvider;
  const model = body.model;
  if (isCustomProvider(provider) && chatProviders) {
    const customCancel = new AbortController();
    const customSignal = AbortSignal.any([request.signal, customCancel.signal, AbortSignal.timeout(24e4)]);
    return chatProviders.reply(body, customSignal, () => customCancel.abort());
  }
  if (!(await chatModels(ctx, chatProviders)).some((item) => item.provider === provider && item.model === model))
    return error("\u8BE5\u6A21\u578B\u672A\u914D\u7F6E\u3002\u8BF7\u5728 Harness \u7684\u6A21\u578B\u5217\u8868\u6216\u81EA\u5B9A\u4E49\u670D\u52A1\u5546\u4E2D\u542F\u7528\u3002", 400);
  const sparkMessages = [];
  const messages = [];
  for (const message of body.messages ?? []) {
    const blocks2 = typeof message.content === "string" ? [{ type: "text", text: message.content }] : message.content ?? [];
    if (message.role === "assistant") {
      const content = [];
      const sparkText = [];
      for (const block of blocks2) {
        if (block.type === "text" && typeof block.text === "string") {
          content.push({ type: "text", text: block.text });
          sparkText.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use" && block.id && block.name) {
          content.push({ type: "tool-call", id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) });
        }
      }
      if (content.length) messages.push({ id: randomUUID(), role: "assistant", source: { kind: "model", provider, model }, content });
      const calls = blocks2.flatMap((block) => block.type === "tool_use" && block.id && block.name ? [{
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) }
      }] : []);
      const text = sparkText.map((block) => block.text).join("\n");
      if (text || calls.length) sparkMessages.push({ role: "assistant", ...text ? { content: text } : {}, ...calls.length ? { tool_calls: calls } : {} });
    } else if (message.role === "user") {
      const text = [];
      const images = [];
      for (const block of blocks2) {
        if (block.type === "text" && typeof block.text === "string") text.push({ type: "text", text: block.text });
        else if (block.type === "image" && block.source?.type === "base64")
          images.push({ type: "image_url", image_url: { url: "data:" + block.source.media_type + ";base64," + block.source.data } });
        else if (block.type === "tool_result" && block.tool_use_id) {
          const result = typeof block.content === "string" ? block.content : JSON.stringify(block.content ?? "");
          messages.push({
            id: randomUUID(),
            role: "tool",
            toolCallId: block.tool_use_id,
            isError: Boolean(block.is_error),
            source: { kind: "tool", callId: block.tool_use_id },
            content: [{ type: "text", text: result.slice(0, 12e3) }]
          });
          sparkMessages.push({ role: "tool", tool_call_id: block.tool_use_id, content: result.slice(0, 12e3) });
        }
      }
      if (text.length || images.length) {
        messages.push({ role: "user", content: text });
        const joined = text.map((block) => block.text).join("\n");
        sparkMessages.push({
          role: "user",
          content: images.length
            ? [...(joined ? [{ type: "text", text: joined }] : []), ...images]
            : joined
        });
      }
    }
  }
  const last = messages.at(-1);
  if (!messages.length || last.role !== "user" && last.role !== "tool") return error("\u8BF7\u53D1\u9001\u4E00\u6761\u6587\u5B57\u6D88\u606F\u3002", 400);
  const named = (body.tools ?? []).flatMap((tool) => tool?.name && tool.input_schema ? [{ name: tool.name, description: tool.description || tool.name, parameters: tool.input_schema }] : []);
  const declared = provider === spark.provider ? [] : named;
  const sparkTools = named.map((tool) => ({ type: "function", function: tool }));
  const cancel = new AbortController();
  const signal = AbortSignal.any([request.signal, cancel.signal, AbortSignal.timeout(24e4)]);
  const stream = provider === spark.provider ? sparkStream((await ctx.credentials.resolve("DSWC_SPARK_API_KEY"))?.value, sparkMessages, body.system, sparkTools, signal) : ctx.llm.stream({ provider, model, system: body.system, messages, signal, ...declared.length ? { tools: declared } : {} });
  const encoder = new TextEncoder();
  const blocks = /* @__PURE__ */ new Map();
  let usage;
  return new Response(new ReadableStream({
    async start(controller) {
      const send = (type, fields = {}) => {
        if (!cancel.signal.aborted) controller.enqueue(encoder.encode("event: " + type + "\ndata: " + JSON.stringify({ ...fields, type }) + "\n\n"));
      };
      const closeBlock = (index) => {
        const block = blocks.get(index);
        if (block && !block.closed) {
          block.closed = true;
          send("content_block_stop", { index: block.index });
        }
      };
      try {
        send("message_start", { message: {
          id: randomUUID(),
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          stop_sequence: null
        } });
        for await (const chunk of stream) {
          if (chunk.type === "text-delta" || chunk.type === "reasoning-delta") {
            const thinking = chunk.type === "reasoning-delta";
            if (!blocks.has(chunk.index)) {
              const index = blocks.size;
              blocks.set(chunk.index, { index, closed: false });
              send("content_block_start", {
                index,
                content_block: thinking ? { type: "thinking", thinking: "" } : { type: "text", text: "" }
              });
            }
            send("content_block_delta", {
              index: blocks.get(chunk.index).index,
              delta: thinking ? { type: "thinking_delta", thinking: chunk.text } : { type: "text_delta", text: chunk.text }
            });
          } else if (chunk.type === "tool-call-delta") {
            if (!blocks.has(chunk.index)) {
              const index = blocks.size;
              blocks.set(chunk.index, { index, closed: false });
              send("content_block_start", { index, content_block: { type: "tool_use", id: chunk.id, name: chunk.name || "", input: {} } });
            }
            send("content_block_delta", {
              index: blocks.get(chunk.index).index,
              delta: { type: "input_json_delta", partial_json: chunk.argumentsDelta || "" }
            });
          } else if (chunk.type === "block-end") {
            if (chunk.block?.type === "tool-call" && !blocks.has(chunk.index)) {
              const index = blocks.size;
              blocks.set(chunk.index, { index, closed: false });
              send("content_block_start", { index, content_block: { type: "tool_use", id: chunk.block.id, name: chunk.block.name, input: {} } });
              send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: chunk.block.arguments || "{}" } });
            }
            closeBlock(chunk.index);
          } else if (chunk.type === "usage") {
            const units = chunk.usage;
            usage = {
              input_tokens: units.inputTokens,
              output_tokens: units.outputTokens,
              cache_read_input_tokens: units.cacheReadTokens ?? 0,
              cache_creation_input_tokens: units.cacheWriteTokens ?? 0,
              cache_reported: units.cacheReadTokens !== void 0
            };
          } else if (chunk.type === "finish") {
            if (!["stop", "max-tokens", "tool-calls"].includes(chunk.reason.kind))
              throw new Error("Harness \u6A21\u578B\u672A\u8FD4\u56DE\u5B8C\u6574\u56DE\u590D\u3002\u8BF7\u68C0\u67E5\u670D\u52A1\u5546\u8BBE\u7F6E\u548C\u8FDE\u63A5\u3002");
            for (const index of blocks.keys()) closeBlock(index);
            const stop = chunk.reason.kind === "max-tokens" ? "max_tokens" : chunk.reason.kind === "tool-calls" ? "tool_use" : "end_turn";
            send("message_delta", { delta: { stop_reason: stop }, usage });
            send("message_stop");
          }
        }
      } catch (reason) {
        send("error", { error: { message: provider === spark.provider && reason instanceof Error && reason.message.startsWith("\u8BAF\u98DE\u661F\u8FB0 MaaS") ? reason.message : "\u6A21\u578B\u8BF7\u6C42\u4E2D\u65AD\u3002\u8BF7\u68C0\u67E5\u670D\u52A1\u5546\u8BBE\u7F6E\u548C\u7F51\u7EDC\u540E\u91CD\u8BD5\u3002" } });
      } finally {
        if (!cancel.signal.aborted) controller.close();
      }
    },
    cancel() {
      cancel.abort();
    }
  }), { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

export { listModels, chatModels, chatCatalog, modelReply };
