import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import CombatUnitPicker from "@/components/room/CombatUnitPicker";
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
  searchParams?: { error?: string; opponentId?: string; opponentTokenId?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) notFound();
  const room = membership.room;
  if (room.status === "LOBBY") redirect("/rooms/" + room.id + "/prepare");
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
  // 战斗开始后统一进入独立战斗页面，不再停留在申请页。
  if (active !== null) redirect("/rooms/" + room.id + "/combat/" + active.id);
  const isKP = membership.role === "KP";
  const canRequest = isKP || room.allowPlayerCombatRequest;
  const error = searchParams?.error;
  const opponentId = searchParams?.opponentId ?? null;
  const opponent = opponentId === null
    ? null
    : await prisma.roomMember.findUnique({
        where: { roomId_userId: { roomId: room.id, userId: opponentId } },
        include: { user: { select: { username: true, displayName: true } }, activeCharacter: { select: { name: true } } }
      });
  const opponentTokenId = searchParams?.opponentTokenId ?? null;
  const opponentToken = opponentTokenId === null
    ? null
    : await prisma.token.findFirst({
        where: { id: opponentTokenId, roomId: room.id },
        include: {
          character: { select: { name: true } },
          card: { select: { name: true } }
        }
      });
  const opponentRef = opponentToken === null
    ? null
    : opponentToken.characterId !== null
      ? "character:" + opponentToken.characterId
      : opponentToken.cardId !== null
        ? "npc:" + opponentToken.cardId
        : null;
  const defaultAllyRefs = isKP ? [] : selectable.map((unit) => unit.ref);
  const defaultEnemyRefs = isKP && opponentRef !== null ? [opponentRef] : [];

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

      {opponent === null && opponentToken === null ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-200">
          发起战斗的 Token：
          {opponent === null
            ? opponentToken?.name ?? ""
            : (opponent.user.displayName ?? opponent.user.username) + (opponent.activeCharacter === null ? "" : "（" + opponent.activeCharacter.name + "）")}
          {isKP ? "。请确认敌方单位后直接开战。" : "。提交后 KP 会收到审批并选择敌方单位。"}
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
            {opponentTokenId === null ? null : <input type="hidden" name="opponentTokenId" value={opponentTokenId} />}
            <CombatUnitPicker
              units={selectable}
              isKP={isKP}
              defaultAllyRefs={defaultAllyRefs}
              defaultEnemyRefs={defaultEnemyRefs}
            />
            {isKP ? (
              <p className="text-[11px] text-white/35">同一个角色只能选一边；已选我方的单位不会再允许选敌方。</p>
            ) : (
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
