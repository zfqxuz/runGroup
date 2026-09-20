import type { ActionKind, CombatView } from "@touhou/combat";
import type { RoomBgmView } from "./bgm";
import type { GameStateView } from "./game";

export type ChatChannel = "OOC" | "IC" | "KP_ONLY" | "WHISPER";
export type ChatKind = "CHAT" | "DICE" | "SYSTEM";

export interface DiceRollView {
  readonly expression: string;
  readonly total: number;
  readonly terms: readonly string[];
  readonly min: number;
  readonly max: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly channel: ChatChannel;
  readonly kind: ChatKind;
  readonly text: string;
  readonly dice: DiceRollView | null;
  readonly targetId: string | null;
  readonly createdAt: string;
}

export type DiceVisibility = "PUBLIC" | "DARK" | "SECRET";

export interface RoomMemberSkillView {
  readonly id: string;
  /** 未公开时服务端不会下发真实值。 */
  readonly value: number | null;
}

export interface RoomMemberCharacterView {
  readonly id: string;
  readonly name: string;
  readonly occupation: string | null;
  readonly portraitUrl: string | null;
  /** 当前查看者可见的数值是否被隐藏；隐藏时统一显示 ???。 */
  readonly statsHidden: boolean;
  /** 成员本人是否选择了公开角色信息（与房间默认可见性无关）。 */
  readonly statsPublic: boolean;
  readonly hp: number | null;
  readonly maxHp: number | null;
  readonly mp: number | null;
  readonly maxMp: number | null;
  readonly san: number | null;
  readonly maxSan: number | null;
  readonly attributes: Readonly<Record<string, number | null>>;
  readonly skills: readonly RoomMemberSkillView[];
}

export interface RoomMemberView {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: "KP" | "PLAYER" | "SPECTATOR";
  readonly avatarUrl: string | null;
  readonly character: RoomMemberCharacterView | null;
}

export interface TradeOfferSummary {
  readonly id: string;
  readonly direction: "INCOMING" | "OUTGOING";
  readonly counterpartId: string;
  readonly counterpartName: string;
  readonly cardName: string;
  readonly cardSubtitle: string | null;
  readonly note: string | null;
  readonly status: "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  readonly createdAt: string;
}

export interface Ack {
  readonly ok: boolean;
  readonly error?: string;
}

export interface JoinAck extends Ack {
  readonly messages?: readonly ChatMessage[];
  readonly members?: readonly RoomMemberView[];
  readonly gameState?: GameStateView | null;
  readonly activeCombatId?: string | null;
  readonly activeCharacter?: { readonly id: string; readonly name: string } | null;
}

export interface RoomStateUpdate {
  readonly roomId: string;
  readonly gameId: string;
  readonly state: GameStateView;
}

export interface RoomAdvancementUpdate {
  readonly roomId: string;
  readonly gameId: string;
  readonly characterId: string;
}

export interface CombatActionPayload {
  readonly kind: ActionKind;
  readonly targetId?: string | null;
  readonly skill?: string;
  readonly damage?: string;
  readonly rangeBand?: number;
  readonly shots?: number;
  readonly pointBlank?: boolean;
  /** U-3：多目标 / 多技能攻击 routine。 */
  readonly routine?: readonly {
    readonly targetId: string;
    readonly skill?: string;
    readonly rangeBand?: number;
    readonly shots?: number;
    readonly pointBlank?: boolean;
  }[];
  readonly maneuver?: "DISARM" | "TRIP" | "GRAPPLE";
  readonly accuracyMod?: number;
  readonly name?: string;
  readonly spellId?: string;
  readonly spellCardId?: string;
  readonly mpCost?: number;
  readonly sanCost?: string;
  readonly spellcardMode?: "DECLARATION" | "CONSUMPTION";
  readonly declarationHp?: number;
  readonly declarationDurationTicks?: number;
  /** 本次展开是否宣告为 LSC（Last Spell Card）。 */
  readonly declarationLsc?: boolean;
  /** 战斗内使用道具：只传 cardId，效果 / 消耗由服务端按卡牌数据解析。 */
  readonly itemCardId?: string;
  readonly status?: { readonly key: string; readonly stacks: number };
  /** 擦弹点消费：随 PASS 行动提交。 */
  readonly grazeSpend?: "MP" | "MELEE_DAMAGE" | "RANGED_DAMAGE";
  /** PASS 行动用于主动放弃展开中的符卡。 */
  readonly abandonDeclaration?: boolean;
  /** DP（千幻抄）行动种类：弹幕 / 射击 / 追击 / 近战 / 其他判定。 */
  readonly dpAction?: "DANMAKU" | "RANGED" | "CHASE" | "MELEE" | "SKILL";
  /** DP 其他行动：目标达成值。 */
  readonly dpTargetValue?: number;
  readonly dpDice?: number;
  readonly dpSecondaryDice?: number;
  readonly dpAttribute?: string;
  readonly dpTargetIds?: readonly string[];
  readonly dpEscalation?: number;
  readonly danmakuDpReduction?: number;
  readonly danmakuBaseDamage?: number;
  readonly damageAbilityId?: string;
  readonly damageTrainingId?: string;
  readonly damageWeaponSkill?: string;
}

export interface CombatReactionPayload {
  readonly type: "PASS" | "DEFEND" | "DODGE" | "COUNTER" | "SEEK_COVER" | "RESIST" | "COVER" | "FLEE";
  readonly skill?: string;
  /** DP 模式：本次应对 / 抵抗 / 掩护消费的骰数。 */
  readonly dpDice?: number;
  /** DP 掩护：本次掩护的队友 id。 */
  readonly coverTargetId?: string;
}

export interface CombatImmediateSpellcardPayload {
  readonly combatId: string;
  /** 展开者（必须是当前应对窗口的目标单位）。 */
  readonly actorId: string;
  readonly spellCardId: string;
  readonly targetId?: string | null;
}

export interface CombatDpDeclarePayload {
  readonly combatId: string;
  readonly participantId?: string;
  /** 本轮声明的 DP；不得超过当前 DP。 */
  readonly value: number;
}

export interface CombatChaseMovePayload {
  readonly combatId: string;
  readonly actorId?: string;
  readonly steps: number;
}

export interface CombatChaseEndTurnPayload {
  readonly combatId: string;
  readonly actorId?: string;
}

export interface CombatChaseWithdrawPayload {
  readonly combatId: string;
  readonly actorId?: string;
  readonly reason?: string;
}

export interface CombatChaseAttackPayload {
  readonly combatId: string;
  readonly actorId?: string;
  readonly targetId: string;
  readonly skill?: string;
  readonly damage?: string;
  readonly rangeBand?: number;
  readonly shots?: number;
  readonly accuracyMod?: number;
}

export interface CombatInitiativeOrderPayload {
  readonly combatId: string;
  readonly order: readonly string[];
}

export interface CombatReadyWeaponPayload {
  readonly combatId: string;
  readonly actorId: string;
  readonly ready: boolean;
}

export interface CombatReactionRequest {
  readonly combatId: string;
  readonly actorId: string;
  readonly actorName: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly options: readonly CombatReactionPayload["type"][];
}

export interface CombatUpdate {
  readonly combatId: string;
  readonly view: CombatView;
}

export interface CombatJoinAck extends Ack {
  readonly view?: CombatView;
}
export interface RoomRefresh {
  readonly roomId: string;
  readonly reason?: string;
}

export interface RoomBgmJoinAck extends Ack {
  readonly bgm?: RoomBgmView | null;
}

export interface RoomBgmUpdate {
  readonly roomId: string;
  readonly bgm: RoomBgmView | null;
}

export interface RoomUpdate {
  readonly roomId: string;
  readonly status: "LOBBY" | "PLAYING" | "PAUSED" | "COMBAT" | "ENDED";
}

export interface CombatLifecycle {
  readonly roomId: string;
  readonly combatId: string;
}
