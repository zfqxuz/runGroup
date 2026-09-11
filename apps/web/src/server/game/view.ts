import type { CharacterAdvancement, Game, GameState } from "@prisma/client";
import type {
  AdvancementKind,
  AdvancementSource,
  CharacterAdvancementView,
  GameStateView,
  GameView,
  GrowthCheckView
} from "@/shared/game";

function jsonRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function gameStateView(row: GameState): GameStateView {
  return {
    gameId: row.gameId,
    moduleId: row.moduleId,
    moduleVersion: row.moduleVersion,
    currentChapterId: row.currentChapterId,
    currentSceneId: row.currentSceneId,
    currentEncounterId: row.currentEncounterId,
    gameTime: row.gameTime,
    paused: row.paused,
    flags: jsonRecord(row.flags),
    counters: jsonRecord(row.counters),
    custom: jsonRecord(row.custom),
    version: row.version,
    updatedAt: row.updatedAt.toISOString()
  };
}

export function gameView(row: Game): GameView {
  return {
    id: row.id,
    roomId: row.roomId,
    moduleId: row.moduleId,
    title: row.title,
    status: row.status,
    startedAt: row.startedAt === null ? null : row.startedAt.toISOString(),
    endedAt: row.endedAt === null ? null : row.endedAt.toISOString()
  };
}

const ADVANCEMENT_KINDS: readonly AdvancementKind[] = [
  "ATTRIBUTE",
  "SKILL",
  "SAN",
  "ITEM",
  "RELATIONSHIP",
  "OTHER"
];

export function isAdvancementKind(value: string): value is AdvancementKind {
  return (ADVANCEMENT_KINDS as readonly string[]).includes(value);
}

const ADVANCEMENT_SOURCES: readonly AdvancementSource[] = [
  "MANUAL",
  "END_REWARD",
  "GROWTH_CHECK",
  "MODULE",
  "IMPORT",
  "OTHER"
];

export function isAdvancementSource(value: string): value is AdvancementSource {
  return (ADVANCEMENT_SOURCES as readonly string[]).includes(value);
}

export function advancementView(
  row: CharacterAdvancement & {
    character?: { name: string } | null;
    game?: { title: string } | null;
  }
): CharacterAdvancementView {
  return {
    id: row.id,
    characterId: row.characterId,
    characterName: row.character?.name ?? "未知角色",
    gameId: row.gameId,
    gameTitle: row.game?.title ?? null,
    kind: (isAdvancementKind(row.kind) ? row.kind : "OTHER") as AdvancementKind,
    target: row.target,
    delta: row.delta,
    note: row.note,
    source: (isAdvancementSource(row.source) ? row.source : "OTHER") as AdvancementSource,
    metadata: jsonRecord(row.metadata),
    editedAt: row.editedAt === null ? null : row.editedAt.toISOString(),
    revertedAt: row.revertedAt === null ? null : row.revertedAt.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}

export function growthCheckView(
  row: {
    readonly id: string;
    readonly gameId: string;
    readonly characterId: string;
    readonly skillId: string;
    readonly skillName: string | null;
    readonly state: string;
    readonly beforeValue: number;
    readonly roll: number | null;
    readonly gain: number | null;
    readonly note: string | null;
    readonly resolvedAt: Date | null;
    readonly createdAt: Date;
    readonly character?: { name: string } | null;
  }
): GrowthCheckView {
  const state =
    row.state === "PENDING" || row.state === "PASSED" || row.state === "FAILED" || row.state === "CANCELLED"
      ? row.state
      : "PENDING";
  return {
    id: row.id,
    gameId: row.gameId,
    characterId: row.characterId,
    characterName: row.character?.name ?? "未知角色",
    skillId: row.skillId,
    skillName: row.skillName,
    state,
    beforeValue: row.beforeValue,
    roll: row.roll,
    gain: row.gain,
    note: row.note,
    resolvedAt: row.resolvedAt === null ? null : row.resolvedAt.toISOString(),
    createdAt: row.createdAt.toISOString()
  };
}

export function isActiveGameStatus(status: string): boolean {
  return status === "PREPARING" || status === "PLAYING" || status === "PAUSED" || status === "COMBAT";
}
