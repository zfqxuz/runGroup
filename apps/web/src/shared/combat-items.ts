import type { MagicEffect } from "@touhou/rules";
import type { CARD_TARGETINGS, CARD_TARGET_SCOPES, CARD_USABLE_IN } from "./card";

/** 战斗内「使用道具」下拉/结算所需的道具选项。 */
export interface CombatItemOption {
  readonly cardId: string;
  readonly name: string;
  readonly targeting: (typeof CARD_TARGETINGS)[number];
  readonly targetScope: (typeof CARD_TARGET_SCOPES)[number];
  readonly effects: readonly MagicEffect[];
  readonly cost: {
    readonly mp: number;
    readonly san: string | null;
    readonly uses: number | null;
    readonly cooldownRounds: number;
  };
  readonly usableIn: readonly (typeof CARD_USABLE_IN)[number][];
}
