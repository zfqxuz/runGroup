import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import CombatBoard from "@/components/room/CombatBoard";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export const dynamic = "force-dynamic";

export default async function CombatPage({
  params
}: {
  params: { id: string; combatId: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");
  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    select: { role: true }
  });
  if (membership === null) notFound();
  const combat = await prisma.combat.findUnique({
    where: { id: params.combatId },
    select: { roomId: true }
  });
  if (combat === null || combat.roomId !== params.id) notFound();
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header>
        <Link href={"/rooms/" + params.id} className="text-xs text-white/40 transition hover:text-white/70">
          ← 返回房间
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">战斗</h1>
        <p className="mt-1 text-sm text-white/50">
          全局计数器推进，动作结算与墙钟无关。
        </p>
      </header>
      <CombatBoard combatId={params.combatId} isKP={membership.role === "KP"} />
    </main>
  );
}
