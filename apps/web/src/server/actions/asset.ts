"use server";

import { revalidatePath } from "next/cache";
import { deleteAssetIfOrphan } from "@/server/assets/cleanup";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export type AttachKind = "PORTRAIT" | "AVATAR" | "CARD_ART" | "SCENE_BG" | "MAP" | "MAP_LAYER" | "TOKEN";

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

  if (input.kind === "MAP_LAYER") {
    const layer = await prisma.mapLayer.findUnique({
      where: { id: input.targetId },
      select: {
        id: true,
        assetId: true,
        map: { select: { scene: { select: { id: true, roomId: true } } } }
      }
    });
    if (layer === null) return { ok: false, error: "图层不存在" };
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: layer.map.scene.roomId, userId: session.user.id } },
      select: { role: true }
    });
    if (membership === null || membership.role !== "KP") {
      return { ok: false, error: "只有 KP 可以设置图层图片" };
    }
    await prisma.mapLayer.update({ where: { id: layer.id }, data: { assetId: asset.id } });
    if (layer.assetId !== null && layer.assetId !== asset.id) {
      await deleteAssetIfOrphan(layer.assetId);
    }
    revalidatePath("/rooms/" + layer.map.scene.roomId + "/scenes");
    revalidatePath("/rooms/" + layer.map.scene.roomId);
    return { ok: true, url: asset.url };
  }

  if (input.kind === "TOKEN") {
    const token = await prisma.token.findUnique({
      where: { id: input.targetId },
      select: { id: true, assetId: true, character: { select: { userId: true } }, map: { select: { scene: { select: { roomId: true } } } } }
    });
    if (token === null) return { ok: false, error: "Token 不存在" };
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: token.map.scene.roomId, userId: session.user.id } },
      select: { role: true }
    });
    const canEdit = membership?.role === "KP" || (token.character !== null && token.character.userId === session.user.id);
    if (canEdit === false) return { ok: false, error: "你不能修改这个 Token" };
    await prisma.token.update({ where: { id: token.id }, data: { assetId: asset.id } });
    if (token.assetId !== null && token.assetId !== asset.id) {
      await deleteAssetIfOrphan(token.assetId);
    }
    revalidatePath("/rooms/" + token.map.scene.roomId + "/scenes");
    revalidatePath("/rooms/" + token.map.scene.roomId);
    return { ok: true, url: asset.url };
  }

  if (input.kind === "SCENE_BG") {
    const scene = await prisma.scene.findUnique({
      where: { id: input.targetId },
      select: { id: true, roomId: true, backgroundId: true }
    });
    if (scene === null) return { ok: false, error: "场景不存在" };
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: scene.roomId, userId: session.user.id } },
      select: { role: true }
    });
    if (membership === null || membership.role !== "KP") {
      return { ok: false, error: "只有 KP 可以设置场景背景" };
    }
    await prisma.scene.update({
      where: { id: scene.id },
      data: { backgroundId: asset.id }
    });
    if (scene.backgroundId !== null && scene.backgroundId !== asset.id) {
      await deleteAssetIfOrphan(scene.backgroundId);
    }
    revalidatePath("/rooms/" + scene.roomId + "/scenes");
    revalidatePath("/rooms/" + scene.roomId);
    return { ok: true, url: asset.url };
  }

  if (input.kind === "MAP") {
    const map = await prisma.map.findUnique({
      where: { id: input.targetId },
      select: { id: true, backgroundId: true, scene: { select: { roomId: true } } }
    });
    if (map === null) return { ok: false, error: "地图不存在" };
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: map.scene.roomId, userId: session.user.id } },
      select: { role: true }
    });
    if (membership === null || membership.role !== "KP") {
      return { ok: false, error: "只有 KP 可以设置地图背景" };
    }
    await prisma.map.update({
      where: { id: map.id },
      data: { backgroundId: asset.id }
    });
    if (map.backgroundId !== null && map.backgroundId !== asset.id) {
      await deleteAssetIfOrphan(map.backgroundId);
    }
    revalidatePath("/rooms/" + map.scene.roomId + "/scenes");
    revalidatePath("/rooms/" + map.scene.roomId);
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
