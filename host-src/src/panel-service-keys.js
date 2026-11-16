var keys = {
  spark: "DSWC_SPARK_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  ark: "ARK_API_KEY",
  siliconflow: "SILICONFLOW_API_KEY",
  hunyuan: "DSWC_HUNYUAN_API_KEY"
};
async function serviceKeys(credentials, operation, request) {
  if (operation === "service-key-status")
    return Response.json(Object.fromEntries(await Promise.all(Object.entries(keys).map(async ([id2, ref]) => [id2, Boolean((await credentials.describe(ref)).configured)]))));
  const input = await request.json();
  if (typeof input.id !== "string" || !Object.hasOwn(keys, input.id)) throw new Error("\u8BF7\u9009\u62E9\u670D\u52A1\u3002");
  const key3 = typeof input.key === "string" ? input.key.trim() : "";
  if (!key3 || key3.length > 512 || /\s/.test(key3)) throw new Error("\u8BF7\u8F93\u5165\u6709\u6548\u7684 API Key\u3002");
  if (input.id === "spark" && !/^ak-[a-z\d]+$/i.test(key3)) throw new Error("\u8BF7\u8F93\u5165\u8BAF\u98DE\u661F\u8FB0 MaaS \u7684 API Key\u3002");
  try {
    await credentials.set(keys[input.id], key3);
  } catch {
    throw new Error("\u5F53\u524D Harness \u51ED\u636E\u5B58\u50A8\u65E0\u6CD5\u5199\u5165\uFF0C\u8BF7\u68C0\u67E5 Harness \u8BBE\u7F6E\u3002");
  }
  return Response.json({ saved: true });
}

export { serviceKeys };
