import Link from "next/link";
import type { ReactNode } from "react";

interface ModulePublicCardProps {
  readonly module: {
    readonly id: string;
    readonly title: string;
    readonly author: string | null;
    readonly system: string | null;
    readonly era: string | null;
    readonly background: string | null;
    readonly synopsis: string | null;
    readonly occupationRecommendation: string | null;
    readonly owner?: { readonly username: string; readonly displayName: string | null } | null;
  };
  readonly actions?: ReactNode;
}

function textOrDash(value: string | null): string {
  return value === null || value.trim().length === 0 ? "未填写" : value;
}

export default function ModulePublicCard(props: ModulePublicCardProps) {
  const author = props.module.owner?.displayName ?? props.module.owner?.username ?? props.module.author ?? "未署名";
  return (
    <article className="flex flex-col gap-3 rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-base font-medium text-white/90">{props.module.title}</h2>
          <p className="mt-1 text-[11px] text-white/40">
            {author} · v1.0.0
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-[10px] text-spirit-300">
            {props.module.system ?? "未指定系统"}
          </span>
          <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/50">
            {props.module.era ?? "未指定年代"}
          </span>
        </div>
      </div>

      <dl className="grid gap-2 text-xs">
        <div>
          <dt className="text-[10px] text-white/35">背景</dt>
          <dd className="mt-0.5 whitespace-pre-wrap leading-relaxed text-white/60">{textOrDash(props.module.background)}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-white/35">简介</dt>
          <dd className="mt-0.5 whitespace-pre-wrap leading-relaxed text-white/70">{textOrDash(props.module.synopsis)}</dd>
        </div>
        <div>
          <dt className="text-[10px] text-white/35">职业推荐</dt>
          <dd className="mt-0.5 whitespace-pre-wrap leading-relaxed text-white/60">
            {textOrDash(props.module.occupationRecommendation)}
          </dd>
        </div>
      </dl>

      {props.actions === undefined ? null : <div className="mt-auto flex flex-wrap gap-2 pt-1">{props.actions}</div>}
    </article>
  );
}

export function ModulePreviewLink(props: { readonly moduleId: string }): JSX.Element {
  return (
    <Link
      href={"/modules/" + props.moduleId}
      className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/55 transition hover:border-white/35 hover:text-white"
    >
      公开预览
    </Link>
  );
}
