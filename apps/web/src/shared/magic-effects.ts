import type { MagicEffect } from "@touhou/rules";

export type MagicEffectFieldKind = "text" | "number";

export interface MagicEffectField {
  readonly key: string;
  readonly label: string;
  readonly kind: MagicEffectFieldKind;
  readonly placeholder?: string;
  readonly defaultValue: string;
  readonly required?: boolean;
}

export interface MagicEffectDefinition {
  readonly type: MagicEffect["type"];
  readonly label: string;
  readonly summary: string;
  readonly fields: readonly MagicEffectField[];
}

const AMOUNT: MagicEffectField = {
  key: "amount",
  label: "数值 / 骰式",
  kind: "text",
  placeholder: "例如 2d6+1 / 3",
  defaultValue: "1d6",
  required: true
};

const DURATION_ROUNDS: MagicEffectField = {
  key: "durationTicks",
  label: "持续行动轮次",
  kind: "number",
  placeholder: "0 = 耗尽 / 战斗结束",
  defaultValue: "0"
};

const DURATION_ACTIONS: MagicEffectField = {
  key: "durationActions",
  label: "持续行动次数",
  kind: "number",
  placeholder: "例如 1",
  defaultValue: "1",
  required: true
};

export const MAGIC_EFFECT_DEFINITIONS: readonly MagicEffectDefinition[] = [
  { type: "DAMAGE", label: "伤害", summary: "造成伤害，走伤害管线与护甲", fields: [AMOUNT] },
  { type: "HEAL", label: "治疗", summary: "恢复 HP", fields: [AMOUNT] },
  { type: "MP_RESTORE", label: "回 MP", summary: "恢复 MP", fields: [{ ...AMOUNT, defaultValue: "3" }] },
  { type: "MP_DRAIN", label: "吸 MP", summary: "扣除目标 MP，同量转移给施法者", fields: [{ ...AMOUNT, defaultValue: "3" }] },
  { type: "SAN_LOSS", label: "扣 SAN", summary: "扣除 SAN", fields: [{ ...AMOUNT, defaultValue: "1d4" }] },
  { type: "SAN_RESTORE", label: "回 SAN", summary: "恢复 SAN", fields: [{ ...AMOUNT, defaultValue: "3" }] },
  {
    type: "STATUS",
    label: "状态",
    summary: "施加规则包中定义的状态",
    fields: [
      { key: "key", label: "状态 key", kind: "text", placeholder: "例如 HASTE", defaultValue: "HASTE", required: true },
      { key: "stacks", label: "层数", kind: "number", placeholder: "例如 1", defaultValue: "1" }
    ]
  },
  {
    type: "ARMOR",
    label: "护甲",
    summary: "获得护甲池，1:1 吸收伤害，按行动轮次到期",
    fields: [AMOUNT, DURATION_ROUNDS]
  },
  {
    type: "SUMMON",
    label: "召唤",
    summary: "按独立 NPC 卡生成参战单位；无卡走通用兜底",
    fields: [
      { key: "name", label: "召唤物名字", kind: "text", placeholder: "例如 次元蹒跚者", defaultValue: "召唤物", required: true },
      { key: "key", label: "稳定 key（可选）", kind: "text", placeholder: "用于跨译名匹配", defaultValue: "" },
      { key: "cardId", label: "指定房间 NPC 卡 id（可选）", kind: "text", placeholder: "留空则按名字匹配", defaultValue: "" },
      { key: "count", label: "数量", kind: "number", placeholder: "例如 1", defaultValue: "1" },
      DURATION_ROUNDS
    ]
  },
  {
    type: "DOT",
    label: "持续伤害",
    summary: "目标每次行动开始时结算持续伤害",
    fields: [
      AMOUNT,
      { key: "durationTicks", label: "持续目标行动次数", kind: "number", placeholder: "例如 3", defaultValue: "3" },
      { key: "key", label: "可选分组 key", kind: "text", placeholder: "留空则按法术 id", defaultValue: "" }
    ]
  },
  { type: "STUN", label: "眩晕", summary: "强制跳过行动", fields: [DURATION_ACTIONS] },
  { type: "CONTROL", label: "控制", summary: "强制跳过行动", fields: [DURATION_ACTIONS] },
  {
    type: "CLEANSE",
    label: "净化",
    summary: "清除状态 / 持续伤害 / 控制；keys 为空时清默认项",
    fields: [
      { key: "keys", label: "要清除的 key（逗号分隔）", kind: "text", placeholder: "留空 = DOT + STUN + CONTROL", defaultValue: "" }
    ]
  }
];

export function magicEffectDefinition(type: string): MagicEffectDefinition | null {
  return MAGIC_EFFECT_DEFINITIONS.find((item) => item.type === type) ?? null;
}

export function defaultMagicEffectValues(type: string): Record<string, string> {
  const definition = magicEffectDefinition(type);
  if (definition === null) return {};
  const values: Record<string, string> = {};
  for (const field of definition.fields) values[field.key] = field.defaultValue;
  return values;
}

export function serializeMagicEffect(type: string, values: Readonly<Record<string, string>>): Record<string, unknown> {
  const definition = magicEffectDefinition(type);
  const output: Record<string, unknown> = { type };
  if (definition === null) return output;
  for (const field of definition.fields) {
    const raw = values[field.key];
    if (raw === undefined || raw.trim().length === 0) continue;
    if (field.key === "keys") {
      output[field.key] = raw
        .split(/[,，\n]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
    } else {
      output[field.key] = raw.trim();
    }
  }
  return output;
}
