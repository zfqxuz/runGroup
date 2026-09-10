import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { reviewCombatRequestAction } from "@/server/actions/combat";
import { auth } from "@/server/auth";
import { listSelectableUnits } from "@/server/combat/setup";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

interface SetupShape {
  readonly allies?: unknown;
}

export default async function CombatRequestPage({
  params,
  searchParams
}: {
  params: { id: string; requestId: string };
  searchParams?: { error?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) notFound();
  if ((membership.role === "KP") === false) notFound();
  const request = await prisma.combatRequest.findUnique({
    where: { id: params.requestId },
    include: {
      room: true,
      initiator: { select: { username: true, displayName: true } }
    }
  });
  if (request === null || request.roomId !== params.id) notFound();
  if (request.status !== "PENDING_REVIEW") redirect("/rooms/" + params.id);
  const selectable = await listSelectableUnits(params.id, session.user.id, "KP");
  const setup = (request.setup ?? {}) as SetupShape;
  const requestedRefs = Array.isArray(setup.allies) ? setup.allies.map((value) => String(value)) : [];
  const requestedUnits = selectable.filter((unit) => requestedRefs.includes(unit.ref));
  const enemyCandidates = selectable.filter((unit) => requestedRefs.includes(unit.ref) === false);
  const error = searchParams?.error;

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href={"/rooms/" + params.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回房间
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">战斗申请审批</h1>
        <p className="mt-1 text-sm text-white/50">
          {request.initiator.displayName ?? request.initiator.username} 申请发起战斗。
        </p>
      </header>

      {error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">申请方单位（{requestedUnits.length}）</h2>
        {requestedUnits.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">申请中没有可识别单位，可能已被删除。</p>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {requestedUnits.map((unit) => (
              <li key={unit.ref} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-sm text-white/75">
                {unit.name} · HP {unit.hp}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">选择敌方单位</h2>
        {enemyCandidates.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">没有可选的敌方单位，请先在房间中准备 NPC/Boss。</p>
        ) : (
          <form action={reviewCombatRequestAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="roomId" value={params.id} />
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="approve" value="1" />
            <div className="grid gap-2 sm:grid-cols-2">
              {enemyCandidates.map((unit) => (
                <label
                  key={unit.ref}
                  className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5"
                >
                  <span>
                    <span className="block text-sm text-white/75">{unit.name}</span>
                    <span className="mt-0.5 block text-[11px] text-white/35">
                      {unit.kind === "NPC" ? "NPC" : "PLAYER"} · HP {unit.hp}
                    </span>
                  </span>
                  <input type="checkbox" name="enemies" value={unit.ref} className="h-4 w-4 accent-red-400" />
                </label>
              ))}
            </div>
            <button
              type="submit"
              className="self-start rounded-lg bg-emerald-500 px-6 py-3 text-sm font-medium text-ink-900 transition hover:bg-emerald-400"
            >
              通过并开战
            </button>
          </form>
        )}
      </section>

      <form action={reviewCombatRequestAction}>
        <input type="hidden" name="roomId" value={params.id} />
        <input type="hidden" name="requestId" value={request.id} />
        <input type="hidden" name="approve" value="0" />
        <button
          type="submit"
          className="rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-300 transition hover:bg-red-400/10"
        >
          驳回申请
        </button>
      </form>
    </main>
  );
}
