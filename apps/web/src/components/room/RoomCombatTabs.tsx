"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface RoomCombatTab {
  readonly id: string;
  readonly sceneName: string | null;
  readonly round: number;
  readonly participantCount: number;
}

interface Props {
  readonly roomId: string;
  readonly combats: readonly RoomCombatTab[];
  /** 是否允许从房间页再发起 / 申请一场新战斗。 */
  readonly canCreate: boolean;
  readonly isKP: boolean;
}

/** 同房间多场战斗：每场一个独立 tab，可分别进入。 */
export default function RoomCombatTabs(props: Props) {
  const pathname = usePathname() ?? "";
  if (props.combats.length === 0 && props.canCreate === false) return null;

  const createHref = "/rooms/" + props.roomId + "/combat/new";
  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-white/80">战斗</h2>
          <span className="text-[11px] text-white/35">
            {props.combats.length === 0 ? "当前没有进行中的战斗" : "本房有 " + props.combats.length + " 场进行中的战斗"}
          </span>
        </div>
        {props.canCreate ? (
          <Link
            href={createHref}
            className="rounded-lg border border-sakura-500/50 bg-sakura-500/10 px-3 py-1.5 text-xs text-sakura-200 transition hover:bg-sakura-500/20"
          >
            {props.isKP ? "＋ 发起新战斗" : "＋ 申请新战斗"}
          </Link>
        ) : null}
      </div>
      {props.combats.length === 0 ? null : (
        <div className="mt-3 flex flex-wrap gap-2">
          {props.combats.map((combat, index) => {
            const href = "/rooms/" + props.roomId + "/combat/" + combat.id;
            const active = pathname.startsWith(href);
            return (
              <Link
                key={combat.id}
                href={href}
                className={
                  "flex min-w-[150px] flex-col rounded-lg border px-3 py-2 transition " +
                  (active
                    ? "border-emerald-400/60 bg-emerald-400/10"
                    : "border-white/15 bg-ink-900/60 hover:border-white/35")
                }
              >
                <span className={active ? "text-xs font-medium text-emerald-200" : "text-xs font-medium text-white/75"}>
                  {combat.sceneName ?? "战斗 " + String(index + 1)}
                </span>
                <span className="mt-0.5 text-[10px] text-white/40">
                  第 {combat.round} 轮 · {combat.participantCount} 人参战
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}
