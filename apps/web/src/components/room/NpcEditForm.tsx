import { PRESET_TIERS, RARITIES } from "@touhou/rules";
import { updateNpcAction } from "@/server/actions/npc";
import { NPC_ATTRIBUTE_KEYS, NpcStatsSchema } from "@/shared/npc";

interface Props {
  readonly roomId: string;
  readonly card: {
    readonly id: string;
    readonly name: string;
    readonly subtitle: string | null;
    readonly description: string | null;
    readonly rarity: string;
    readonly stats: unknown;
  };
  readonly returnTo: string;
}

export const NPC_ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量",
  con: "体质",
  siz: "体型",
  dex: "敏捷",
  app: "外貌",
  int: "智力",
  pow: "意志",
  edu: "教育",
  luck: "幸运"
};

const inputClass =
  "rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75 outline-none focus:border-sakura-500";

function skillsText(skills: Record<string, number>): string {
  return Object.entries(skills).map(([id, value]) => id + ":" + String(value)).join(", ");
}

export default function NpcEditForm({ roomId, card, returnTo }: Props) {
  const parsed = NpcStatsSchema.safeParse(card.stats);
  if (parsed.success === false) {
    return <p className="mt-2 text-[11px] text-amber-300">这张 NPC 卡的属性数据不完整，暂时无法编辑。</p>;
  }
  const stats = parsed.data;
  return (
    <details className="mt-3 rounded border border-white/10 bg-ink-900/40 p-2">
      <summary className="cursor-pointer text-[11px] text-white/45">编辑 NPC / Boss</summary>
      <form action={updateNpcAction} className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="roomId" value={roomId} />
        <input type="hidden" name="cardId" value={card.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">名字</span>
            <input name="name" defaultValue={card.name} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">副标题</span>
            <input name="subtitle" defaultValue={card.subtitle ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">Tier</span>
            <select name="tier" defaultValue={stats.tier} className={inputClass}>
              {PRESET_TIERS.map((tier) => <option key={tier} value={tier}>{tier}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">稀有度</span>
            <select name="rarity" defaultValue={card.rarity} className={inputClass}>
              {RARITIES.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">种族</span>
            <input name="race" defaultValue={stats.race ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">标签（逗号分隔）</span>
            <input name="tags" defaultValue={stats.tags.join(", ")} className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/35">描述</span>
          <input name="description" defaultValue={card.description ?? ""} className={inputClass} />
        </label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
          {NPC_ATTRIBUTE_KEYS.map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">{NPC_ATTRIBUTE_LABELS[key] ?? key}</span>
              <input name={"attr_" + key} type="number" defaultValue={stats.attributes[key]} className={inputClass} />
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["maxHp", "maxMp", "maxSan", "maxDp"] as const).map((key) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">{key}</span>
              <input name={key} type="number" defaultValue={stats[key]} className={inputClass} />
            </label>
          ))}
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/35">技能（示例：FIGHTING_BRAWL:60, DODGE:40）</span>
          <input name="skills" defaultValue={skillsText(stats.skills)} className={inputClass + " font-mono"} />
        </label>
        <button type="submit" className="self-start rounded bg-sakura-500 px-3 py-1.5 text-[11px] font-medium text-ink-900">
          保存 NPC
        </button>
      </form>
    </details>
  );
}
