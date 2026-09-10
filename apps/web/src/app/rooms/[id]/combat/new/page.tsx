import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { startCombatAction } from "@/server/actions/combat";
import { auth } from "@/server/auth";
import { listSelectableUnits } from "@/server/combat/setup";
import { prisma } from "@/server/db/prisma";
import { loadEffectivePack } from "@/server/rules/loader";

export const dynamic = "force-dynamic";

export default async function NewCombatPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams?: { error?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) notFound();
  const room = membership.room;
  const effective = await loadEffectivePack({
    id: room.id,
    system: room.system,
    rulePackVersionId: room.rulePackVersionId,
    ruleOverride: room.ruleOverride
  });
  const selectable = await listSelectableUnits(room.id, session.user.id, membership.role);
  const active = await prisma.combat.findFirst({
    where: { roomId: room.id, endedAt: null },
    select: { id: true }
  });
  const isKP = membership.role === "KP";
  const canRequest = isKP || room.allowPlayerCombatRequest;
  const error = searchParams?.error;

  const inputClass =
    "h-4 w-4 accent-sakura-500";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href={"/rooms/" + room.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回房间
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">发起战斗</h1>
        <p className="mt-1 text-sm text-white/50">
          {isKP ? "KP 可以直接开战，并指定双方单位。" : "选择你能操控的角色提交申请，等 KP 审批。"}
        </p>
      </header>

      {error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {active === null ? null : (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-sm text-amber-200">
          本房间已有进行中的战斗。
          <Link href={"/rooms/" + room.id + "/combat/" + active.id} className="ml-2 underline">
            进入战斗
          </Link>
        </p>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        {canRequest === false ? (
          <p className="text-sm text-white/50">本房已关闭玩家发起战斗申请的开关。</p>
        ) : selectable.length === 0 ? (
          <p className="text-sm text-white/50">
            {isKP ? "先准备至少一张 NPC 卡，或等待玩家带入角色。" : "你还没有通过审核的角色卡。"}
          </p>
        ) : (
          <form action={startCombatAction} className="flex flex-col gap-4">
            <input type="hidden" name="roomId" value={room.id} />
            <div className="grid gap-2">
              {selectable.map((unit) => (
                <div
                  key={unit.ref}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white/80">
                      {unit.name}
                      <span className="ml-2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/35">
                        {unit.kind === "NPC" ? "NPC" : "PLAYER"}
                      </span>
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-white/35">
                      {unit.subtitle === null ? "" : unit.subtitle + " · "}HP {unit.hp}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    <label className="flex items-center gap-1.5 text-xs text-white/60">
                      <input type="checkbox" name="allies" value={unit.ref} className={inputClass} />
                      我方
                    </label>
                    {isKP ? (
                      <label className="flex items-center gap-1.5 text-xs text-white/60">
                        <input type="checkbox" name="enemies" value={unit.ref} className={inputClass} />
                        敌方
                      </label>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            {isKP ? null : (
              <p className="text-[11px] text-white/35">提交后 KP 会在审批页选择敌方单位。</p>
            )}
            <button
              type="submit"
              disabled={active !== null}
              className="self-start rounded-lg bg-sakura-500 px-6 py-3 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isKP ? "直接开战" : "提交战斗申请"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
