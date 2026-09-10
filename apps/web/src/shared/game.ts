export type AdvancementKind =
  | "ATTRIBUTE"
  | "SKILL"
  | "SAN"
  | "ITEM"
  | "RELATIONSHIP"
  | "OTHER";

export interface GameStateView {
  readonly gameId: string;
  readonly moduleId: string | null;
  readonly moduleVersion: string | null;
  readonly currentChapterId: string | null;
  readonly currentSceneId: string | null;
  readonly currentEncounterId: string | null;
  readonly gameTime: string | null;
  readonly paused: boolean;
  readonly flags: Record<string, unknown>;
  readonly counters: Record<string, unknown>;
  readonly custom: Record<string, unknown>;
  readonly version: number;
  readonly updatedAt: string;
}

export interface GameCharacterView {
  readonly id: string;
  readonly characterId: string;
  readonly userId: string;
  readonly name: string;
  readonly status: string;
  readonly currentHp: number;
  readonly currentMp: number;
  readonly currentSan: number;
  readonly currentDp: number;
  readonly conditions: readonly unknown[];
}

export interface GameView {
  readonly id: string;
  readonly roomId: string;
  readonly moduleId: string | null;
  readonly title: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

export interface CharacterAdvancementView {
  readonly id: string;
  readonly characterId: string;
  readonly characterName: string;
  readonly gameId: string | null;
  readonly gameTitle: string | null;
  readonly kind: AdvancementKind;
  readonly target: string | null;
  readonly delta: number | null;
  readonly note: string | null;
  readonly createdAt: string;
}
