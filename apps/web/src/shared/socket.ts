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

export interface RoomMemberView {
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly role: "KP" | "PLAYER" | "SPECTATOR";
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
