import { describe, expect, it } from "vitest";
import { isThrownOutOfRange, matchRangeBand, pointBlankBonusDice, thrownRangeFeet } from "../range";

describe("COC7 距离规则", () => {
  it("霰弹枪距离档：DEX 英寸内近距离，超出后使用远距离", () => {
    const bands = [
      { label: "近距离", maxFeet: "DEX" as const },
      { label: "普通", maxFeet: null }
    ];
    expect(matchRangeBand(20, 50, bands).bandIndex).toBe(0);
    expect(matchRangeBand(60, 50, bands).bandIndex).toBe(1);
  });

  it("有限档位全部超出时判定超程", () => {
    const bands = [{ maxFeet: 30 }, { maxFeet: 100 }];
    expect(matchRangeBand(101, 50, bands)).toMatchObject({ bandIndex: null, outOfRange: true });
  });

  it("手枪/步枪在 DEX/5 英尺内获得近距离奖励骰", () => {
    expect(pointBlankBonusDice("FIREARMS_HANDGUN", 10, 50)).toBe(1);
    expect(pointBlankBonusDice("FIREARMS_HANDGUN", 11, 50)).toBe(0);
    expect(pointBlankBonusDice("FIREARMS_RIFLE", 10, 50)).toBe(1);
    expect(pointBlankBonusDice("FIREARMS_SHOTGUN", 10, 50)).toBe(0);
  });

  it("投掷最远距离为 STR/5 码（英尺）", () => {
    expect(thrownRangeFeet(50)).toBe(30);
    expect(isThrownOutOfRange(50, 30)).toBe(false);
    expect(isThrownOutOfRange(50, 31)).toBe(true);
  });
});
