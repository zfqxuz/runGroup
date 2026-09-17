/**
 * 最终聚合节点：合并所有分支结果，统一生成稳定实体 id，并构建返回给应用的结构。
 *
 * build-workflows.mjs 会替换：
 * - __BRANCH_READS__    每个分支解析节点读取代码
 * - __INITIAL_CALL_COUNTS__ 每个分支初始调用计数
 */

const rawRoot = $("Webhook 团本解析").first().json;
const root = (rawRoot && rawRoot.body && typeof rawRoot.body === "object") ? rawRoot.body : rawRoot;
const sources = Array.isArray(root.sources) ? root.sources : [];
const inputImages = Array.isArray(root.images) ? root.images : [];
const moduleSystem = root.system === "TOUHOU" ? "TOUHOU" : "COC7";

const stage1Items = [];
/*__BRANCH_READS__*/

const pendingRequests = $("汇总待校验").all().map((item) => (item && item.json) ? item.json : {});
const validationResponses = items.map((item) => (item && item.json) ? item.json : {});
const warnings = [];
const extractions = [];
const imageExtractions = [];
const completedChunkGroups = new Set();

const SECTION_SET = new Set([
  "元信息", "真相与背景", "剧情梗概", "开场钩子", "关键NPC", "地点与场景", "线索", "遭遇与战斗", "道具与手书", "怪物与神话生物", "结局分支", "奖励与成长", "KP备注", "附录"
]);

function asRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

function asString(value, fallback) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return fallback === undefined ? "" : fallback;
}

function asObjectArray(value) {
  if (Array.isArray(value)) return value.map(asRecord);
  if (value !== null && typeof value === "object") return [asRecord(value)];
  return [];
}

function normalizeChunkExtraction(raw, label) {
  const rootNode = asRecord(raw);
  const metaRaw = asRecord(rootNode.meta ?? rootNode.frontMatter ?? {});
  const meta = {};
  for (const key of ["title", "summary", "background", "occupationRecommendation"]) {
    const value = asString(metaRaw[key]);
    if (value.length > 0) meta[key] = value;
  }
  const sectionsRaw = asRecord(rootNode.sections ?? rootNode["章节"] ?? {});
  const sections = {};
  for (const section of SECTION_SET) {
    const value = asString(sectionsRaw[section] ?? sectionsRaw[section.replace(/与/g, "")] ?? "");
    if (value.length > 0) sections[section] = value;
  }
  const structuredRaw = asRecord(rootNode.structured ?? rootNode["结构化数据"] ?? {});
  const structured = {};
  const pluralMap = {
    chapters: "chapter", scenes: "scene", encounters: "encounter", npcs: "npc",
    clues: "clue", items: "item", endings: "ending", rewards: "reward", magic: "magic", spells: "magic"
  };
  for (const [rawKind, value] of Object.entries(structuredRaw)) {
    const plural = rawKind === "spells" ? "magic" : rawKind;
    const kind = pluralMap[plural] || pluralMap[plural.replace(/s$/, "")];
    if (kind === undefined) continue;
    const entries = asObjectArray(value);
    if (entries.length > 0) structured[kind] = entries;
  }
  return { label, meta, sections, structured };
}

function normalizeImageExtractions(raw, batch) {
  const records = asObjectArray(asRecord(raw).images);
  const results = [];
  for (let index = 0; index < batch.length; index += 1) {
    const image = batch[index];
    const record = records.find((item) => asString(item.filename) === image.filename) || records[index] || {};
    const kindRaw = asString(record.kind).toUpperCase();
    const kinds = ["MAP", "SCENE", "HANDOUT", "CLUE", "NPC", "ITEM", "TEXT", "OTHER"];
    const kind = kinds.includes(kindRaw) ? kindRaw : "OTHER";
    const rawSection = asString(record.section);
    const section = SECTION_SET.has(rawSection) ? rawSection : "附录";
    results.push({
      filename: image.filename,
      relativePath: image.relativePath,
      kind,
      transcription: asString(record.transcription).slice(0, 4000),
      description: asString(record.description).slice(0, 3000),
      section,
      sectionText: asString(record.sectionText).slice(0, 3000),
      scene: record.scene && typeof record.scene === "object" && !Array.isArray(record.scene) ? record.scene : null,
      clue: record.clue && typeof record.clue === "object" && !Array.isArray(record.clue) ? record.clue : null,
      npc: record.npc && typeof record.npc === "object" && !Array.isArray(record.npc) ? record.npc : null,
      item: record.item && typeof record.item === "object" && !Array.isArray(record.item) ? record.item : null
    });
  }
  return results;
}

function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function slugify(value) {
  const text = String(value || "").trim().toLowerCase();
  const slug = text
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug;
}

const COC7_SKILL_ALIAS_PAIRS = [
  ["斗殴", "FIGHTING_BRAWL"], ["格斗", "FIGHTING_BRAWL"], ["肉搏", "FIGHTING_BRAWL"], ["肉搏攻击", "FIGHTING_BRAWL"], ["近战", "FIGHTING_BRAWL"], ["战斗", "FIGHTING_BRAWL"], ["拳", "FIGHTING_BRAWL"], ["爪", "FIGHTING_BRAWL"], ["牙", "FIGHTING_BRAWL"], ["撕咬", "FIGHTING_BRAWL"], ["啃咬", "FIGHTING_BRAWL"],
  ["闪避", "DODGE"], ["闪躲", "DODGE"],
  ["手枪", "FIREARMS_HANDGUN"], ["射击（手枪）", "FIREARMS_HANDGUN"], ["射击(手枪)", "FIREARMS_HANDGUN"],
  ["步枪", "FIREARMS_RIFLE"], ["霰弹枪", "FIREARMS_RIFLE"], ["射击（步枪）", "FIREARMS_RIFLE"], ["射击(步枪)", "FIREARMS_RIFLE"], ["射击（步枪/霰弹枪）", "FIREARMS_RIFLE"],
  ["弓", "FIREARMS_BOW"], ["射击（弓）", "FIREARMS_BOW"], ["射击(弓)", "FIREARMS_BOW"],
  ["投掷", "THROW"], ["攀爬", "CLIMB"], ["跳跃", "JUMP"], ["游泳", "SWIM"], ["潜行", "STEALTH"], ["聆听", "LISTEN"], ["侦查", "SPOT_HIDDEN"], ["观察", "SPOT_HIDDEN"], ["妙手", "SLEIGHT_OF_HAND"], ["锁匠", "LOCKSMITH"], ["汽车驾驶", "DRIVE_AUTO"], ["驾驶", "DRIVE_AUTO"], ["骑术", "RIDE"], ["急救", "FIRST_AID"],
  ["会计", "ACCOUNTING"], ["人类学", "ANTHROPOLOGY"], ["估价", "APPRAISE"], ["考古学", "ARCHAEOLOGY"], ["历史", "HISTORY"], ["法律", "LAW"], ["图书馆使用", "LIBRARY_USE"], ["医学", "MEDICINE"], ["博物学", "NATURAL_WORLD"], ["导航", "NAVIGATE"], ["神秘学", "OCCULT"], ["精神分析", "PSYCHOANALYSIS"], ["心理学", "PSYCHOLOGY"], ["科学", "SCIENCE"], ["克苏鲁神话", "CTHULHU_MYTHOS"], ["克苏鲁神话知识", "CTHULHU_MYTHOS"], ["母语", "LANGUAGE_OWN"], ["外语", "LANGUAGE_OTHER"],
  ["电子学", "ELECTRONICS"], ["计算机使用", "COMPUTER_USE"], ["电气维修", "ELECTRICAL_REPAIR"], ["机械维修", "MECHANICAL_REPAIR"], ["操作重型机械", "OPERATE_HEAVY_MACHINERY"],
  ["魅惑", "CHARM"], ["话术", "FAST_TALK"], ["恐吓", "INTIMIDATE"], ["说服", "PERSUADE"], ["信用评级", "CREDIT_RATING"], ["乔装", "DISGUISE"], ["追踪", "TRACK"], ["生存", "SURVIVAL"], ["艺术与手艺", "ART_CRAFT"]
];
const COC7_SKILL_ALIAS_MAP = new Map();
for (const pair of COC7_SKILL_ALIAS_PAIRS) {
  COC7_SKILL_ALIAS_MAP.set(normalizeKey(pair[0]), pair[1]);
  COC7_SKILL_ALIAS_MAP.set(normalizeKey(pair[1]), pair[1]);
}
function canonicalSkillId(value) {
  const text = asString(value);
  if (text.length === 0) return undefined;
  return COC7_SKILL_ALIAS_MAP.get(normalizeKey(text));
}
function numberFrom(value, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function attributeDecimal(attributes, key, fallback) {
  const record = asRecord(attributes);
  const aliases = {
    dex: ["dex", "DEX", "敏捷"],
    str: ["str", "STR", "力量"],
    con: ["con", "CON", "体质"],
    siz: ["siz", "SIZ", "体型"],
    app: ["app", "APP", "外貌", "魅力"],
    int: ["int", "INT", "智力"],
    pow: ["pow", "POW", "意志", "意志力"],
    edu: ["edu", "EDU", "教育"],
    luck: ["luck", "LUCK", "幸运"]
  };
  for (const alias of aliases[key] || [key]) {
    const value = record[alias];
    if (value !== undefined && value !== null && value !== "") return numberFrom(value, fallback);
  }
  return fallback;
}
function diceExpressionOf(value) {
  const match = String(value || "").match(/(\d+)\s*[dD]\s*(\d+)(?:\s*([+-])\s*(\d+))?/);
  if (match === null) return undefined;
  return match[1] + "d" + match[2] + (match[3] ? match[3] + match[4] : "");
}
function normalizeWeaponRange(value) {
  const text = asString(value).toUpperCase();
  if (text.length === 0) return "";
  if (text.includes("MELEE") || /近战|格斗|白刃|刀|棍|斧|矛|拳/.test(text)) return "MELEE";
  if (text.includes("NEAR") || /近距离|手枪|霰弹|短枪|短/.test(text)) return "NEAR";
  if (text.includes("FAR") || /远距离|步枪|狙击|远程|远/.test(text)) return "FAR";
  return text.slice(0, 20);
}
function inferWeaponSkillId(name, range) {
  const text = asString(name);
  if (/斧/.test(text)) return "FIGHTING_AXE";
  if (/刀|匕首|棍|爪|牙|拳|撕咬|踢|撞|矛|剑|近战/.test(text)) return "FIGHTING_BRAWL";
  if (range === "NEAR") return "FIREARMS_HANDGUN";
  if (range === "FAR") return "FIREARMS_RIFLE";
  return "FIGHTING_BRAWL";
}
function normalizeNpcSkills(value, attributes) {
  const dex = attributeDecimal(attributes, "dex", 50);
  const output = new Map();
  const add = (skillId, rawValue) => {
    if (skillId === undefined) return;
    const value = Math.max(0, Math.floor(numberFrom(rawValue, 0)));
    if (value <= 0) return;
    output.set(skillId, Math.max(output.get(skillId) ?? 0, value));
  };
  let rows = [];
  if (Array.isArray(value)) rows = value;
  else if (value !== null && typeof value === "object") rows = Object.entries(value).map(([key, item]) => ({ skill: key, value: item }));
  // 先写入模型显式给出的技能值；默认技能只补缺失，不能用 25/闪避基础值覆盖显式低值。
  for (const raw of rows) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const name = asString(raw.skill ?? raw.skillId ?? raw.skill_name ?? raw.skillName ?? raw.name ?? raw.title);
    const skillId = canonicalSkillId(name);
    add(skillId, raw.value ?? raw.level ?? raw.skill_value ?? raw.score);
  }
  const defaults = [
    ["FIGHTING_BRAWL", 25],
    ["DODGE", Math.floor(dex / 2)],
    ["SPOT_HIDDEN", 25],
    ["LISTEN", 20],
    ["STEALTH", 20],
    ["LIBRARY_USE", 20],
    ["FIRST_AID", 30],
    ["PSYCHOLOGY", 10],
    ["OCCULT", 5]
  ];
  for (const [skillId, rawValue] of defaults) {
    if (output.has(skillId)) continue;
    add(skillId, rawValue);
  }
  return [...output.entries()].map(([skill, value]) => ({ skill, value }));
}
function normalizeNpcWeapons(value) {
  const rows = Array.isArray(value) ? value : (value !== null && typeof value === "object" && !Array.isArray(value) ? Object.values(value) : []);
  const output = [];
  for (const raw of rows) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
    const name = asString(raw.name ?? raw.weapon_name ?? raw.weaponName ?? raw.title);
    if (name.length === 0) continue;
    const range = normalizeWeaponRange(raw.range ?? raw.type ?? raw.attackType);
    const skillId = canonicalSkillId(raw.skillId ?? raw.skill_id ?? raw.skill ?? raw.skillName) ?? inferWeaponSkillId(name, range);
    output.push({
      name: name.slice(0, 120),
      damage: asString(raw.damage ?? raw.dmg).slice(0, 80),
      range,
      skillId,
      attacks: raw.attacks ?? raw.attackCount ?? raw.count ?? null,
      notes: asString(raw.notes ?? raw.note ?? raw.description).slice(0, 300)
    });
  }
  return output.slice(0, 30);
}
function normalizeNpcForRules(entry) {
  entry.skills = normalizeNpcSkills(entry.skills ?? entry.skill, entry.attributes);
  entry.weapons = normalizeNpcWeapons(entry.weapons ?? entry.attacks);
}
function normalizeMagicExprNumber(value, fallback) {
  const text = asString(value);
  const match = text.match(/\d+/);
  return match === null ? fallback : match[0];
}
function normalizeMagicDice(value, fallback) {
  const dice = diceExpressionOf(value);
  if (dice !== undefined) return dice;
  const number = asString(value).match(/^\d+$/);
  return number === null ? fallback : number[0];
}
function normalizeMagicTarget(value) {
  const text = asString(value).toUpperCase();
  if (text === "SELF" || text === "ALL") return text;
  return "ONE";
}
function normalizeMagicTargeting(value, entry) {
  const text = asString(value).toUpperCase();
  if (text === "SELF" || text === "ALLY" || text === "ENEMY" || text === "ANY") return text;
  const effects = Array.isArray(entry.effects) ? entry.effects : [];
  const types = effects.map((effect) => effect && typeof effect === "object" ? asString(effect.type) : "");
  if (types.includes("HEAL") || types.includes("MP_RESTORE") || types.includes("SAN_RESTORE") || types.includes("CLEANSE") || types.includes("ARMOR") || types.includes("SUMMON")) return "ALLY";
  if (types.some((type) => ["DAMAGE", "DOT", "STUN", "CONTROL", "MP_DRAIN", "SAN_LOSS"].includes(type))) return "ENEMY";
  if (normalizeMagicTarget(entry.target) === "SELF") return "SELF";
  return "ENEMY";
}
function summonNameFromDescription(text) {
  const match = /(?:召唤|唤出|呼唤|召来|召出|召唤出)[「“"]?([^，。；;\n」”"]{1,20})/.exec(text);
  let raw = match && typeof match[1] === "string" ? match[1].trim() : "";
  const trimLead = (value) => value.replace(/^[\s/／、,，;；:：\-—–]+/, "");
  raw = trimLead(raw);
  raw = raw.replace(/^(?:驱逐|束缚|控制|并|出|来)/u, "");
  raw = trimLead(raw);
  raw = raw.replace(/^\d+\s*(?:只|个|位|群|名)?/u, "");
  raw = raw.replace(/^(?:一只|一个|一位|一群|数个|若干)/u, "");
  raw = trimLead(raw);
  return raw.length > 0 ? raw : "召唤物";
}
function armorEffectFromDescription(text) {
  if (/(护甲|防护|保护)/.test(text) === false || /(伤害|物理|非魔法)/.test(text) === false) return null;
  const match = /(\d*d\d+)\s*点?\s*(?:防非魔法伤害的)?护甲/i.exec(text);
  return { type: "ARMOR", amount: match ? normalizeMagicDice(match[1], "1d6") : "1d6", durationTicks: "0" };
}
function effectFromDescription(value) {
  const text = asString(value);
  if (text.length === 0) return null;
  const dice = diceExpressionOf(text);
  if (/(召唤|唤出|呼唤|召来|召出)/.test(text)) {
    const countMatch = /(\d+)\s*(?:只|个|位|群|名)/.exec(text);
    const summonName = summonNameFromDescription(text);
    return { type: "SUMMON", name: summonName, key: normalizeKey(summonName), count: countMatch ? countMatch[1] : "1", durationTicks: "0" };
  }
  if (/(净化|驱散|解除|移除|清除)/.test(text) && /(状态|异常|持续伤害|眩晕|控制|诅咒|中毒|灼烧|冰冻)/.test(text)) {
    return { type: "CLEANSE", keys: [] };
  }
  if (/(晕眩|眩晕|昏迷|麻痹|无法行动|跳过行动)/.test(text)) return { type: "STUN", durationActions: "1" };
  if (/(控制|支配|服从|心智|操纵)/.test(text)) return { type: "CONTROL", durationActions: "1" };
  const armor = armorEffectFromDescription(text);
  if (armor !== null) return armor;
  if (/(持续伤害|每回合|每轮|DOT)/i.test(text)) return { type: "DOT", amount: dice ?? "1d3", durationTicks: "3" };
  if (/(理智|SAN)/i.test(text) && /(损失|失去|扣除|减少)/.test(text)) return { type: "SAN_LOSS", amount: dice ?? "1d4" };
  if (/(理智|SAN)/i.test(text) && /(恢复|回复|增加| regain )/i.test(text)) return { type: "SAN_RESTORE", amount: dice ?? "1" };
  if (/(恢复|治疗|回复)/.test(text) && /(HP|生命|体力)/i.test(text)) return { type: "HEAL", amount: dice ?? "1d3" };
  if (/(MP|魔力|魔法值)/i.test(text) && /(恢复|回复)/.test(text)) return { type: "MP_RESTORE", amount: "1" };
  if (/(MP|魔力|魔法值)/i.test(text) && /(吸取|抽取|吸收)/.test(text)) return { type: "MP_DRAIN", amount: "1" };
  const statusMatch = /(?:获得|进入|施加|附加)\s*([A-Z][A-Z0-9_]{1,30})\s*(?:状态|效果)?/.exec(text);
  if (statusMatch && statusMatch[1] !== undefined) return { type: "STATUS", key: statusMatch[1], stacks: "1" };
  if (/(伤害|造成|扣除|减少|HP|生命)/.test(text)) return { type: "DAMAGE", amount: dice ?? "1d6" };
  return null;
}
function normalizeMagicEffects(value, entry) {
  const output = [];
  const push = (effect) => {
    if (effect !== null && effect !== undefined) output.push(effect);
  };
  if (typeof value === "string") {
    push(effectFromDescription(value));
  } else if (Array.isArray(value)) {
    for (const raw of value) {
      if (typeof raw === "string") push(effectFromDescription(raw));
      else if (raw !== null && typeof raw === "object" && Array.isArray(raw) === false) {
        const type = asString(raw.type).toUpperCase();
        if (type === "DAMAGE" || type === "HEAL" || type === "DOT" || type === "SAN_LOSS") {
          push({ type, amount: normalizeMagicDice(raw.amount, "1d6"), ...(type === "DOT" ? { durationTicks: normalizeMagicExprNumber(raw.durationTicks, "3") } : {}) });
        } else if (type === "MP_RESTORE" || type === "MP_DRAIN" || type === "SAN_RESTORE") {
          push({ type, amount: normalizeMagicExprNumber(raw.amount, "1") });
        } else if (type === "STATUS") {
          push({ type, key: asString(raw.key) || "STATUS", stacks: normalizeMagicExprNumber(raw.stacks, "1") });
        } else if (type === "ARMOR") {
          push({ type, amount: normalizeMagicDice(raw.amount, "1d6"), durationTicks: normalizeMagicExprNumber(raw.durationTicks, "0") });
        } else if (type === "SUMMON") {
          const summonName = asString(raw.name) || "召唤物";
          push({ type, name: summonName, key: normalizeKey(asString(raw.key) || summonName), cardId: asString(raw.cardId) || undefined, count: normalizeMagicExprNumber(raw.count, "1"), durationTicks: normalizeMagicExprNumber(raw.durationTicks, "0") });
        } else if (type === "STUN" || type === "CONTROL") {
          push({ type, durationActions: normalizeMagicExprNumber(raw.durationActions, "1") });
        } else if (type === "CLEANSE") {
          push({ type, keys: Array.isArray(raw.keys) ? raw.keys.filter((key) => typeof key === "string") : [] });
        }
      }
    }
  }
  if (output.length === 0) {
    const fromDamage = diceExpressionOf(entry.damage);
    if (fromDamage !== undefined) output.push({ type: "DAMAGE", amount: fromDamage });
  }
  if (output.length === 0) {
    const fromDescription = effectFromDescription(entry.description);
    if (fromDescription !== null) output.push(fromDescription);
  }
  const seen = new Set();
  return output.filter((effect) => {
    const key = JSON.stringify(effect);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function normalizeMagicForRules(entry, system) {
  const defaultSkill = system === "TOUHOU" ? "MAGIC" : "OCCULT";
  const skill = canonicalSkillId(entry.skill);
  entry.skill = system === "TOUHOU" ? (skill ?? defaultSkill) : (skill === "OCCULT" || skill === "CTHULHU_MYTHOS" ? skill : defaultSkill);
  entry.mpCost = normalizeMagicExprNumber(entry.mpCost, "0");
  entry.sanCost = normalizeMagicDice(entry.sanCost, "0");
  entry.damage = normalizeMagicDice(entry.damage, "");
  entry.target = normalizeMagicTarget(entry.target);
  entry.effects = normalizeMagicEffects(entry.effects ?? entry.effect, entry);
  // 通用归一化：描述里明确了护甲表达式时，以描述为准；避免模型把「2D6 初始护甲 + 1D6/MP」拆成两条 ARMOR 重复叠加。
  const armorFromText = armorEffectFromDescription(asString(entry.name) + "\n" + asString(entry.description));
  if (armorFromText !== null) {
    const others = entry.effects.filter((effect) => effect && effect.type !== "ARMOR");
    entry.effects = [armorFromText, ...others];
  } else if (entry.effects.length > 1 && entry.effects.every((effect) => effect && effect.type === "ARMOR")) {
    entry.effects = [entry.effects[0]];
  }
  entry.targeting = normalizeMagicTargeting(entry.targeting, entry);
}

function entryName(kind, entry) {
  if (kind === "clue") return asString(entry.title) || asString(entry.name);
  return asString(entry.name) || asString(entry.title);
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s_\-—–·•.。:：,，、;；!！?？'"“”‘’（）()【】\[\]《》<>\/\\]+/g, "")
    .slice(0, 120);
}

function entryAliases(kind, entry) {
  const names = [];
  const direct = entryName(kind, entry);
  if (direct) names.push(direct);
  if (Array.isArray(entry.aliases)) {
    for (const alias of entry.aliases) if (typeof alias === "string") names.push(alias);
  }
  for (const candidate of [entry.name, entry.title]) {
    if (typeof candidate === "string") names.push(candidate);
  }
  return [...new Set(names.map((item) => item.trim()).filter((item) => item.length > 0))];
}

const entityNameToId = new Map();
const entityNameEntries = new Map();
const usedEntityIds = new Set();

function findMappedEntityId(kind, names) {
  for (const name of names) {
    const key = kind + "::" + normalizeKey(name);
    const found = entityNameToId.get(key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function findSubstringEntityId(kind, names) {
  if (kind !== "npc" && kind !== "magic" && kind !== "item" && kind !== "scene" && kind !== "chapter") return undefined;
  const entries = entityNameEntries.get(kind) || [];
  const targets = names.map(normalizeKey).filter((item) => item.length >= 2);
  for (const target of targets) {
    for (const entry of entries) {
      const normalized = entry.normalized;
      if (normalized.length < 2) continue;
      if (normalized === target) return entry.id;
      const bothEndWithDigits = /\d$/.test(normalized) && /\d$/.test(target);
      if (bothEndWithDigits) continue;
      if (normalized.includes(target) || target.includes(normalized)) return entry.id;
    }
  }
  return undefined;
}

function canonicalEntityId(kind, entry, sourceKey, index) {
  const names = entryAliases(kind, entry);
  let existing = findMappedEntityId(kind, names);
  if (existing === undefined) existing = findSubstringEntityId(kind, names);
  if (existing !== undefined) {
    for (const name of names) {
      const normalized = normalizeKey(name);
      entityNameToId.set(kind + "::" + normalized, existing);
      const list = entityNameEntries.get(kind) || [];
      if (list.some((item) => item.normalized === normalized) === false) list.push({ normalized, id: existing });
      entityNameEntries.set(kind, list);
    }
    return existing;
  }
  const base = names.slice().sort((left, right) => right.length - left.length)[0] || "";
  const slug = slugify(base) || hashString(String(sourceKey || "") + ":" + kind + ":" + String(index));
  let id = kind + "-" + slug;
  if (usedEntityIds.has(id)) {
    id = id + "-" + hashString(String(sourceKey || "") + ":" + kind + ":" + String(index) + ":" + String(names.join("|")));
  }
  usedEntityIds.add(id);
  for (const name of names) {
    const normalized = normalizeKey(name);
    entityNameToId.set(kind + "::" + normalized, id);
    const list = entityNameEntries.get(kind) || [];
    if (list.some((item) => item.normalized === normalized) === false) list.push({ normalized, id });
    entityNameEntries.set(kind, list);
  }
  return id;
}

function resolveEntityId(kind, name, sourceKey) {
  const clean = asString(name);
  if (clean.length === 0) return undefined;
  const existing = findMappedEntityId(kind, [clean]);
  if (existing !== undefined) return existing;
  const slug = slugify(clean) || hashString(String(sourceKey || "") + ":" + kind + ":" + clean);
  let id = kind + "-" + slug;
  if (usedEntityIds.has(id)) id = id + "-" + hashString(String(sourceKey || "") + ":" + clean);
  usedEntityIds.add(id);
  const normalized = normalizeKey(clean);
  entityNameToId.set(kind + "::" + normalized, id);
  const list = entityNameEntries.get(kind) || [];
  if (list.some((item) => item.normalized === normalized) === false) list.push({ normalized, id });
  entityNameEntries.set(kind, list);
  return id;
}

function normalizeItemForRules(entry) {
  const rawType = asString(entry.itemType ?? entry.kind ?? entry.type).toUpperCase();
  const damage = asString(entry.damage);
  const range = normalizeWeaponRange(entry.range);
  if (rawType !== "WEAPON" && damage.length === 0 && range.length === 0) return;
  entry.damage = damage;
  entry.range = range;
  entry.skillId = canonicalSkillId(entry.skillId ?? entry.skill ?? entry.skillName) ?? inferWeaponSkillId(asString(entry.name ?? entry.title), range);
}

function stabilizeExtractionIds(extraction, sourceKey, system) {
  const structured = extraction && extraction.structured ? extraction.structured : {};
  for (const [kind, entries] of Object.entries(structured)) {
    if (!Array.isArray(entries)) continue;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
      entry.id = canonicalEntityId(kind, entry, sourceKey, index);
      if (kind === "npc") normalizeNpcForRules(entry);
      if (kind === "magic") normalizeMagicForRules(entry, system);
      if (kind === "item") normalizeItemForRules(entry);
      if (kind === "encounter") {
        if (asString(entry.sceneName).length > 0) entry.sceneId = resolveEntityId("scene", entry.sceneName, sourceKey);
        if (asString(entry.chapterName).length > 0) entry.chapterId = resolveEntityId("chapter", entry.chapterName, sourceKey);
      }
      if (kind === "clue") {
        const linkedName = asString(entry.linkedItemName) || asString(entry.linkedItemId);
        if (linkedName.length > 0 && linkedName.startsWith("item-") === false) {
          const linkedId = resolveEntityId("item", linkedName, sourceKey);
          if (linkedId !== undefined) entry.linkedItemId = linkedId;
        }
      }
    }
  }
}

function addTextParsed(item, parsed) {
  const sourceKey = item.chunkGroupId || item.originId || item.label || "unknown";
  const extraction = normalizeChunkExtraction(parsed, item.label || "未命名分块");
  stabilizeExtractionIds(extraction, sourceKey, moduleSystem);
  const hasContent =
    Object.keys(extraction.meta).length > 0 ||
    Object.keys(extraction.sections).length > 0 ||
    Object.keys(extraction.structured).length > 0;
  if (hasContent) {
    extractions.push(extraction);
  }
  if (item.chunkGroupId) completedChunkGroups.add(item.chunkGroupId);
  return hasContent;
}

function addImageParsed(item, parsed) {
  const batch = Array.isArray(item.imageBatch) ? item.imageBatch : [];
  if (batch.length === 0) return false;
  const records = normalizeImageExtractions(parsed, batch);
  if (records.length === 0) return false;
  imageExtractions.push(...records);
  return true;
}

const pendingGroups = new Map();
for (const item of stage1Items) {
  if (item.needsStage2 === true) {
    const key = item.originId || item.stage2Id || "unknown";
    const list = pendingGroups.get(key) || [];
    list.push(item);
    pendingGroups.set(key, list);
  } else if (item.parsed !== undefined && item.parsed !== null) {
    if (item.kind === "image") addImageParsed(item, item.parsed);
    else addTextParsed(item, item.parsed);
  }
}

const stage2ByStage2Id = new Map();
for (let index = 0; index < pendingRequests.length; index += 1) {
  const request = pendingRequests[index] || {};
  const response = validationResponses[index] || {};
  stage2ByStage2Id.set(String(request.stage2Id || ("s2-" + String(index))), { request, response });
}

for (const group of pendingGroups.values()) {
  let success = false;
  const hadRetry = group.some((item) => item.stage2Kind === "retry");
  const hadValidate = group.some((item) => item.stage2Kind === "validate");

  for (const pending of group) {
    const pair = stage2ByStage2Id.get(String(pending.stage2Id || ""));
    if (pair === undefined) continue;
    const response = pair.response || {};
    const request = pair.request || {};
    if (request.stage2Kind === "noop") continue;
    const choice = Array.isArray(response.choices) ? response.choices[0] : null;
    const finishReason = choice ? choice.finish_reason : "";
    const content = choice && choice.message && typeof choice.message.content === "string" ? choice.message.content : "";
    if (response.error || finishReason === "length" || content.trim().length === 0) continue;
    const parsed = extractJsonObject(content);
    if (parsed === null) continue;
    const ok = pending.kind === "image" ? addImageParsed(pending, parsed) : addTextParsed(pending, parsed);
    if (ok) success = true;
  }

  const first = group[0] || {};
  const label = first.originLabel || first.label || first.originId || "未命名分块";
  if (success) {
    if (hadRetry) warnings.push(label + " 初次输出被 max_tokens 截断，已拆分为更小片段重试成功");
    else if (hadValidate) warnings.push(label + " JSON 格式异常，已由格式校验 Agent 修复并通过");
    continue;
  }

  if (first.fallbackText && String(first.fallbackText).trim().length > 0) {
    extractions.push({
      label: label + "（原文回退）",
      meta: {},
      sections: {},
      structured: {},
      fallbackText: String(first.fallbackText).slice(0, 4000)
    });
    if (first.chunkGroupId) completedChunkGroups.add(first.chunkGroupId);
    warnings.push(label + " 的所有分支均未产出合法 JSON，已把原文片段放入附录");
  } else {
    warnings.push(label + " 的所有分支均失败，已跳过");
  }
}

const npcEntries = [];
for (const extraction of extractions) {
  const npcs = extraction && extraction.structured ? extraction.structured.npcs : null;
  if (Array.isArray(npcs)) for (const entry of npcs) npcEntries.push(entry);
}
const npcStats = buildNpcStats({ entries: npcEntries, sources });

const chunkGroups = new Set();
for (const item of stage1Items) {
  if (item && item.kind === "chunk" && item.chunkGroupId) chunkGroups.add(item.chunkGroupId);
}
const realStage2Requests = pendingRequests.filter((request) => request && request.stage2Kind !== "noop");
const initialCallCount = new Set(stage1Items.map((item) => item && item.originId).filter((item) => item !== undefined && item !== null && item !== "")).size;

return [{
  json: {
    ok: true,
    extractions,
    images: imageExtractions,
    npcStats,
    warnings,
    stats: {
      aiCalls: initialCallCount + realStage2Requests.length,
      attempts: realStage2Requests.length > 0 ? 2 : 1,
      chunks: chunkGroups.size,
      chunksCompleted: completedChunkGroups.size,
      imagesAnalyzed: imageExtractions.length,
      imagesUsed: inputImages.length,
      npcStatsParsed: npcStats.length
    }
  }
}];
