import Link from "next/link";
import {
  bindRoomRulePackAction,
  createRulePackAction,
  deleteRulePackAdminAction,
  syncBuiltinRulePacksAction
} from "@/server/actions/admin";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function AdminRulePacksPage({
  searchParams
}: {
  searchParams: { saved?: string; error?: string; reason?: string };
}) {
  const [packs, rooms, versions] = await Promise.all([
    prisma.rulePack.findMany({
      include: {
        versions: {
          orderBy: { createdAt: "desc" },
          include: { _count: { select: { rooms: true, modules: true } } }
        },
        owner: { select: { username: true, displayName: true } }
      },
      orderBy: [{ isBuiltin: "desc" }, { createdAt: "asc" }]
    }),
    prisma.room.findMany({ select: { id: true, name: true, system: true }, orderBy: { createdAt: "desc" }, take: 200 }),
    prisma.rulePackVersion.findMany({
      where: { status: "PUBLISHED", pack: { isPublished: true } },
      include: { pack: { select: { name: true, system: true } } },
      orderBy: { publishedAt: "desc" }
    })
  ]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/admin" className="text-xs text-white/40 transition hover:text-white/70">← 管理后台</Link>
          <h1 className="mt-2 text-2xl font-semibold">规则包管理</h1>
          <p className="mt-1 text-sm text-white/50">P2-2：规则包从代码注册表升级为数据库管理，支持创建、版本、发布、绑房、导入导出与审计。</p>
        </div>
        <form action={syncBuiltinRulePacksAction}>
          <button type="submit" className="rounded-lg border border-spirit-400/40 px-4 py-2 text-xs text-spirit-300 transition hover:bg-spirit-400/10">
            同步内置规则包
          </button>
        </form>
      </header>

      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200">操作已保存：{searchParams.saved}</p>
      )}
      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-200">
          操作失败：{searchParams.error}
          {searchParams.reason === undefined ? "" : " · " + searchParams.reason}
        </p>
      )}

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">新建规则包</h2>
          <p className="mt-1 text-[11px] text-white/35">从内置包复制，或粘贴完整 RulePack JSON。新包默认草稿，需发布版本后才能绑定房间。</p>
          <form action={createRulePackAction} className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">名称</span>
              <input name="name" required className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">slug（唯一）</span>
              <input name="slug" placeholder="my-pack" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">系统</span>
              <select name="system" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500">
                <option value="COC7">COC7</option>
                <option value="TOUHOU">东方扩展</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">复制内置包（可选）</span>
              <select name="baseSlug" defaultValue="" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500">
                <option value="">不复制 / 使用下方 JSON</option>
                <option value="coc7-baseline">coc7-baseline</option>
                <option value="touhou-ext">touhou-ext</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[11px] text-white/45">描述</span>
              <input name="description" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5 sm:col-span-2">
              <span className="text-[11px] text-white/45">RulePack JSON（可选）</span>
              <textarea name="config" rows={4} placeholder='{"id":"my-pack","version":"1.0.0",...}' className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-[11px] outline-none focus:border-sakura-500" />
            </label>
            <div>
              <button type="submit" className="rounded-lg bg-sakura-500 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-sakura-400">
                创建规则包
              </button>
            </div>
          </form>
        </div>

        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">绑定房间</h2>
          <p className="mt-1 text-[11px] text-white/35">把已发布版本绑定到房间，房间后续判定、战斗、成长都使用该版本；留空表示回退内置包。</p>
          <form action={bindRoomRulePackAction} className="mt-4 grid gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">房间</span>
              <select name="roomId" required className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500">
                <option value="">选择房间</option>
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.name}（{room.system}）</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">已发布版本</span>
              <select name="versionId" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-xs outline-none focus:border-sakura-500">
                <option value="">解绑 / 使用内置包</option>
                {versions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.pack.name} · v{version.version}（{version.pack.system}）
                  </option>
                ))}
              </select>
            </label>
            <div>
              <button type="submit" className="rounded-lg border border-spirit-400/40 px-4 py-2 text-xs text-spirit-300 transition hover:bg-spirit-400/10">
                保存绑定
              </button>
            </div>
          </form>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-white/10 bg-ink-800/50">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-white/10 bg-ink-900/60 text-[10px] uppercase tracking-wider text-white/35">
            <tr>
              <th className="px-4 py-3">规则包</th>
              <th className="px-4 py-3">版本</th>
              <th className="px-4 py-3">绑定</th>
              <th className="px-4 py-3">发布</th>
              <th className="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {packs.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-xs text-white/35">还没有数据库规则包，点击右上角“同步内置规则包”开始。</td></tr>
            ) : null}
            {packs.map((pack) => {
              const roomCount = pack.versions.reduce((sum, version) => sum + version._count.rooms, 0);
              const moduleCount = pack.versions.reduce((sum, version) => sum + version._count.modules, 0);
              const publishedVersions = pack.versions.filter((version) => version.status === "PUBLISHED");
              return (
                <tr key={pack.id}>
                  <td className="px-4 py-3">
                    <Link href={"/admin/rulepacks/" + pack.id} className="font-medium text-white/80 hover:text-sakura-300">{pack.name}</Link>
                    <p className="mt-0.5 text-[10px] text-white/35">
                      {pack.slug} · {pack.system}
                      {pack.isBuiltin ? " · 内置" : ""}
                      {pack.owner === null ? "" : " · " + (pack.owner.displayName ?? pack.owner.username)}
                    </p>
                    {pack.description === null ? null : <p className="mt-1 max-w-md text-[10px] text-white/30">{pack.description}</p>}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-white/45">
                    共 {pack.versions.length} 个 · 已发布 {publishedVersions.length}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-white/45">房 {roomCount} · 团 {moduleCount}</td>
                  <td className="px-4 py-3">
                    {pack.isPublished ? (
                      <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300">已发布</span>
                    ) : (
                      <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">未发布</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <Link href={"/admin/rulepacks/" + pack.id} className="rounded border border-spirit-400/40 px-2 py-1 text-[10px] text-spirit-300 transition hover:bg-spirit-400/10">管理</Link>
                      {pack.isBuiltin ? null : (
                        <form action={deleteRulePackAdminAction}>
                          <input type="hidden" name="packId" value={pack.id} />
                          <button type="submit" className="rounded border border-red-400/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10">删除</button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}
