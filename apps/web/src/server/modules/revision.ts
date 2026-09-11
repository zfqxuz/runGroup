import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/prisma";
import { structuredOfContent, type StructuredModuleData } from "@/server/modules/structure";

export interface GameModuleAssetView {
  readonly assetId: string | null;
  readonly relativePath: string;
  readonly originalName: string | null;
  readonly kind: string;
  readonly url: string;
  readonly mimeType: string | null;
  readonly size: number | null;
  readonly width: number | null;
  readonly height: number | null;
}

export interface GameModuleView {
  readonly source: "revision" | "live";
  readonly revisionId: string | null;
  readonly moduleId: string | null;
  readonly version: string;
  readonly title: string;
  readonly author: string | null;
  readonly system: string | null;
  readonly era: string | null;
  readonly background: string | null;
  readonly occupationRecommendation: string | null;
  readonly synopsis: string | null;
  readonly content: Record<string, unknown>;
  readonly sections: readonly string[];
  readonly structured: StructuredModuleData;
  readonly assets: readonly GameModuleAssetView[];
}

export function moduleSectionsOf(content: unknown): string[] {
  if (content === null || typeof content !== "object") return [];
  const raw = (content as { sections?: unknown }).sections;
  if (Array.isArray(raw) === false) return [];
  return raw.filter((item): item is string => typeof item === "string");
}

function contentOf(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function revisionView(revision: {
  readonly id: string;
  readonly moduleId: string | null;
  readonly version: string;
  readonly title: string;
  readonly author: string | null;
  readonly system: string | null;
  readonly era: string | null;
  readonly background: string | null;
  readonly occupationRecommendation: string | null;
  readonly synopsis: string | null;
  readonly content: Prisma.JsonValue;
  readonly assets: readonly {
    readonly assetId: string | null;
    readonly relativePath: string;
    readonly originalName: string | null;
    readonly kind: string;
    readonly url: string;
    readonly mimeType: string | null;
    readonly size: number | null;
    readonly width: number | null;
    readonly height: number | null;
  }[];
}): GameModuleView {
  return {
    source: "revision",
    revisionId: revision.id,
    moduleId: revision.moduleId,
    version: revision.version,
    title: revision.title,
    author: revision.author,
    system: revision.system,
    era: revision.era,
    background: revision.background,
    occupationRecommendation: revision.occupationRecommendation,
    synopsis: revision.synopsis,
    content: contentOf(revision.content),
    sections: moduleSectionsOf(revision.content),
    structured: structuredOfContent(revision.content),
    assets: revision.assets.map((item) => ({
      assetId: item.assetId,
      relativePath: item.relativePath,
      originalName: item.originalName,
      kind: item.kind,
      url: item.url,
      mimeType: item.mimeType,
      size: item.size,
      width: item.width,
      height: item.height
    }))
  };
}

export async function loadGameModuleView(
  game: { readonly moduleId: string | null; readonly moduleRevisionId: string | null } | null
): Promise<GameModuleView | null> {
  if (game === null) return null;

  if (game.moduleRevisionId !== null) {
    const revision = await prisma.moduleRevision.findUnique({
      where: { id: game.moduleRevisionId },
      include: { assets: { orderBy: [{ orderIndex: "asc" }, { id: "asc" }] } }
    });
    if (revision !== null) return revisionView(revision);
  }

  if (game.moduleId === null) return null;
  const moduleRecord = await prisma.module.findUnique({
    where: { id: game.moduleId },
    include: { assets: { include: { asset: true }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] } }
  });
  if (moduleRecord === null) return null;

  return {
    source: "live",
    revisionId: null,
    moduleId: moduleRecord.id,
    version: moduleRecord.version,
    title: moduleRecord.title,
    author: moduleRecord.author,
    system: moduleRecord.system,
    era: moduleRecord.era,
    background: moduleRecord.background,
    occupationRecommendation: moduleRecord.occupationRecommendation,
    synopsis: moduleRecord.synopsis,
    content: contentOf(moduleRecord.content),
    sections: moduleSectionsOf(moduleRecord.content),
    structured: structuredOfContent(moduleRecord.content),
    assets: moduleRecord.assets.map((item) => ({
      assetId: item.assetId,
      relativePath: item.relativePath,
      originalName: item.originalName,
      kind: item.kind,
      url: item.asset.url,
      mimeType: item.asset.mimeType,
      size: item.asset.size,
      width: item.asset.width,
      height: item.asset.height
    }))
  };
}

export async function ensureModuleRevision(moduleId: string): Promise<{ id: string; version: string; title: string } | null> {
  const moduleRecord = await prisma.module.findUnique({
    where: { id: moduleId },
    include: { assets: { include: { asset: true }, orderBy: [{ orderIndex: "asc" }, { id: "asc" }] } }
  });
  if (moduleRecord === null) return null;

  const assets = moduleRecord.assets.map((item) => ({
    assetId: item.assetId,
    relativePath: item.relativePath,
    originalName: item.originalName,
    kind: item.kind,
    orderIndex: item.orderIndex,
    url: item.asset.url,
    mimeType: item.asset.mimeType,
    size: item.asset.size,
    width: item.asset.width,
    height: item.asset.height
  }));

  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        version: moduleRecord.version,
        title: moduleRecord.title,
        author: moduleRecord.author,
        system: moduleRecord.system,
        era: moduleRecord.era,
        background: moduleRecord.background,
        occupationRecommendation: moduleRecord.occupationRecommendation,
        synopsis: moduleRecord.synopsis,
        metadata: moduleRecord.metadata,
        content: moduleRecord.content,
        assets
      })
    )
    .digest("hex");

  const existing = await prisma.moduleRevision.findUnique({
    where: { moduleId_contentHash: { moduleId, contentHash: hash } },
    select: { id: true, version: true, title: true }
  });
  if (existing !== null) return existing;

  try {
    const created = await prisma.moduleRevision.create({
      data: {
        moduleId,
        version: moduleRecord.version,
        title: moduleRecord.title,
        author: moduleRecord.author,
        system: moduleRecord.system,
        era: moduleRecord.era,
        background: moduleRecord.background,
        occupationRecommendation: moduleRecord.occupationRecommendation,
        synopsis: moduleRecord.synopsis,
        metadata: moduleRecord.metadata as never,
        content: moduleRecord.content as never,
        contentHash: hash,
        assets: { create: assets }
      },
      select: { id: true, version: true, title: true }
    });
    return created;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const raced = await prisma.moduleRevision.findUnique({
        where: { moduleId_contentHash: { moduleId, contentHash: hash } },
        select: { id: true, version: true, title: true }
      });
      if (raced !== null) return raced;
    }
    throw error;
  }
}
