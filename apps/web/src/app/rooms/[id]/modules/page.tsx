import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ModuleImporter from "@/components/module/ModuleImporter";
import ModuleActions from "@/components/module/ModuleActions";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function ModuleListPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { deleted?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: { select: { id: true, name: true, status: true } } }
  });
  if (membership === null) notFound();

  const isKP = membership.role === "KP";
  const modules = await prisma.module.findMany({
    where: { roomId: params.id },
    include: { _count: { select: { assets: true, chapters: true } } },
    orderBy: { id: "asc" }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={"/rooms/" + params.id + "/prepare"} className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回准备页
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">团本管理</h1>
          <p className="mt-1 text-sm text-white/50">{membership.room.name} · {membership.room.status}</p>
        </div>
        <span className="rounded-full border border-sakura-500/40 px-3 py-1 text-xs text-sakura-400">
          我的身份：{membership.role}
        </span>
      </header>

      {isKP ? (
        <ModuleImporter roomId={params.id} />
      ) : (
        <p className="rounded-xl border border-white/10 bg-ink-800/50 px-4 py-3 text-xs text-white/45">
          只有 KP 可以导入或编辑团本，你可以查看已绑定团本。
        </p>
      )}

      {searchParams.deleted === "1" ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          团本已删除。
        </p>
      ) : null}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">本房团本（{modules.length}）</h2>
        {modules.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有团本。KP 可以导入 .md 或 .zip 标准包。</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-white/5">
            {modules.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link
                  href={"/rooms/" + params.id + "/modules/" + item.id}
                  className="min-w-0 flex-1"
                >
                  <p className="truncate text-sm text-white/80">{item.title}</p>
                  <p className="mt-0.5 text-[11px] text-white/35">
                    v{item.version} · {item.author ?? "未署名"} · {item.sourceType}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2 text-[10px] text-white/45">
                  <span className="rounded-full border border-white/15 px-2 py-0.5">{item._count.assets} 资源</span>
                  <span className="rounded-full border border-white/15 px-2 py-0.5">{item._count.chapters} 章节</span>
                  {isKP ? <ModuleActions roomId={params.id} moduleId={item.id} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
