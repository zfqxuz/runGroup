import { RARITIES } from "@touhou/rules";
import { updateRoomCardAction } from "@/server/actions/card";

interface Props {
  readonly card: {
    readonly id: string;
    readonly name: string;
    readonly subtitle: string | null;
    readonly description: string | null;
    readonly rarity: string;
    readonly quantity: number;
    readonly type: string;
    readonly stats: unknown;
  };
  readonly returnTo: string;
}

const inputClass =
  "rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75 outline-none focus:border-sakura-500";

export default function RoomCardEditForm({ card, returnTo }: Props) {
  const statsText = JSON.stringify(card.stats ?? {}, null, 2);
  return (
    <details className="mt-2 rounded border border-white/10 bg-ink-900/40 p-2">
      <summary className="cursor-pointer text-[11px] text-white/45">编辑{card.type === "CLUE" ? "证物" : "物品"}卡</summary>
      <form action={updateRoomCardAction} className="mt-2 flex flex-col gap-2">
        <input type="hidden" name="cardId" value={card.id} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">名称</span>
            <input name="name" defaultValue={card.name} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">副标题</span>
            <input name="subtitle" defaultValue={card.subtitle ?? ""} className={inputClass} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">稀有度</span>
            <select name="rarity" defaultValue={card.rarity} className={inputClass}>
              {RARITIES.map((rarity) => <option key={rarity} value={rarity}>{rarity}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">数量</span>
            <input name="quantity" type="number" min={0} defaultValue={card.quantity} className={inputClass} />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/35">描述</span>
          <textarea name="description" rows={2} defaultValue={card.description ?? ""} className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] text-white/35">stats JSON（伤害、射程、技能等）</span>
          <textarea name="stats" rows={6} defaultValue={statsText} className={inputClass + " font-mono"} />
        </label>
        <button type="submit" className="self-start rounded bg-sakura-500 px-3 py-1.5 text-[11px] font-medium text-ink-900">
          保存卡片
        </button>
      </form>
    </details>
  );
}
