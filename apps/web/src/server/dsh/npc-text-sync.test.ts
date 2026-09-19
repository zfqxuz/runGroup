import { describe, expect, it } from "vitest";
import { syncNpcStatsFromText } from "@/server/dsh/npc-text-sync";

function npcByName(structured: Record<string, unknown>, name: string): Record<string, unknown> | undefined {
  const npcs = Array.isArray(structured.npcs) ? structured.npcs : [];
  for (const item of npcs) {
    if (item === null || typeof item !== "object") continue;
    const data = (item as { data?: Record<string, unknown> }).data;
    if (data !== null && typeof data === "object" && data.name === name) return data;
  }
  return undefined;
}

describe("syncNpcStatsFromText", () => {
  it("从正文数值行补回被删除的 NPC，且不污染其它 NPC", () => {
    const text = [
      "沃尔特·科比特，不死的恶魔 STR 90CON 115SIZ 55INT 80；房东诺特先生。",
      "科比特：POW 90、DEX 35、APP 05、EDU 80，SAN 0，HP 16，伤害加值+1D4，体格1，移动速度8，MP 18（每小时回复1点）。",
      "金·戴伯伦(Kim Debrun)，法院办公室职员。",
      "鼠群：STR 35 CON 55 SIZ 35 POW 50 DEX 70，HP 9，MP 10，移动 9，每回合攻击 1 次。",
      "复活的小女孩特蕾莎·马卡里奥：STR 20 CON 45 SIZ 25 DEX 50 POW 60，HP 7，MP 12，闪避 25%、潜行 40%、侦查 25%、聆听 20%。"
    ].join("\n");
    const structured = {
      npcs: [
        { id: "npc-walter", kind: "npc", title: "沃尔特·科比特", data: { id: "npc-walter", name: "沃尔特·科比特", aliases: ["科比特"], attributes: {} } },
        { id: "npc-kim", kind: "npc", title: "金·戴伯伦", data: { id: "npc-kim", name: "金·戴伯伦", aliases: ["Kim Debrun"], attributes: {} } }
      ]
    };

    const synced = syncNpcStatsFromText({ newText: text, fallbackText: text, structured });
    const rats = npcByName(synced, "鼠群");
    const girl = npcByName(synced, "复活的小女孩特蕾莎·马卡里奥");
    const kim = npcByName(synced, "金·戴伯伦");
    const walter = npcByName(synced, "沃尔特·科比特");

    expect(rats?.attributes).toEqual({ str: 35, con: 55, siz: 35, pow: 50, dex: 70 });
    expect(rats?.maxHp).toBe(9);
    expect(rats?.maxMp).toBe(10);
    expect(girl?.attributes).toEqual({ str: 20, con: 45, siz: 25, dex: 50, pow: 60 });
    expect(girl?.maxHp).toBe(7);
    expect(girl?.maxMp).toBe(12);
    expect(kim?.attributes).toEqual({});
    expect(walter?.attributes).toEqual({ str: 90, con: 115, siz: 55, dex: 35, app: 5, int: 80, pow: 90, edu: 80 });
    expect(walter?.maxHp).toBe(16);
    expect(walter?.maxMp).toBe(18);
  });

  it("只有明确要求补回时，才从旧正文恢复被删 NPC", () => {
    const fallbackText = "鼠群：STR 35 CON 55 SIZ 35 POW 50 DEX 70，HP 9，MP 10。";
    const structured = { npcs: [] as unknown[] };

    const withoutRecover = syncNpcStatsFromText({
      newText: "本轮只修改了标题。",
      fallbackText,
      structured
    });
    expect(Array.isArray(withoutRecover.npcs) ? withoutRecover.npcs.length : 0).toBe(0);

    const withRecover = syncNpcStatsFromText({
      newText: "本轮只修改了标题。",
      fallbackText,
      structured,
      recoverMissing: true
    });
    const rats = npcByName(withRecover, "鼠群");
    expect(rats?.attributes).toEqual({ str: 35, con: 55, siz: 35, pow: 50, dex: 70 });
    expect(rats?.maxHp).toBe(9);
    expect(rats?.maxMp).toBe(10);
  });

  it("yaml module-npc 块的字段覆盖结构，但不会清空未提供的字段", () => {
    const text = [
      "```yaml module-npc",
      "name: 鼠群",
      "attributes:",
      "  str: 35",
      "  con: 55",
      "  siz: 35",
      "  pow: 50",
      "  dex: 70",
      "maxHp: 9",
      "maxMp: 10",
      "```"
    ].join("\n");
    const structured = {
      npcs: [
        {
          id: "npc-rats",
          kind: "npc",
          title: "鼠群",
          data: { id: "npc-rats", name: "鼠群", aliases: ["老鼠"], attributes: { luck: 0 }, maxSan: 8, description: "旧描述" }
        }
      ]
    };
    const synced = syncNpcStatsFromText({ newText: text, structured });
    const rats = npcByName(synced, "鼠群");
    expect(rats?.attributes).toMatchObject({ str: 35, con: 55, siz: 35, pow: 50, dex: 70, luck: 0 });
    expect(rats?.maxHp).toBe(9);
    expect(rats?.maxMp).toBe(10);
    expect(rats?.maxSan).toBe(8);
    expect(rats?.description).toBe("旧描述");
  });

  it("正文里的旧数值行不会覆盖页面上已经改好的 yaml 块", () => {
    const text = [
      "```yaml module-npc",
      "name: 鼠群",
      "attributes:",
      "  str: 40",
      "  con: 60",
      "  siz: 40",
      "  pow: 60",
      "  dex: 80",
      "maxHp: 10",
      "maxMp: 12",
      "```",
      "",
      "鼠群：STR 35 CON 55 SIZ 35 POW 50 DEX 70，HP 9，MP 10。"
    ].join("\n");
    const structured = {
      npcs: [
        { id: "npc-rats", kind: "npc", title: "鼠群", data: { id: "npc-rats", name: "鼠群", aliases: ["老鼠"], attributes: {} } }
      ]
    };
    const synced = syncNpcStatsFromText({ newText: text, structured });
    const rats = npcByName(synced, "鼠群");
    expect(rats?.attributes).toEqual({ str: 40, con: 60, siz: 40, pow: 60, dex: 80 });
    expect(rats?.maxHp).toBe(10);
    expect(rats?.maxMp).toBe(12);
  });

  it("明确要求补回时，正文数值行优先于 dsh 写错的 yaml 块", () => {
    const newText = [
      "```yaml module-npc",
      "name: 鼠群",
      "attributes:",
      "  str: 90",
      "  con: 115",
      "  siz: 55",
      "  pow: 90",
      "  dex: 35",
      "maxHp: 17",
      "maxMp: 18",
      "```"
    ].join("\n");
    const fallbackText = "鼠群：STR 35 CON 55 SIZ 35 POW 50 DEX 70，HP 9，MP 10。";
    const synced = syncNpcStatsFromText({ newText, fallbackText, structured: { npcs: [] }, recoverMissing: true });
    const rats = npcByName(synced, "鼠群");
    expect(rats?.attributes).toEqual({ str: 35, con: 55, siz: 35, pow: 50, dex: 70 });
    expect(rats?.maxHp).toBe(9);
    expect(rats?.maxMp).toBe(10);
  });
});
