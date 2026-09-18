import Link from "next/link";
import { updateSystemSettingAction } from "@/server/actions/admin";
import { prisma } from "@/server/db/prisma";
import { isN8nConfigured, n8nModuleParseUrl } from "@/server/ai/n8n";

export const dynamic = "force-dynamic";

const COMMON_SETTINGS = [
  {
    key: "ai.moduleImport.model",
    label: "默认 AI 模型",
    hint: "视觉模型支持图片，推荐默认；文本模型仅支持文本。"
  },
  {
    key: "ai.moduleImport.maxFiles",
    label: "单次导入文件上限",
    hint: "填写数字，例如 30。"
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
  const hasN8n = isN8nConfigured();
  const n8nUrl = n8nModuleParseUrl();

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
        <h1 className="mt-2 text-2xl font-semibold">系统设置</h1>
        <p className="mt-1 text-sm text-white/50">平台级配置，AI 团本导入时优先使用。</p>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">设置已保存。</p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">保存失败：{searchParams.error}</p>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">AI 团本解析服务</h2>
        <p className="mt-2 text-xs text-white/45">
          工作流地址：{hasN8n ? n8nUrl : "未配置（请在部署环境设置 N8N_MODULE_PARSE_URL，例如 http://n8n:5678/webhook/module-parse）"}
        </p>
        <p className="mt-1 text-xs text-white/45">
          当前导入解析器：{hasN8n ? "n8n 工作流（NPC 数值走确定性解析，DeepSeek 只负责正文抽取）" : "备用模型直连"}
        </p>
        <p className="mt-1 text-[11px] text-white/30"></p>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">备用模型接入</h2>
        <p className="mt-2 text-xs text-white/45">
          API Key：{hasDeepseekKey ? "已配置" : "未配置（解析服务可用时无需配置）"}
        </p>
        <p className="mt-1 text-xs text-white/45">Base URL：{baseUrl}</p>
        <p className="mt-1 text-[11px] text-white/30"></p>
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
              <button type="submit" className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-white transition hover:bg-sakura-400">保存</button>
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
