"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ATTRIBUTE_KEYS,
  builtinRegistry,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  type AttributeKey,
  type AttributeSet
} from "@touhou/rules";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import { parseCharacterWorkbook } from "@/server/character/import-xlsx";

const SKILL_ALIASES: Record<string, string> = {
  "斗殴": "FIGHTING_BRAWL",
  "斧": "FIGHTING_AXE",
  "手枪": "FIREARMS_HANDGUN",
  "步枪/霰弹枪": "FIREARMS_RIFLE",
  "弓": "FIREARMS_BOW",
  "闪避": "DODGE",
  "投掷": "THROW"
};

function packSkillId(packSkills: readonly { readonly id: string; readonly name: string }[], label: string): string {
  const trimmed = label.trim();
  const exact = packSkills.find((skill) => skill.name === trimmed);
  if (exact !== undefined) return exact.id;
  const contained = packSkills.find(
    (skill) => skill.name.includes(trimmed) || trimmed.includes(skill.name.replace(/[（(].*?[)）]/g, ""))
  );
  if (contained !== undefined) return contained.id;
  return SKILL_ALIASES[trimmed] ?? trimmed;
}

function inferRange(skillLabel: string | null, type: string | null): "MELEE" | "NEAR" | "FAR" {
  const text = (skillLabel ?? "") + " " + (type ?? "");
  if (/步枪|霰弹|弓|机枪|冲锋枪|喷射|重武器|炮/.test(text)) return "FAR";
  if (/手枪|投掷/.test(text)) return "NEAR";
  return "MELEE";
}

export async function importCharacterAction(formData: FormData): Promise<void> {
  const session = await auth();
  if (session === null) redirect("/login");

  const file = formData.get("file");
  if (file === null || typeof file !== "object" || !("arrayBuffer" in file)) {
    redirect("/characters/import?error=" + encodeURIComponent("请选择 .xlsx 文件"));
  }
  const upload = file as File;
  if (upload.name.toLowerCase().endsWith(".xlsx") === false) {
    redirect("/characters/import?error=" + encodeURIComponent("目前只支持 .xlsx 格式"));
  }

  const buffer = Buffer.from(await upload.arrayBuffer());
  let parsed;
  try {
    parsed = parseCharacterWorkbook(buffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "解析失败";
    redirect("/characters/import?error=" + encodeURIComponent(message));
  }

  const system = "COC7" as const;
  const pack = resolveRulePack("coc7-baseline", builtinRegistry());
  const compiled = compileParsedRulePack(pack);

  const attributes = {} as AttributeSet;
  for (const key of ATTRIBUTE_KEYS as readonly AttributeKey[]) {
    attributes[key] = Math.max(pack.attributes.min, Math.min(pack.attributes.max, parsed.attributes[key]));
  }
  const outcome = computeDerived(compiled, { attributes, race: null });

  const occupation =
    parsed.occupationCode === null
      ? null
      : await prisma.occupation.findUnique({
          where: { system_code: { system, code: parsed.occupationCode } }
        });

  const skills: Record<string, number> = {};
  const labels: Record<string, string> = {};
  const allocation: {
    source: "XLSX";
    occupation: Record<string, number>;
    interest: Record<string, number>;
    growth: Record<string, number>;
    labels: Record<string, string>;
  } = { source: "XLSX", occupation: {}, interest: {}, growth: {}, labels };
  for (const skill of parsed.skills) {
    const skillId = packSkillId(pack.skills, skill.label);
    skills[skillId] = Math.max(skills[skillId] ?? 0, skill.total);
    labels[skillId] = skill.label;
    if (skill.occupation > 0) allocation.occupation[skillId] = (allocation.occupation[skillId] ?? 0) + skill.occupation;
    if (skill.interest > 0) allocation.interest[skillId] = (allocation.interest[skillId] ?? 0) + skill.interest;
    if (skill.growth > 0) allocation.growth[skillId] = (allocation.growth[skillId] ?? 0) + skill.growth;
  }

  const character = await prisma.character.create({
    data: {
      userId: session.user.id,
      roomId: null,
      system,
      reviewStatus: "DRAFT",
      name: parsed.name,
      playerName: parsed.playerName,
      occupation: occupation?.name ?? parsed.occupationName,
      occupationId: occupation?.id ?? null,
      era: parsed.era,
      age: parsed.age,
      gender: parsed.gender,
      residence: parsed.residence,
      str: attributes.str,
      con: attributes.con,
      siz: attributes.siz,
      dex: attributes.dex,
      app: attributes.app,
      int: attributes.int,
      pow: attributes.pow,
      edu: attributes.edu,
      luck: attributes.luck,
      raceMods: { source: "XLSX", filename: upload.name },
      skills,
      skillAllocation: allocation as never,
      sourceData: {
        filename: upload.name,
        occupationCode: parsed.occupationCode,
        hometown: parsed.hometown,
        skills: parsed.skills,
        weapons: parsed.weapons
      } as never,
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

  for (const weapon of parsed.weapons) {
    const skillId = weapon.skillLabel === null ? null : packSkillId(pack.skills, weapon.skillLabel);
    await prisma.card.create({
      data: {
        scope: "CHARACTER",
        ownerId: session.user.id,
        characterId: character.id,
        type: "WEAPON",
        name: weapon.name,
        subtitle: weapon.type,
        description: "由 xlsx 人物卡导入",
        system,
        isEquipped: true,
        stats: {
          skillId,
          range: inferRange(weapon.skillLabel, weapon.type),
          damage: weapon.damage,
          success: weapon.success,
          impale: weapon.impale,
          attacks: weapon.attacks,
          capacity: weapon.capacity,
          malfunction: weapon.malfunction,
          source: "XLSX"
        } as never
      }
    });
  }

  revalidatePath("/characters");
  redirect("/characters/" + character.id + "?imported=1");
}
