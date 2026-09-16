import { isDeepSeekConfigured } from "@/server/ai/deepseek";
import type { ChunkExtraction, ImageExtraction } from "@/server/ai/chunking";

export interface N8nParseChunk {
  readonly id: string;
  readonly filename: string;
  readonly fileIndex: number;
  readonly fileTotal: number;
  readonly heading: string;
  readonly text: string;
}

export interface N8nParseSource {
  readonly filename: string;
  readonly text: string;
}

export interface N8nParseImage {
  readonly filename: string;
  readonly relativePath: string;
  readonly mime: string;
  readonly dataUrl: string;
  readonly pageNumber?: number;
  readonly pageText?: string;
  readonly origin?: string;
}

export interface N8nNpcStat {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly source: string;
  readonly attributes: Readonly<Record<string, number>>;
  readonly maxHp: number | null;
  readonly maxMp: number | null;
  readonly maxSan: number | null;
  readonly maxDp: number | null;
}

export interface N8nModuleParseInput {
  readonly requestId: string;
  readonly title: string;
  readonly system: "COC7" | "TOUHOU";
  readonly era: string;
  readonly author: string;
  readonly instructions: string;
  readonly model: string;
  readonly visionModel: string;
  readonly chunks: readonly N8nParseChunk[];
  readonly sources: readonly N8nParseSource[];
  readonly images: readonly N8nParseImage[];
}

export interface N8nModuleParseOutput {
  readonly extractions: readonly ChunkExtraction[];
  readonly images: readonly ImageExtraction[];
  readonly npcStats: readonly N8nNpcStat[];
  readonly warnings: readonly string[];
  readonly stats: {
    readonly aiCalls: number;
    readonly attempts: number;
    readonly chunks: number;
    readonly chunksCompleted: number;
    readonly imagesAnalyzed: number;
    readonly imagesUsed: number;
    readonly npcStatsParsed: number;
  };
}

export function n8nModuleParseUrl(): string {
  const direct = (process.env.N8N_MODULE_PARSE_URL ?? "").trim();
  if (direct.length > 0) return direct.replace(/\/+$/, "");
  const base = (process.env.N8N_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const path = (process.env.N8N_MODULE_PARSE_PATH ?? "/webhook/module-parse").trim();
  if (base.length === 0) return "";
  return base + (path.startsWith("/") ? path : "/" + path);
}

export function isN8nConfigured(): boolean {
  return n8nModuleParseUrl().length > 0;
}

/** 应用侧 AI 导入是否可用：n8n 工作流优先，未配置时回退 DeepSeek 直连。 */
export function isAiImportConfigured(): boolean {
  return isN8nConfigured() || isDeepSeekConfigured();
}

function parseInteger(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  return fallback;
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayOf<T>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function parseModuleWithN8n(input: N8nModuleParseInput): Promise<N8nModuleParseOutput> {
  const url = n8nModuleParseUrl();
  if (url.length === 0) throw new Error("未配置 N8N_MODULE_PARSE_URL，无法调用 n8n 工作流");

  const configuredTimeout = Number(process.env.N8N_REQUEST_TIMEOUT_MS ?? 1_800_000);
  const timeoutMs = Number.isFinite(configuredTimeout) ? Math.max(30_000, configuredTimeout) : 1_800_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const secret = (process.env.N8N_WEBHOOK_SECRET ?? "").trim();
  if (secret.length > 0) headers["x-n8n-webhook-secret"] = secret;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("n8n 团本解析超时（" + String(Math.round(timeoutMs / 1000)) + " 秒），请检查工作流是否卡住");
    }
    throw new Error("无法连接 n8n 团本解析工作流：" + (error instanceof Error ? error.message : "未知错误"));
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("n8n 返回了无法解析的响应（HTTP " + String(response.status) + "）：" + text.slice(0, 300));
  }

  if (response.ok === false || payload.ok !== true) {
    const rawWarnings = arrayOf<unknown>(payload.warnings).map(stringOf).filter((item) => item.length > 0);
    const details = rawWarnings.length > 0 ? rawWarnings.join("；") : stringOf(payload.error) || text.slice(0, 300);
    throw new Error("n8n 团本解析失败（HTTP " + String(response.status) + "）：" + details);
  }

  const extractions = arrayOf<ChunkExtraction>(payload.extractions);
  const images = arrayOf<ImageExtraction>(payload.images);
  const npcStats = arrayOf<N8nNpcStat>(payload.npcStats);
  const warnings = arrayOf<unknown>(payload.warnings).map(stringOf).filter((item) => item.length > 0);
  const statsRaw = (payload.stats ?? {}) as Record<string, unknown>;

  if (extractions.length === 0 && input.chunks.length > 0) {
    throw new Error("n8n 工作流没有返回任何文本分块解析结果");
  }

  return {
    extractions,
    images,
    npcStats,
    warnings,
    stats: {
      aiCalls: parseInteger(statsRaw.aiCalls, 0),
      attempts: Math.max(1, parseInteger(statsRaw.attempts, 1)),
      chunks: parseInteger(statsRaw.chunks, input.chunks.length),
      chunksCompleted: parseInteger(statsRaw.chunksCompleted, extractions.length),
      imagesAnalyzed: parseInteger(statsRaw.imagesAnalyzed, images.length),
      imagesUsed: parseInteger(statsRaw.imagesUsed, input.images.length),
      npcStatsParsed: parseInteger(statsRaw.npcStatsParsed, npcStats.length)
    }
  };
}
