import type { MagicEffect, MagicTargeting } from "@touhou/rules";
import type { SpellCardCombatProfile } from "@/shared/card";
import type { DanmakuPattern } from "./schema";

export type SpellCardMode = "DECLARATION" | "CONSUMPTION";
export type SpellCardClearTargets = "ALL" | "OTHERS_ONLY";
export type SpellCardEnhanceType = "DANMAKU" | "MELEE" | "SPELL" | "AREA";

/**
 * 战斗页需要的符卡公开信息。
 *
 * 只包含演出与释放所需字段；真正的 HP / 持续 tick 由服务端在结算时计算。
 */
export interface CombatSpellCardOption {
  readonly cardId: string;
  readonly name: string;
  readonly mode: SpellCardMode;
  readonly mpCost: number;
  readonly hpRatio: number | null;
  readonly durationTicks: number | null;
  readonly clearTargets: SpellCardClearTargets | null;
  readonly enhanceType: SpellCardEnhanceType;
  readonly enhanceValue: number;
  readonly pattern: DanmakuPattern | null;
  /** Touhou-COC7 战斗档案；DP 模式忽略。 */
  readonly combat: SpellCardCombatProfile | null;
  /** 卡牌声明的效果；符卡可以像法术/道具一样结算这些效果。 */
  readonly effects: readonly MagicEffect[];
  readonly targeting: MagicTargeting;
  readonly targetScope: "SELF" | "ONE" | "ALL";
}
