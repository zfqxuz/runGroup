import Link from "next/link";
import { redirect } from "next/navigation";
import AppTabs from "@/components/layout/AppTabs";
import ConfirmModuleDeleteButton from "@/components/module/ConfirmModuleDeleteButton";
import ModuleImporter from "@/components/module/ModuleImporter";
import { createBlankModuleAction, setModulePublishedAction } from "@/server/actions/module";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function MyModulesPage({
  searchParams
}: {
  searchParams: { deleted?: string; saved?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const modules = await prisma.module.findMany({
    where: { ownerId: session.user.id },
    include: { room: { select: { id: true, name: true } } },
    orderBy: { id: "desc" }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">← 返回房间列表</Link>
          <h1 className="mt-2 text-2xl font-semibold">我的团本</h1>
          <p className="mt-1 text-sm text-white/50">你创建或导入的团本。只有你可以编辑和发布它们。</p>
        </div>
        <Link
          href="/modules"
          className="rounded-lg border border-spirit-400/40 px-4 py-2 text-sm text-spirit-300 transition hover:bg-spirit-400/10"
        >
          去团本广场
        </Link>
      </header>

      <AppTabs />

      {searchParams.deleted === "1" ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          团本已删除。
        </p>
      ) : null}
      {searchParams.saved === "1" ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          团本已保存。
        </p>
      ) : null}

      <section className="grid gap-3 rounded-xl border border-white/10 bg-ink-800/50 p-5 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-medium text-white/80">新建空白团本</h2>
          <p className="mt-1 text-[11px] text-white/35">生成标准 14 章节模板，创建后再编辑内容和发布。</p>
          <form action={createBlankModuleAction} className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">规则系统</span>
              <select name="system" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500">
                <option value="COC7">COC7 原版</option>
                <option value="TOUHOU">东方扩展</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">年代</span>
              <select name="era" className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500">
                <option value="MODERN">现代</option>
                <option value="CLASSIC">1920 年代</option>
                <option value="FANTASY">幻想乡</option>
              </select>
            </label>
            <button type="submit" className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400">
              新建空白团本
            </button>
          </form>
        </div>
        <div>
          <h2 className="text-sm font-medium text-white/80">导入标准团本</h2>
          <p className="mt-1 text-[11px] text-white/35">支持 `.md` 单文件或 `.zip` 标准包，导入后即可编辑和发布。</p>
          <div className="mt-3">
            <ModuleImporter />
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">全部团本（{modules.length}）</h2>
        {modules.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有团本。可以在上方新建或导入。</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-white/5">
            {modules.map((module) => (
              <li key={module.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={"/modules/" + module.id} className="truncate text-sm text-white/80 hover:text-sakura-300">
                      {module.title}
                    </Link>
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/45">
                      {module.system ?? "未指定系统"}
                    </span>
                    <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/45">
                      {module.era ?? "未指定年代"}
                    </span>
                    {module.isPublished ? (
                      <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300">已发布</span>
                    ) : (
                      <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">未发布</span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-white/35">
                    {module.room === null ? "独立团本" : "房间：" + module.room.name} · v{module.version}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Link
                    href={"/modules/" + module.id}
                    className="rounded-md border border-spirit-400/40 px-2 py-1 text-[11px] text-spirit-300 transition hover:bg-spirit-400/10"
                  >
                    管理
                  </Link>
                  <form action={setModulePublishedAction}>
                    <input type="hidden" name="moduleId" value={module.id} />
                    <input type="hidden" name="published" value={module.isPublished ? "0" : "1"} />
                    <button
                      type="submit"
                      className={
                        module.isPublished
                          ? "rounded-md border border-amber-400/40 px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-400/10"
                          : "rounded-md border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-400/10"
                      }
                    >
                      {module.isPublished ? "取消发布" : "发布到广场"}
                    </button>
                  </form>
                  <ConfirmModuleDeleteButton moduleId={module.id} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
