import { EventSourceParserStream } from "eventsource-parser/stream";

import { randomUUID as randomUUID3 } from "node:crypto";
var key2 = "dsh-web-chat/automations";
var blank = { tasks: [], inbox: [] };
var minute = 6e4;
var maxMessages = 100;
var readText = (value, max) => typeof value === "string" ? value.trim().slice(0, max) : "";
// 自动化模型路由：显式 DeepSeek 官方或未指定模型走普通 messages 路径，其余走 model-reply
export const automationOp = (task) =>
  !task.model || task.model.provider === "deepseek-official" ? "messages" : "model-reply";
async function collect(response) {
  if (!response.ok || !response.body) throw new Error("\u6A21\u578B\u8BF7\u6C42\u5931\u8D25\uFF08HTTP " + response.status + "\uFF09");
  const events = response.body.pipeThrough(new TextDecoderStream()).pipeThrough(new EventSourceParserStream());
  let text = "";
  for await (const frame of events) {
    const event = JSON.parse(frame.data);
    if (event.type === "error") throw new Error("\u6A21\u578B\u8FD4\u56DE\u9519\u8BEF");
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta")
      text = (text + event.delta.text).slice(0, 64e3);
    if (event.type === "message_stop" && text.trim()) return text;
  }
  throw new Error("\u6A21\u578B\u672A\u8FD4\u56DE\u5B8C\u6574\u6B63\u6587");
}
function createPanelAutomation(credentials, generate) {
  let running = false;
  const abort = new AbortController();
  // 每个运行中的任务持有独立 AbortController，删除时可精确取消对应请求
  const activeRuns = new Map();
  const read2 = async () => (await credentials.readRecord(key2))?.payload ?? blank;
  const change = (update) => credentials.modifyRecord(key2, (record) => {
    const existing = record?.payload ?? blank;
    const updated = update(existing);
    return updated === existing ? void 0 : { kind: "grant", payload: updated };
  });
  async function tick() {
    if (running || abort.signal.aborted) return;
    running = true;
    let selected;
    let runController;
    try {
      const now = Date.now();
      await change((state) => {
        if (state.inbox.length >= maxMessages) return state;
        const due = state.tasks.find((task) => task.enabled && task.next <= now);
        if (!due) return state;
        const interval = due.every * minute;
        const next = interval ? due.next + (Math.floor((now - due.next) / interval) + 1) * interval : null;
        selected = { ...due, run: randomUUID3() };
        return { ...state, tasks: state.tasks.map((task) => task.id === due.id ? { ...task, enabled: next !== null, next, last: { at: now, status: "running", id: selected.run } } : task) };
      });
      if (!selected) return;
      runController = new AbortController();
      activeRuns.set(selected.id, { run: selected.run, controller: runController });
      let output;
      let status2;
      try {
        output = await collect(await generate(selected, AbortSignal.any([abort.signal, runController.signal, AbortSignal.timeout(12e4)])));
        status2 = "done";
      } catch {
        output = "\u81EA\u52A8\u5316\u8FD0\u884C\u5931\u8D25\u3002\u8BF7\u68C0\u67E5\u6240\u9009\u6A21\u578B\u3001\u51ED\u636E\u548C\u7F51\u7EDC\uFF0C\u7136\u540E\u91CD\u8BD5\u3002";
        status2 = "error";
      }
      // 写入收件箱前校验任务仍存在且运行 ID 仍有效（删除/被取代的结果不投递），并按运行 ID 去重
      await change((state) => {
        const task = state.tasks.find((item) => item.id === selected.id);
        if (!task || task.last?.id !== selected.run) return state;
        if (state.inbox.some((item) => item.id === selected.run)) return state;
        return {
          tasks: state.tasks.map((item) => item.id === selected.id ? { ...item, last: { at: now, status: status2, id: selected.run } } : item),
          inbox: [...state.inbox, { id: selected.run, session: selected.session, title: selected.title, text: output, at: now, status: status2 }]
        };
      });
    } finally {
      if (selected) activeRuns.delete(selected.id);
      running = false;
    }
  }
  const run = () => void tick().catch((error2) => console.warn("[dsh-web-chat] \u81EA\u52A8\u5316\u5B58\u50A8\u6682\u4E0D\u53EF\u7528", error2.name));
  void change((state) => !state.tasks.some((task) => task.last?.status === "running") ? state : {
    ...state,
    tasks: state.tasks.map((task) => task.last?.status === "running" ? { ...task, last: { ...task.last, status: "error" } } : task)
  }).catch((error2) => console.warn("[dsh-web-chat] \u65E0\u6CD5\u6062\u590D\u81EA\u52A8\u5316\u72B6\u6001", error2.name));
  const timer = setInterval(run, 3e3);
  timer.unref();
  return {
    dispose() {
      clearInterval(timer);
      abort.abort();
    },
    async handle(action, request) {
      if (action === "automation-list") {
        const state = await read2();
        return Response.json(state);
      }
      const body = await request.json();
      if (action === "automation-ack") {
        const ids = new Set(Array.isArray(body.ids) ? body.ids.slice(0, maxMessages) : []);
        await change((state) => ({ ...state, inbox: state.inbox.filter((item) => !ids.has(item.id)) }));
      } else if (action === "automation-toggle") {
        await change((state) => ({ ...state, tasks: state.tasks.map((task) => task.id === body.id ? { ...task, enabled: !task.enabled, next: task.enabled ? task.next : Math.max(Date.now(), task.next ?? 0) } : task) }));
      } else if (action === "automation-delete") {
        const id2 = readText(body.id, 80);
        if (!id2) throw new Error("\u7F3A\u5C11\u8981\u5220\u9664\u7684\u4EFB\u52A1\u3002");
        activeRuns.get(id2)?.controller.abort();
        activeRuns.delete(id2);
        await change((state) => ({ ...state, tasks: state.tasks.filter((task) => task.id !== id2) }));
      } else {
        const title = readText(body.title, 80);
        const prompt = readText(body.prompt, 24e3);
        const instructions = readText(body.instructions, 24e3);
        const mail = ["gmail", "outlook", "qqmail"].includes(body.mail) ? body.mail : "";
        const query = readText(body.query, 300);
        const session = readText(body.session, 128);
        const next = Number(body.next);
        const every = Number(body.every);
        if (!title || !prompt || !session || !Number.isSafeInteger(next) || next < Date.now() - minute || !Number.isSafeInteger(every) || every < 0 || every > 525600) throw new Error("\u8BF7\u586B\u5199\u4EFB\u52A1\u540D\u79F0\u3001\u6307\u4EE4\u3001\u5BF9\u8BDD\u548C\u6709\u6548\u8FD0\u884C\u65F6\u95F4\u3002");
        if (mail && (!query || body.allowMail !== true)) throw new Error("\u8BF7\u586B\u5199\u90AE\u4EF6\u7B5B\u9009\u8BCD\u5E76\u786E\u8BA4\u5C06\u5339\u914D\u90AE\u4EF6\u4EA4\u7ED9\u6A21\u578B\u3002");
        const model = body.model?.provider && body.model?.model ? { provider: readText(body.model.provider, 160), model: readText(body.model.model, 250) } : null;
        await change((state) => {
          const current = state.tasks.find((task2) => task2.id === body.id);
          if (!current && state.tasks.length >= 30) throw new Error("\u6700\u591A\u4FDD\u5B58 30 \u4E2A\u81EA\u52A8\u5316\u4EFB\u52A1\u3002");
          const task = {
            id: current?.id ?? randomUUID3(),
            title,
            prompt,
            instructions,
            session,
            next,
            every,
            model,
            mail,
            query,
            enabled: current?.enabled ?? true,
            last: current?.last ?? null
          };
          return { ...state, tasks: current ? state.tasks.map((item) => item.id === task.id ? task : item) : [...state.tasks, task] };
        });
        run();
      }
      return Response.json({ ok: true });
    }
  };
}

export { createPanelAutomation };
