"use server";

import { unlink } from "node:fs/promises";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { uploadRoot } from "@/server/assets/storage";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export type AttachKind = "PORTRAIT" | "AVATAR" | "CARD_ART";

export interface AttachInput {
  readonly kind: AttachKind;
  readonly targetId: string;
  readonly assetId: string;
}

export interface AttachResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly url?: string;
}

async function deleteAssetFiles(asset: { type: string; filename: string }): Promise<void> {
  const dir = path.join(uploadRoot(), asset.type.toLowerCase());
  const thumbName = asset.filename.replace(/[.]png$/, "_thumb.png");
  await unlink(path.join(dir, asset.filename)).catch(() => undefined);
  await unlink(path.join(dir, thumbName)).catch(() => undefined);
}

/** 旧资源如果已经没有任何引用，连文件和记录一起清掉，避免存储无限膨胀。 */
async function pruneIfOrphan(assetId: string): Promise<void> {
  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    include: {
      portraitOf: { select: { id: true } },
      avatarOf: { select: { id: true } },
      tokenOf: { select: { id: true } },
      layers: { select: { id: true } },
      tokens: { select: { id: true } },
      clues: { select: { id: true } }
    }
  });
  if (asset === null) return;

  const referenced =
    asset.portraitOf !== null ||
    asset.avatarOf !== null ||
    asset.tokenOf !== null ||
    asset.layers.length > 0 ||
    asset.tokens.length > 0 ||
    asset.clues.length > 0;
  if (referenced) return;

  await deleteAssetFiles(asset);
  await prisma.asset.delete({ where: { id: asset.id } });
}

export async function attachAssetAction(input: AttachInput): Promise<AttachResult> {
  const session = await auth();
  if (session === null) return { ok: false, error: "未登录" };

  const asset = await prisma.asset.findUnique({ where: { id: input.assetId } });
  if (asset === null || asset.ownerId !== session.user.id) {
    return { ok: false, error: "资源不存在或不属于你" };
  }

  if (input.kind === "CARD_ART") {
    const card = await prisma.card.findUnique({ where: { id: input.targetId } });
    if (card === null || card.ownerId !== session.user.id) {
      return { ok: false, error: "卡牌不存在" };
    }
    await prisma.card.update({
      where: { id: card.id },
      data: { imageUrl: asset.url, thumbnailUrl: asset.thumbnailUrl }
    });
    revalidatePath("/cards");
    return { ok: true, url: asset.url };
  }

  const character = await prisma.character.findUnique({ where: { id: input.targetId } });
  if (character === null || character.userId !== session.user.id) {
    return { ok: false, error: "角色不存在" };
  }

  const previousId = input.kind === "PORTRAIT" ? character.portraitId : character.avatarId;

  await prisma.character.update({
    where: { id: character.id },
    data: input.kind === "PORTRAIT" ? { portraitId: asset.id } : { avatarId: asset.id }
  });

  if (previousId !== null && previousId !== asset.id) {
    await pruneIfOrphan(previousId);
  }

  revalidatePath("/characters/" + character.id);
  revalidatePath("/characters");
  return { ok: true, url: asset.url };
}
