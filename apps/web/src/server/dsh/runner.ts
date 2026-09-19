import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * dsh 极简模式（headless）调用桥。
 *
 * 两种部署形态：
 * 1. `DSH_SERVICE_URL`：外部/旁车 dsh 服务，POST /run { task, files }；
 * 2. 否则本地拉起 `DSH_HEADLESS_COMMAND`（默认 dsh --profile headless）。
 *
 * 约定：任务说明与 module.json 写入临时工作目录，dsh 完成后读取同目录 result.json。
 * 思维链只出现在 dsh 的 stderr，调用方不会展示。
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

async function runDshCli(input: DshRunnerInput): Promise<DshRunnerOutput> {
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
        if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        finished = true;
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        finished = true;
        clearTimeout(timer);
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

export async function runDshTask(input: DshRunnerInput): Promise<DshRunnerOutput> {
  const service = dshServiceUrl();
  if (service.length > 0) return runDshService(service, input);
  return runDshCli(input);
}
