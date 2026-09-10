import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import RoomNpcPanel from "@/components/room/RoomNpcPanel";
import RoomConfigPanel from "@/components/room/RoomConfigPanel";
import { startRoomAction } from "@/server/actions/room";
import { reviewEntry, withdrawEntry } from "@/server/actions/room-entry";
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


  if (room.status !== "LOBBY") redirect("/rooms/" + room.id);
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
  void initialMessages;

  const characterEntries = await prisma.roomCharacterEntry.findMany({
    where: { roomId: room.id },
    include: {
      character: { include: { user: { select: { username: true, displayName: true } } } }
    },
    orderBy: { submittedAt: "desc" }
  });

  const cardEntries = await prisma.roomCardEntry.findMany({
    where: { roomId: room.id },
    include: {
      card: { include: { owner: { select: { username: true, displayName: true } } } }
    },
    orderBy: { submittedAt: "desc" }
  });

  // 待审的排最前，KP 一眼看到该处理什么
  const priority: Record<string, number> = { PENDING_REVIEW: 0, APPROVED: 1, REJECTED: 2 };
  characterEntries.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
  cardEntries.sort((a, b) => (priority[a.status] ?? 9) - (priority[b.status] ?? 9));
  const pendingCharacterCount = characterEntries.filter((e) => e.status === "PENDING_REVIEW").length;
  const pendingCardCount = cardEntries.filter((e) => e.status === "PENDING_REVIEW").length;

  const initialMembers: RoomMemberView[] = room.members.map((member) => ({
    userId: member.userId,
    username: member.user.username,
    displayName: member.user.displayName ?? member.user.username,
    role: member.role
  }));
  void initialMembers;

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
        <h2 className="flex items-center gap-2 text-sm font-medium text-white/80">角色卡（{characterEntries.length}）{pendingCharacterCount > 0 ? <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">待审 {pendingCharacterCount}</span> : null}</h2>
        {characterEntries.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有人带角色卡进来</p>
        ) : (
          <ul className="mt-4 flex flex-col divide-y divide-white/5">
            {characterEntries.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <Link
                  href={"/rooms/" + room.id + "/characters/" + entry.characterId}
                  className="min-w-0 flex-1"
                >
                  <p className="truncate text-sm text-white/80">
                    {entry.character.name}
                    {entry.character.race === null ? null : (
                      <span className="ml-2 text-[11px] text-sakura-400">{entry.character.race}</span>
                    )}
                  </p>
                  <p className="mt-0.5 text-[11px] text-white/35">
                    {entry.character.user.displayName ?? entry.character.user.username} · HP{" "}
                    {entry.character.maxHp} · SAN {entry.character.maxSan}
                  </p>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {entry.status === "PENDING_REVIEW" && isKP ? (
                    <>
                      <form action={reviewEntry}>
                        <input type="hidden" name="kind" value="CHARACTER" />
                        <input type="hidden" name="entryId" value={entry.id} />
                        <input type="hidden" name="approve" value="1" />
                        <button
                          type="submit"
                          className="rounded-md border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-400/10"
                        >
                          通过
                        </button>
                      </form>
                      <form action={reviewEntry}>
                        <input type="hidden" name="kind" value="CHARACTER" />
                        <input type="hidden" name="entryId" value={entry.id} />
                        <input type="hidden" name="approve" value="0" />
                        <input name="comment" placeholder="理由" className="w-20 rounded-md border border-white/15 bg-ink-900 px-1.5 py-1 text-[11px] text-white/70 outline-none focus:border-red-400/50" />
                        <button
                          type="submit"
                          className="rounded-md border border-red-400/40 px-2 py-1 text-[11px] text-red-300 transition hover:bg-red-400/10"
                        >
                          驳回
                        </button>
                      </form>
                    </>
                  ) : null}
                  {entry.character.userId === session.user.id ? (
                    <form action={withdrawEntry}>
                      <input type="hidden" name="kind" value="CHARACTER" />
                      <input type="hidden" name="entryId" value={entry.id} />
                      <button
                        type="submit"
                        className="rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/40 transition hover:border-white/35 hover:text-white/70"
                      >
                        撤回
                      </button>
                    </form>
                  ) : null}
                  <span
                    className={
                      entry.status === "APPROVED"
                        ? "rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300"
                        : entry.status === "REJECTED"
                          ? "rounded-full border border-red-400/40 px-2 py-0.5 text-[10px] text-red-300"
                          : "rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300"
                    }
                  >
                    {entry.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="flex items-center gap-2 text-sm font-medium text-white/80">带入的卡牌（{cardEntries.length}）{pendingCardCount > 0 ? <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">待审 {pendingCardCount}</span> : null}</h2>
        {cardEntries.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有人带卡牌进来</p>
        ) : (
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cardEntries.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm text-white/80">{entry.card.name}</p>
                  <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-400">
                    {entry.card.type}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-white/35">
                  {entry.card.owner?.displayName ?? entry.card.owner?.username ?? "未知"}
                </p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span
                    className={
                      entry.status === "APPROVED"
                        ? "text-[10px] text-emerald-300"
                        : entry.status === "REJECTED"
                          ? "text-[10px] text-red-300"
                          : "text-[10px] text-amber-300"
                    }
                  >
                    {entry.status}
                  </span>
                  {entry.status === "PENDING_REVIEW" && isKP ? (
                    <div className="flex gap-1">
                      <form action={reviewEntry}>
                        <input type="hidden" name="kind" value="CARD" />
                        <input type="hidden" name="entryId" value={entry.id} />
                        <input type="hidden" name="approve" value="1" />
                        <button type="submit" className="rounded border border-emerald-400/40 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          通过
                        </button>
                      </form>
                      <form action={reviewEntry}>
                        <input type="hidden" name="kind" value="CARD" />
                        <input type="hidden" name="entryId" value={entry.id} />
                        <input type="hidden" name="approve" value="0" />
                        <input name="comment" placeholder="理由" className="w-20 rounded-md border border-white/15 bg-ink-900 px-1.5 py-1 text-[11px] text-white/70 outline-none focus:border-red-400/50" />
                        <button type="submit" className="rounded border border-red-400/40 px-1.5 py-0.5 text-[10px] text-red-300">
                          驳回
                        </button>
                      </form>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <RoomNpcPanel roomId={room.id} isKP={isKP} />

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">准备完成</h2>
            <p className="mt-1 text-[11px] text-white/35">开始后进入房间页，可以发言、掷骰与进入战斗。</p>
          </div>
          {isKP ? (
            <form action={startRoomAction}>
              <input type="hidden" name="roomId" value={room.id} />
              <button
                type="submit"
                className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
              >
                开始跑团
              </button>
            </form>
          ) : (
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/50">等待 KP 开始跑团</span>
          )}
        </div>
      </section>
    </main>
  );
}
