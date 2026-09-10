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

function parseWeapons(sheet: XLSX.WorkSheet): ImportedWeapon[] {
  const weapons: ImportedWeapon[] = [];
  for (let row = 53; row <= 80; row += 1) {
    const address = (column: string): string => column + String(row);
    const name = text(sheet, address("B"));
    if (name.length === 0) {
      if (weapons.length > 0) break;
      continue;
    }
    if (name === "无" || name === "武器名称") continue;
    const type = nullableText(sheet, address("G"));
    const skillLabel = nullableText(sheet, address("M"));
    if (type === null && skillLabel === null) continue;
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
    weapons: parseWeapons(sheet)
  };
}
