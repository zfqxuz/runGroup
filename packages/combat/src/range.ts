/**
 * COC7 武器距离档 / 近距离奖励的纯规则计算。
 * 距离由服务端从地图 Token 位置换算为英尺后传入，保证客户端无法篡改。
 */

export interface RangeBandLike {
  readonly label?: string;
  /** 该档位的最大距离；"DEX" 表示使用攻击者 DEX 的英尺数；null / undefined 表示无上限。 */
  readonly maxFeet?: number | "DEX" | null;
}

export interface RangeMatchResult {
  /** 命中的距离档索引；null 表示所有档位都有上限且本次攻击超程。 */
  readonly bandIndex: number | null;
  /** 该档位的实际最大距离；null 表示无上限。 */
  readonly maxFeet: number | null;
  /** 是否因为超过所有有限档位而超程。 */
  readonly outOfRange: boolean;
}

function resolveBandMax(maxFeet: number | "DEX" | null | undefined, dex: number): number | null {
  if (maxFeet === "DEX") return Math.max(0, Math.floor(dex));
  if (typeof maxFeet === "number" && Number.isFinite(maxFeet)) {
    return Math.max(0, Math.floor(maxFeet));
  }
  return null;
}

/**
 * 根据距离选择伤害档。
 * - 按数组顺序找第一个 distance <= 上限的档位；
 * - 无上限档位总是兜底；
 * - 若所有档位都有限且都超过，返回 outOfRange。
 */
export function matchRangeBand(
  distanceFeet: number,
  dex: number,
  bands: readonly RangeBandLike[]
): RangeMatchResult {
  if (bands.length === 0) return { bandIndex: null, maxFeet: null, outOfRange: false };
  const distance = Math.max(0, distanceFeet);
  let lastMax: number | null = null;
  for (let index = 0; index < bands.length; index += 1) {
    const max = resolveBandMax(bands[index]?.maxFeet, dex);
    if (max === null) return { bandIndex: index, maxFeet: null, outOfRange: false };
    lastMax = max;
    if (distance <= max) return { bandIndex: index, maxFeet: max, outOfRange: false };
  }
  return { bandIndex: null, maxFeet: lastMax, outOfRange: true };
}

/** 手枪 / 步枪在 DEX/5 英尺以内的近距离点射获得 1 枚奖励骰。 */
export function pointBlankBonusDice(skill: string, distanceFeet: number, dex: number): number {
  if (skill !== "FIREARMS_HANDGUN" && skill !== "FIREARMS_RIFLE") return 0;
  const limit = Math.max(0, Math.floor(dex / 5));
  return Math.max(0, distanceFeet) <= limit ? 1 : 0;
}

/** 投掷最远距离：STR/5 码，换算为英尺。 */
export function thrownRangeFeet(str: number): number {
  return Math.max(0, Math.floor(str / 5)) * 3;
}

/** 投掷是否超过程序允许的最大射程。 */
export function isThrownOutOfRange(str: number, distanceFeet: number): boolean {
  return Math.max(0, distanceFeet) > thrownRangeFeet(str);
}
