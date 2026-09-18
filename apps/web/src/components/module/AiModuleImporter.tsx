"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  readonly roomId?: string;
}

interface ImportResult {
  readonly ok: boolean;
  readonly jobId?: string;
  readonly status?: "RUNNING" | "DONE" | "FAILED";
  readonly progress?: readonly string[];
  readonly moduleId?: string;
  readonly error?: string;
  readonly title?: string;
  readonly model?: string;
  readonly sessionId?: string;
  readonly attempts?: number;
  readonly aiCalls?: number;
  readonly chunks?: number;
  readonly chunksCompleted?: number;
  readonly imagesAnalyzed?: number;
  readonly imagesUsed?: number;
  readonly warnings?: readonly { readonly filename: string; readonly message: string }[];
}

const POLL_INTERVAL_MS = 2500;
const POLL_TIMEOUT_MS = 30 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function AiModuleImporter(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function submit(form: HTMLFormElement): Promise<void> {
    setBusy(true);
    setMessage(null);
    setResult(null);
    try {
      const response = await fetch("/api/modules/ai-import", {
        method: "POST",
        body: new FormData(form)
      });
      const payload = (await response.json()) as ImportResult;
      if (payload.ok === false || payload.jobId === undefined) {
        setMessage(payload.error ?? "AI 整合失败");
        setResult(payload);
        return;
      }

      // 任务已建立并拿到独立 jobId，立刻清空上一次导入留下的文件与表单上下文，
      // 避免下一次导入误带旧素材、旧年代或旧额外要求。
      form.reset();
      const jobId = payload.jobId;
      setMessage("任务已创建，正在解析素材…");
      const startedAt = Date.now();
      while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
        await sleep(POLL_INTERVAL_MS);
        let statusResponse: Response;
        try {
          statusResponse = await fetch("/api/modules/ai-import?jobId=" + encodeURIComponent(jobId), {
            cache: "no-store"
          });
        } catch {
          // 单次轮询网络抖动时继续等待，不中断整个任务。
          continue;
        }
        const statusPayload = (await statusResponse.json()) as ImportResult;
        const progress = statusPayload.progress ?? [];
        const latest = progress[progress.length - 1];
        if (latest !== undefined) setMessage(latest);

        if (statusPayload.status === "DONE" && statusPayload.moduleId !== undefined) {
          setResult(statusPayload);
          setMessage("AI 整合完成，正在跳转到团本详情…");
          router.push(
            props.roomId === undefined
              ? "/modules/" + statusPayload.moduleId
              : "/rooms/" + props.roomId + "/modules/" + statusPayload.moduleId
          );
          router.refresh();
          return;
        }
        if (statusPayload.status === "FAILED" || statusPayload.ok === false) {
          setMessage(statusPayload.error ?? "AI 整合失败");
          setResult(statusPayload);
          return;
        }
      }
      setMessage("解析时间较长，请稍后在「我的团本」查看。");
    } catch {
      setMessage("请求失败，请稍后重试。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit(event.currentTarget);
      }}
      className="rounded-xl border border-white/10 bg-ink-900/60 p-4"
    >
      {props.roomId === undefined ? null : <input type="hidden" name="roomId" value={props.roomId} />}
      <div className="grid gap-3 lg:grid-cols-2">
        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-xs text-white/50">上传任意数量素材（文档 / 图片 / 表格，可多选）</span>
          <input
            type="file"
            name="files"
            multiple
            required
            className="block w-full cursor-pointer rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs text-white/60 file:mr-3 file:rounded-md file:border-0 file:bg-sakura-500 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white"
          />
          <span className="text-[10px] leading-4 text-white/30">
            支持 md / txt / json / yaml / csv / docx / pptx / xlsx / pdf（自动抽取正文、内嵌图片与矢量页面渲染）/ png / jpg / webp / gif / avif / bmp / tiff / heic；
            单文件最大 25MB，最多 40 个文件、12 张图片；长文本会分段解析后合并，不会因为模型输出上限丢内容（正文上限约 90 万字、80 段，超限会明确要求拆分而不是静默截断）。
          </span>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/50">目标系统</span>
          <select name="system" defaultValue="AUTO" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500">
            <option value="AUTO">自动判断</option>
            <option value="COC7">COC7 原版</option>
            <option value="TOUHOU">东方扩展</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-white/50">年代</span>
          <input name="era" defaultValue="MODERN" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500" />
        </label>

        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-xs text-white/50">模型（处理图片素材时建议选择视觉模型）</span>
          <select name="model" defaultValue="" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500">
            <option value="">使用默认模型（支持图片）</option>
            <option value="deepseek-flash">视觉模型（推荐，支持图片）</option>
            <option value="deepseek-v4-pro">文本模型（仅支持文本）</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-xs text-white/50">额外要求（可选）</span>
          <textarea
            name="instructions"
            rows={3}
            placeholder="例：重点整合 NPC 关系图；把地图截图对应写成场景；偏向轻松搞笑风格……"
            className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-sakura-400 disabled:opacity-40"
        >
          {busy ? "正在解析…" : "AI 解析团本"}
        </button>
        {busy ? (
          <span className="text-[11px] text-white/35">任务会在后台继续，完成后可在「我的团本」查看。</span>
        ) : null}
      </div>

      {message === null ? null : (
        <p className={result?.ok === false ? "mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200" : "mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200"}>
          {message}
          {result?.model === undefined
            ? ""
            : " " + result.model +
              " · " + String(result.chunksCompleted ?? 0) + "/" + String(result.chunks ?? 0) +
              " · " + String(result.imagesAnalyzed ?? result.imagesUsed ?? 0) + "/" + String(result.imagesUsed ?? 0) +
              " · " + String(result.aiCalls ?? result.attempts ?? 1) + " 次"}
        </p>
      )}

      {result?.warnings === undefined || result.warnings.length === 0 ? null : (
        <ul className="mt-3 space-y-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
          {result.warnings.slice(0, 8).map((item, index) => (
            <li key={String(index)}>· {item.filename}：{item.message}</li>
          ))}
        </ul>
      )}
    </form>
  );
}
