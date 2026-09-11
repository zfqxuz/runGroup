import Link from "next/link";
import { adminSetModulePublishedAction, deleteModuleAdminAction } from "@/server/actions/admin";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function AdminModulesPage({
  searchParams
}: {
  searchParams: { q?: string; saved?: string; error?: string };
}) {
  const q = (searchParams.q ?? "").trim();
  const modules = await prisma.module.findMany({
    where: q.length === 0 ? {} : { title: { contains: q, mode: "insensitive" } },
    include: {
      owner: { select: { username: true, displayName: true } },
      room: { select: { id: true, name: true } },
      _count: { select: { games: true, assets: true, revisions: true } }
    },
    orderBy: { id: "desc" },
    take: 300
  });

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
          <h1 className="mt-2 text-2xl font-semibold">团本管理</h1>
          <p className="mt-1 text-sm text-white/50">全站 {modules.length} 个团本。可强制下架违规团本；被进行中游戏使用的团本不可删除。</p>
        </div>
        <form className="flex items-end gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="按标题搜索"
            className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500"
          />
          <button type="submit" className="rounded-lg border border-spirit-400/40 px-4 py-2 text-xs text-spirit-300 transition hover:bg-spirit-400/10">
            搜索
          </button>
        </form>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">操作已保存：{searchParams.saved}</p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">操作失败：{searchParams.error}</p>
      )}

      <div className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/50">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 bg-ink-900/60 text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">团本</th>
              <th className="px-4 py-3">归属</th>
              <th className="px-4 py-3">数据</th>
              <th className="px-4 py-3">发布</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {modules.map((moduleRecord) => (
              <tr key={moduleRecord.id}>
                <td className="px-4 py-3">
                  <Link href={"/modules/" + moduleRecord.id} className="font-medium text-white/80 hover:text-sakura-300">{moduleRecord.title}</Link>
                  <p className="mt-0.5 text-[10px] text-white/35">
                    {moduleRecord.system ?? "未指定"} · {moduleRecord.era ?? "未指定"} · v{moduleRecord.version}
                  </p>
                </td>
                <td className="px-4 py-3 text-[10px] text-white/45">
                  {moduleRecord.owner === null ? "平台/无主" : moduleRecord.owner.displayName ?? moduleRecord.owner.username}
                  <br />
                  {moduleRecord.room === null ? "独立团本" : "房间：" + moduleRecord.room.name}
                </td>
                <td className="px-4 py-3 text-[10px] text-white/35">
                  资源 {moduleRecord._count.assets} · 局 {moduleRecord._count.games} · 快照 {moduleRecord._count.revisions}
                </td>
                <td className="px-4 py-3">
                  {moduleRecord.isPublished ? (
                    <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300">已发布</span>
                  ) : (
                    <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">未发布</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <form action={adminSetModulePublishedAction}>
                      <input type="hidden" name="moduleId" value={moduleRecord.id} />
                      <input type="hidden" name="published" value={moduleRecord.isPublished ? "0" : "1"} />
                      <button type="submit" className="rounded border border-spirit-400/40 px-2 py-1 text-[10px] text-spirit-300 transition hover:bg-spirit-400/10">
                        {moduleRecord.isPublished ? "下架" : "发布"}
                      </button>
                    </form>
                    <form action={deleteModuleAdminAction}>
                      <input type="hidden" name="moduleId" value={moduleRecord.id} />
                      <button type="submit" className="rounded border border-red-400/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10">删除</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
