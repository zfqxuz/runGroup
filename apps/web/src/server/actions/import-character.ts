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
import { occupationSlotCandidates, toOccupationView } from "@/shared/occupation";

const SKILL_ALIASES: Record<string, string> = {
  "斗殴": "FIGHTING_BRAWL",
  "斧": "FIGHTING_AXE",
  "剑": "格斗（剑）",
  "手枪": "FIREARMS_HANDGUN",
  "步枪/霰弹枪": "FIREARMS_RIFLE",
  "弓": "FIREARMS_BOW",
  "闪避": "DODGE",
  "投掷": "THROW",
  "取悦": "CHARM",
  "魅力": "CHARM",
  "魅惑": "CHARM",
  "汽车驾驶": "DRIVE_AUTO",
  "驾驶": "DRIVE_AUTO",
  "母语": "LANGUAGE_OWN",
  "外语": "LANGUAGE_OTHER",
  "技艺": "ART_CRAFT",
  "科学": "SCIENCE",
  "学问": "学问"
};

const COMPOSITE_SKILL_BASES: Record<string, string> = {
  "外语": "LANGUAGE_OTHER",
  "其他语言": "LANGUAGE_OTHER",
  "语言": "LANGUAGE_OTHER",
  "科学": "SCIENCE",
  "驾驶": "驾驶",
  "生存": "SURVIVAL",
  "技艺": "ART_CRAFT",
  "学问": "学问"
};

function packSkillId(packSkills: readonly { readonly id: string; readonly name: string }[], label: string): string {
  const trimmed = label.trim();
  const exact = packSkills.find((skill) => skill.name === trimmed || skill.id === trimmed);
  if (exact !== undefined) return exact.id;
  const base = trimmed.replace(/[（(].*?[)）]/g, "").trim();
  const inner = /[（(](.*?)[)）]/.exec(trimmed)?.[1]?.trim() ?? "";
  if (inner.length > 0) {
    if (base === "射击" && /弩/.test(inner)) return "FIREARMS_BOW#弩";
    const compositeBase = COMPOSITE_SKILL_BASES[base];
    if (compositeBase !== undefined && packSkills.some((skill) => skill.id === compositeBase)) {
      return compositeBase + "#" + inner;
    }
  }
  for (const key of [trimmed, base, inner]) {
    const alias = SKILL_ALIASES[key];
    if (alias !== undefined) {
      const aliased = packSkills.find((skill) => skill.id === alias || skill.name === alias);
      if (aliased !== undefined) return aliased.id;
    }
  }
  const baseExact = packSkills.find((skill) => skill.name === base || skill.id === base);
  if (baseExact !== undefined) return baseExact.id;
  const contained = packSkills.find(
    (skill) => skill.name.includes(trimmed) || trimmed.includes(skill.name.replace(/[（(].*?[)）]/g, ""))
  );
  if (contained !== undefined) return contained.id;
  return trimmed;
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
  const occupation =
    parsed.occupationCode === null
      ? null
      : await prisma.occupation.findUnique({
          where: { system_code: { system, code: parsed.occupationCode } }
        });

  const skills: Record<string, number> = {};
  const labels: Record<string, string> = {};
  let sourceDataSlots: Record<string, string[]> = {};
  const allocation: {
    source: "XLSX";
    occupation: Record<string, number>;
    interest: Record<string, number>;
    growth: Record<string, number>;
    labels: Record<string, string>;
    slots?: Record<string, string[]>;
  } = { source: "XLSX", occupation: {}, interest: {}, growth: {}, labels };
  for (const skill of parsed.skills) {
    const skillId = packSkillId(pack.skills, skill.label);
    skills[skillId] = Math.max(skills[skillId] ?? 0, skill.total);
    labels[skillId] = skill.label;
    if (skill.occupation > 0) allocation.occupation[skillId] = (allocation.occupation[skillId] ?? 0) + skill.occupation;
    if (skill.interest > 0) allocation.interest[skillId] = (allocation.interest[skillId] ?? 0) + skill.interest;
    if (skill.growth > 0) allocation.growth[skillId] = (allocation.growth[skillId] ?? 0) + skill.growth;
  }

  // 按职业的「本职空位」把导入的加点反推成 slots，保证编辑时同一套空位校验能通过。
  const occupationProfile = occupation === null ? null : toOccupationView(occupation).skillProfile;
  if (occupationProfile !== null) {
    const fixed = new Set<string>([...occupationProfile.fixed.map((item) => item.skillId), "CREDIT_RATING"]);
    const pool = Object.keys(allocation.occupation).filter((id) => fixed.has(id) === false);
    const used = new Set<string>();
    const slotAssignments: Record<string, string[]> = {};
    for (const slot of occupationProfile.slots) {
      const candidateList = occupationSlotCandidates(slot, compiled.skills.map((skill) => skill.id)).map((item) => item.skillId);
      const candidates = new Set(candidateList);
      const picks: string[] = [];
      // 先放有职业点的技能。
      for (const id of pool) {
        if (picks.length >= slot.pick) break;
        if (used.has(id) || candidates.has(id) === false) continue;
        picks.push(id);
        used.add(id);
      }
      // 空位没填满时，用「没有兴趣点、也不是固定本职」的技能补位，满足 pick 数量要求。
      for (const id of candidateList) {
        if (picks.length >= slot.pick) break;
        if (used.has(id) || fixed.has(id) || (allocation.interest[id] ?? 0) > 0) continue;
        picks.push(id);
        used.add(id);
      }
      if (picks.length === slot.pick) slotAssignments[slot.id] = picks;
    }
    allocation.slots = slotAssignments;
    sourceDataSlots = slotAssignments;
  }

  const finalOutcome = computeDerived(compiled, { attributes, race: null, skills });
  const maxSan = finalOutcome.derived.maxSan;
  const san = Math.max(0, Math.min(attributes.pow, maxSan));

  const spellNames = parsed.spells.map((spell) => spell.name);

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
      raceMods: {
        source: "XLSX",
        filename: upload.name,
        baseAttributes: attributes,
        ageAdjusted: false
      },
      skills,
      skillAllocation: allocation as never,
      sourceData: {
        filename: upload.name,
        occupationCode: parsed.occupationCode,
        hometown: parsed.hometown,
        skills: parsed.skills,
        weapons: parsed.weapons,
        items: parsed.items,
        assets: parsed.assets,
        // 背景故事 / 经历 / 法术 / 伙伴的原始解析结果
        backstory: parsed.backstory,
        experiences: parsed.experiences,
        mythosExperiences: parsed.mythosExperiences,
        spells: spellNames,
        spellDetails: parsed.spells,
        companions: parsed.companions,
        slotAssignments: sourceDataSlots
      } as never,
      backstory: {
        ...parsed.backstory,
        experiences: parsed.experiences,
        mythosExperiences: parsed.mythosExperiences,
        spells: spellNames,
        spellDetails: parsed.spells,
        companions: parsed.companions,
        slotAssignments: sourceDataSlots
      } as never,
      hp: finalOutcome.derived.maxHp,
      maxHp: finalOutcome.derived.maxHp,
      mp: finalOutcome.derived.maxMp,
      maxMp: finalOutcome.derived.maxMp,
      san,
      maxSan,
      dp: finalOutcome.derived.maxDp,
      maxDp: finalOutcome.derived.maxDp
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

  // 「随身物品」同样落成一般物品卡：即使用户没有填结构化效果，也保留为可编辑 / 可携带的 ITEM 卡。
  // 默认只勾选「战斗外」，避免“背包 / 圣经”这类无结构化效果的普通物品混进战斗道具栏。
  for (const item of parsed.items) {
    const subtitleParts = [item.status, item.location].filter(
      (part): part is string => typeof part === "string" && part.trim().length > 0
    );
    await prisma.card.create({
      data: {
        scope: "CHARACTER",
        ownerId: session.user.id,
        characterId: character.id,
        type: "ITEM",
        name: item.name,
        subtitle: subtitleParts.length === 0 ? null : subtitleParts.join(" · "),
        description: item.note === null ? "由 xlsx 人物卡导入" : item.note,
        system,
        isEquipped: true,
        stats: {
          effects: [],
          targeting: "SELF",
          targetScope: "SELF",
          cost: { mp: 0, san: null, uses: null, cooldownRounds: 0 },
          usableIn: ["FIELD"],
          effect: item.note ?? "",
          uses: null,
          sanCost: null,
          source: "XLSX",
          status: item.status,
          location: item.location
        } as never
      }
    });
  }

  revalidatePath("/characters");
  // 导入后直接进新的统一编辑页（两页：属性技能 / 故事财产物品），不再落旧的详情页。
  redirect("/characters/" + character.id + "/edit?imported=1");
}
