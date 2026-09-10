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
