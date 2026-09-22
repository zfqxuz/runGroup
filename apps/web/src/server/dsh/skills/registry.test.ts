import { describe, expect, it } from "vitest";
import { listSkillsForContext, resolveSkillForContext } from "@/server/dsh/skills/registry";
import type { DshResolvedContext } from "@/server/dsh/context";
import type { DshContextKind } from "@/shared/dsh-context";

function makeContext(kind: DshContextKind, overrides: Partial<DshResolvedContext> = {}): DshResolvedContext {
  return {
    route: { kind, pathname: "/" },
    kind,
    label: "test",
    canEditModule: false,
    isKp: false,
    roomRole: null,
    pack: {},
    ...overrides
  };
}

function ids(context: DshResolvedContext): string[] {
  return listSkillsForContext(context).map((skill) => skill.id);
}

describe("listSkillsForContext", () => {
  it("团本页：非作者只有只读技能", () => {
    const result = ids(makeContext("MODULE", { moduleId: "m1" }));
    expect(result).toContain("assistant.chat");
    expect(result).toContain("nav.guide");
    expect(result).toContain("module.explain");
    expect(result).not.toContain("module.edit");
  });

  it("团本页：作者额外获得修改团本", () => {
    const result = ids(makeContext("MODULE", { moduleId: "m1", canEditModule: true }));
    expect(result).toContain("module.edit");
  });

  it("战斗页：有战况解读，没有团本解读", () => {
    const result = ids(makeContext("COMBAT", { combatId: "c1", roomId: "r1" }));
    expect(result).toContain("combat.explain");
    expect(result).not.toContain("module.explain");
    expect(result).not.toContain("module.edit");
  });

  it("全局页：只给通用 / 导航 / 规则", () => {
    const result = ids(makeContext("GLOBAL"));
    expect(result).toEqual(expect.arrayContaining(["assistant.chat", "nav.guide", "kp.rule"]));
    expect(result).not.toContain("combat.explain");
    expect(result).not.toContain("module.edit");
  });
});

describe("resolveSkillForContext", () => {
  it("不选技能时回退到通用助手", () => {
    const picked = resolveSkillForContext(null, makeContext("GLOBAL"));
    expect(picked.ok).toBe(true);
    if (picked.ok) expect(picked.skill.id).toBe("assistant.chat");
  });

  it("拒绝当前页面不支持的技能", () => {
    const picked = resolveSkillForContext("combat.explain", makeContext("MODULE", { moduleId: "m1" }));
    expect(picked.ok).toBe(false);
    if (picked.ok === false) expect(picked.error).toContain("当前页面");
  });

  it("拒绝没有权限的写入技能", () => {
    const picked = resolveSkillForContext("module.edit", makeContext("MODULE", { moduleId: "m1", canEditModule: false }));
    expect(picked.ok).toBe(false);
    if (picked.ok === false) expect(picked.error).toContain("权限");
  });

  it("作者可以选中修改团本", () => {
    const picked = resolveSkillForContext("module.edit", makeContext("MODULE", { moduleId: "m1", canEditModule: true }));
    expect(picked.ok).toBe(true);
    if (picked.ok) {
      expect(picked.skill.id).toBe("module.edit");
      expect(picked.skill.effect).toBe("WRITE");
    }
  });

  it("未知技能直接报错", () => {
    const picked = resolveSkillForContext("not.a.skill", makeContext("GLOBAL"));
    expect(picked.ok).toBe(false);
  });
});
