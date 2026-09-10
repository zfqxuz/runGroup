"use server";

import { revalidatePath } from "next/cache";
import {
  ATTRIBUTE_KEYS,
  builtinRegistry,
  checkPointBuy,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  type AttributeKey,
  type AttributeSet
} from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";

export interface SaveCharacterInput {
  roomId: string;
  name: string;
  race: string | null;
  attributes: Record<string, number>;
  skills: Record<string, number>;
  chargenMethod: string;
}

export interface SaveCharacterResult {
  ok: boolean;
  error?: string;
  characterId?: string;
}

const packIdFor = (system: string): string =>
  system === "TOUHOU" ? "touhou-ext" : "coc7-baseline";

export async function saveCharacter(
  input: SaveCharacterInput
): Promise<SaveCharacterResult> {
  const session = await auth();
  if (session === null) return { ok: false, error: "未登录" };

  const membership = await prisma.roomMember.findUnique({
    where: { roomId_userId: { roomId: input.roomId, userId: session.user.id } }
  });
  if (membership === null) return { ok: false, error: "你不在这个房间里" };

  const room = await prisma.room.findUnique({ where: { id: input.roomId } });
  if (room === null) return { ok: false, error: "房间不存在" };

  const name = input.name.trim();
  if (name.length === 0) return { ok: false, error: "角色名不能为空" };
  if (name.length > 50) return { ok: false, error: "角色名最多 50 个字符" };

  const pack = resolveRulePack(packIdFor(room.system), builtinRegistry());
  const compiled = compileParsedRulePack(pack);

  const attributes = {} as AttributeSet;
  for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
    const value = Math.floor(Number(input.attributes[key] ?? 0));
    if (Number.isFinite(value) === false) {
      return { ok: false, error: key + " 不是合法数字" };
    }
    if (value < pack.attributes.min || value > pack.attributes.max) {
      return {
        ok: false,
        error: key + " 必须在 " + pack.attributes.min + "~" + pack.attributes.max + " 之间"
      };
    }
    attributes[key] = value;
  }

  const method = pack.attributes.methods.find((item) => item.id === input.chargenMethod);
  if (method === undefined) return { ok: false, error: "本房的车卡方式不合法" };

  if (method.kind === "POINT_BUY") {
    const check = checkPointBuy(method, attributes);
    if (check.valid === false) {
      return { ok: false, error: "点数分配不合法：" + check.errors.join("；") };
    }
  }

  if (method.kind === "ROLL_SETS") {
    for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
      if (attributes[key] % method.multiplier !== 0) {
        return { ok: false, error: key + " 不是 " + method.dice + "×" + method.multiplier + " 的合法结果" };
      }
    }
  }

  if (input.race !== null && pack.races[input.race] === undefined) {
    return { ok: false, error: "本规则包没有这个种族" };
  }

  // 服务端重算衍生属性 —— 客户端传来的一律不信
  const outcome = computeDerived(compiled, { attributes, race: input.race });

  const character = await prisma.character.create({
    data: {
      userId: session.user.id,
      roomId: room.id,
      system: room.system,
      reviewStatus: "PENDING_REVIEW",
      name,
      race: input.race,
      str: attributes.str,
      con: attributes.con,
      siz: attributes.siz,
      dex: attributes.dex,
      app: attributes.app,
      int: attributes.int,
      pow: attributes.pow,
      edu: attributes.edu,
      luck: attributes.luck,
      raceMods: { method: input.chargenMethod, flags: [...outcome.flags] },
      skills: input.skills,
      hp: outcome.derived.maxHp,
      maxHp: outcome.derived.maxHp,
      mp: outcome.derived.maxMp,
      maxMp: outcome.derived.maxMp,
      san: outcome.derived.maxSan,
      maxSan: outcome.derived.maxSan,
      dp: outcome.derived.maxDp,
      maxDp: outcome.derived.maxDp
    },
    select: { id: true }
  });

  revalidatePath("/rooms/" + room.id);
  return { ok: true, characterId: character.id };
}
