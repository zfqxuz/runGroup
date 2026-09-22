import { describe, expect, it } from "vitest";
import { dshContextKey, parseDshRoute } from "@/shared/dsh-context";

describe("parseDshRoute", () => {
  it("识别房间首页", () => {
    expect(parseDshRoute("/rooms/room1234")).toEqual({ kind: "ROOM", pathname: "/rooms/room1234", roomId: "room1234" });
  });

  it("识别房间内的战斗 / 角色 / 团本", () => {
    expect(parseDshRoute("/rooms/room1234/combat/combat12")).toEqual({
      kind: "COMBAT",
      pathname: "/rooms/room1234/combat/combat12",
      roomId: "room1234",
      combatId: "combat12"
    });
    expect(parseDshRoute("/rooms/room1234/characters/char1234")).toEqual({
      kind: "CHARACTER",
      pathname: "/rooms/room1234/characters/char1234",
      roomId: "room1234",
      characterId: "char1234"
    });
    expect(parseDshRoute("/rooms/room1234/modules/module12")).toEqual({
      kind: "MODULE",
      pathname: "/rooms/room1234/modules/module12",
      roomId: "room1234",
      moduleId: "module12"
    });
  });

  it("识别独立资源页", () => {
    expect(parseDshRoute("/modules/module12")).toEqual({ kind: "MODULE", pathname: "/modules/module12", moduleId: "module12" });
    expect(parseDshRoute("/characters/char1234")).toEqual({ kind: "CHARACTER", pathname: "/characters/char1234", characterId: "char1234" });
    expect(parseDshRoute("/cards/card1234/edit")).toEqual({ kind: "CARD", pathname: "/cards/card1234/edit", cardId: "card1234" });
    expect(parseDshRoute("/history/game1234")).toEqual({ kind: "GAME", pathname: "/history/game1234", gameId: "game1234" });
  });

  it("动作路由不会当成资源 id", () => {
    expect(parseDshRoute("/modules/mine")).toEqual({ kind: "GLOBAL", pathname: "/modules/mine" });
    expect(parseDshRoute("/characters/new")).toEqual({ kind: "GLOBAL", pathname: "/characters/new" });
    expect(parseDshRoute("/rooms/room1234/combat/new")).toEqual({
      kind: "COMBAT",
      pathname: "/rooms/room1234/combat/new",
      roomId: "room1234"
    });
  });

  it("忽略 query / hash 并处理未知路由", () => {
    expect(parseDshRoute("/rooms/room1234?tab=log#top").pathname).toBe("/rooms/room1234");
    expect(parseDshRoute("/").kind).toBe("GLOBAL");
    expect(parseDshRoute("/admin/users").kind).toBe("GLOBAL");
  });
});

describe("dshContextKey", () => {
  it("同一资源的不同 pathname 得到相同的 key", () => {
    const a = parseDshRoute("/rooms/room1234/combat/combat12");
    const b = parseDshRoute("/rooms/room1234/combat/combat12?tab=log");
    expect(dshContextKey(a)).toBe(dshContextKey(b));
  });

  it("不同资源得到不同的 key", () => {
    const a = parseDshRoute("/rooms/room1234/combat/combat12");
    const b = parseDshRoute("/rooms/room1234/combat/combat99");
    expect(dshContextKey(a)).not.toBe(dshContextKey(b));
  });
});
