import Link from "next/link";
import { prisma } from "@/server/db/prisma";

interface Props {
  readonly roomId: string;
  readonly isKP: boolean;
  readonly allowPlayerCombatRequest: boolean;
}

export default async function RoomCombatPanel(props: Props) {
  const [active, pending] = await Promise.all([
    prisma.combat.findFirst({
      where: { roomId: props.roomId, endedAt: null },
      select: { id: true }
    }),
    props.isKP
      ? prisma.combatRequest.findMany({
          where: { roomId: props.roomId, status: "PENDING_REVIEW" },
          include: { initiator: { select: { username: true, displayName: true } } },
          orderBy: { createdAt: "asc" }
        })
      : Promise.resolve([])
  ]);
  const canStart = active === null && (props.isKP || props.allowPlayerCombatRequest);

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white/80">战斗</h2>
          <p className="mt-0.5 text-[11px] text-white/35">
            {active === null
              ? props.isKP
                ? "你可以直接发起战斗" 
                : props.allowPlayerCombatRequest
                  ? "你可以提交战斗申请，由 KP 审批" 
                  : "本房当前不允许玩家发起战斗申请"
              : "本房已有进行中的战斗"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {active === null ? (
            canStart ? (
              <Link
                href={"/rooms/" + props.roomId + "/combat/new"}
                className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
              >
                {props.isKP ? "发起战斗" : "申请战斗"}
              </Link>
            ) : null
          ) : (
            <Link
              href={"/rooms/" + props.roomId + "/combat/" + active.id}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-emerald-400"
            >
              进入战斗页面
            </Link>
          )}
        </div>
      </div>
      {pending.length === 0 ? null : (
        <ul className="mt-3 flex flex-col divide-y divide-white/5">
          {pending.map((request) => (
            <li key={request.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <span className="text-xs text-white/60">
                待审批：{request.initiator.displayName ?? request.initiator.username}
              </span>
              <Link
                href={"/rooms/" + props.roomId + "/combat/requests/" + request.id}
                className="rounded-md border border-amber-400/40 px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-400/10"
              >
                审批
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
