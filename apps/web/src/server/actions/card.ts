"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { ItemStatsSchema, SpellCardStatsSchema, WeaponStatsSchema } from "@/shared/card";

export interface SaveCardInput {
  roomId: string;
  kind: "SPELLCARD" | "WEAPON" | "ITEM";
  name: string;
  subtitle: string | null;
  description: string | null;
  stats: unknown;
}

export interface SaveCardResult {
  ok: boolean;
  error?: string;
  cardId?: string;
}

const inputSchema = z.object({
  roomId: z.string().min(1),
  kind: z.enum(["SPELLCARD", "WEAPON", "ITEM"]),
  name: z.string().min(1).max(40),
  subtitle: z.string().max(40).nullable(),
  description: z.string().max(500).nullable(),
  stats: z.unknown()
});

export async function saveCard(input: SaveCardInput): Promise<SaveCardResult> {
  const session = await auth();
  if (session === null) return { ok: false, error: "未登录" };

  const parsed = inputSchema.safeParse(input);
  if (parsed.success === false) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "参数不合法" };
  }
  const data = parsed.data;
  const name = data.name.trim();
  if (name.length === 0) return { ok: false, error: "卡名不能为空" };

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: data.roomId, userId: session.user.id } },
    include: { room: true }
  });
  if (membership === null) return { ok: false, error: "你不在这个房间里" };

  if (membership.room.system !== "TOUHOU" && data.kind === "SPELLCARD") {
    return { ok: false, error: "本房是 COC7 规则，不支持符卡" };
  }

  const statsResult =
    data.kind === "SPELLCARD"
      ? SpellCardStatsSchema.safeParse(data.stats)
      : data.kind === "WEAPON"
        ? WeaponStatsSchema.safeParse(data.stats)
        : ItemStatsSchema.safeParse(data.stats);

  if (statsResult.success === false) {
    return { ok: false, error: statsResult.error.issues[0]?.message ?? "卡牌数据不合法" };
  }

  const card = await prisma.card.create({
    data: {
      scope: "ROOM",
      roomId: data.roomId,
      ownerId: session.user.id,
      type: data.kind,
      name,
      subtitle: data.subtitle,
      description: data.description,
      system: membership.room.system,
      stats: statsResult.data as unknown as Prisma.InputJsonValue
    },
    select: { id: true }
  });

  revalidatePath("/rooms/" + data.roomId);
  return { ok: true, cardId: card.id };
}
