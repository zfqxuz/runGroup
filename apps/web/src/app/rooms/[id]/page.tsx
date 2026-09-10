import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import CombatBoard from "@/components/room/CombatBoard";
import RoomCombatPanel from "@/components/room/RoomCombatPanel";
import RoomConfigPanel from "@/components/room/RoomConfigPanel";
import RoomPlay from "@/components/room/RoomPlay";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import type { ChatChannel, ChatKind, ChatMessage, RoomMemberView } from "@/shared/socket";

export const dynamic = "force-dynamic";

interface StoredContent {
  text?: string;
  kind?: string;
  dice?: ChatMessage["dice"];
}

export default async function RoomPage({ params }: { params: { id: string } }) {
  const session = await auth();
  if (session === null) redirect("/login");

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: params.id, userId: session.user.id } },
    include: {
      room: {
        include: {
          members: {
            include: { user: { select: { username: true, displayName: true } } },
            orderBy: { joinedAt: "asc" }
          }
        }
      }
    }
  });
  if (membership === null) notFound();
  const room = membership.room;
  const isKP = membership.role === "KP";
  if (room.status === "LOBBY") redirect("/rooms/" + room.id + "/prepare");

  const rows = await prisma.message.findMany({
    where: isKP ? { roomId: room.id } : { roomId: room.id, channel: { not: "KP_ONLY" } },
    include: { user: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: "desc" },
    take: 50
  });

  const initialMessages: ChatMessage[] = rows
    .slice()
    .reverse()
    .map((row) => {
      const content = (row.content ?? {}) as StoredContent;
      return {
        id: row.id,
        userId: row.userId,
        username: row.user.username,
        displayName: row.user.displayName ?? row.user.username,
        channel: row.channel as ChatChannel,
        kind: (content.kind ?? row.type) as ChatKind,
        text: content.text ?? "",
        dice: content.dice ?? null,
        createdAt: row.createdAt.toISOString()
      };
    });

  const initialMembers: RoomMemberView[] = room.members.map((member) => ({
    userId: member.userId,
    username: member.user.username,
    displayName: member.user.displayName ?? member.user.username,
    role: member.role
  }));

  const activeCombat = await prisma.combat.findFirst({
    where: { roomId: room.id, endedAt: null },
    select: { id: true }
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回房间列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{room.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/50">
            <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-spirit-400">{room.system}</span>
            <span className="rounded-full border border-white/15 px-2 py-0.5">{room.status}</span>
            
          </p>
        </div>
        <span className="rounded-full border border-sakura-500/40 px-3 py-1 text-xs text-sakura-400">我的身份：{membership.role}</span>
      </header>

      <RoomConfigPanel
        roomId={room.id}
        system={room.system}
        chargenMethod={room.chargenMethod}
        rulePackVersionId={room.rulePackVersionId}
        ruleOverride={room.ruleOverride}
        status={room.status}
        inviteCode={room.inviteCode}
        allowPlayerCombatRequest={room.allowPlayerCombatRequest}
      />

      {activeCombat === null ? (
        <RoomCombatPanel
          roomId={room.id}
          isKP={isKP}
          allowPlayerCombatRequest={room.allowPlayerCombatRequest}
        />
      ) : (
        <section id="combat" className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-white/80">战斗进行中</h2>
            <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">
              {room.status}
            </span>
          </div>
          <CombatBoard combatId={activeCombat.id} isKP={isKP} />
        </section>
      )}

      <RoomPlay
        roomId={room.id}
        isKP={isKP}
        initialMembers={initialMembers}
        initialMessages={initialMessages}
      />
    </main>
  );
}
