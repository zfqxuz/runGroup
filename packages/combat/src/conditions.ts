import {
  findCondition,
  makeCondition,
  parseConditions,
  type GameCondition
} from "@touhou/rules";
import type { CombatParticipantState } from "./types";

/** 战斗标记 -> 局内核心状态的映射。 */
const CORE_FLAGS: readonly { readonly type: string; readonly flag: keyof CombatParticipantState }[] = [
  { type: "MAJOR_WOUND", flag: "majorWound" },
  { type: "PRONE", flag: "prone" },
  { type: "UNCONSCIOUS", flag: "unconscious" },
  { type: "DYING", flag: "dying" },
  { type: "DEAD", flag: "dead" }
];

function coreConditionId(participantId: string, type: string): string {
  return "core:" + type.toLowerCase() + ":" + participantId;
}

/** 由战斗中的 COC7 状态标记派生的核心状态。 */
export function coreConditionsFromParticipant(participant: CombatParticipantState): GameCondition[] {
  const output: GameCondition[] = [];
  for (const entry of CORE_FLAGS) {
    if (participant[entry.flag] !== true) continue;
    output.push(
      makeCondition({
        id: coreConditionId(participant.id, entry.type),
        type: entry.type,
        unit: "NARRATIVE",
        note: "由 COC7 HP / CON 规则驱动",
        visibility: "PUBLIC",
        data: { participantId: participant.id }
      })
    );
  }
  return output;
}

/** 夺舍充能池在战斗里的状态表示。 */
export function possessConditionOf(participant: CombatParticipantState): GameCondition | null {
  const possessedBy = participant.possessedBy ?? null;
  if (possessedBy === null) return null;
  return makeCondition({
    id: "possess:" + participant.id,
    type: "POSSESS",
    sourceActorId: possessedBy,
    controllerId: possessedBy,
    unit: "CHARGE",
    remaining: Math.max(0, Math.floor(participant.possessCharges ?? 0)),
    visibility: "KP",
    data: { targetId: participant.id }
  });
}

/** 护甲在战斗里的状态表示；duration 为剩余轮次，0 表示直到耗尽 / 战斗结束。 */
export function armorConditionOf(participant: CombatParticipantState, round: number): GameCondition | null {
  const armor = Math.max(0, Math.floor(participant.armor ?? 0));
  if (armor <= 0) return null;
  const expiresAt = participant.armorExpiresAtRound ?? null;
  const remaining = expiresAt === null ? 0 : Math.max(0, expiresAt - round);
  return makeCondition({
    id: "armor:" + participant.id,
    type: "ARMOR",
    unit: "ROUND",
    remaining,
    visibility: "PUBLIC",
    data: { armor, maxArmor: Math.max(0, Math.floor(participant.maxArmor ?? 0)) }
  });
}

/**
 * 合并局内持久状态与战斗内派生状态。
 * 派生状态（核心标记 / 夺舍 / 护甲）优先于残留的持久副本，避免两边不一致。
 */
export function participantConditions(participant: CombatParticipantState, round: number): GameCondition[] {
  const derivedTypes = new Set(["MAJOR_WOUND", "PRONE", "UNCONSCIOUS", "DYING", "DEAD", "POSSESS", "ARMOR"]);
  const base = (participant.conditions ?? []).filter((condition) => derivedTypes.has(condition.type) === false);
  return [
    ...base,
    ...coreConditionsFromParticipant(participant),
    ...(possessConditionOf(participant) === null ? [] : [possessConditionOf(participant)!]),
    ...(armorConditionOf(participant, round) === null ? [] : [armorConditionOf(participant, round)!])
  ];
}

/**
 * 战斗结束后写回局内的状态：只保留应持久化的部分。
 * - 核心状态保留；
 * - POSSESS 若仍有充能则保留，否则丢弃；
 * - ARMOR 作为战斗临时护甲不写回局内（局内护甲由角色卡 / 预施法字段表达）；
 * - 眩晕 / 控制 / DOT 这类战斗临时状态不写回。
 */
export function persistableConditions(participant: CombatParticipantState, round = 1): GameCondition[] {
  const core = coreConditionsFromParticipant(participant);
  const keepTypes = new Set(["POISON", "DISEASE", "CURSE", "INSANITY", "HALLUCINATION", "DOT", "BOUND", "SILENCE"]);
  const custom = (participant.conditions ?? []).filter(
    (condition) =>
      keepTypes.has(condition.type) ||
      condition.type.startsWith("STATUS:") ||
      condition.type === "ARMOR"
  );
  const possess = possessConditionOf(participant);
  const armor = armorConditionOf(participant, round);
  // 护甲由战斗内护甲池重新派生，避免保留过期副本。
  const withoutArmor = custom.filter((condition) => condition.type !== "ARMOR");
  return [...core, ...withoutArmor, ...(possess === null ? [] : [possess]), ...(armor === null ? [] : [armor])];
}

/** 从局内状态里提取夺舍初值（持久状态 → 战斗运行时）。 */
export function possessInitFromConditions(conditions: readonly GameCondition[]): {
  readonly possessedBy: string | null;
  readonly possessCharges: number;
} {
  const possess = findCondition(conditions, "POSSESS");
  if (possess === null) return { possessedBy: null, possessCharges: 0 };
  const controller = possess.controllerId ?? possess.sourceActorId ?? null;
  return { possessedBy: controller, possessCharges: Math.max(0, Math.floor(possess.duration.remaining)) };
}

/** 载入局内状态到参战单位（用于开局 / 快照恢复）。 */
export function loadParticipantConditions(value: unknown): GameCondition[] {
  return parseConditions(value);
}

export function conditionByType(participant: CombatParticipantState, type: string): GameCondition | null {
  return findCondition(participant.conditions ?? [], type);
}
