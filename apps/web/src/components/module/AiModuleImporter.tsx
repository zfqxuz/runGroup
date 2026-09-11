"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

interface Props {
  readonly roomId?: string;
}

interface ImportResult {
  readonly ok: boolean;
  readonly moduleId?: string;
  readonly error?: string;
  readonly title?: string;
  readonly model?: string;
  readonly attempts?: number;
  readonly imagesUsed?: number;
  readonly warnings?: readonly { readonly filename: string; readonly message: string }[];
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
      if (payload.ok === false || payload.moduleId === undefined) {
        setMessage(payload.error ?? "AI 整合失败");
        setResult(payload);
        return;
      }
      setResult(payload);
      setMessage("AI 整合完成，正在跳转到团本详情…");
      router.push(
        props.roomId === undefined
          ? "/modules/" + payload.moduleId
          : "/rooms/" + props.roomId + "/modules/" + payload.moduleId
      );
      router.refresh();
    } catch {
      setMessage("请求失败：DeepSeek 调用时间可能过长，或网络中断；请稍后用同样素材重试。");
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
            className="block w-full cursor-pointer rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs text-white/60 file:mr-3 file:rounded-md file:border-0 file:bg-sakura-500 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-ink-900"
          />
          <span className="text-[10px] leading-4 text-white/30">
            支持 md / txt / json / yaml / csv / docx / pptx / xlsx / pdf（PDF 目前只保留元信息）/ png / jpg / webp / gif；
            单文件最大 25MB，最多 40 个。
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
          <span className="text-xs text-white/50">模型（涉及图片素材时推荐 deepseek-flash）</span>
          <select name="model" defaultValue="" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500">
            <option value="">使用后台/环境默认（默认 deepseek-flash，支持 vision）</option>
            <option value="deepseek-flash">deepseek-flash（推荐 · 支持图片视觉）</option>
            <option value="deepseek-v4-pro">deepseek-v4-pro（文本推理）</option>
          </select>
        </label>

        <label className="flex flex-col gap-1.5 lg:col-span-2">
          <span className="text-xs text-white/50">给 DeepSeek 的额外要求（可选）</span>
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
          className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:opacity-40"
        >
          {busy ? "DeepSeek 整合中…" : "AI 智能整合团本"}
        </button>
        {busy ? (
          <span className="text-[11px] text-white/35">正在阅读全部素材并生成 14 章标准团本，可能需要 1-3 分钟，请不要关闭页面。</span>
        ) : null}
      </div>

      {message === null ? null : (
        <p className={result?.ok === false ? "mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200" : "mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200"}>
          {message}
          {result?.model === undefined ? "" : "（模型 " + result.model + "，尝试 " + String(result.attempts ?? 1) + " 次，图片 " + String(result.imagesUsed ?? 0) + " 张）"}
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
