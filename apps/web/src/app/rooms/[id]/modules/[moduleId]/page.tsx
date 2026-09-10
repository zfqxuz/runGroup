import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ModuleActions from "@/components/module/ModuleActions";
import ModuleAssetActions from "@/components/module/ModuleAssetActions";
import { saveModuleAction } from "@/server/actions/module";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

interface ModuleContent {
  readonly format?: string;
  readonly text?: string;
  readonly sections?: readonly unknown[];
}

export default async function ModuleDetailPage({
  params,
  searchParams
}: {
  params: { id: string; moduleId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: { select: { id: true, name: true } } }
  });
  if (membership === null) notFound();

  const moduleRecord = await prisma.module.findUnique({
    where: { id: params.moduleId },
    include: {
      assets: {
        include: { asset: true },
        orderBy: { orderIndex: "asc" }
      }
    }
  });
  if (moduleRecord === null || moduleRecord.roomId !== params.id) notFound();

  const isKP = membership.role === "KP";
  const content = (moduleRecord.content ?? {}) as ModuleContent;
  const text = content.text ?? "";

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={"/rooms/" + params.id + "/modules"} className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回团本列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{moduleRecord.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span>{moduleRecord.author ?? "未署名"}</span>
            <span>·</span>
            <span>v{moduleRecord.version}</span>
            <span>·</span>
            <span>{moduleRecord.system ?? "未指定系统"}</span>
            <span>·</span>
            <span>{moduleRecord.era ?? "未指定年代"}</span>
            <span>·</span>
            <span>{moduleRecord.sourceType}</span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="rounded-full border border-sakura-500/40 px-3 py-1 text-xs text-sakura-400">
            我的身份：{membership.role}
          </span>
          {isKP ? <ModuleActions roomId={params.id} moduleId={moduleRecord.id} /> : null}
        </div>
      </header>

      {searchParams.saved === "1" ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          团本已保存。
        </p>
      ) : null}
      {searchParams.saved === "copy" ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          团本已复制，可以继续编辑副本。
        </p>
      ) : null}
      {searchParams.saved === "new" ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          空白团本已创建，可以开始编辑标题、简介与正文。
        </p>
      ) : null}
      {searchParams.error === "active" ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          该团本仍被进行中的局使用，不能删除。请先结束本局。
        </p>
      ) : null}
      {searchParams.error === "title" ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          标题不能为空。
        </p>
      ) : null}

      {isKP ? (
        <form action={saveModuleAction} className="flex flex-col gap-5 rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <input type="hidden" name="roomId" value={params.id} />
          <input type="hidden" name="moduleId" value={moduleRecord.id} />
          <h2 className="text-sm font-medium text-white/80">编辑团本</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">标题</span>
              <input
                name="title"
                defaultValue={moduleRecord.title}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">版本</span>
              <input
                name="version"
                defaultValue={moduleRecord.version}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">作者</span>
              <input
                name="author"
                defaultValue={moduleRecord.author ?? ""}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">简介</span>
              <input
                name="synopsis"
                defaultValue={moduleRecord.synopsis ?? ""}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">Markdown 正文</span>
            <textarea
              name="content"
              rows={22}
              defaultValue={text}
              className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-sakura-500"
            />
          </label>
          <div>
            <button
              type="submit"
              className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
            >
              保存
            </button>
          </div>
        </form>
      ) : null}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">资源（{moduleRecord.assets.length}）</h2>
        {moduleRecord.assets.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">暂无资源。</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {moduleRecord.assets.map((item) => (
              <div key={item.id} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
                {item.kind === "IMAGE" || item.kind === "MAP" ? (
                  <img
                    src={item.asset.url}
                    alt={item.originalName ?? item.relativePath}
                    className="mb-2 max-h-40 w-full rounded object-contain"
                  />
                ) : null}
                <p className="truncate text-xs text-white/70">{item.originalName ?? item.relativePath}</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-white/35">{item.relativePath}</p>
                <a
                  href={item.asset.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[11px] text-spirit-400 hover:underline"
                >
                  打开资源
                </a>
                {isKP ? (
                  <ModuleAssetActions
                    roomId={params.id}
                    moduleId={moduleRecord.id}
                    moduleAssetId={item.id}
                  />
                ) : null}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">正文预览</h2>
        {text.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">暂无正文。</p>
        ) : (
          <pre className="mt-4 max-h-[640px] overflow-auto whitespace-pre-wrap rounded-lg border border-white/10 bg-ink-900/60 px-4 py-3 font-sans text-xs leading-relaxed text-white/60">
            {text}
          </pre>
        )}
      </section>
    </main>
  );
}
