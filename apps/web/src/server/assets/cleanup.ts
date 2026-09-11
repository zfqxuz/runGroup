import { unlink } from "node:fs/promises";
import path from "node:path";
import { uploadRoot } from "@/server/assets/storage";
import { prisma } from "@/server/db/prisma";

function filePathFromUrl(url: string): string | null {
  const prefix = "/api/assets/";
  if (url.startsWith(prefix) === false) return null;
  const parts = url.slice(prefix.length).split("/");
  if (parts.length === 0) return null;
  for (const part of parts) {
    if (part.length === 0 || part === "." || part === "..") return null;
  }
  return path.join(uploadRoot(), ...parts);
}

export async function deleteAssetFilesByUrl(url: string): Promise<void> {
  const filePath = filePathFromUrl(url);
  if (filePath === null) return;
  await unlink(filePath).catch(() => undefined);
  if (filePath.endsWith(".png")) {
    await unlink(filePath.replace(/[.]png$/, "_thumb.png")).catch(() => undefined);
  }
}

export async function deleteAssetIfOrphan(assetId: string): Promise<boolean> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: {
      portraitOf: { select: { id: true } },
      avatarOf: { select: { id: true } },
      tokenOf: { select: { id: true } },
      mapBackgroundOf: { select: { id: true } },
      sceneBackgroundOf: { select: { id: true } },
      layers: { select: { id: true } },
      tokens: { select: { id: true } },
      clues: { select: { id: true } },
      moduleAssets: { select: { id: true } },
      moduleRevisionAssets: {
        select: {
          id: true,
          revision: { select: { games: { select: { status: true } } } }
        }
      }
    }
  });
  if (asset === null) return false;
  const activeGameStatuses = new Set(["PREPARING", "PLAYING", "PAUSED", "COMBAT"]);
  const referencedByActiveGame = asset.moduleRevisionAssets.some((link) =>
    link.revision.games.some((game) => activeGameStatuses.has(game.status))
  );
  const referenced =
    asset.portraitOf !== null ||
    asset.avatarOf !== null ||
    asset.tokenOf !== null ||
    asset.mapBackgroundOf.length > 0 ||
    asset.sceneBackgroundOf.length > 0 ||
    asset.layers.length > 0 ||
    asset.tokens.length > 0 ||
    asset.clues.length > 0 ||
    asset.moduleAssets.length > 0 ||
    referencedByActiveGame;
  if (referenced) return false;
  await deleteAssetFilesByUrl(asset.url);
  await prisma.asset.delete({ where: { id: assetId } }).catch(() => undefined);
  return true;
}
