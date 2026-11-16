var recordKey = "dsh-web-chat/qq-bot";
var gatewayApi = "https://api.sgroup.qq.com/gateway";
var sourceEvents = /* @__PURE__ */ new Set(["C2C_MESSAGE_CREATE", "GROUP_AT_MESSAGE_CREATE"]);
function createQQBot(credentials, offline2) {
  let account;
  let socket;
  let heartbeat;
  let retry;
  let stopped = false;
  let revision = 0;
  let attempt = 0;
  let summary = { account: null, configured: true, pending: false, error: null };
  const inbox = [];
  const stale = (generation, id2) => stopped || generation !== revision || id2 !== attempt;
  const closeSocket = () => {
    clearInterval(heartbeat);
    clearTimeout(retry);
    const current = socket;
    socket = void 0;
    current?.close();
  };
  const invalidate = () => {
    revision++;
    attempt++;
    closeSocket();
  };
  async function persist(value, generation, id2) {
    if (stale(generation, id2)) return false;
    if (!offline2) {
      await credentials.modifyRecord(recordKey, () => {
        if (stale(generation, id2)) return void 0;
        return { kind: "grant", payload: { appId: value.appId, secret: value.secret, attempt: id2 } };
      });
      if (stale(generation, id2)) {
        const stored = await credentials.readRecord(recordKey);
        if (stored?.payload?.attempt === id2) await credentials.deleteRecord(recordKey);
        return false;
      }
    }
    if (stale(generation, id2)) return false;
    account = value;
    return true;
  }
  function listen(value, accessToken, generation, id2) {
    const url = value.gateway;
    const ws = socket = new WebSocket(url);
    let seq = null;
    let acknowledged = true;
    const send = (data) => {
      if (ws.readyState === 1) ws.send(JSON.stringify(data));
    };
    ws.addEventListener("message", (event) => {
      if (socket !== ws || stale(generation, id2)) return;
      let packet;
      try {
        packet = JSON.parse(event.data);
      } catch {
        return;
      }
      if (Number.isInteger(packet.s)) seq = packet.s;
      if (packet.op === 10) {
        send({ op: 2, d: {
          token: "QQBot " + accessToken,
          intents: 1 << 25,
          shard: [0, 1],
          properties: { os: process.platform, browser: "dsh-web-chat", device: "dsh-web-chat" }
        } });
        clearInterval(heartbeat);
        heartbeat = setInterval(() => {
          if (!acknowledged) {
            ws.close();
            return;
          }
          acknowledged = false;
          send({ op: 1, d: seq });
        }, Math.max(5e3, packet.d?.heartbeat_interval || 4e4));
        heartbeat.unref?.();
      } else if (packet.op === 11) acknowledged = true;
      else if (packet.op === 1) send({ op: 1, d: seq });
      else if (packet.op === 7 || packet.op === 9) ws.close();
      else if (packet.t === "READY")
        summary = { account: packet.d?.user?.username ?? value.appId, configured: true, pending: false, error: null };
      else if (sourceEvents.has(packet.t) && packet.d?.id && typeof packet.d?.content === "string" && !inbox.some((item) => item.id === packet.d.id)) {
        inbox.unshift({
          id: packet.d.id,
          kind: packet.t === "C2C_MESSAGE_CREATE" ? "\u5355\u804A" : "\u7FA4\u804A",
          text: packet.d.content.trim().slice(0, 2e3),
          at: Date.now()
        });
        inbox.length = Math.min(inbox.length, 30);
      }
    });
    ws.addEventListener("close", () => {
      if (socket !== ws || stale(generation, id2)) return;
      clearInterval(heartbeat);
      summary = { account: null, configured: true, pending: false, error: "QQ \u7F51\u5173\u5DF2\u65AD\u5F00\uFF0C\u6B63\u5728\u7B49\u5F85\u91CD\u8FDE\u3002" };
      retry = setTimeout(() => {
        if (stale(generation, id2)) return;
        void attach(value, generation, id2).catch(() => {
        });
      }, 15e3);
      retry.unref?.();
    });
  }
  async function attach(value, generation, id2) {
    closeSocket();
    if (stale(generation, id2)) return;
    summary = { account: null, configured: true, pending: true, error: null };
    if (offline2) {
      if (!await persist(value, generation, id2)) return;
      summary = { account: value.appId, configured: true, pending: false, error: null };
      return;
    }
    const request = async (url2, init) => {
      const response = await fetch(url2, { ...init, redirect: "error", signal: AbortSignal.timeout(15e3) });
      if (!response.ok) throw new Error("QQ \u5F00\u653E\u5E73\u53F0\u8FD4\u56DE HTTP " + response.status);
      return response.json();
    };
    const access = await request("https://bots.qq.com/app/getAppAccessToken", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ appId: value.appId, clientSecret: value.secret })
    });
    if (stale(generation, id2)) return;
    if (!access.access_token) throw new Error("QQ \u673A\u5668\u4EBA\u51ED\u636E\u672A\u83B7\u6388\u6743\u3002");
    const route2 = await request(gatewayApi, { headers: { authorization: "QQBot " + access.access_token } });
    if (stale(generation, id2)) return;
    const url = new URL(route2.url);
    if (url.protocol !== "wss:" || url.username || url.password || ![".qq.com", ".qcloud.com"].some((domain) => url.hostname.endsWith(domain))) throw new Error("QQ \u8FD4\u56DE\u4E86\u65E0\u6548\u7684\u7F51\u5173\u5730\u5740\u3002");
    if (!await persist(value, generation, id2)) return;
    summary = { account: value.appId, configured: true, pending: false, error: null };
    value.gateway = url.href;
    listen(value, access.access_token, generation, id2);
  }
  if (!offline2) void credentials.readRecord(recordKey).then((record) => {
    if (!stopped && !revision && record?.payload) {
      account = record.payload;
      return attach(account, revision, attempt);
    }
  }).catch(() => {
  });
  return {
    status: () => summary,
    inbox: () => inbox,
    async connect(body) {
      const appId = typeof body.appId === "string" ? body.appId.trim() : "";
      const secret = typeof body.secret === "string" ? body.secret.trim() : "";
      if (!/^\d{3,40}$/.test(appId) || !/^[\w-]{8,240}$/.test(secret)) throw new Error("\u8BF7\u8F93\u5165 QQ \u673A\u5668\u4EBA AppID \u548C AppSecret\u3002");
      invalidate();
      const generation = revision;
      const id2 = attempt;
      try {
        await attach({ appId, secret }, generation, id2);
      } catch (error2) {
        if (!stale(generation, id2)) {
          summary = { account: null, configured: true, pending: false, error: error2.message };
          throw error2;
        }
      }
    },
    async disconnect() {
      invalidate();
      inbox.length = 0;
      account = void 0;
      summary = { account: null, configured: true, pending: false, error: null };
      if (!offline2) await credentials.deleteRecord(recordKey);
    },
    dispose() {
      stopped = true;
      invalidate();
    }
  };
}

export { createQQBot };
