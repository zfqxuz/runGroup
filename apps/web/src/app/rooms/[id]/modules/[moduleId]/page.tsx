import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ModuleActions from "@/components/module/ModuleActions";
import RoomPresetContentPanel from "@/components/module/RoomPresetContentPanel";
import ModuleAssetActions from "@/components/module/ModuleAssetActions";
import ModuleMarkdown from "@/components/module/ModuleMarkdown";
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

  const [moduleRecord, roomLink] = await Promise.all([
    prisma.module.findUnique({
      where: { id: params.moduleId },
      include: {
        assets: {
          include: { asset: true },
          orderBy: { orderIndex: "asc" }
        }
      }
    }),
    prisma.room.findUnique({ where: { id: params.id }, select: { selectedModuleId: true } })
  ]);
  if (moduleRecord === null) notFound();
  // 广场团本通过 Room.selectedModuleId 关联到房间；作者 / 已发布团本也允许房间成员查看。
  const linkedToRoom =
    moduleRecord.roomId === params.id ||
    moduleRecord.ownerId === session.user.id ||
    moduleRecord.isPublished ||
    roomLink?.selectedModuleId === moduleRecord.id;
  if (linkedToRoom === false) notFound();

  const isKP = membership.role === "KP";
  const canEdit = moduleRecord.ownerId === session.user.id;
  const canViewFull = canEdit || isKP;
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
          {canEdit ? <ModuleActions roomId={params.id} moduleId={moduleRecord.id} /> : null}
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
      {searchParams.error === "preset-active" ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          该团本已应用到某个房间的准备预设。请先在对应房间换预设或删除预设对象，再删除团本。
        </p>
      ) : null}
      {searchParams.error === "owner" ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          只有团本作者可以删除此团本。
        </p>
      ) : null}

      {canEdit ? (
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

      {isKP ? <RoomPresetContentPanel roomId={params.id} moduleId={moduleRecord.id} /> : null}

      {canViewFull ? (
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
                {canEdit ? (
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
      ) : (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">资源</h2>
          <p className="mt-3 text-xs text-white/35">地图、图片、手书与附件仅 KP / 团本作者可见。玩家只会看到公开元信息与 KP 主动分享的线索。</p>
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">公开信息</h2>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
          <div>
            <p className="text-[10px] text-white/35">背景</p>
            <p className="mt-0.5 whitespace-pre-wrap text-white/60">{moduleRecord.background ?? "未填写"}</p>
          </div>
          <div>
            <p className="text-[10px] text-white/35">职业推荐</p>
            <p className="mt-0.5 whitespace-pre-wrap text-white/60">{moduleRecord.occupationRecommendation ?? "未填写"}</p>
          </div>
          <div className="sm:col-span-2">
            <p className="text-[10px] text-white/35">简介</p>
            <p className="mt-0.5 whitespace-pre-wrap text-white/70">{moduleRecord.synopsis ?? "未填写"}</p>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">正文预览</h2>
        {canViewFull === false ? (
          <p className="mt-3 text-xs text-white/35">非公开正文仅 KP 与团本作者可见。</p>
        ) : (
          <div className="mt-4">
            <ModuleMarkdown text={text} />
          </div>
        )}
      </section>
    </main>
  );
}
