import type { ActionKind, CombatView } from "@touhou/combat";

export type ChatChannel = "OOC" | "IC" | "KP_ONLY";
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
  readonly createdAt: string;
}

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
}

export interface CombatActionPayload {
  readonly kind: ActionKind;
  readonly targetId?: string | null;
  readonly skill?: string;
  readonly damage?: string;
  readonly accuracyMod?: number;
  readonly name?: string;
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

