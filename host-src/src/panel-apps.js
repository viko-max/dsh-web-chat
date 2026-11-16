import { qqMail } from "./panel-qqmail.js";
import { createQQBot } from "./panel-qqbot.js";

import { createHash as createHash2, randomBytes } from "node:crypto";
import { createServer as createServer2 } from "node:http";
import { setTimeout as wait } from "node:timers/promises";

var providers = ["github", "gmail", "outlook"];
var googleScope = "https://www.googleapis.com/auth/gmail.readonly";
var githubHeaders = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "dsh-web-chat" };
var githubToken = "https://github.com/login/oauth/access_token";
var googleToken = "https://oauth2.googleapis.com/token";
var microsoft = "https://login.microsoftonline.com/common/oauth2/v2.0";
var outlookScope = "openid email profile offline_access https://graph.microsoft.com/Mail.Read";
function qqStatus(account, summary) {
  const item = summary ?? { account, configured: true, pending: false, error: null };
  let phase = "ready";
  if (item.pending) phase = "pending";
  else if (item.account) phase = "connected";
  else if (item.error && /失效|撤销|过期|未获授权/.test(item.error)) phase = "expired";
  else if (item.error) phase = "failed";
  return {
    account: phase === "connected" ? item.account : null,
    configured: true,
    pending: phase === "pending",
    error: item.error ?? null,
    phase,
    setup: null,
    authorizeUrl: null,
    userCode: null
  };
}
var graph = "https://graph.microsoft.com/v1.0/me";
var json = (value) => Response.json(value, { headers: { "cache-control": "no-store" } });
var clean = (value, size = 600) => typeof value === "string" ? value.trim().slice(0, size) : "";
var form = (fields, headers = {}) => ({
  method: "POST",
  headers: { accept: "application/json", ...headers },
  body: new URLSearchParams(fields)
});
var recordKey2 = (provider) => "dsh-web-chat/" + provider;
var idPattern = /^[A-Za-z0-9_.-]+$/;
// OAuth 应用凭据不再硬编码：通过 Harness 凭据 DSWC_GITHUB_CLIENT_ID/SECRET、
// DSWC_GMAIL_CLIENT_ID/SECRET 配置（设置 → 连接应用）。未配置时相应连接器提示需先配置。
var githubClientId = "";
var gmailClientId = "";
var gmailClientSecret = "";
var failureOf = (message) => {
  const text = clean(message, 170);
  return { message: text, expired: /失效|撤销|过期|没有授予/.test(text) };
};
function emailFromIdToken(idToken) {
  if (typeof idToken !== "string") return "";
  const part = idToken.split(".")[1];
  if (!part) return "";
  try {
    const claims = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    const login2 = claims.email || claims.preferred_username || claims.upn;
    return clean(login2, 150);
  } catch {
    return "";
  }
}
function normalizeOAuth(provider, body) {
  const source = provider === "gmail" ? body.googleConfig?.installed : body;
  const clientId = provider === "gmail" ? source?.client_id : source?.clientId;
  const clientSecret = provider === "gmail" ? source?.client_secret : void 0;
  if (provider === "outlook" && !/^[a-f0-9-]{36}$/i.test(clientId ?? ""))
    throw new Error("\u9700\u8981\u652F\u6301\u4E2A\u4EBA Microsoft \u8D26\u53F7\u7684 Outlook \u5E94\u7528\u7A0B\u5E8F ID\u3002");
  if (typeof clientId !== "string" || clientId.length > 250 || !idPattern.test(clientId))
    throw new Error(provider === "gmail" ? "\u9700\u8981 Google \u63A7\u5236\u53F0\u4E0B\u8F7D\u7684\u684C\u9762\u5E94\u7528 OAuth JSON\u3002" : "\u9700\u8981\u6709\u6548\u7684 GitHub App Client ID\u3002");
  if (provider === "gmail" && (typeof clientSecret !== "string" || !clientSecret || clientSecret.length > 250 || !clientId.endsWith(".apps.googleusercontent.com")))
    throw new Error("\u8FD9\u4EFD\u684C\u9762\u5E94\u7528\u914D\u7F6E\u7F3A\u5C11\u6709\u6548\u7684 Google \u5BA2\u6237\u7AEF\u51ED\u636E\u3002");
  return { clientId, clientSecret };
}
async function api(url, options = {}, signal) {
  const response = await fetch(url, {
    ...options,
    redirect: "error",
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2e4)]) : AbortSignal.timeout(2e4)
  });
  const data = await response.json().catch(() => null);
  const detail = typeof data?.error_description === "string" ? clean(data.error_description, 160) : "";
  if (!response.ok || data === null) throw Object.assign(new Error(detail || "\u670D\u52A1\u8BF7\u6C42\u5931\u8D25\uFF08HTTP " + response.status + "\uFF09"), {
    status: response.status,
    invalidGrant: data?.error === "invalid_grant"
  });
  return data;
}
function createPanelApps(offline2, credentials) {
  const qq = qqMail(credentials, offline2);
  const qqBot = createQQBot(credentials, offline2);
  const accounts = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Map();
  const failures = /* @__PURE__ */ new Map();
  const refreshing = /* @__PURE__ */ new Map();
  const tokenEndpoint = (provider) => provider === "github" ? githubToken : provider === "outlook" ? microsoft + "/token" : googleToken;
  const saved = async (provider) => offline2 ? accounts.get(provider) : (await credentials.readRecord(recordKey2(provider)))?.payload;
  const remember = async (provider, value) => {
    if (offline2) {
      accounts.set(provider, value);
      return;
    }
    await credentials.modifyRecord(recordKey2(provider), async (current) => {
      if (value.expected !== void 0 && current?.payload?.token !== value.expected) return void 0;
      const { expected, ...payload } = value;
      return { kind: "grant", payload: Object.fromEntries(Object.entries(payload).filter(([, item]) => item !== void 0)) };
    });
  };
  async function configured(provider) {
    if (offline2) return null;
    const local = (await credentials.readRecord(recordKey2(provider) + "-config"))?.payload;
    if (local?.clientId) return local;
    if (provider === "outlook") {
      const clientId2 = (await credentials.resolve("DSWC_OUTLOOK_CLIENT_ID"))?.value?.trim();
      return clientId2 && /^[a-f0-9-]{36}$/i.test(clientId2) ? { clientId: clientId2 } : null;
    }
    if (provider === "github") {
      const clientId2 = (await credentials.resolve("DSWC_GITHUB_CLIENT_ID"))?.value?.trim();
      const clientSecret2 = (await credentials.resolve("DSWC_GITHUB_CLIENT_SECRET"))?.value?.trim();
      const id2 = clientId2 && idPattern.test(clientId2) ? clientId2 : githubClientId;
      return clientSecret2 ? { clientId: id2, clientSecret: clientSecret2 } : { clientId: id2 };
    }
    const clientId = (await credentials.resolve("DSWC_GMAIL_CLIENT_ID"))?.value?.trim();
    const clientSecret = (await credentials.resolve("DSWC_GMAIL_CLIENT_SECRET"))?.value?.trim();
    if (clientId && clientSecret && idPattern.test(clientId) && clientId.endsWith(".apps.googleusercontent.com"))
      return { clientId, clientSecret };
    return { clientId: gmailClientId, clientSecret: gmailClientSecret };
  }
  function cancel(provider) {
    const session = pending.get(provider);
    pending.delete(provider);
    session?.controller.abort();
    session?.close?.();
  }
  async function connected(provider, session, tokens) {
    if (!tokens.access_token?.trim()) throw new Error("\u6CA1\u6709\u6536\u5230\u8BBF\u95EE\u4EE4\u724C");
    if (provider === "gmail" && !String(tokens.scope).split(" ").includes(googleScope))
      throw new Error("Google \u6CA1\u6709\u6388\u4E88 Gmail \u53EA\u8BFB\u6743\u9650");
    const headers = { authorization: "Bearer " + tokens.access_token };
    let identity;
    if (provider === "outlook") {
      let mailbox;
      try {
        mailbox = await api(graph + "/messages?" + new URLSearchParams({ $top: "1", $select: "id" }), { headers }, session.controller.signal);
      } catch (error2) {
        if (error2.status === 401 || error2.status === 403) throw new Error("Microsoft \u6CA1\u6709\u6388\u4E88 Outlook \u90AE\u4EF6\u8BFB\u53D6\u6743\u9650");
        throw error2;
      }
      if (!Array.isArray(mailbox?.value)) throw new Error("Microsoft \u6CA1\u6709\u8FD4\u56DE\u53EF\u8BFB\u53D6\u7684\u90AE\u7BB1\u3002");
      let login2 = emailFromIdToken(tokens.id_token);
      if (!login2) {
        try {
          const me = await api(graph + "?$select=mail,userPrincipalName,displayName", { headers }, session.controller.signal);
          login2 = clean(me.mail || me.userPrincipalName || me.displayName, 150);
        } catch {
        }
      }
      identity = { login: login2 || "Mail.Read \u5DF2\u9A8C\u8BC1" };
    } else {
      identity = provider === "github" ? await api("https://api.github.com/user", { headers: { ...githubHeaders, authorization: "Bearer " + tokens.access_token } }, session.controller.signal) : await api("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers }, session.controller.signal);
    }
    if (pending.get(provider) !== session) return;
    const label = clean(identity.login || identity.emailAddress, 150);
    if (!label || label === "Microsoft Outlook") throw new Error("\u670D\u52A1\u6CA1\u6709\u8FD4\u56DE\u53EF\u6838\u5B9E\u7684\u8D26\u53F7");
    await remember(provider, {
      token: tokens.access_token,
      refreshToken: tokens.refresh_token,
      label,
      verified: true,
      ...session.oauth,
      until: tokens.expires_in > 0 ? Date.now() + Number(tokens.expires_in) * 1e3 : null
    });
  }
  function run(provider, session, task) {
    void task.catch((error2) => {
      if (!session.controller.signal.aborted) failures.set(provider, failureOf(error2.message));
    }).finally(() => {
      if (pending.get(provider) === session) cancel(provider);
    });
  }
  async function start(provider, body) {
    cancel(provider);
    failures.delete(provider);
    if (offline2) {
      accounts.set(provider, {
        token: "fixture",
        verified: true,
        label: provider === "github" ? "offline-reviewer" : provider === "outlook" ? "offline-outlook@example.test" : "offline@example.test",
        until: Date.now() + 8 * 36e5
      });
      const url = {
        github: "https://github.com/login/device",
        gmail: "https://accounts.google.com/o/oauth2/v2/auth",
        outlook: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize"
      }[provider];
      return { offline: true, url };
    }
    const prior = await saved(provider);
    const oauth = body.clientId || body.googleConfig ? normalizeOAuth(provider, body) : await configured(provider) ?? (prior?.clientId ? { clientId: prior.clientId, clientSecret: prior.clientSecret } : null);
    if (!oauth?.clientId || provider === "gmail" && !oauth.clientSecret)
      throw new Error("\u6CA1\u6709\u5DF2\u6CE8\u518C\u7684\u6388\u6743\u5E94\u7528\uFF0C\u6253\u4E0D\u5F00\u6388\u6743\u9875\u3002");
    const { clientId, clientSecret } = oauth;
    const session = { controller: new AbortController(), oauth };
    pending.set(provider, session);
    const signal = session.controller.signal;
    try {
      if (provider === "github" && !clientSecret) {
        const code = await api("https://github.com/login/device/code", form({ client_id: clientId, scope: "read:user repo" }), signal);
        if (!code.device_code || !code.user_code) throw new Error("GitHub App \u9700\u8981\u5F00\u542F Device Flow");
        session.authorizeUrl = "https://github.com/login/device?user_code=" + encodeURIComponent(code.user_code);
        session.userCode = code.user_code;
        run(provider, session, (async () => {
          const expiry = Date.now() + Number(code.expires_in) * 1e3;
          let interval = Math.max(5, Number(code.interval) || 5);
          while (Date.now() < expiry) {
            await wait(interval * 1e3, void 0, { signal });
            const tokens = await api(githubToken, form({
              client_id: clientId,
              device_code: code.device_code,
              grant_type: "urn:ietf:params:oauth:grant-type:device_code"
            }), signal);
            if (tokens.error === "authorization_pending") continue;
            if (tokens.error === "slow_down") {
              interval = Math.max(interval + 5, Number(tokens.interval) || 0);
              continue;
            }
            if (tokens.error) throw new Error("GitHub \u6388\u6743\u672A\u5B8C\u6210\uFF0C\u91CD\u65B0\u8FDE\u63A5\u540E\u518D\u8BD5");
            return connected(provider, session, tokens);
          }
          throw new Error("GitHub \u6388\u6743\u7B49\u5F85\u5DF2\u8D85\u65F6\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u3002");
        })());
        return { url: session.authorizeUrl };
      }
      if (provider === "github") {
        const state2 = randomBytes(24).toString("base64url");
        let done2;
        let reject2;
        const callback2 = new Promise((resolve, fail2) => {
          done2 = resolve;
          reject2 = fail2;
        });
        let redirect2;
        const server2 = createServer2((request, response) => {
          const url3 = URL.parse(request.url, "http://127.0.0.1");
          if (request.method !== "GET" || url3?.pathname !== "/callback" || url3.searchParams.get("state") !== state2) {
            response.writeHead(404).end();
            return;
          }
          const code = url3.searchParams.get("code");
          response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(code ? "\u5DF2\u6536\u5230\u6388\u6743\u3002\u8BF7\u8FD4\u56DE DeepSeek \u5BF9\u8BDD\u9762\u677F\u3002" : "\u6388\u6743\u5DF2\u53D6\u6D88\u3002\u8BF7\u8FD4\u56DE\u9762\u677F\u3002");
          if (code) done2(code);
          else reject2(new Error("\u6388\u6743\u88AB\u53D6\u6D88"));
        });
        const timeout2 = setTimeout(() => reject2(new Error("\u6388\u6743\u7B49\u5F85\u8D85\u65F6")), 3e5);
        timeout2.unref();
        session.close = () => {
          clearTimeout(timeout2);
          server2.close();
          reject2(new Error("\u8FDE\u63A5\u5DF2\u53D6\u6D88"));
        };
        run(provider, session, callback2.then(async (code) => {
          const tokens = await api(githubToken, form({
            client_id: clientId,
            client_secret: clientSecret,
            code,
            redirect_uri: redirect2
          }), signal);
          return connected(provider, session, tokens);
        }));
        await new Promise((resolve, reject3) => server2.once("error", (error2) => {
          reject3(error2.code === "EADDRINUSE" ? new Error("\u672C\u673A 53621 \u7AEF\u53E3\u88AB\u5360\u7528\uFF0CGitHub \u6388\u6743\u9875\u6253\u4E0D\u5F00\u3002") : error2);
        }).listen(53621, "127.0.0.1", resolve));
        redirect2 = "http://127.0.0.1:53621/callback";
        const url2 = new URL("https://github.com/login/oauth/authorize");
        url2.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirect2, scope: "read:user repo", state: state2 });
        session.authorizeUrl = url2.href;
        return { url: session.authorizeUrl };
      }
      const state = randomBytes(24).toString("base64url");
      const verifier = randomBytes(48).toString("base64url");
      let done;
      let reject;
      const callback = new Promise((resolve, fail2) => {
        done = resolve;
        reject = fail2;
      });
      let redirect;
      const server = createServer2((request, response) => {
        const url2 = URL.parse(request.url, "http://127.0.0.1");
        if (request.method !== "GET" || url2?.pathname !== "/callback" || url2.searchParams.get("state") !== state) {
          response.writeHead(404).end();
          return;
        }
        const code = url2.searchParams.get("code");
        response.writeHead(200, { "content-type": "text/plain; charset=utf-8" }).end(code ? "\u5DF2\u6536\u5230\u6388\u6743\u3002\u8BF7\u8FD4\u56DE DeepSeek \u5BF9\u8BDD\u9762\u677F\u3002" : "\u6388\u6743\u5DF2\u53D6\u6D88\u3002\u8BF7\u8FD4\u56DE\u9762\u677F\u3002");
        if (code) done(code);
        else reject(new Error("\u6388\u6743\u88AB\u53D6\u6D88"));
      });
      const timeout = setTimeout(() => reject(new Error("\u6388\u6743\u7B49\u5F85\u8D85\u65F6")), 3e5);
      timeout.unref();
      session.close = () => {
        clearTimeout(timeout);
        server.close();
        reject(new Error("\u8FDE\u63A5\u5DF2\u53D6\u6D88"));
      };
      run(provider, session, callback.then(async (code) => {
        const tokens = await api(tokenEndpoint(provider), form({
          client_id: clientId,
          ...clientSecret ? { client_secret: clientSecret } : {},
          code,
          code_verifier: verifier,
          grant_type: "authorization_code",
          redirect_uri: redirect
        }), signal);
        return connected(provider, session, tokens);
      }));
      await new Promise((resolve, reject2) => server.once("error", reject2).listen(0, "127.0.0.1", resolve));
      redirect = "http://" + (provider === "outlook" ? "localhost" : "127.0.0.1") + ":" + server.address().port + "/callback";
      const url = new URL(provider === "outlook" ? microsoft + "/authorize" : "https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirect,
        scope: provider === "outlook" ? outlookScope : googleScope,
        state,
        ...provider === "gmail" ? { access_type: "offline" } : {},
        code_challenge_method: "S256",
        code_challenge: createHash2("sha256").update(verifier).digest("base64url"),
        prompt: "select_account"
      });
      session.authorizeUrl = url.href;
      return { url: session.authorizeUrl };
    } catch (error2) {
      if (pending.get(provider) === session) cancel(provider);
      throw error2;
    }
  }
  const valid = (value) => Boolean(value?.token && (value.until === null || value.until > Date.now()));
  async function account(provider) {
    const value = await saved(provider);
    if (valid(value)) return value;
    if (!value?.refreshToken || offline2) return null;
    let request = refreshing.get(provider);
    if (!request) {
      request = (async () => {
        const body = { grant_type: "refresh_token", refresh_token: value.refreshToken, client_id: value.clientId };
        if (provider === "gmail") body.client_secret = value.clientSecret;
        let tokens;
        try {
          tokens = await api(tokenEndpoint(provider), form(body));
        } catch (error2) {
          if (!error2.invalidGrant) throw error2;
          tokens = {};
        }
        if (tokens.error && !["bad_refresh_token", "invalid_grant"].includes(tokens.error))
          throw new Error("\u6388\u6743\u66F4\u65B0\u5931\u8D25\u3002\u8BF7\u5728\u8FDE\u63A5\u5E94\u7528\u91CC\u91CD\u65B0\u6388\u6743\u3002");
        if (tokens.access_token && provider === "gmail" && tokens.scope && !String(tokens.scope).split(" ").includes(googleScope))
          throw new Error("Google \u6CA1\u6709\u6388\u4E88 Gmail \u53EA\u8BFB\u6743\u9650");
        if (!tokens.access_token) failures.set(provider, failureOf("\u6388\u6743\u5DF2\u5931\u6548\u6216\u88AB\u64A4\u9500\uFF0C\u8BF7\u91CD\u65B0\u6388\u6743\u3002"));
        else failures.delete(provider);
        const updated = {
          ...value,
          token: tokens.access_token ?? null,
          refreshToken: tokens.access_token ? tokens.refresh_token ?? value.refreshToken : null,
          until: tokens.expires_in > 0 ? Date.now() + Number(tokens.expires_in) * 1e3 : null
        };
        await remember(provider, { ...updated, expected: value.token });
        const current = await saved(provider);
        return valid(current) ? current : null;
      })().finally(() => refreshing.delete(provider));
      refreshing.set(provider, request);
    }
    return request;
  }
  async function tool(body, signal) {
    const { name: name3, input } = body;
    const provider = typeof name3 === "string" ? name3.split("_")[0] : "";
    const allowed = ["github_list", "github_detail", "gmail_search", "gmail_read", "outlook_search", "outlook_read"];
    if (!allowed.includes(name3) || !input || typeof input !== "object") throw new Error("\u5DE5\u5177\u53C2\u6570\u65E0\u6548");
    const loggedIn = await account(provider);
    if (provider !== "github" && !loggedIn) throw new Error("\u8BF7\u5148\u5728\u8FDE\u63A5\u5E94\u7528\u4E2D\u6388\u6743 " + (provider === "gmail" ? "Gmail" : "Outlook"));
    async function read2(url, headers2) {
      try {
        return await api(url, { headers: headers2 }, signal);
      } catch (error2) {
        if (loggedIn && error2.status === 401) {
          await remember(provider, { ...loggedIn, token: null, refreshToken: null, expected: loggedIn.token });
          failures.set(provider, failureOf("\u5E94\u7528\u6388\u6743\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u3002"));
          throw new Error("\u5E94\u7528\u6388\u6743\u5DF2\u5931\u6548\uFF0C\u8BF7\u5728\u300C\u8FDE\u63A5\u5E94\u7528\u300D\u91CC\u91CD\u65B0\u8FDE\u63A5\u3002");
        }
        if (provider === "github" && !loggedIn && error2.status === 404)
          throw new Error("\u627E\u4E0D\u5230\u516C\u5F00\u4ED3\u5E93\u6216\u8BE5\u6761\u8BB0\u5F55\u3002\u79C1\u6709\u4ED3\u5E93\u8BF7\u5148\u8FDE\u63A5 GitHub\u3002");
        throw error2;
      }
    }
    if (provider === "github") {
      const repo = clean(input.repo, 210);
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || repo.split("/").some((value) => value === "." || value === ".."))
        throw new Error("\u4ED3\u5E93\u683C\u5F0F\u5E94\u4E3A owner/repo");
      if (!["issues", "pulls"].includes(input.kind)) throw new Error("\u8BF7\u9009\u62E9 Issue \u6216 PR");
      const endpoint2 = "https://api.github.com/repos/" + repo + "/" + input.kind;
      const headers2 = loggedIn ? { ...githubHeaders, authorization: "Bearer " + loggedIn.token } : githubHeaders;
      if (name3 === "github_list") {
        const rows = offline2 ? [{ number: 7, title: "\u4FEE\u590D\u79BB\u7EBF\u6A21\u5F0F", state: "open", html_url: "https://github.com/" + repo + "/pull/7" }] : await read2(endpoint2 + "?state=all&per_page=15&sort=updated&direction=desc", headers2);
        return rows.filter((row2) => input.kind !== "issues" || !row2.pull_request).map((row2) => ({
          number: row2.number,
          title: clean(row2.title),
          state: row2.state,
          url: row2.html_url
        }));
      }
      if (!Number.isSafeInteger(input.number) || input.number < 1) throw new Error("\u9700\u8981\u6709\u6548\u7684 Issue \u6216 PR \u7F16\u53F7");
      const target = endpoint2 + "/" + input.number;
      const row = offline2 ? { number: input.number, title: "\u4FEE\u590D\u79BB\u7EBF\u6A21\u5F0F", body: "\u6539\u52A8\u79BB\u7EBF\u52A0\u8F7D\u8DEF\u5F84\uFF0C\u65B0\u589E\u56DE\u5F52\u6D4B\u8BD5\u3002" } : await read2(target, headers2);
      const detail = {
        number: row.number,
        title: clean(row.title),
        state: row.state,
        text: clean(row.body, 3500),
        url: offline2 ? "https://github.com/" + repo + "/" + (input.kind === "pulls" ? "pull" : "issues") + "/" + input.number : row.html_url
      };
      if (input.kind === "pulls") {
        const files = offline2 ? [{ filename: "lib/panel.js", status: "modified", patch: "+ loadLocal()" }] : await read2(target + "/files?per_page=15", headers2);
        detail.files = files.map((file) => ({ name: file.filename, status: file.status, patch: clean(file.patch, 480) }));
      }
      return detail;
    }
    const headers = { authorization: "Bearer " + loggedIn.token };
    if (provider === "outlook") {
      headers.prefer = 'outlook.body-content-type="text"';
      if (name3 === "outlook_search") {
        const query = clean(input.query, 220).replaceAll('"', "").replaceAll("\\", "");
        if (!query) throw new Error("\u9700\u8981 Outlook \u90AE\u4EF6\u641C\u7D22\u8BCD");
        const rows = offline2 ? [{ id: "outlook-fixture", subject: "Outlook \u793A\u4F8B", from: { emailAddress: { address: "demo@example.test" } } }] : (await read2(graph + "/messages?" + new URLSearchParams({
          $search: '"' + query + '"',
          $top: "8",
          $select: "id,subject,from,receivedDateTime"
        }), headers)).value ?? [];
        return rows.map((row2) => ({ id: row2.id, subject: clean(row2.subject), from: clean(row2.from?.emailAddress?.address), date: row2.receivedDateTime }));
      }
      const id2 = clean(input.threadId, 400);
      if (!/^[\w+/=-]{1,400}$/.test(id2)) throw new Error("\u9700\u8981\u6709\u6548\u7684 Outlook \u90AE\u4EF6 ID");
      const row = offline2 ? { subject: "Outlook \u793A\u4F8B", body: { content: "\u8FD9\u662F\u4E00\u5C01 Outlook \u793A\u4F8B\u90AE\u4EF6\u3002" } } : await read2(graph + "/messages/" + encodeURIComponent(id2) + "?$select=subject,from,receivedDateTime,body", headers);
      return {
        subject: clean(row.subject),
        from: clean(row.from?.emailAddress?.address),
        date: row.receivedDateTime,
        text: clean(row.body?.content, 3e3)
      };
    }
    const endpoint = "https://gmail.googleapis.com/gmail/v1/users/me";
    const threadId = clean(input.threadId, 150);
    if (name3 === "gmail_read" && !/^[A-Za-z0-9_-]{1,150}$/.test(threadId)) throw new Error("\u9700\u8981\u6709\u6548\u7684\u90AE\u4EF6\u4F1A\u8BDD ID");
    if (name3 === "gmail_search") {
      const query = clean(input.query);
      if (!query) throw new Error("\u9700\u8981\u641C\u7D22\u6761\u4EF6");
      if (offline2) return [{ id: "offline-thread", subject: "\u79BB\u7EBF\u6D4B\u8BD5\u90AE\u4EF6", from: "demo@example.test" }];
      const index = await read2(endpoint + "/threads?" + new URLSearchParams({ q: query, maxResults: "8" }), headers);
      return Promise.all((index.threads ?? []).map(async (item) => {
        const info = await read2(endpoint + "/threads/" + encodeURIComponent(item.id) + "?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date", headers);
        return { id: item.id, ...messageHeaders(info.messages?.at(-1)) };
      }));
    }
    if (offline2) return [{ from: "demo@example.test", subject: "\u79BB\u7EBF\u6D4B\u8BD5\u90AE\u4EF6", text: "\u90AE\u4EF6\u6837\u4F8B\uFF0C\u9879\u76EE\u5C06\u5728\u5468\u4E94\u4EA4\u4ED8\u3002" }];
    const result = await read2(endpoint + "/threads/" + encodeURIComponent(threadId) + "?format=full", headers);
    return (result.messages ?? []).slice(-6).map((message) => ({
      ...messageHeaders(message),
      text: clean(plainText(message.payload) || message.snippet, 2800)
    }));
  }
  return {
    dispose: () => {
      providers.forEach(cancel);
      accounts.clear();
      failures.clear();
      qqBot.dispose();
    },
    async handle(operation, request) {
      if (operation === "apps-status") {
        const mailAccount = await qq.status();
        const bot = qqBot.status();
        return json({ ...Object.fromEntries(await Promise.all(providers.map(async (name3) => {
          const value = await saved(name3);
          const hasConfig = offline2 || Boolean(value?.clientId || await configured(name3));
          const failure = failures.get(name3);
          const session = pending.get(name3);
          const placeholder = value?.label === "Microsoft Outlook";
          const readable = Boolean(value?.label) && !placeholder && (name3 !== "outlook" || value.verified === true);
          let phase = "ready";
          if (session) phase = "pending";
          else if (failure?.expired || value?.label && (placeholder || name3 === "outlook" && value.verified !== true)) phase = "expired";
          else if (failure) phase = "failed";
          else if (readable && (valid(value) || value?.refreshToken)) phase = "connected";
          return [name3, {
            account: phase === "connected" ? value.label : null,
            configured: hasConfig,
            pending: phase === "pending",
            error: failure?.message ?? (phase === "expired" ? "\u6388\u6743\u5DF2\u5931\u6548\uFF0C\u8BF7\u91CD\u65B0\u6388\u6743\u3002" : null),
            phase,
            setup: null,
            authorizeUrl: session?.authorizeUrl ?? null,
            userCode: session?.userCode ?? null
          }];
        }))), qqmail: qqStatus(mailAccount, null), qqbot: qqStatus(bot.account, bot) });
      }
      const body = await request.json();
      if (body.provider === "qqbot") {
        if (operation === "apps-connect") await qqBot.connect(body);
        else if (operation === "apps-disconnect") await qqBot.disconnect();
        else if (operation === "apps-inbox") return json(qqBot.inbox());
        else throw new Error("QQ \u673A\u5668\u4EBA\u64CD\u4F5C\u65E0\u6548\u3002");
        return json({ ok: true });
      }
      if (operation === "apps-tool" && ["qqmail_search", "qqmail_read"].includes(body.name))
        return json({ result: await qq.tool(body.name, body.input ?? {}, request.signal) });
      if (body.provider === "qqmail") {
        if (operation === "apps-connect") await qq.connect(body, request.signal);
        else if (operation === "apps-disconnect") await qq.disconnect();
        else throw new Error("QQ \u90AE\u7BB1\u64CD\u4F5C\u65E0\u6548\u3002");
        return json({ ok: true });
      }
      if (operation === "apps-tool") return json({ result: await tool(body, request.signal) });
      if (!providers.includes(body.provider)) throw new Error("\u5E94\u7528\u4E0D\u5B58\u5728");
      if (operation === "apps-configure") {
        if (!offline2) {
          const config = normalizeOAuth(body.provider, body);
          await credentials.modifyRecord(recordKey2(body.provider) + "-config", () => ({
            kind: "grant",
            payload: Object.fromEntries(Object.entries(config).filter(([, value]) => value !== void 0))
          }));
        }
        return json({ ok: true });
      }
      if (operation === "apps-connect") return json(await start(body.provider, body));
      cancel(body.provider);
      accounts.delete(body.provider);
      if (!offline2) await credentials.deleteRecord(recordKey2(body.provider));
      failures.delete(body.provider);
      return json({ ok: true });
    }
  };
}
function messageHeaders(message) {
  const headers = new Map((message?.payload?.headers ?? []).map((field) => [field.name.toLowerCase(), clean(field.value)]));
  return { subject: headers.get("subject") ?? "", from: headers.get("from") ?? "", date: headers.get("date") ?? "" };
}
function plainText(part) {
  if (part?.mimeType === "text/plain" && part.body?.data && !part.filename)
    return Buffer.from(part.body.data, "base64url").toString("utf8");
  return (part?.parts ?? []).map(plainText).filter(Boolean).join("\n");
}

export { createPanelApps };
