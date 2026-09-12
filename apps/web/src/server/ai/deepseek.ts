import { prisma } from "@/server/db/prisma";

export interface DeepSeekTextPart {
  readonly type: "text";
  readonly text: string;
}

export interface DeepSeekImagePart {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
}

export type DeepSeekContentPart = DeepSeekTextPart | DeepSeekImagePart;

export interface DeepSeekMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string | readonly DeepSeekContentPart[];
}

export interface DeepSeekChatOptions {
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly jsonMode?: boolean;
  readonly timeoutMs?: number;
}

export interface DeepSeekModelInfo {
  readonly id: string;
  readonly label: string;
  readonly vision: boolean;
  readonly recommended: boolean;
}

export const DEEPSEEK_MODELS: readonly DeepSeekModelInfo[] = [
  { id: "deepseek-flash", label: "deepseek-flash（推荐 · 支持图片视觉）", vision: true, recommended: true },
  { id: "deepseek-v4-pro", label: "deepseek-v4-pro（文本推理）", vision: false, recommended: false }
] as const;

export function deepseekBaseUrl(): string {
  return (process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "");
}

export function deepseekApiKey(): string {
  return (process.env.DEEPSEEK_API_KEY ?? "").trim();
}

export function isDeepSeekConfigured(): boolean {
  return deepseekApiKey().length > 0;
}

async function defaultModel(): Promise<string> {
  const envModel = (process.env.DEEPSEEK_MODEL ?? "").trim();
  try {
    const setting = await prisma.systemSetting.findUnique({ where: { key: "ai.moduleImport.model" } });
    const value = setting?.value;
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  } catch {
    // 数据库不可用时回退环境变量
  }
  return envModel.length > 0 ? envModel : "deepseek-flash";
}

interface ChatCompletionResponse {
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown; readonly reasoning_content?: unknown };
    readonly finish_reason?: string;
  }[];
  readonly error?: { readonly message?: string };
}

/** DeepSeek 因 max_tokens 上限截断输出；调用方应压缩素材或提高上限后重试。 */
export class DeepSeekTruncationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeepSeekTruncationError";
  }
}

async function callOnce(messages: readonly DeepSeekMessage[], model: string, options: DeepSeekChatOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens ?? 8192,
    stream: false
  };
  if (options.jsonMode === true) {
    body.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 600000);
  let response: Response;
  try {
    response = await fetch(deepseekBaseUrl() + "/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + deepseekApiKey(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload: ChatCompletionResponse;
  try {
    payload = JSON.parse(text) as ChatCompletionResponse;
  } catch {
    throw new Error("DeepSeek 返回了无法解析的响应（HTTP " + response.status + "）");
  }
  if (response.ok === false) {
    throw new Error("DeepSeek 调用失败（HTTP " + response.status + "）：" + (payload.error?.message ?? text.slice(0, 300)));
  }
  const choice = payload.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new DeepSeekTruncationError(
      "DeepSeek 输出达到 max_tokens 上限被截断（finish_reason=length）；请压缩素材或调高输出上限"
    );
  }
  const content = choice?.message?.content;
  if (typeof content === "string" && content.trim().length > 0) return content;
  const reasoning = choice?.message?.reasoning_content;
  if (typeof reasoning === "string" && reasoning.trim().length > 0) {
    throw new Error("DeepSeek 只返回了推理内容，没有返回正文；请降低推理强度或更换模型后重试。");
  }
  throw new Error("DeepSeek 没有返回可用内容");
}

/**
 * 调用 DeepSeek OpenAI 兼容 Chat API，带超时与指数退避重试。
 */
export async function chatDeepSeek(
  messages: readonly DeepSeekMessage[],
  options: DeepSeekChatOptions = {}
): Promise<string> {
  if (isDeepSeekConfigured() === false) {
    throw new Error("未配置 DEEPSEEK_API_KEY，无法使用 AI 团本导入");
  }
  const model = options.model ?? (await defaultModel());
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await callOnce(messages, model, options);
    } catch (error) {
      lastError = error;
      const aborted = error instanceof Error && error.name === "AbortError";
      // 截断是确定性的：重试同一请求只会得到同样结果，交给上层拆分素材。
      if (aborted || error instanceof DeepSeekTruncationError) break;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("DeepSeek 调用失败");
}

export function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1));
    }
    throw new Error("DeepSeek 返回的内容不是合法 JSON");
  }
}
