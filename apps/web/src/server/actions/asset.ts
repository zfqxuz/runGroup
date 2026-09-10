"use server";

import { revalidatePath } from "next/cache";
import { deleteAssetIfOrphan } from "@/server/assets/cleanup";
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
    await deleteAssetIfOrphan(previousId);
  }

  revalidatePath("/characters/" + character.id);
  revalidatePath("/characters");
  return { ok: true, url: asset.url };
}
