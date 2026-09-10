import { ATTRIBUTE_KEYS } from "@touhou/rules";
import { recordAdvancementAction } from "@/server/actions/game";
import type { CharacterAdvancementView } from "@/shared/game";

interface Props {
  readonly roomId: string;
  readonly gameId: string;
  readonly isKP: boolean;
  readonly characters: readonly { readonly id: string; readonly name: string }[];
  readonly advancements: readonly CharacterAdvancementView[];
  readonly skillOptions: readonly { readonly id: string; readonly name: string }[];
  readonly saved: boolean;
}

const ATTRIBUTE_LABELS: Record<string, string> = {
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

const KIND_LABELS: Record<string, string> = {
  ATTRIBUTE: "属性",
  SKILL: "技能",
  SAN: "SAN",
  ITEM: "物品",
  RELATIONSHIP: "关系",
  OTHER: "其他"
};

function deltaText(delta: number | null): string {
  if (delta === null) return "";
  return delta > 0 ? "+" + delta : String(delta);
}

function targetText(kind: string, target: string | null): string {
  if (target === null) return "";
  if (kind === "ATTRIBUTE") return ATTRIBUTE_LABELS[target] ?? target;
  return target;
}

export default function RoomAdvancementPanel(props: Props) {
  return (
    <section id="advancement" className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white/80">成长与奖励</h2>
          <p className="mt-1 text-[11px] text-white/35">
            成长记录会标注来源，并单独保存；属性 / 技能 / SAN 变动会同步到角色卡。
          </p>
        </div>
        <span className="rounded-full border border-amber-400/40 px-2 py-0.5 text-[10px] text-amber-300">
          {props.advancements.length} 条
        </span>
      </div>

      {props.saved ? (
        <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">
          成长记录已保存。
        </p>
      ) : null}

      {props.advancements.length === 0 ? (
        <p className="mt-3 text-xs text-white/35">本局暂无成长记录。</p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-white/5">
          {props.advancements.map((item) => (
            <li key={item.id} className="py-2.5 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-white/75">{item.characterName}</span>
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/45">
                  {KIND_LABELS[item.kind] ?? item.kind}
                </span>
                {item.target === null ? null : (
                  <span className="rounded border border-spirit-400/25 px-1.5 py-0.5 font-mono text-[10px] text-spirit-200">
                    {targetText(item.kind, item.target)}
                  </span>
                )}
                {item.delta === null ? null : (
                  <span className="font-mono text-[11px] text-sakura-300">{deltaText(item.delta)}</span>
                )}
              </div>
              {item.note === null || item.note.length === 0 ? null : (
                <p className="mt-1 leading-relaxed text-white/45">{item.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {props.isKP && props.characters.length > 0 ? (
        <form action={recordAdvancementAction} className="mt-5 border-t border-white/10 pt-5">
          <input type="hidden" name="roomId" value={props.roomId} />
          <input type="hidden" name="gameId" value={props.gameId} />
          <h3 className="text-xs font-medium text-white/70">KP 记录成长 / 奖励</h3>
          <datalist id="advancement-targets">
            {ATTRIBUTE_KEYS.map((key) => (
              <option key={key} value={key}>
                {ATTRIBUTE_LABELS[key] ?? key}
              </option>
            ))}
            {props.skillOptions.map((skill) => (
              <option key={skill.id} value={skill.id}>
                {skill.name}
              </option>
            ))}
          </datalist>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label className="flex flex-col gap-1.5 lg:col-span-1">
              <span className="text-[11px] text-white/45">角色</span>
              <select
                name="characterId"
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              >
                {props.characters.map((character) => (
                  <option key={character.id} value={character.id}>
                    {character.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">类型</span>
              <select
                name="kind"
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              >
                <option value="ATTRIBUTE">属性</option>
                <option value="SKILL">技能</option>
                <option value="SAN">SAN</option>
                <option value="ITEM">物品</option>
                <option value="RELATIONSHIP">关系</option>
                <option value="OTHER">其他</option>
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">目标 / 说明键</span>
              <input
                name="target"
                list="advancement-targets"
                placeholder="attr / skill id / 物品名"
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11px] text-white/45">数值变化</span>
              <input
                name="delta"
                type="number"
                placeholder="例：+1"
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
            <label className="flex flex-col gap-1.5 lg:col-span-1">
              <span className="text-[11px] text-white/45">备注</span>
              <input
                name="note"
                placeholder="来源 / 奖励说明"
                className="rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500"
              />
            </label>
          </div>
          <div className="mt-3">
            <button
              type="submit"
              className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
            >
              记录成长
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
