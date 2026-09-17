import * as XLSX from "xlsx";

export interface ImportedSkill {
  readonly label: string;
  readonly total: number;
  readonly initial: number;
  readonly growth: number;
  readonly occupation: number;
  readonly interest: number;
  readonly specialization: string | null;
  readonly occupationMarker: string | null;
  readonly checked: boolean;
  readonly modernOnly: boolean;
}

export interface ImportedItem {
  /** 携带状态：显露 / 隐藏 / 背包 等。 */
  readonly status: string | null;
  /** 携带部位：颈部 / 背后 / 右手 / 背包格 等。 */
  readonly location: string | null;
  readonly name: string;
  /** 背包内物品的备注 / 数量。 */
  readonly note: string | null;
}

export interface ImportedAssets {
  readonly creditRating: string | null;
  readonly livingStandard: string | null;
  readonly consumption: string | null;
  readonly otherAssetsValue: string | null;
  readonly cash: number | null;
  readonly cashUnit: string | null;
  readonly vehicle: string | null;
  readonly residence: string | null;
  readonly luxury: string | null;
  readonly securities: string | null;
  readonly other: string | null;
}

export interface ImportedWeapon {
  readonly name: string;
  readonly type: string | null;
  readonly skillLabel: string | null;
  readonly success: number | null;
  readonly damage: string | null;
  readonly rangeText: string | null;
  readonly impale: string | null;
  readonly attacks: string | null;
  readonly capacity: string | null;
  readonly malfunction: string | null;
}

export interface ImportedCharacter {
  readonly name: string;
  readonly playerName: string | null;
  readonly occupationName: string | null;
  readonly occupationCode: number | null;
  readonly era: "CLASSIC" | "MODERN" | null;
  readonly age: number | null;
  readonly gender: string | null;
  readonly residence: string | null;
  readonly hometown: string | null;
  readonly attributes: {
    readonly str: number;
    readonly con: number;
    readonly siz: number;
    readonly dex: number;
    readonly app: number;
    readonly int: number;
    readonly pow: number;
    readonly edu: number;
    readonly luck: number;
  };
  readonly skills: readonly ImportedSkill[];
  readonly weapons: readonly ImportedWeapon[];
  readonly items: readonly ImportedItem[];
  readonly assets: ImportedAssets | null;
}

interface CellLike {
  readonly v?: unknown;
  readonly w?: unknown;
}

function resolveCell(sheet: XLSX.WorkSheet, address: string): CellLike | null {
  const direct = sheet[address] as CellLike | undefined;
  if (direct !== undefined) return direct;
  const target = XLSX.utils.decode_cell(address);
  for (const merge of sheet["!merges"] ?? []) {
    if (
      target.r >= merge.s.r &&
      target.r <= merge.e.r &&
      target.c >= merge.s.c &&
      target.c <= merge.e.c
    ) {
      const topLeft = XLSX.utils.encode_cell(merge.s);
      const cell = sheet[topLeft] as CellLike | undefined;
      if (cell !== undefined) return cell;
    }
  }
  return null;
}

function cellValue(sheet: XLSX.WorkSheet, address: string): unknown {
  const cell = resolveCell(sheet, address);
  if (cell === null) return undefined;
  return cell.v !== undefined ? cell.v : cell.w;
}

function text(sheet: XLSX.WorkSheet, address: string): string {
  const value = cellValue(sheet, address);
  if (value === undefined || value === null) return "";
  return String(value).replace(/\u00a0/g, " ").trim();
}

function nullableText(sheet: XLSX.WorkSheet, address: string): string | null {
  const value = text(sheet, address);
  return value.length === 0 ? null : value;
}

function numberValue(sheet: XLSX.WorkSheet, address: string): number | null {
  const value = cellValue(sheet, address);
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function intValue(sheet: XLSX.WorkSheet, address: string): number {
  const value = numberValue(sheet, address);
  if (value === null) return 0;
  return Math.floor(value);
}

function normalizeSkillLabel(rawName: string, rawSpecialization: string | null): {
  label: string;
  modernOnly: boolean;
} {
  let name = rawName.trim();
  const modernOnly = name.includes("Ω");
  name = name.replace(/[Ω\s]/g, "");
  const specialization = rawSpecialization?.trim() ?? "";
  const baseMatch = name.match(/^(技艺|科学|外语|格斗|射击|驾驶|生存|学问)[①②③④]?[:：]?$/);
  if (baseMatch !== null) {
    const base = baseMatch[1];
    if (base === undefined) return { label: name, modernOnly };
    if (specialization.length > 0) return { label: base + "（" + specialization + "）", modernOnly };
    return { label: base, modernOnly };
  }
  return { label: name, modernOnly };
}

function parseSkillSide(
  sheet: XLSX.WorkSheet,
  columns: {
    readonly name: string;
    readonly specialization: string;
    readonly initial: string;
    readonly growth: string;
    readonly occupation: string;
    readonly interest: string;
    readonly total: string;
    readonly marker: string;
    readonly occupationMarker: string;
  },
  startRow: number,
  endRow: number
): ImportedSkill[] {
  const skills: ImportedSkill[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    const address = (column: string): string => column + String(row);
    const rawName = text(sheet, address(columns.name));
    if (rawName.length === 0) continue;
    if (rawName.startsWith("成功标") || rawName === "技能名称") continue;
    const rawSpecialization = nullableText(sheet, address(columns.specialization));
    const normalized = normalizeSkillLabel(rawName, rawSpecialization);
    const initial = intValue(sheet, address(columns.initial));
    const growth = intValue(sheet, address(columns.growth));
    const occupation = intValue(sheet, address(columns.occupation));
    const interest = intValue(sheet, address(columns.interest));
    const totalValue = numberValue(sheet, address(columns.total));
    const total = totalValue === null ? initial + growth + occupation + interest : Math.floor(totalValue);
    if (total <= 0 && occupation <= 0 && interest <= 0 && growth <= 0) continue;
    skills.push({
      label: normalized.label,
      total: Math.max(0, total),
      initial,
      growth,
      occupation,
      interest,
      specialization: rawSpecialization,
      occupationMarker: nullableText(sheet, address(columns.occupationMarker)),
      checked: text(sheet, address(columns.marker)) === "☑",
      modernOnly: normalized.modernOnly
    });
  }
  return skills;
}

function parseEra(value: string): "CLASSIC" | "MODERN" | null {
  if (value.length === 0) return null;
  if (value.includes("现代")) return "MODERN";
  if (value.includes("1920") || value.includes("古典") || value.includes("二十世纪")) return "CLASSIC";
  return null;
}

const WEAPON_SECTION_STOP = ["资产", "随身物品", "背景故事", "其他资产", "武器表", "调查员经历"];

function parseWeapons(sheet: XLSX.WorkSheet): ImportedWeapon[] {
  const weapons: ImportedWeapon[] = [];
  // 模板的武器表在 53~58 行；再往后是资产 / 随身物品等区块，不能继续当武器解析。
  for (let row = 53; row <= 58; row += 1) {
    const address = (column: string): string => column + String(row);
    const name = text(sheet, address("B"));
    if (name.length === 0) {
      if (weapons.length > 0) break;
      continue;
    }
    if (name === "无" || name === "武器名称") continue;
    if (WEAPON_SECTION_STOP.some((stop) => name.startsWith(stop))) break;
    const type = nullableText(sheet, address("G"));
    const skillLabel = nullableText(sheet, address("M"));
    if (type === null && skillLabel === null) continue;
    if (skillLabel !== null && skillLabel.startsWith("←")) continue;
    weapons.push({
      name,
      type,
      skillLabel,
      success: numberValue(sheet, address("Q")),
      damage: nullableText(sheet, address("W")),
      rangeText: nullableText(sheet, address("AA")),
      impale: nullableText(sheet, address("AC")),
      attacks: nullableText(sheet, address("AE")),
      capacity: nullableText(sheet, address("AG")),
      malfunction: nullableText(sheet, address("AJ"))
    });
  }
  return weapons;
}

/** 解析「随身物品」区域：部位 / 物品名称为主，N 列是背包格内的物品。 */
function parseItems(sheet: XLSX.WorkSheet): ImportedItem[] {
  const items: ImportedItem[] = [];
  for (let row = 79; row <= 94; row += 1) {
    const address = (column: string): string => column + String(row);
    const name = text(sheet, address("F"));
    const status = nullableText(sheet, address("B"));
    const location = nullableText(sheet, address("D"));
    if (name.length > 0) {
      items.push({ status, location, name, note: null });
      continue;
    }
    // 该行没有物品名称时，可能是背包格内容；遇到明确的下一节标题就停止。
    if (status !== null && (status.includes("调查员经历") || status.includes("资产") || status.includes("状态"))) break;
  }
  // 背包格（N 列）：与随身物品同一区域，按顺序追加。
  for (let row = 78; row <= 94; row += 1) {
    const value = nullableText(sheet, "N" + String(row));
    if (value === null) continue;
    if (value.includes("背包格") || value === "无") continue;
    // 「圣水，有一定消炎杀菌作用」这类写法拆成名称 + 备注。
    const parts = value.split(/[，,]/);
    const itemName = parts[0]?.trim() ?? value;
    const note = parts.length > 1 ? parts.slice(1).join("，").trim() : null;
    items.push({ status: "背包", location: "背包格", name: itemName.length === 0 ? value : itemName, note });
  }
  return items;
}

/** 解析资产 / 其他资产区域。 */
function parseAssets(sheet: XLSX.WorkSheet): ImportedAssets | null {
  const creditRating = nullableText(sheet, "B62");
  const livingStandard = nullableText(sheet, "F62");
  const consumption = nullableText(sheet, "I62");
  const otherAssetsValue = nullableText(sheet, "L62");
  const cash = numberValue(sheet, "O62");
  const cashUnit = nullableText(sheet, "S62");
  const vehicle = nullableText(sheet, "B70");
  const residence = nullableText(sheet, "F70");
  const luxury = nullableText(sheet, "J70");
  const securities = nullableText(sheet, "N70");
  const other = nullableText(sheet, "R70");
  const hasAny =
    creditRating !== null ||
    cash !== null ||
    vehicle !== null ||
    residence !== null ||
    luxury !== null ||
    securities !== null ||
    other !== null;
  if (hasAny === false) return null;
  return {
    creditRating,
    livingStandard,
    consumption,
    otherAssetsValue,
    cash,
    cashUnit,
    vehicle,
    residence,
    luxury,
    securities,
    other
  };
}

export function parseCharacterWorkbook(buffer: Buffer): ImportedCharacter {
  const workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellDates: false });
  const sheet = workbook.Sheets["人物卡"];
  if (sheet === undefined) {
    throw new Error("工作簿中没有「人物卡」工作表");
  }

  const name = text(sheet, "E3");
  if (name.length === 0) {
    throw new Error("无法识别人物卡：E3 角色名为空");
  }

  const attributes = {
    str: intValue(sheet, "U3"),
    dex: intValue(sheet, "AA3"),
    pow: intValue(sheet, "AG3"),
    con: intValue(sheet, "U5"),
    app: intValue(sheet, "AA5"),
    edu: intValue(sheet, "AG5"),
    siz: intValue(sheet, "U7"),
    int: intValue(sheet, "AA7"),
    luck: intValue(sheet, "AG7")
  };

  const left = parseSkillSide(
    sheet,
    {
      name: "F",
      specialization: "H",
      initial: "J",
      growth: "L",
      occupation: "N",
      interest: "P",
      total: "R",
      marker: "B",
      occupationMarker: "D"
    },
    16,
    49
  );
  const right = parseSkillSide(
    sheet,
    {
      name: "AB",
      specialization: "AD",
      initial: "AF",
      growth: "AH",
      occupation: "AJ",
      interest: "AL",
      total: "AN",
      marker: "X",
      occupationMarker: "Z"
    },
    16,
    49
  );

  return {
    name,
    playerName: nullableText(sheet, "E4"),
    occupationName: nullableText(sheet, "E5"),
    occupationCode: numberValue(sheet, "M5") === null ? null : Math.floor(numberValue(sheet, "M5") as number),
    era: parseEra(text(sheet, "M4")),
    age: numberValue(sheet, "E6") === null ? null : Math.floor(numberValue(sheet, "E6") as number),
    gender: nullableText(sheet, "M6"),
    residence: nullableText(sheet, "E7"),
    hometown: nullableText(sheet, "M7"),
    attributes,
    skills: [...left, ...right],
    weapons: parseWeapons(sheet),
    items: parseItems(sheet),
    assets: parseAssets(sheet)
  };
}
