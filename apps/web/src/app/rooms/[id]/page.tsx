import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
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

  // 房间绑定的规则包（暂用内置包；未来接 RulePackVersion 表）
  const pack = resolveRulePack(
    room.system === "TOUHOU" ? "touhou-ext" : "coc7-baseline",
    builtinRegistry()
  );
  const method =
    pack.attributes.methods.find((item) => item.id === room.chargenMethod) ??
    pack.attributes.methods[0];
  const raceCount = Object.keys(pack.races).length;

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

  const cards = await prisma.card.findMany({
    where: { roomId: room.id },
    orderBy: { createdAt: "desc" },
    take: 30
  });

  const initialMembers: RoomMemberView[] = room.members.map((member) => ({
    userId: member.userId,
    username: member.user.username,
    displayName: member.user.displayName ?? member.user.username,
    role: member.role
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回房间列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{room.name}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-white/50">
            <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-spirit-400">
              {room.system}
            </span>
            <span className="rounded-full border border-white/15 px-2 py-0.5">{room.status}</span>
            <span className="font-mono">邀请码 {room.inviteCode}</span>
            <span className="rounded-full border border-white/15 px-2 py-0.5">
              {method?.label ?? "未指定车卡方式"}
            </span>
          </p>
        </div>
        <span className="rounded-full border border-sakura-500/40 px-3 py-1 text-xs text-sakura-400">
          我的身份：{membership.role}
        </span>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-xs text-white/40">规则包</p>
          <p className="mt-1 font-mono text-sm text-white/80">{pack.id}@{pack.version}</p>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-xs text-white/40">可选种族</p>
          <p className="mt-1 text-sm text-white/80">
            {raceCount > 0 ? raceCount + " 个" : "无（纯 COC7）"}
          </p>
        </div>
        <div className="rounded-xl border border-white/10 bg-ink-800/50 p-4">
          <p className="text-xs text-white/40">技能表</p>
          <p className="mt-1 text-sm text-white/80">{pack.skills.length} 项</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-ink-800/50 px-5 py-4">
        <div>
          <p className="text-sm text-white/80">角色卡</p>
          <p className="mt-0.5 text-xs text-white/40">按本房规则创建你的调查员</p>
        </div>
        <div className="flex gap-2">
          <Link
            href={"/rooms/" + room.id + "/cards/new"}
            className="rounded-lg border border-sakura-500/40 px-4 py-2 text-sm text-sakura-400 transition hover:bg-sakura-500/10"
          >
            新建卡牌
          </Link>
          <Link
            href={"/rooms/" + room.id + "/characters/new"}
            className="rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
          >
            车一张新卡
          </Link>
        </div>
      </div>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">卡池（{cards.length}）</h2>
        {cards.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有卡牌，点右上角「新建卡牌」</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cards.map((card) => (
              <div key={card.id} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-white/80">{card.name}</p>
                  <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-400">
                    {card.type}
                  </span>
                </div>
                {card.subtitle === null ? null : (
                  <p className="mt-0.5 truncate text-[11px] text-white/35">{card.subtitle}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <RoomPlay
        roomId={room.id}
        isKP={isKP}
        initialMembers={initialMembers}
        initialMessages={initialMessages}
      />
    </main>
  );
}
