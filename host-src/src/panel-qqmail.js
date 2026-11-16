import { ImapFlow } from "imapflow";

var key = "dsh-web-chat/qq-mail";
function client(account) {
  return new ImapFlow({
    host: "imap.qq.com",
    port: 993,
    secure: true,
    auth: { user: account.address, pass: account.authorization },
    logger: false,
    connectionTimeout: 12e3,
    greetingTimeout: 1e4,
    socketTimeout: 2e4
  });
}
async function read(account, action, signal) {
  const connection = client(account);
  const cancel = () => connection.close();
  signal.throwIfAborted();
  signal.addEventListener("abort", cancel, { once: true });
  try {
    await connection.connect();
    await connection.mailboxOpen("INBOX", { readOnly: true });
    return await action(connection);
  } catch (error2) {
    if (signal.aborted) throw signal.reason;
    if (error2?.message === "\u627E\u4E0D\u5230\u90AE\u4EF6\u3002") throw error2;
    throw new Error("QQ \u90AE\u7BB1\u8FDE\u63A5\u6216\u8BFB\u53D6\u5931\u8D25\u3002\u8BF7\u68C0\u67E5 IMAP \u670D\u52A1\u548C\u5BA2\u6237\u7AEF\u6388\u6743\u7801\u3002");
  } finally {
    signal.removeEventListener("abort", cancel);
    connection.close();
  }
}
var header = (entry) => ({
  id: String(entry.uid),
  subject: entry.envelope?.subject ?? "",
  from: entry.envelope?.from?.[0]?.address ?? "",
  date: entry.envelope?.date?.toISOString()
});
function qqMail(credentials, offline2) {
  let local;
  const account = async () => offline2 ? local : (await credentials.readRecord(key))?.payload;
  return {
    async status() {
      return (await account())?.address ?? null;
    },
    async connect(body, signal) {
      const address = String(body.address ?? "").trim();
      const authorization = String(body.authorization ?? "").trim();
      if (!/^[\w.+-]{1,64}@qq\.com$/i.test(address) || !/^[a-z\d]{8,64}$/i.test(authorization))
        throw new Error("\u8BF7\u8F93\u5165 QQ \u90AE\u7BB1\u5730\u5740\u548C IMAP \u5BA2\u6237\u7AEF\u6388\u6743\u7801\u3002");
      const record = { address, authorization };
      if (offline2) local = { address };
      else {
        await read(record, () => true, signal);
        await credentials.modifyRecord(key, () => ({ kind: "grant", payload: record }));
      }
    },
    async disconnect() {
      if (offline2) local = void 0;
      else await credentials.deleteRecord(key);
    },
    async tool(name3, input, signal) {
      const record = await account();
      if (!record) throw new Error("\u8BF7\u5148\u8FDE\u63A5 QQ \u90AE\u7BB1\u3002");
      if (name3 === "qqmail_search") {
        const subject = typeof input.query === "string" ? input.query.trim().slice(0, 100) : "";
        if (!subject) throw new Error("\u9700\u8981 QQ \u90AE\u7BB1\u641C\u7D22\u8BCD\u3002");
        if (offline2) return [{ id: "7", subject: "QQ \u90AE\u7BB1\u79BB\u7EBF\u793A\u4F8B", from: "demo@example.test" }];
        return read(record, async (connection) => {
          const matches = await connection.search({ subject }, { uid: true });
          if (!matches?.length) return [];
          const result = [];
          for await (const entry of connection.fetch(matches.slice(-8), { uid: true, envelope: true }, { uid: true }))
            result.push(header(entry));
          return result.reverse();
        }, signal);
      }
      const id2 = Number(input.threadId);
      if (!Number.isSafeInteger(id2) || id2 <= 0) throw new Error("\u9700\u8981\u6709\u6548\u7684 QQ \u90AE\u4EF6 ID\u3002");
      if (offline2) return { id: String(id2), subject: "QQ \u90AE\u7BB1\u79BB\u7EBF\u793A\u4F8B", text: "\u90AE\u4EF6\u6B63\u6587\u793A\u4F8B\u3002" };
      return read(record, async (connection) => {
        const entry = await connection.fetchOne(id2, { uid: true, envelope: true, bodyStructure: true }, { uid: true });
        if (!entry) throw new Error("\u627E\u4E0D\u5230\u90AE\u4EF6\u3002");
        const plain = (part2) => part2?.type === "text/plain" && part2.disposition !== "attachment" ? part2 : part2?.childNodes?.map(plain).find(Boolean);
        const part = plain(entry.bodyStructure);
        if (!part) return { ...header(entry), text: "\u90AE\u4EF6\u6CA1\u6709\u53EF\u8BFB\u53D6\u7684\u7EAF\u6587\u672C\u90E8\u5206\u3002" };
        const { content } = await connection.download(String(id2), part.part ?? "1", { uid: true, maxBytes: 12e3 });
        if (!content) throw new Error("\u627E\u4E0D\u5230\u90AE\u4EF6\u3002");
        const chunks = [];
        for await (const chunk of content) chunks.push(chunk);
        return { ...header(entry), text: Buffer.concat(chunks).toString("utf8").slice(0, 3e3) };
      }, signal);
    }
  };
}

export { qqMail };
