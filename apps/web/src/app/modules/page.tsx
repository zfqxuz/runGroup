import Link from "next/link";
import { redirect } from "next/navigation";
import ModulePublicCard, { ModulePreviewLink } from "@/components/module/ModulePublicCard";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function ModuleSquarePage() {
  const session = await auth();
  if (session === null) redirect("/login");

  const modules = await prisma.module.findMany({
    where: { isPublished: true },
    include: { owner: { select: { username: true, displayName: true } } },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }]
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">← 返回房间列表</Link>
          <h1 className="mt-2 text-2xl font-semibold">团本广场</h1>
          <p className="mt-1 text-sm text-white/50">
            所有已发布的团本。这里只展示公开预览字段，完整内容由各房间 KP 在团本管理页查看。
          </p>
        </div>
        <Link
          href="/modules/mine"
          className="rounded-lg border border-sakura-500/40 px-4 py-2 text-sm text-sakura-300 transition hover:bg-sakura-500/10"
        >
          我的团本
        </Link>
      </header>


      {modules.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 px-5 py-12 text-center text-sm text-white/40">
          还没有已发布的团本，去“我的团本”发布一个吧。
        </p>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((module) => (
            <ModulePublicCard
              key={module.id}
              module={module}
              actions={
                <>
                  <Link
                    href={"/rooms/new?moduleId=" + module.id}
                    className="rounded-lg bg-sakura-500 px-3 py-1.5 text-xs font-medium text-ink-900 transition hover:bg-sakura-400"
                  >
                    用这个团本建房
                  </Link>
                  <ModulePreviewLink moduleId={module.id} />
                </>
              }
            />
          ))}
        </section>
      )}
    </main>
  );
}
