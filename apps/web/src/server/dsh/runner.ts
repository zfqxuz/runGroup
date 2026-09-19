import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * dsh 极简模式（headless）调用桥。
 *
 * 两种部署形态：
 * 1. `DSH_SERVICE_URL`：外部/旁车 dsh 服务，POST /run / /run/stream；
 * 2. 否则本地拉起 `DSH_HEADLESS_COMMAND`（默认 dsh --profile headless）。
 *
 * 约定：任务说明与 module.json 写入临时工作目录，dsh 完成后读取同目录 result.json。
 * dsh 的 reasoning 在 stderr；通过 `onEvent` 实时上报，工具调用细节由 sidecar 过滤。
 */
export interface DshRunnerInput {
  readonly task: string;
  readonly files: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

export interface DshRunnerOutput {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly result: unknown | null;
}

export interface DshStreamEvent {
  readonly type: "thinking" | "progress";
  readonly text: string;
}

export interface DshRunnerOptions {
  readonly onEvent?: (event: DshStreamEvent) => void;
}

interface DshStreamPayload {
  readonly type?: string;
  readonly text?: string;
  readonly message?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly result?: unknown;
}

const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_OUTPUT_CHARS = 4_000_000;

export function dshServiceUrl(): string {
  return (process.env.DSH_SERVICE_URL ?? "").trim().replace(/\/+$/, "");
}

export function isDshConfigured(): boolean {
  return dshServiceUrl().length > 0 || (process.env.DSH_HEADLESS_COMMAND ?? "").trim().length > 0;
}

function dshTimeoutMs(): number {
  const value = Number(process.env.DSH_TASK_TIMEOUT_MS);
  return Number.isFinite(value) && value > 5_000 ? Math.min(value, 900_000) : DEFAULT_TIMEOUT_MS;
}

function dshEnv(): NodeJS.ProcessEnv {
  // 只给 dsh 最小环境，避免把 DATABASE_URL / NEXTAUTH_SECRET 等进程密钥暴露给子进程。
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    NODE_ENV: process.env.NODE_ENV ?? "production",
    LANG: process.env.LANG ?? "C.UTF-8",
    TERM: process.env.TERM ?? "dumb"
  };
  const home = (process.env.DSH_HOME ?? "").trim();
  if (home.length > 0) env.DSH_HOME = home;
  const key = (process.env.DEEPSEEK_API_KEY ?? "").trim();
  if (key.length > 0) env.DEEPSEEK_API_KEY = key;
  const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? "").trim();
  if (baseUrl.length > 0) env.DEEPSEEK_BASE_URL = baseUrl;
  const model = (process.env.DEEPSEEK_MODEL ?? "").trim();
  if (model.length > 0) env.DEEPSEEK_MODEL = model;
  return env;
}

function parseMaybeJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

/** 与 sidecar 保持同一套 reasoning 解析规则。 */
function reasoningTextFromLine(line: string): string | null {
  const trimmed = line.replace(/\r$/, "").trim();
  if (trimmed.length === 0) return null;
  const marker = /^dsh:\s*reasoning:\s*/i.exec(trimmed);
  if (marker !== null) {
    const text = trimmed.slice(marker[0].length).trim();
    return text.length > 0 ? text : null;
  }
  if (/^dsh:/i.test(trimmed)) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return null;
  return trimmed;
}

function emitStderrLine(line: string, onEvent?: (event: DshStreamEvent) => void): void {
  if (onEvent === undefined) return;
  const text = reasoningTextFromLine(line);
  if (text !== null) onEvent({ type: "thinking", text });
}

async function runDshCli(input: DshRunnerInput, options: DshRunnerOptions = {}): Promise<DshRunnerOutput> {
  const root = (process.env.DSH_WORKSPACE_ROOT ?? join(tmpdir(), "touhou-dsh")).trim();
  await mkdir(root, { recursive: true });
  const workspace = await mkdtemp(join(root, "turn-"));
  try {
    for (const [name, content] of Object.entries(input.files)) {
      await writeFile(join(workspace, name), content, "utf8");
    }
    const command = (process.env.DSH_HEADLESS_COMMAND ?? "dsh").trim() || "dsh";
    const args = (process.env.DSH_HEADLESS_ARGS ?? "--profile headless")
      .split(/\s+/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    args.push(input.task);
    const timeoutMs = input.timeoutMs ?? dshTimeoutMs();

    const output = await new Promise<DshRunnerOutput>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: workspace,
        env: dshEnv(),
        stdio: ["ignore", "pipe", "pipe"]
      });
      let stdout = "";
      let stderr = "";
      let stderrBuffer = "";
      let finished = false;
      const timer = setTimeout(() => {
        if (finished === false) {
          child.kill("SIGTERM");
          setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
        }
      }, timeoutMs);
      timer.unref();

      child.stdout.on("data", (chunk: Buffer) => {
        if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        if (stderr.length < MAX_OUTPUT_CHARS) stderr += text;
        stderrBuffer += text;
        let index;
        while ((index = stderrBuffer.indexOf("\n")) >= 0) {
          const line = stderrBuffer.slice(0, index);
          stderrBuffer = stderrBuffer.slice(index + 1);
          emitStderrLine(line, options.onEvent);
        }
      });
      child.on("error", (error) => {
        finished = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        finished = true;
        clearTimeout(timer);
        if (stderrBuffer.length > 0) emitStderrLine(stderrBuffer, options.onEvent);
        resolve({ exitCode: code ?? 1, stdout, stderr, result: null });
      });
    });

    let result: unknown | null = null;
    try {
      const raw = await readFile(join(workspace, "result.json"), "utf8");
      result = parseMaybeJson(raw);
    } catch {
      result = null;
    }
    if (result === null) result = parseMaybeJson(output.stdout);
    return { ...output, result };
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runDshService(url: string, input: DshRunnerInput): Promise<DshRunnerOutput> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? dshTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    const response = await fetch(url + "/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: input.task, files: input.files, timeoutMs }),
      signal: controller.signal
    });
    const payload = (await response.json()) as {
      readonly exitCode?: number;
      readonly stdout?: string;
      readonly stderr?: string;
      readonly result?: unknown;
    };
    if (response.ok === false) {
      throw new Error("dsh 服务返回 " + String(response.status));
    }
    return {
      exitCode: typeof payload.exitCode === "number" ? payload.exitCode : 1,
      stdout: typeof payload.stdout === "string" ? payload.stdout : "",
      stderr: typeof payload.stderr === "string" ? payload.stderr : "",
      result: payload.result ?? null
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runDshServiceStream(
  url: string,
  input: DshRunnerInput,
  onEvent: (event: DshStreamEvent) => void
): Promise<DshRunnerOutput> {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? dshTimeoutMs();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref();
  try {
    const response = await fetch(url + "/run/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: input.task, files: input.files, timeoutMs }),
      signal: controller.signal
    });
    if (response.ok === false) {
      const detail = await response.text().catch(() => "");
      throw new Error("dsh 服务返回 " + String(response.status) + (detail.trim().length > 0 ? "：" + detail.trim().slice(0, 200) : ""));
    }
    if (response.body === null) throw new Error("dsh 服务没有返回流");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const state: { output: DshRunnerOutput | null } = { output: null };
    let buffer = "";

    const handleLine = (line: string): void => {
      const trimmed = line.trim();
      if (trimmed.length === 0) return;
      let event: DshStreamPayload;
      try {
        event = JSON.parse(trimmed) as DshStreamPayload;
      } catch {
        return;
      }
      if ((event.type === "thinking" || event.type === "progress") && typeof event.text === "string") {
        onEvent({ type: event.type, text: event.text });
        return;
      }
      if (event.type === "result") {
        state.output = {
          exitCode: typeof event.exitCode === "number" ? event.exitCode : 1,
          stdout: typeof event.stdout === "string" ? event.stdout : "",
          stderr: typeof event.stderr === "string" ? event.stderr : "",
          result: event.result ?? null
        };
        return;
      }
      if (event.type === "error") {
        throw new Error(typeof event.message === "string" ? event.message : "dsh 服务执行失败");
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        handleLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) handleLine(buffer);
    if (state.output === null) throw new Error("dsh 服务没有返回最终结果");
    return state.output;
  } finally {
    clearTimeout(timer);
  }
}

export async function runDshTask(input: DshRunnerInput, options: DshRunnerOptions = {}): Promise<DshRunnerOutput> {
  const service = dshServiceUrl();
  if (service.length > 0) {
    if (options.onEvent !== undefined) return runDshServiceStream(service, input, options.onEvent);
    return runDshService(service, input);
  }
  return runDshCli(input, options);
}
