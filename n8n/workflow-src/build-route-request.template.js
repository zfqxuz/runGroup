/**
 * 分支「构建请求」节点通用代码。
 * build-workflows.mjs 会注入 ROUTE_KEY / ROUTE_LABEL。
 */

const requests = [];

for (let index = 0; index < items.length; index += 1) {
  const input = (items[index] && items[index].json) ? items[index].json : {};
  const ctx = (input.context && typeof input.context === "object") ? input.context : {};
  const hints = ctx.hints && typeof ctx.hints === "object"
    ? ctx.hints
    : { system: "COC7", era: "MODERN", instructions: "" };
  const isImage = ROUTE_KEY === "image" || input.kind === "image";
  const messages = isImage
    ? buildVisionMessages(Array.isArray(input.imageBatch) ? input.imageBatch : [], hints)
    : buildAgentMessages(ROUTE_KEY, input.chunk || {}, hints, {});
  const body = {
    model: isImage ? (ctx.visionModel || ctx.model || "deepseek-flash") : (ctx.model || "deepseek-flash"),
    temperature: 0.0,
    max_tokens: ctx.maxTokens || 8192,
    stream: false,
    response_format: { type: "json_object" },
    messages
  };
  const originId = String(input.originId || (ROUTE_KEY + "-" + String(index + 1)));
  const requestId = "req-" + originId;
  const baseUrl = String(ctx.deepseekBaseUrl || "https://api.deepseek.com").replace(/\/+$/, "");
  requests.push({
    json: {
      requestId,
      originId,
      route: ROUTE_KEY,
      kind: isImage ? "image" : "chunk",
      label: input.label || (ROUTE_LABEL + " " + String(index + 1)),
      chunk: input.chunk || null,
      imageBatch: Array.isArray(input.imageBatch) ? input.imageBatch : [],
      chunkGroupId: input.chunkGroupId || "",
      context: ctx,
      fallbackText: !isImage && input.chunk && typeof input.chunk.text === "string" ? input.chunk.text.slice(0, 4000) : "",
      url: baseUrl + "/chat/completions",
      body
    }
  });
}

return requests;
