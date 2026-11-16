import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
function wave(rate = 16e3) {
  const samples = rate * 4;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF");
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(rate, 24);
  buffer.writeUInt32LE(rate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(1300 * Math.sin(i * Math.PI * 2 * 440 / rate)), i * 2 + 44);
  return buffer;
}
async function fixture({ record = true, demo = false } = {}) {
  const calls = [];
  const failures = [];
  let fileIndex = 0;
  const server = createServer(async (req, res) => {
    try {
      if (demo && req.method === "DELETE" && req.url.startsWith("/anthropic/v1/files/")) {
        res.writeHead(204);
        res.end();
        return;
      }
      const buffers = [];
      for await (const bytes of req) buffers.push(bytes);
      const blob = Buffer.concat(buffers);
      const multipart = req.headers["content-type"]?.startsWith("multipart/");
      const payload = multipart ? await new Response(blob, { headers: { "content-type": req.headers["content-type"] } }).formData() : JSON.parse(blob.toString());
      if (record) calls.push({ path: req.url, payload });
      assert.equal(req.method, "POST");
      const json2 = (body) => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/v1/chat/completions") {
        assert.equal(req.headers.authorization, "Bearer dsh-local-test");
        assert.equal(payload.model, "agent-fixture");
        assert.equal(payload.stream, true);
        const answer = "Harness \u539F\u751F\u4F1A\u8BDD\u5DF2\u6536\u5230\u4EFB\u52A1\u3002";
        const base = { id: "chatcmpl-fixture", object: "chat.completion.chunk", model: payload.model };
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const choices of [
          [{ index: 0, delta: { role: "assistant", content: answer }, finish_reason: null }],
          [{ index: 0, delta: {}, finish_reason: "stop" }],
          []
        ]) {
          res.write("data: " + JSON.stringify({ ...base, choices, ...choices.length ? {} : {
            usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48 }
          } }) + "\n\n");
        }
        res.end("data: [DONE]\n\n");
        return;
      }
      if (req.url === "/anthropic/v1/messages") {
        assert.equal(req.headers["x-api-key"], "dsh-local-test");
        assert.equal(payload.model, "deepseek-flash");
        assert.equal(payload.stream, true);
        const incoming = JSON.stringify(payload.messages);
        const ids = payload.tools?.map((tool2) => tool2.type) ?? [];
        const withSearch = ids.includes("deepseek_web_search");
        const withLink = ids.includes("deepseek_read_url");
        const content = payload.messages.at(-1).content;
        const latest = typeof content === "string" ? content : content.map((item) => item.text).join(" ");
        const registered = new Set(payload.tools?.map((tool2) => tool2.name));
        const toolResult = Array.isArray(content) && content.find((item) => item.type === "tool_result");
        let tool;
        if (demo && latest.includes("\u67E5 GitHub") && registered.has("github_detail"))
          tool = ["github_detail", "github-pr", { repo: "demo/example", kind: "pulls", number: 7 }];
        if (demo && latest.includes("\u67E5 Gmail") && registered.has("gmail_search"))
          tool = ["gmail_search", "gmail-search", { query: "newer_than:7d" }];
        if (demo && toolResult?.tool_use_id === "gmail-search" && !toolResult.is_error) {
          assert.match(toolResult.content, /offline-thread/);
          tool = ["gmail_read", "gmail-read", { threadId: "offline-thread" }];
        }
        let answer = latest.includes("\u7EED\u804A") && incoming.includes("\u6A59\u8272\u9CB8\u9C7C") ? "\u7EED\u804A\u6210\u529F\uFF0C\u6697\u53F7\u662F\u6A59\u8272\u9CB8\u9C7C\u3002" : latest.includes("\u7B2C\u4E8C\u6761") ? "\u8FD9\u662F\u7B2C\u4E8C\u6761\u79BB\u7EBF\u56DE\u590D\u3002" : latest.includes("\u68C0\u67E5\u56DE\u590D\u98CE\u683C") ? payload.system.includes("\u76F4\u63A5\u7ED9\u7ED3\u8BBA") ? "\u5DF2\u6536\u5230\u7B80\u6D01\u6A21\u5F0F\u3002" : "\u5F53\u524D\u662F\u9ED8\u8BA4\u6A21\u5F0F\u3002" : latest.includes("\u7EC4\u4EF6\u9A8C\u8BC1") ? "\u79BB\u7EBF\u5DE5\u5177\u9A8C\u8BC1\u5B8C\u6210\u3002" : "\u8FD9\u662F\u7B2C\u4E00\u6761\u79BB\u7EBF\u56DE\u590D\u3002";
        if (demo && toolResult?.tool_use_id === "github-pr") {
          assert.match(toolResult.content, /loadLocal/);
          answer = "\u79BB\u7EBF GitHub \u5DE5\u5177\u5DF2\u8BFB\u5230 PR #7 \u7684\u6539\u52A8\u3002";
        }
        if (demo && toolResult?.tool_use_id?.startsWith("gmail-")) {
          if (toolResult.is_error) {
            assert.doesNotMatch(toolResult.content, /周五交付|demo@example/);
            answer = "\u672A\u6536\u5230\u90AE\u4EF6\u539F\u6587\u3002";
          } else if (toolResult.tool_use_id === "gmail-read") {
            assert.match(toolResult.content, /周五交付/);
            answer = "\u79BB\u7EBF Gmail \u5DE5\u5177\u5DF2\u8BFB\u5230\uFF1A\u9879\u76EE\u5C06\u5728\u5468\u4E94\u4EA4\u4ED8\u3002";
          }
        }
        const showLink = withLink && (!demo || latest.includes("https://"));
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store" });
        const send = (type, body = {}) => res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...body }) + "\n\n");
        send("message_start", { message: { usage: { input_tokens: 60, output_tokens: 0, cache_read_input_tokens: 40, cache_creation_input_tokens: 0 } } });
        let index = 0;
        if (tool) {
          const [name3, id2, input] = tool;
          const args = JSON.stringify(input);
          send("content_block_start", { index, content_block: { type: "tool_use", id: id2, name: name3, input: {} } });
          send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: args.slice(0, 7) } });
          send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: args.slice(7) } });
          send("content_block_stop", { index });
          send("message_delta", {
            delta: { stop_reason: "tool_use" },
            usage: { input_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 40, output_tokens: 5 }
          });
          send("message_stop");
          res.end();
          return;
        }
        if (withSearch) {
          send("content_block_start", { index, content_block: {
            type: "server_tool_use",
            id: "srvtoolu_mock",
            name: "deepseek_web_search",
            kind: "deep_search",
            caller: { type: "direct" },
            input: demo ? { action: "search", queries: ["\u5B9E\u9A8C"] } : {}
          } });
          if (!demo) send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: '{"action":"search","queries":["\u5B9E\u9A8C"]}' } });
          send("content_block_stop", { index: index++ });
          send("content_block_start", { index, content_block: {
            type: "web_search_tool_result",
            tool_use_id: "srvtoolu_mock",
            kind: "deep_search",
            content: []
          } });
          send("content_block_stop", { index: index++ });
        }
        if (showLink) {
          send("content_block_start", { index, content_block: {
            type: "server_tool_use",
            id: "srvtoolu_fetch",
            name: "deepseek_read_url",
            kind: "read_link",
            caller: { type: "direct" },
            input: { action: "open_page", url: "https://example.test/source" }
          } });
          send("content_block_stop", { index: index++ });
          send("content_block_start", { index, content_block: {
            type: "web_fetch_tool_result",
            kind: "read_link",
            tool_use_id: "srvtoolu_fetch",
            signature: "mock-signed-page",
            content: {
              type: "web_fetch_result",
              url: "https://example.test/source",
              published_at: null,
              content: { type: "document", title: "\u672C\u5730\u6A21\u62DF\u6765\u6E90", source: { type: "text", media_type: "text/plain", data: "" } }
            }
          } });
          send("content_block_stop", { index: index++ });
        }
        send("content_block_start", { index, content_block: { type: "text", text: "" } });
        send("content_block_delta", { index, delta: { type: "text_delta", text: answer.slice(0, 6) } });
        await delay(demo && latest.includes("\u684C\u5BA0\u52A8\u4F5C\u6D4B\u8BD5") ? 750 : 225);
        send("content_block_delta", { index, delta: { type: "text_delta", text: answer.slice(6) } });
        if (withSearch || showLink) send("content_block_delta", { index, delta: { type: "citations_delta", citation: {
          type: "web_search_result_location",
          url: "https://example.test/source",
          title: "\u672C\u5730\u6A21\u62DF\u6765\u6E90",
          cited_text: answer,
          encrypted_index: ""
        } } });
        send("content_block_stop", { index });
        if (latest.includes("\u5F02\u5E38\u4E2D\u65AD")) {
          res.end();
          return;
        }
        send("message_delta", {
          delta: { stop_reason: "end_turn", ...demo && payload.title ? { title: "\u79BB\u7EBF\u6D4B\u8BD5\u5BF9\u8BDD" } : {} },
          usage: demo ? { input_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 40, output_tokens: 12 } : { output_tokens: 12 }
        });
        send("message_stop");
        res.end();
        return;
      }
      if (demo && req.url === "/anthropic/v1/files") assert.equal(req.headers["x-api-key"], "dsh-local-test");
      else assert.equal(req.headers.authorization, "Bearer dsh-local-test");
      if (req.url === "/v1/tools/tts") {
        assert.equal(payload.format, demo ? "pcm" : "wav");
        assert.ok(payload.text.trim());
        res.writeHead(200, { "content-type": demo ? "application/octet-stream" : "audio/wav" });
        res.end(demo ? wave(24e3).subarray(44) : wave());
      } else if (req.url === "/v1/tools/asr") {
        const file = payload.get("file");
        assert.ok(file.size > 44);
        assert.match(file.name, /^(?:speech|recording)\.(wav|ogg)$/);
        json2({ text: "\u8FD9\u662F\u79BB\u7EBF\u8BED\u97F3\u8F6C\u5199", duration_ms: 1e3 });
      } else if (req.url === "/v1/tools/ocr") {
        assert.ok(payload.get("file").size > 0);
        if (payload.get("file").name === "bad.pdf") json2({ error: { code: "invalid_document" } });
        else json2({ pages: [{ index: 0, text: "\u79BB\u7EBF OCR \u8BC6\u522B\u7ED3\u679C", finish_reason: "stop" }] });
      } else if (req.url === "/files" || req.url === "/anthropic/v1/files") {
        assert.ok(payload.get("file").size > 0);
        assert.ok(["text_recognition", "rich_layout_recognition", "user_data", ...demo ? [null] : []].includes(payload.get("purpose")));
        json2({ id: "file-api-mock-" + ++fileIndex });
      } else throw new Error("\u975E\u9884\u671F\u8DEF\u5F84 " + req.url);
    } catch (error2) {
      if (record) failures.push(error2);
      if (!res.headersSent) res.writeHead(400);
      res.end(String(error2));
    }
  });
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  return {
    calls,
    failures,
    origin: "http://127.0.0.1:" + server.address().port,
    close: () => new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections();
    })
  };
}

export { fixture };
