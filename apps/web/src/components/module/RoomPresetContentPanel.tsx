import Link from "next/link";
import ClueAdminControls from "@/components/room/ClueAdminControls";
import NpcEditForm from "@/components/room/NpcEditForm";
import RoomCardEditForm from "@/components/room/RoomCardEditForm";
import { prisma } from "@/server/db/prisma";

interface Props {
  readonly roomId: string;
  readonly moduleId: string;
}

function idsOf(instances: readonly { templateType: string; entityId: string }[], type: string): string[] {
  return instances.filter((instance) => instance.templateType === type).map((instance) => instance.entityId);
}

export default async function RoomPresetContentPanel({ roomId, moduleId }: Props) {
  const application = await prisma.roomPresetApplication.findFirst({
    where: { roomId, moduleId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    include: { instances: true }
  });
  const returnTo = "/rooms/" + roomId + "/modules/" + moduleId;
  if (application === null) {
    return (
      <section className="rounded-xl border border-dashed border-white/15 bg-ink-800/40 p-5">
        <h2 className="text-sm font-medium text-white/70">预设内容</h2>
        <p className="mt-2 text-xs leading-relaxed text-white/40">
          本团本还没有应用到当前房间。先回准备页点击「应用团本预设到房间」，NPC / 线索 / 场景才会生成并在这里编辑。
        </p>
      </section>
    );
  }

  const cardIds = idsOf(application.instances, "CARD");
  const clueIds = idsOf(application.instances, "CLUE");
  const sceneIds = idsOf(application.instances, "SCENE");
  const encounterIds = idsOf(application.instances, "ENCOUNTER");

  const [cards, clues, scenes, encounters, members] = await Promise.all([
    cardIds.length === 0
      ? Promise.resolve([])
      : prisma.card.findMany({ where: { id: { in: cardIds } }, orderBy: { createdAt: "asc" } }),
    clueIds.length === 0
      ? Promise.resolve([])
      : prisma.clue.findMany({ where: { id: { in: clueIds } }, orderBy: { createdAt: "asc" }, include: { shares: { select: { userId: true } } } }),
    sceneIds.length === 0
      ? Promise.resolve([])
      : prisma.scene.findMany({ where: { id: { in: sceneIds } }, orderBy: { orderIndex: "asc" }, select: { id: true, name: true, description: true, isActive: true } }),
    encounterIds.length === 0
      ? Promise.resolve([])
      : prisma.encounter.findMany({ where: { id: { in: encounterIds } }, orderBy: { orderIndex: "asc" }, select: { id: true, title: true, trigger: true } }),
    prisma.roomMember.findMany({
      where: { roomId, role: { not: "KP" } },
      include: { user: { select: { displayName: true, username: true } } },
      orderBy: { joinedAt: "asc" }
    })
  ]);

  const memberOptions = members.map((member) => ({
    userId: member.userId,
    displayName: member.user.displayName ?? member.user.username,
    role: member.role
  }));
  const npcs = cards.filter((card) => card.type === "NPC");
  const otherCards = cards.filter((card) => card.type !== "NPC");

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div>
        <h2 className="text-sm font-medium text-white/80">预设内容编辑（KP）</h2>
        <p className="mt-1 text-[11px] text-white/40">
          这些对象来自当前房间已应用的团本预设。编辑只影响本房间，不会修改团本模板。
        </p>
      </div>

      <div className="rounded-lg border border-white/10 bg-ink-900/40 p-4">
        <h3 className="text-xs font-medium text-white/70">NPC / Boss（{npcs.length}）</h3>
        {npcs.length === 0 ? (
          <p className="mt-2 text-xs text-white/35">本预设没有 NPC / Boss。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {npcs.map((card) => (
              <li key={card.id} className="rounded-lg border border-white/10 bg-ink-800/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-white/80">{card.name}</span>
                  <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">{card.rarity}</span>
                  {card.isPublic ? null : <span className="rounded border border-amber-400/40 px-1.5 py-0.5 text-[10px] text-amber-300">未公开</span>}
                </div>
                <NpcEditForm roomId={roomId} card={card} returnTo={returnTo} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-ink-900/40 p-4">
        <h3 className="text-xs font-medium text-white/70">线索（{clues.length}）</h3>
        {clues.length === 0 ? (
          <p className="mt-2 text-xs text-white/35">本预设没有线索。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {clues.map((clue) => (
              <li key={clue.id} className="rounded-lg border border-white/10 bg-ink-800/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-white/80">{clue.title}</span>
                  <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">{clue.isPublic ? "公开" : "KP 可见"}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-xs text-white/50">{clue.content}</p>
                <ClueAdminControls
                  roomId={roomId}
                  clue={{ id: clue.id, title: clue.title, content: clue.content, isPublic: clue.isPublic }}
                  members={memberOptions}
                  sharedUserIds={clue.shares.map((share) => share.userId)}
                  returnTo={returnTo}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-ink-900/40 p-4">
        <h3 className="text-xs font-medium text-white/70">物品 / 证物 / 线索卡（{otherCards.length}）</h3>
        {otherCards.length === 0 ? (
          <p className="mt-2 text-xs text-white/35">本预设没有物品卡。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {otherCards.map((card) => (
              <li key={card.id} className="rounded-lg border border-white/10 bg-ink-800/60 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-white/80">{card.name}</span>
                  <span className="rounded border border-white/15 px-1.5 py-0.5 text-[10px] text-white/40">{card.type} · {card.rarity}</span>
                </div>
                {card.description === null ? null : <p className="mt-1 text-xs text-white/45">{card.description}</p>}
                <RoomCardEditForm card={card} returnTo={returnTo} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-ink-900/40 p-4">
        <h3 className="text-xs font-medium text-white/70">场景 / 地图（{scenes.length}）</h3>
        {scenes.length === 0 ? (
          <p className="mt-2 text-xs text-white/35">本预设没有场景。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {scenes.map((scene) => (
              <li key={scene.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-ink-800/60 px-3 py-2">
                <span className="text-xs text-white/75">
                  {scene.name}
                  {scene.isActive ? <span className="ml-2 rounded border border-emerald-400/30 px-1.5 py-0.5 text-[10px] text-emerald-300">当前</span> : null}
                </span>
                <Link href={"/rooms/" + roomId + "/scenes"} className="rounded border border-spirit-400/40 px-2 py-1 text-[11px] text-spirit-300">
                  编辑场景 / 地图 / 图层 / Token
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-ink-900/40 p-4">
        <h3 className="text-xs font-medium text-white/70">遭遇（{encounters.length}）</h3>
        {encounters.length === 0 ? (
          <p className="mt-2 text-xs text-white/35">本预设没有遭遇。</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {encounters.map((encounter) => (
              <li key={encounter.id} className="rounded border border-white/10 bg-ink-800/60 px-3 py-2 text-xs text-white/70">
                {encounter.title}
                {encounter.trigger === null ? null : <span className="ml-2 text-white/35">{encounter.trigger}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
