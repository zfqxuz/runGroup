import type { ActionKind, CombatView } from "@touhou/combat";
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
  readonly accuracyMod?: number;
  readonly name?: string;
  readonly spellId?: string;
  readonly mpCost?: number;
  readonly sanCost?: string;
  readonly spellcardMode?: "DECLARATION" | "CONSUMPTION";
  readonly declarationHp?: number;
  readonly declarationDurationTicks?: number;
  readonly status?: { readonly key: string; readonly stacks: number };
}

export interface CombatReactionPayload {
  readonly type: "PASS" | "DEFEND" | "DODGE" | "COUNTER";
  readonly skill?: string;
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
  readonly accuracyMod?: number;
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

export interface RoomUpdate {
  readonly roomId: string;
  readonly status: "LOBBY" | "PLAYING" | "PAUSED" | "COMBAT" | "ENDED";
}

export interface CombatLifecycle {
  readonly roomId: string;
  readonly combatId: string;
}
