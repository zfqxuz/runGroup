import type { ActionSubmission, CombatParticipantState } from "@touhou/combat";
import type { CompiledRulePack } from "@touhou/rules";
import { prisma } from "@/server/db/prisma";
import { SpellCardStatsSchema } from "@/shared/card";
import type {
  CombatSpellCardOption,
  SpellCardClearTargets
} from "@/shared/danmaku/spellcards";

export interface SpellCardParticipantRef {
  readonly id: string;
  readonly characterId: string | null;
}

/**
 * 载入参战角色装备的符卡。
 *
 * 只在 TOUHOU 房间调用；COC7 或自定义规则包直接返回空 Map。
 * 符卡属于“个人库装备到角色”的卡，NPC 目前不参与。
 */
export async function loadSpellcardsByParticipant(
  system: string,
  participants: readonly SpellCardParticipantRef[]
): Promise<Map<string, readonly CombatSpellCardOption[]>> {
  const result = new Map<string, readonly CombatSpellCardOption[]>();
  if (system !== "TOUHOU") return result;

  const characterIds = participants
    .map((participant) => participant.characterId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (characterIds.length === 0) return result;

  const cards = await prisma.card.findMany({
    where: {
      characterId: { in: characterIds },
      type: "SPELLCARD",
      isEquipped: true,
      system: "TOUHOU"
    },
    select: { id: true, name: true, stats: true, characterId: true },
    orderBy: { createdAt: "asc" }
  });

  const byCharacter = new Map<string, CombatSpellCardOption[]>();
  for (const card of cards) {
    if (card.characterId === null) continue;
    const parsed = SpellCardStatsSchema.safeParse(card.stats);
    if (parsed.success === false) continue;
    const stats = parsed.data;
    const option: CombatSpellCardOption = {
      cardId: card.id,
      name: card.name,
      mode: stats.mode,
      mpCost: stats.mpCost,
      hpRatio: stats.hpRatio,
      durationTicks: stats.durationTicks,
      clearTargets: stats.clearTargets,
      enhanceType: stats.enhanceType,
      enhanceValue: stats.enhanceValue,
      pattern: stats.pattern ?? null
    };
    const list = byCharacter.get(card.characterId) ?? [];
    list.push(option);
    byCharacter.set(card.characterId, list);
  }

  for (const participant of participants) {
    if (participant.characterId === null) continue;
    const list = byCharacter.get(participant.characterId);
    if (list === undefined) continue;
    result.set(participant.id, list);
  }
  return result;
}

export type PrepareSpellCardResult =
  | { readonly ok: true; readonly action: ActionSubmission }
  | { readonly ok: false; readonly error: string };

/**
 * 服务端接管符卡数值计算：客户端只允许传 cardId。
 * 这样客户端无法伪造 declarationHp / mpCost / clearTargets。
 */
export function prepareSpellcardAction(
  pack: CompiledRulePack,
  actor: CombatParticipantState,
  cards: readonly CombatSpellCardOption[],
  action: ActionSubmission
): PrepareSpellCardResult {
  if (pack.system !== "TOUHOU" || pack.pack.spellcard === undefined) {
    return { ok: false, error: "只有東方拓展房间可以使用符卡" };
  }
  if (actor.defeated) {
    return { ok: false, error: "施法者已退场" };
  }
  const cardId = action.spellCardId;
  if (typeof cardId !== "string" || cardId.length === 0) {
    return { ok: false, error: "请选择要释放的符卡" };
  }
  const card = cards.find((item) => item.cardId === cardId);
  if (card === undefined) {
    return { ok: false, error: "该角色没有装备这张符卡" };
  }
  if (actor.mp < card.mpCost) {
    return { ok: false, error: "灵力不足，无法释放「" + card.name + "」" };
  }
  if (card.mode === "DECLARATION" && actor.declaration !== null) {
    return { ok: false, error: "该角色已有展开中的符卡" };
  }
  if (
    card.mode === "CONSUMPTION" &&
    pack.pack.spellcard.consumption.oncePerCombat === true &&
    (actor.usedSpellCards.includes(card.cardId) || actor.usedSpellCards.includes(card.name))
  ) {
    return { ok: false, error: "这张消费型符卡本场已经使用过" };
  }

  if (card.mode === "CONSUMPTION") {
    return {
      ok: true,
      action: {
        ...action,
        kind: "SPELLCARD",
        name: card.name,
        spellCardId: card.cardId,
        mpCost: card.mpCost,
        spellcardMode: "CONSUMPTION"
      }
    };
  }

  if (card.hpRatio === null || Number.isFinite(card.hpRatio) === false || card.hpRatio <= 0) {
    return { ok: false, error: "符卡数据不完整，缺少展开独立 HP" };
  }

  const clearTargets: SpellCardClearTargets | undefined =
    card.clearTargets === null ? undefined : card.clearTargets;

  return {
    ok: true,
    action: {
      ...action,
      kind: "SPELLCARD",
      name: card.name,
      spellCardId: card.cardId,
      mpCost: card.mpCost,
      spellcardMode: "DECLARATION",
      declarationHp: Math.max(1, Math.round(actor.maxHp * card.hpRatio)),
      declarationDurationTicks: card.durationTicks ?? undefined,
      declarationClearTargets: clearTargets
    }
  };
}
