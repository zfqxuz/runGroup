import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import ConfirmModuleDeleteButton from "@/components/module/ConfirmModuleDeleteButton";
import ModuleAssetActions from "@/components/module/ModuleAssetActions";
import ModuleEntityEditors from "@/components/module/ModuleEntityEditors";
import ModulePublicCard from "@/components/module/ModulePublicCard";
import ModuleMarkdown from "@/components/module/ModuleMarkdown";
import { saveModuleAction, setModulePublishedAction } from "@/server/actions/module";
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
  params: { moduleId: string };
  searchParams: { saved?: string; error?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const moduleRecord = await prisma.module.findUnique({
    where: { id: params.moduleId },
    include: {
      owner: { select: { username: true, displayName: true } },
      room: { select: { id: true, name: true } },
      assets: { include: { asset: true }, orderBy: { orderIndex: "asc" } }
    }
  });
  if (moduleRecord === null) notFound();

  const canEdit = moduleRecord.ownerId === session.user.id;
  let canViewFull = canEdit;
  if (canViewFull === false && moduleRecord.roomId !== null) {
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: moduleRecord.roomId, userId: session.user.id } },
      select: { role: true }
    });
    canViewFull = membership !== null && membership.role === "KP";
  }
  if (canViewFull === false && moduleRecord.isPublished === false) notFound();

  const content = (moduleRecord.content ?? {}) as ModuleContent;
  const text = content.text ?? "";
  const assetUrlByPath: Record<string, string> = {};
  for (const item of moduleRecord.assets) assetUrlByPath[item.relativePath] = item.asset.url;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href={canEdit ? "/modules/mine" : "/modules"} className="text-xs text-white/40 transition hover:text-white/70">
            ← {canEdit ? "返回我的团本" : "返回团本广场"}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{moduleRecord.title}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/45">
            <span>{moduleRecord.owner?.displayName ?? moduleRecord.owner?.username ?? moduleRecord.author ?? "未署名"}</span>
            <span>·</span>
            <span>{moduleRecord.system ?? "未指定系统"}</span>
            <span>·</span>
            <span>{moduleRecord.era ?? "未指定年代"}</span>
            <span>·</span>
            <span>v{moduleRecord.version}</span>
            {moduleRecord.isPublished ? (
              <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300">已发布</span>
            ) : (
              <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">未发布</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canEdit ? (
            <form action={setModulePublishedAction}>
              <input type="hidden" name="moduleId" value={moduleRecord.id} />
              <input type="hidden" name="published" value={moduleRecord.isPublished ? "0" : "1"} />
              <button
                type="submit"
                className={
                  moduleRecord.isPublished
                    ? "rounded-lg border border-amber-400/40 px-4 py-2 text-sm text-amber-300 transition hover:bg-amber-400/10"
                    : "rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
                }
              >
                {moduleRecord.isPublished ? "取消发布" : "发布到广场"}
              </button>
            </form>
          ) : null}
          {canEdit ? <ConfirmModuleDeleteButton moduleId={moduleRecord.id} label="删除团本" /> : null}
          {moduleRecord.isPublished ? (
            <Link
              href={"/rooms/new?moduleId=" + moduleRecord.id}
              className="rounded-lg border border-spirit-400/40 px-4 py-2 text-sm text-spirit-300 transition hover:bg-spirit-400/10"
            >
              用这个团本建房
            </Link>
          ) : null}
        </div>
      </header>


      {searchParams.saved === "1" ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">团本已保存。</p>
      ) : null}
      {searchParams.saved === "publish" ? (
        <p className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">发布状态已更新。</p>
      ) : null}
      {searchParams.error === "title" ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">标题不能为空。</p>
      ) : null}
      {searchParams.error === "active" ? (
        <p className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">该团本仍被进行中的局使用，不能删除。</p>
      ) : null}

      {canEdit ? (
        <form action={saveModuleAction} className="flex flex-col gap-5 rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <input type="hidden" name="moduleId" value={moduleRecord.id} />
          <h2 className="text-sm font-medium text-white/80">编辑团本</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">标题</span>
              <input name="title" defaultValue={moduleRecord.title} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">版本</span>
              <input name="version" defaultValue={moduleRecord.version} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">作者</span>
              <input name="author" defaultValue={moduleRecord.author ?? ""} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">规则系统</span>
              <select name="system" defaultValue={moduleRecord.system ?? "COC7"} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500">
                <option value="COC7">COC7</option>
                <option value="TOUHOU">TOUHOU</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">年代</span>
              <select name="era" defaultValue={moduleRecord.era ?? "MODERN"} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500">
                <option value="MODERN">现代</option>
                <option value="CLASSIC">1920 年代</option>
                <option value="FANTASY">幻想乡</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/50">简介</span>
              <input name="synopsis" defaultValue={moduleRecord.synopsis ?? ""} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
            </label>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">背景（广场公开）</span>
            <textarea name="background" rows={3} defaultValue={moduleRecord.background ?? ""} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">职业推荐（广场公开）</span>
            <textarea name="occupationRecommendation" rows={3} defaultValue={moduleRecord.occupationRecommendation ?? ""} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-white/50">Markdown 正文（仅 KP / 作者可见）</span>
            <textarea name="content" rows={22} defaultValue={text} className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-sakura-500" />
          </label>
          <div>
            <button type="submit" className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400">保存正文与元信息</button>
          </div>
        </form>
      ) : canViewFull ? (
        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">KP 可见正文</h2>
          <div className="mt-3">
            <ModuleMarkdown text={text} />
          </div>
        </section>
      ) : (
        <ModulePublicCard module={moduleRecord} />
      )}

      {canEdit ? (
        <ModuleEntityEditors
          moduleId={moduleRecord.id}
          content={moduleRecord.content}
          assets={assetUrlByPath}
          returnTo={"/modules/" + moduleRecord.id}
        />
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
                  <img src={item.asset.url} alt={item.originalName ?? item.relativePath} className="mb-2 max-h-40 w-full rounded object-contain" />
                ) : null}
                <p className="truncate text-xs text-white/70">{item.originalName ?? item.relativePath}</p>
                <p className="mt-0.5 truncate font-mono text-[10px] text-white/35">{item.relativePath}</p>
                <a href={item.asset.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] text-spirit-400 hover:underline">
                  打开资源
                </a>
                {canEdit ? <ModuleAssetActions moduleId={moduleRecord.id} moduleAssetId={item.id} /> : null}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
