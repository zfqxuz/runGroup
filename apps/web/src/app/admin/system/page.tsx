import Link from "next/link";
import { updateSystemSettingAction } from "@/server/actions/admin";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

const COMMON_SETTINGS = [
  {
    key: "ai.moduleImport.model",
    label: "DeepSeek 默认模型",
    hint: "deepseek-flash 支持图片视觉输入，推荐作为默认模型；deepseek-v4-pro 为文本推理模型。"
  },
  {
    key: "ai.moduleImport.maxFiles",
    label: "单次 AI 导入最大文件数",
    hint: "JSON 数字，例如 30。"
  }
] as const;

export default async function AdminSystemPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string };
}) {
  const settings = await prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
  const settingByKey = new Map(settings.map((item) => [item.key, item]));
  const hasDeepseekKey = (process.env.DEEPSEEK_API_KEY ?? "").trim().length > 0;
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
        <h1 className="mt-2 text-2xl font-semibold">系统设置</h1>
        <p className="mt-1 text-sm text-white/50">平台级配置，保存在 SystemSetting 表，AI 团本导入会优先读取这里的值。</p>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">设置已保存。</p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">保存失败：{searchParams.error}</p>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">DeepSeek 接入</h2>
        <p className="mt-2 text-xs text-white/45">
          API Key：{hasDeepseekKey ? "已从环境变量 DEEPSEEK_API_KEY 读取" : "未配置（请在 apps/web/.env 设置 DEEPSEEK_API_KEY）"}
        </p>
        <p className="mt-1 text-xs text-white/45">Base URL：{baseUrl}</p>
        <p className="mt-1 text-[11px] text-white/30">Key 永不落库、不会返回给前端；只通过服务端环境变量读取。</p>
      </section>

      {COMMON_SETTINGS.map((item) => {
        const current = settingByKey.get(item.key);
        return (
          <section key={item.key} className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
            <h2 className="text-sm font-medium text-white/80">{item.label}</h2>
            <p className="mt-1 text-[11px] text-white/35">{item.hint}</p>
            <form action={updateSystemSettingAction} className="mt-3 flex flex-wrap items-end gap-3">
              <input type="hidden" name="key" value={item.key} />
              <textarea
                name="value"
                rows={2}
                defaultValue={item.key === "ai.moduleImport.model" ? JSON.stringify(current?.value ?? "deepseek-flash") : JSON.stringify(current?.value ?? (item.key.endsWith("maxFiles") ? 30 : {}))}
                className="min-w-[280px] flex-1 rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-[11px] outline-none focus:border-sakura-500"
              />
              <button type="submit" className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-sakura-400">保存</button>
            </form>
          </section>
        );
      })}

      <section className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/50">
        <div className="border-b border-white/10 px-5 py-3">
          <h2 className="text-sm font-medium text-white/80">全部设置项（{settings.length}）</h2>
        </div>
        <div className="divide-y divide-white/5">
          {settings.length === 0 ? <p className="px-5 py-8 text-center text-xs text-white/35">暂无设置项。</p> : null}
          {settings.map((item) => (
            <div key={item.key} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-xs">
              <code className="font-mono text-[11px] text-sakura-300">{item.key}</code>
              <code className="max-w-xl truncate font-mono text-[11px] text-white/45" title={JSON.stringify(item.value)}>
                {JSON.stringify(item.value)}
              </code>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
