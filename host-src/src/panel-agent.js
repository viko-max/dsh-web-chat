import { randomUUID as randomUUID2 } from "node:crypto";
var routeKey = "dsh-web-chat/agent-sessions";
var validId = (value) => typeof value === "string" && /^[\w-]{1,128}$/.test(value);
function createPanelAgent(ctx, listModels2) {
  const sessions = () => ctx.sessionController;
  const recent = async () => (await ctx.credentials.readRecord(routeKey))?.payload?.sessions ?? [];
  return async (action, request) => {
    if (!sessions()) throw new Error("\u5F53\u524D Harness \u672A\u52A0\u8F7D\u539F\u751F\u4F1A\u8BDD\u670D\u52A1\u3002");
    if (action === "agent-options") {
      const workspaces = ctx.workspaceRegistry.list().map(({ id: id2, title }) => ({ id: id2, name: title }));
      return Response.json({ workspaces, models: await listModels2(), recent: await recent() });
    }
    const input = await request.json();
    const signal = request.signal;
    if (action === "agent-create") {
      const workspaceId = input.workspaceId || void 0;
      if (workspaceId && !ctx.workspaceRegistry.get(workspaceId)) throw new Error("\u8BE5\u5DE5\u4F5C\u533A\u5DF2\u4E0D\u5B58\u5728\u3002");
      const { sessionId: sessionId2 } = await sessions().create({ workspaceId, sessionId: randomUUID2() });
      await ctx.credentials.modifyRecord(routeKey, (current) => ({
        kind: "grant",
        payload: { sessions: [
          { id: sessionId2, workspaceId: workspaceId ?? null },
          ...(current?.payload?.sessions ?? []).filter((item) => item.id !== sessionId2)
        ].slice(0, 24) }
      }));
      return Response.json({ sessionId: sessionId2 });
    }
    const sessionId = input.sessionId;
    if (!validId(sessionId) || !(await recent()).some((item) => item.id === sessionId))
      throw new Error("\u8BF7\u5148\u5728\u9762\u677F\u9009\u62E9\u6216\u521B\u5EFA\u4E00\u4E2A Agent \u4F1A\u8BDD\u3002");
    if (action === "agent-send") {
      const text = typeof input.text === "string" ? input.text.trim() : "";
      if (!text || text.length > 32e3 || !validId(input.requestId)) throw new Error("\u4EFB\u52A1\u6B63\u6587\u9700\u8981\u5728 1 \u81F3 32000 \u5B57\u7B26\u5185\u3002");
      if (input.selection) {
        const [provider, model] = input.selection;
        if (!(await listModels2()).some((item) => item.provider === provider && item.model === model))
          throw new Error("\u8BE5\u6A21\u578B\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002");
        await sessions().selectModel({ sessionId, provider, model });
      }
      await sessions().prompt({
        sessionId,
        requestId: input.requestId,
        mode: "queue",
        content: [{ type: "text", text }]
      }, signal);
      return Response.json({ accepted: true });
    }
    if (action === "agent-stop") {
      await sessions().cancel({ sessionId });
      return Response.json({ accepted: true });
    }
    const { state, output } = await sessions().wait({ sessionId, timeoutMs: 8e3, maxMessages: 12 }, signal);
    const { records } = await sessions().events({
      address: { kind: "session", sessionId },
      throughSeq: state.cursor,
      maxMessages: 12
    }, signal);
    const lastTurn = records.findLast((item) => item.event.type === "turn/end")?.event.data?.reason?.kind;
    const replies = output.records.flatMap(({ event }) => {
      const content = event.data?.message?.content ?? event.data?.content;
      if (!Array.isArray(content)) return [];
      const text = content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
      return text ? [{ seq: event.seq, text }] : [];
    }).reverse();
    return Response.json({ state, replies, truncated: output.truncated, lastTurn });
  };
}

export { createPanelAgent };
