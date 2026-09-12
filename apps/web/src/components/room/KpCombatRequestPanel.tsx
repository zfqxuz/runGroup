import Link from "next/link";
import { prisma } from "@/server/db/prisma";

interface Props {
  readonly roomId: string;
}

/** KP 准备区：待审批的玩家战斗申请。 */
export default async function KpCombatRequestPanel(props: Props) {
  const pending = await prisma.combatRequest.findMany({
    where: { roomId: props.roomId, status: "PENDING_REVIEW" },
    include: { initiator: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "asc" }
  });
  if (pending.length === 0) return null;

  return (
    <section className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
      <h2 className="text-sm font-medium text-amber-200">待审批战斗申请（{pending.length}）</h2>
      <ul className="mt-2 space-y-1.5">
        {pending.map((request) => (
          <li key={request.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-xs text-white/70">
              {request.initiator.displayName ?? request.initiator.username}
            </span>
            <Link
              href={"/rooms/" + props.roomId + "/combat/requests/" + request.id}
              className="shrink-0 rounded border border-amber-400/40 px-2 py-1 text-[11px] text-amber-300 transition hover:bg-amber-400/10"
            >
              处理
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
