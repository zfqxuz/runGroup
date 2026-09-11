import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { builtinRegistry, resolveRulePack } from "@touhou/rules";
import RoomNpcPanel from "@/components/room/RoomNpcPanel";
import RoomConfigPanel from "@/components/room/RoomConfigPanel";
import { selectRoomModuleAction, setActiveCharacterAction, startRoomAction, toggleReadyAction } from "@/server/actions/room";
import { reviewCardEntries, reviewEntry, withdrawEntry } from "@/server/actions/room-entry";
import { auth } from "@/server/auth";
import { loadGameModuleView } from "@/server/modules/revision";
import { prisma } from "@/server/db/prisma";
import { advancementView } from "@/server/game/view";
import { RARITY_LABELS, cardRarityBorderClass } from "@/shared/card";
import type { ChatChannel, ChatKind, ChatMessage, RoomMemberView } from "@/shared/socket";

export const dynamic = "force-dynamic";

interface StoredContent {
  text?: string;
  kind?: string;
  dice?: ChatMessage["dice"];
}

const ADVANCEMENT_KIND_LABELS: Record<string, string> = {
  ATTRIBUTE: "属性",
  SKILL: "技能",
  SAN: "SAN",
  ITEM: "物品",
  RELATIONSHIP: "关系",
  OTHER: "其他"
};

export default async function RoomPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; module?: string } }) {
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


  if (room.status !== "LOBBY" && room.status !== "PAUSED") redirect("/rooms/" + room.id);
  // 房间绑定的规则包（暂用内置包；未来接 RulePackVersion 表）
  const pack = resolveRulePack(
    room.system === "TOUHOU" ? "touhou-ext" : "coc7-baseline",
    builtinRegistry()
  );
  const method =
    pack.attributes.methods.find((item) => item.id === room.chargenMethod) ??
    pack.attributes.methods[0];
  const raceCount = Object.keys(pack.races).length;

  const roomModules = await prisma.module.findMany({
    where: {
      OR: [{ roomId: room.id }, { isPublished: true }]
    },
    orderBy: { id: "asc" },
    select: {
      id: true,
      title: true,
      author: true,
      synopsis: true,
      background: true,
      occupationRecommendation: true,
      version: true,
      sourceType: true,
      system: true,
      era: true,
      roomId: true,
      isPublished: true,
      owner: { select: { username: true, displayName: true } }
    }
  });
  const activeGame = await prisma.game.findFirst({
    where: { roomId: room.id, status: { in: ["PREPARING", "PLAYING", "PAUSED", "COMBAT"] } },
    orderBy: { createdAt: "desc" },
    select: { id: true, moduleId: true, moduleRevisionId: true, title: true, status: true }
  });
  const resuming = activeGame?.status === "PAUSED";
  const activeGameModule = resuming && activeGame !== null ? await loadGameModuleView(activeGame) : null;
  const activeModule = activeGame?.moduleId === null || activeGame?.moduleId === undefined
    ? null
    : roomModules.find((item) => item.id === activeGame.moduleId) ?? null;
  const selectedModule = resuming
    ? activeModule
    : roomModules.find((item) => item.id === room.selectedModuleId) ?? roomModules[0] ?? null;
  const defaultModule = selectedModule ?? activeModule ?? roomModules[0] ?? null;
  const requiredMembers = room.members.filter((member) => member.role !== "SPECTATOR");
  const readyCount = requiredMembers.filter((member) => member.ready).length;
  const allReady = requiredMembers.length > 0 && readyCount === requiredMembers.length;

  const rows = await prisma.message.findMany({
    where: {
      roomId: room.id,
      ...(isKP ? {} : { channel: { not: "KP_ONLY" as const } }),
      OR: [
        { channel: { not: "WHISPER" as const } },
        { userId: session.user.id },
        { targetId: session.user.id }
      ]
    },
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
        targetId: row.targetId,
        createdAt: row.createdAt.toISOString()
      };
    });
  void initialMessages;

  const characterEntries = await prisma.roomCharacterEntry.findMany({
    where: { roomId: room.id },
    include: {
      character: {
        include: {
          user: { select: { username: true, displayName: true } },
          advancements: {
            orderBy: { createdAt: "desc" },
            take: 5,
            include: { game: { select: { title: true } } }
          }
        }
      }
    },
    orderBy: { submittedAt: "desc" }
  });

  const playerUserIds = room.members
    .filter((member) => member.role === "PLAYER")
    .map((member) => member.userId);
  const approvedCharacterUserIds = new Set(
    characterEntries
      .filter((entry) => entry.status === "APPROVED")
      .map((entry) => entry.character.userId)
  );
  const allPlayersHaveApprovedCharacter = playerUserIds.every((userId) =>
    approvedCharacterUserIds.has(userId)
  );
  const myApprovedCharacters = characterEntries.filter(
    (entry) => entry.character.userId === session.user.id && entry.status === "APPROVED"
  );
  const activeCharacter = myApprovedCharacters.find(
    (entry) => entry.characterId === membership.activeCharacterId
  );
  const activeAdvancements = activeCharacter === undefined
    ? []
    : activeCharacter.character.advancements.map((item) =>
        advancementView({ ...item, character: { name: activeCharacter.character.name } })
      );
  const canStart = allReady && allPlayersHaveApprovedCharacter;

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
        era={room.era}
        chargenMethod={room.chargenMethod}
        rulePackVersionId={room.rulePackVersionId}
        ruleOverride={room.ruleOverride}
        status={room.status}
        inviteCode={room.inviteCode}
        allowPlayerCombatRequest={room.allowPlayerCombatRequest}
      />

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">准备状态</h2>
            <p className="mt-1 text-[11px] text-white/35">
              {readyCount}/{requiredMembers.length} 名 KP/PL 已准备；全部准备后 KP 才能开始跑团。
            </p>
          </div>
          <form action={toggleReadyAction}>
            <input type="hidden" name="roomId" value={room.id} />
            <button
              type="submit"
              className={
                membership.ready
                  ? "rounded-lg border border-white/15 px-4 py-2 text-sm text-white/60 transition hover:border-white/35"
                  : "rounded-lg bg-sakura-500 px-4 py-2 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
              }
            >
              {membership.ready ? "取消准备" : "我准备好了"}
            </button>
          </form>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {room.members.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-xs text-white/70">
                  {member.user.displayName ?? member.user.username}
                  {member.userId === session.user.id ? "（我）" : ""}
                </p>
                <p className="mt-0.5 text-[10px] text-white/35">{member.role}</p>
              </div>
              <span
                className={
                  member.ready
                    ? "shrink-0 rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300"
                    : "shrink-0 rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300"
                }
              >
                {member.ready ? "已准备" : "未准备"}
              </span>
            </div>
          ))}
        </div>
        {searchParams.error === "ready" ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
            还有成员未准备，确认所有人准备好后再开始。
          </p>
        ) : null}
        {allPlayersHaveApprovedCharacter === false ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
            每名 PL 至少需要一张审核通过的角色卡才能开始。
          </p>
        ) : null}
        {searchParams.error === "character" ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
            存在没有通过角色审核的 PL，暂时不能开始。
          </p>
        ) : null}
        {searchParams.error === "game" ? (
          <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-200">
            当前没有可继续的局。
          </p>
        ) : null}
        {resuming ? (
          <p className="mt-3 rounded-lg border border-spirit-400/30 bg-spirit-400/10 px-3 py-2 text-[11px] text-spirit-200">
            当前有一个暂停中的局。全员准备后，KP 点击“继续跑团”读取上次进度。
          </p>
        ) : null}
      </section>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">剧本 / 模组</h2>
            <p className="mt-1 text-[11px] text-white/35">
              公开字段全员可见；完整正文仅 KP 在团本管理中查看。开始新局前请先选择本局团本。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/45">
              {roomModules.length} 个可选团本
            </span>
            <Link
              href={"/rooms/" + room.id + "/modules"}
              className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-400 transition hover:bg-spirit-400/10"
            >
              团本管理 / 新建
            </Link>
          </div>
        </div>

        {selectedModule === null ? (
          <div className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3">
            <p className="text-xs text-amber-200">本房间还没有选择团本。</p>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-200/70">
              可以前往团本管理导入 / 创建房间团本，也可以从团本广场选择已发布团本。
            </p>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-white/10 bg-ink-900/60 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm text-white/85">{selectedModule.title}</p>
                <p className="mt-1 text-[11px] text-white/40">
                  {selectedModule.owner?.displayName ?? selectedModule.owner?.username ?? selectedModule.author ?? "未署名"}
                  {" · "}v{selectedModule.version}
                  {selectedModule.roomId === room.id ? " · 房间团本" : selectedModule.isPublished ? " · 广场团本" : ""}
                </p>
              </div>
              <div className="flex gap-1">
                <span className="rounded-full border border-spirit-400/30 px-2 py-0.5 text-[10px] text-spirit-300">
                  {selectedModule.system ?? "未指定系统"}
                </span>
                <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/50">
                  {selectedModule.era ?? "未指定年代"}
                </span>
              </div>
            </div>
            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
              <div>
                <p className="text-[10px] text-white/35">背景</p>
                <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-white/60">
                  {selectedModule.background ?? "未填写"}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-white/35">职业推荐</p>
                <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-white/60">
                  {selectedModule.occupationRecommendation ?? "未填写"}
                </p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-[10px] text-white/35">简介</p>
                <p className="mt-0.5 whitespace-pre-wrap leading-relaxed text-white/70">
                  {selectedModule.synopsis ?? "未填写"}
                </p>
              </div>
            </div>
          </div>
        )}

        {isKP ? (
          <form action={selectRoomModuleAction} className="mt-4 flex flex-wrap items-end gap-3 border-t border-white/10 pt-4">
            <input type="hidden" name="roomId" value={room.id} />
            <label className="flex min-w-[260px] flex-1 flex-col gap-1.5">
              <span className="text-xs text-white/50">选择本局团本</span>
              <select
                name="moduleId"
                defaultValue={selectedModule?.id ?? ""}
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              >
                <option value="">不选择团本（使用房间名）</option>
                {roomModules.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.roomId === room.id ? "[本房] " : "[广场] "}
                    {item.title} · v{item.version}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="rounded-lg border border-spirit-400/40 px-4 py-2 text-sm text-spirit-300 transition hover:bg-spirit-400/10"
            >
              保存团本选择
            </button>
          </form>
        ) : null}

        {activeGameModule === null ? null : (
          <p className="mt-3 rounded-lg border border-spirit-400/30 bg-spirit-400/10 px-3 py-2 text-[11px] text-spirit-200">
            本局已锁定开局快照 v{activeGameModule.version}（共 {activeGameModule.assets.length} 个资源）。暂停期间修改或替换团本，不会影响本局内容；新选择只会用于下一局。
          </p>
        )}

        {searchParams.module === "selected" ? (
          <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">
            团本选择已保存，全员可见。
          </p>
        ) : null}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">当前角色</h2>
            <p className="mt-1 text-[11px] text-white/35">
              选择本局使用的角色。只能选择你已经通过审核的角色卡。
            </p>
          </div>
          {activeCharacter === undefined ? (
            <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">未选择</span>
          ) : (
            <span className="rounded-full border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-300">
              {activeCharacter.character.name}
            </span>
          )}
        </div>
        <form action={setActiveCharacterAction} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="roomId" value={room.id} />
          <label className="flex min-w-[240px] flex-1 flex-col gap-1.5">
            <span className="text-xs text-white/50">选择角色</span>
            <select
              name="characterId"
              defaultValue={membership.activeCharacterId ?? ""}
              className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
            >
              <option value="">（不选择）</option>
              {myApprovedCharacters.map((entry) => (
                <option key={entry.id} value={entry.characterId}>
                  {entry.character.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-spirit-400/40 px-4 py-2 text-sm text-spirit-400 transition hover:bg-spirit-400/10"
          >
            保存当前角色
          </button>
        </form>
        {myApprovedCharacters.length === 0 ? (
          <p className="mt-3 text-[11px] text-white/35">
            还没有通过审核的角色卡。先车卡并等待 KP 审核。
          </p>
        ) : null}
        {activeAdvancements.length === 0 ? null : (
          <div className="mt-4 rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2.5">
            <p className="text-[11px] font-medium text-white/55">当前角色最近成长</p>
            <ul className="mt-2 space-y-1.5">
              {activeAdvancements.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-white/65">{ADVANCEMENT_KIND_LABELS[item.kind] ?? item.kind}</span>
                  {item.target === null ? null : (
                    <span className="rounded border border-spirit-400/25 px-1.5 py-0.5 font-mono text-[10px] text-spirit-200">
                      {item.target}
                    </span>
                  )}
                  {item.delta === null ? null : (
                    <span className="font-mono text-sakura-300">{item.delta > 0 ? "+" + item.delta : item.delta}</span>
                  )}
                  {item.note === null || item.note.length === 0 ? null : (
                    <span className="text-white/40">{item.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

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
        <form action={reviewCardEntries}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-white/80">
              带入的卡牌（{cardEntries.length}）
              {pendingCardCount > 0 ? (
                <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">待审 {pendingCardCount}</span>
              ) : null}
            </h2>
            {isKP && pendingCardCount > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  name="comment"
                  placeholder="批量驳回理由（可选）"
                  className="w-40 rounded-md border border-white/15 bg-ink-900 px-2 py-1 text-[11px] text-white/70 outline-none focus:border-sakura-500"
                />
                <button
                  type="submit"
                  name="decision"
                  value="APPROVE"
                  className="rounded-md border border-emerald-400/40 px-3 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-400/10"
                >
                  批量通过
                </button>
                <button
                  type="submit"
                  name="decision"
                  value="REJECT"
                  className="rounded-md border border-red-400/40 px-3 py-1 text-[11px] text-red-300 transition hover:bg-red-400/10"
                >
                  批量驳回
                </button>
              </div>
            ) : null}
          </div>
          {cardEntries.length === 0 ? (
            <p className="mt-3 text-xs text-white/35">还没有人带卡牌进来</p>
          ) : (
            <div className="mt-4">
              <p className="text-[11px] text-white/35">KP 可勾选多张待审卡牌后一次性处理</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {cardEntries.map((entry) => (
                  <div key={entry.id} className={"rounded-lg border-2 bg-ink-900/60 px-3 py-2.5 " + cardRarityBorderClass(entry.card.rarity)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        {entry.status === "PENDING_REVIEW" && isKP ? (
                          <input
                            type="checkbox"
                            name="entryIds"
                            value={entry.id}
                            className="h-4 w-4 shrink-0 accent-sakura-500"
                          />
                        ) : null}
                        <p className="truncate text-sm text-white/80">{entry.card.name}</p>
                      </div>
                      <span className="shrink-0 rounded border border-spirit-400/30 px-1.5 py-0.5 text-[10px] text-spirit-400">
                        {entry.card.type} · {RARITY_LABELS[entry.card.rarity]}
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
                        <span className="text-[10px] text-white/25">勾选后批量处理</span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      </section>


      <RoomNpcPanel roomId={room.id} isKP={isKP} />

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-white/80">开始跑团</h2>
            <p className="mt-1 text-[11px] text-white/35">
              需要所有 KP/PL 已准备，且每名 PL 至少有一张审核通过的角色卡，KP 才能{resuming ? "继续" : "开始"}。
            </p>
          </div>
          {isKP ? (
            <form action={startRoomAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="roomId" value={room.id} />
              <div className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2 text-xs text-white/60">
                {resuming
                  ? "本局团本：" + (activeModule?.title ?? "未绑定")
                  : "本局团本：" + (defaultModule?.title ?? "未选择（使用房间名）")}
              </div>
              <button
                type="submit"
                disabled={canStart === false}
                className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {(resuming ? "继续跑团" : "开始跑团")}（{readyCount}/{requiredMembers.length}）
              </button>
            </form>
          ) : (
            <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/50">
              {canStart ? "等待 KP 开始跑团" : "等待全员准备和角色审核"}
            </span>
          )}
        </div>
      </section>
    </main>
  );
}
