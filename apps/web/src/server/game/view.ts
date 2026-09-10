import type { CharacterAdvancement, Game, GameState } from "@prisma/client";
import type {
  AdvancementKind,
  CharacterAdvancementView,
  GameStateView,
  GameView
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
    createdAt: row.createdAt.toISOString()
  };
}

export function isActiveGameStatus(status: string): boolean {
  return status === "PREPARING" || status === "PLAYING" || status === "PAUSED" || status === "COMBAT";
}
