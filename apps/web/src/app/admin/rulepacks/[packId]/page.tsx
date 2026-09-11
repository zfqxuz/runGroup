import Link from "next/link";
import { notFound } from "next/navigation";
import {
  adminSetRulePackVersionStatusAction,
  createRulePackVersionAction,
  deleteRulePackAdminAction,
  importRulePackVersionAction
} from "@/server/actions/admin";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "草稿",
  PUBLISHED: "已发布",
  ARCHIVED: "已归档"
};

export default async function AdminRulePackDetailPage({
  params,
  searchParams
}: {
  params: { packId: string };
  searchParams: { saved?: string; error?: string; reason?: string };
}) {
  const pack = await prisma.rulePack.findUnique({
    where: { id: params.packId },
    include: {
      owner: { select: { username: true, displayName: true } },
      versions: {
        orderBy: { createdAt: "desc" },
        include: { _count: { select: { rooms: true, modules: true } } }
      }
    }
  });
  if (pack === null) notFound();

  const latest = pack.versions[0] ?? null;
  const latestConfigText = latest === null ? "" : JSON.stringify(latest.config, null, 2);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/admin/rulepacks" className="text-xs text-white/40 transition hover:text-white/70">← 规则包列表</Link>
        <h1 className="mt-2 text-2xl font-semibold">{pack.name}</h1>
        <p className="mt-1 text-sm text-white/50">
          {pack.slug} · {pack.system}
          {pack.isBuiltin ? " · 内置包" : ""}
          {pack.owner === null ? "" : " · 创建者 " + (pack.owner.displayName ?? pack.owner.username)}
        </p>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">操作已保存：{searchParams.saved}</p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          操作失败：{searchParams.error}{searchParams.reason === undefined ? "" : " · " + searchParams.reason}
        </p>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">版本列表（{pack.versions.length}）</h2>
        <div className="mt-4 flex flex-col divide-y divide-white/5">
          {pack.versions.map((version) => (
            <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white/80">
                  v{version.version}
                  <span className="ml-2 rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/50">
                    {STATUS_LABELS[version.status] ?? version.status}
                  </span>
                </p>
                <p className="mt-0.5 break-all text-[10px] text-white/30">
                  checksum {version.checksum.slice(0, 16)}… · 绑房 {version._count.rooms} · 绑团 {version._count.modules} ·{" "}
                  {version.publishedAt === null ? "未发布" : "发布于 " + version.publishedAt.toLocaleString("zh-CN")}
                </p>
                {version.notes === null ? null : <p className="mt-0.5 text-[10px] text-white/35">{version.notes}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Link href={"/admin/rulepacks/" + pack.id + "/versions/" + version.id + "/export"} className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/55 transition hover:text-white">
                  导出 JSON
                </Link>
                {version.status === "PUBLISHED" ? (
                  <form action={adminSetRulePackVersionStatusAction}>
                    <input type="hidden" name="versionId" value={version.id} />
                    <input type="hidden" name="status" value="ARCHIVED" />
                    <button type="submit" className="rounded border border-amber-400/30 px-2 py-1 text-[10px] text-amber-300 transition hover:bg-amber-400/10">归档</button>
                  </form>
                ) : (
                  <form action={adminSetRulePackVersionStatusAction}>
                    <input type="hidden" name="versionId" value={version.id} />
                    <input type="hidden" name="status" value="PUBLISHED" />
                    <button type="submit" className="rounded border border-emerald-400/40 px-2 py-1 text-[10px] text-emerald-300 transition hover:bg-emerald-400/10">发布</button>
                  </form>
                )}
              </div>
            </div>
          ))}
        </div>
        {pack.isBuiltin ? null : (
          <form action={deleteRulePackAdminAction} className="mt-4 border-t border-white/10 pt-4">
            <input type="hidden" name="packId" value={pack.id} />
            <button type="submit" className="rounded border border-red-400/30 px-3 py-1.5 text-[10px] text-red-300 transition hover:bg-red-400/10">
              删除整个规则包（无绑定时可用）
            </button>
          </form>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">新建版本</h2>
          <p className="mt-1 text-[11px] text-white/35">新版本默认草稿。发布后可在“绑定房间”中选择。</p>
          <form action={createRulePackVersionAction} className="mt-4 grid gap-3">
            <input type="hidden" name="packId" value={pack.id} />
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">版本号</span>
              <input name="version" placeholder="1.1.0" required className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">备注</span>
              <input name="notes" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">完整 RulePack JSON</span>
              <textarea
                name="config"
                rows={14}
                defaultValue={latestConfigText}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-[11px] leading-5 outline-none focus:border-sakura-500"
              />
            </label>
            <div>
              <button type="submit" className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-sakura-400">保存草稿版本</button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">导入 JSON 版本</h2>
          <p className="mt-1 text-[11px] text-white/35">上传一个完整 RulePack JSON 文件，作为新草稿版本落库。</p>
          <form action={importRulePackVersionAction} className="mt-4 grid gap-3">
            <input type="hidden" name="packId" value={pack.id} />
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">版本号</span>
              <input name="version" placeholder="1.2.0" required className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">JSON 文件</span>
              <input
                type="file"
                name="file"
                accept="application/json,.json"
                required
                className="block w-full cursor-pointer rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs text-white/60 file:mr-3 file:rounded file:border-0 file:bg-sakura-500 file:px-3 file:py-1.5 file:text-[11px] file:text-ink-900"
              />
            </label>
            <div>
              <button type="submit" className="rounded-lg border border-spirit-400/40 px-4 py-2 text-xs text-spirit-300 transition hover:bg-spirit-400/10">导入版本</button>
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
