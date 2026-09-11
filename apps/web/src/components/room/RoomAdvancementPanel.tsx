import { ATTRIBUTE_KEYS } from "@touhou/rules";
import GrowthCheckForm, { type CharacterSkillGroup } from "@/components/room/GrowthCheckForm";
import { cancelGrowthCheckAction } from "@/server/actions/advancement";
import { recordAdvancementAction } from "@/server/actions/game";
import { ADVANCEMENT_SOURCE_LABELS } from "@/server/game/advancement";
import type { CharacterAdvancementView, GrowthCheckView } from "@/shared/game";

interface Props {
  readonly roomId: string;
  readonly gameId: string;
  readonly isKP: boolean;
  readonly characters: readonly { readonly id: string; readonly name: string }[];
  readonly advancements: readonly CharacterAdvancementView[];
  readonly growthChecks: readonly GrowthCheckView[];
  readonly characterSkills: readonly CharacterSkillGroup[];
  readonly skillOptions: readonly { readonly id: string; readonly name: string }[];
  readonly saved: boolean;
  readonly notice: string | null;
  readonly error: string | null;
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

const NOTICE_LABELS: Record<string, string> = {
  marked: "已标记成长点。",
  cancelled: "已取消成长点。",
  exists: "该技能已经有待检定成长点。",
  passed: "成长检定完成：有技能成功提升。",
  failed: "成长检定完成：本次没有技能提升。",
  none: "没有待检定的成长点。",
  locked: "该成长点已经结算，不能重复操作。"
};

const ERROR_LABELS: Record<string, string> = {
  growth: "成长点数据不合法，或该技能不在当前规则包中。",
  game: "当前局状态不允许进行成长检定。"
};

export default function RoomAdvancementPanel(props: Props) {
  const noticeText = props.notice === null ? null : NOTICE_LABELS[props.notice] ?? props.notice;
  const errorText = props.error === null ? null : ERROR_LABELS[props.error] ?? "操作失败，请稍后重试。";

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
          {props.advancements.length} 条成长 · {props.growthChecks.length} 个成长点
        </span>
      </div>

      {noticeText === null ? null : (
        <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11px] text-emerald-200">
          {noticeText}
        </p>
      )}
      {errorText === null ? null : (
        <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-[11px] text-red-200">
          {errorText}
        </p>
      )}

      {props.growthChecks.length > 0 ? (
        <div className="mt-4 rounded-lg border border-amber-400/25 bg-amber-400/5 p-3">
          <p className="text-[11px] font-medium text-amber-200">
            待检定成长点（CoC 幕间：d100 大于技能值或 96-100 时 +1d10）
          </p>
          <ul className="mt-2 flex flex-col divide-y divide-white/5">
            {props.growthChecks.map((check) => (
              <li key={check.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <span className="font-medium text-white/75">{check.characterName}</span>
                <span className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/50">
                  {check.skillName ?? check.skillId}
                </span>
                <span className="font-mono text-[10px] text-white/35">当前 {check.beforeValue}</span>
                {check.note === null ? null : <span className="text-white/40">{check.note}</span>}
                {props.isKP ? (
                  <form action={cancelGrowthCheckAction} className="ml-auto">
                    <input type="hidden" name="roomId" value={props.roomId} />
                    <input type="hidden" name="checkId" value={check.id} />
                    <input type="hidden" name="returnTo" value={"/rooms/" + props.roomId} />
                    <button
                      type="submit"
                      className="rounded border border-red-400/30 px-2 py-0.5 text-[10px] text-red-300 transition hover:bg-red-400/10"
                    >
                      取消标记
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
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
                <span className="rounded border border-spirit-400/25 px-1.5 py-0.5 text-[10px] text-spirit-200">
                  {ADVANCEMENT_SOURCE_LABELS[item.source]}
                </span>
                {item.target === null ? null : (
                  <span className="rounded border border-spirit-400/25 px-1.5 py-0.5 font-mono text-[10px] text-spirit-200">
                    {targetText(item.kind, item.target)}
                  </span>
                )}
                {item.delta === null ? null : (
                  <span className="font-mono text-[11px] text-sakura-300">{deltaText(item.delta)}</span>
                )}
                {item.revertedAt === null ? null : (
                  <span className="rounded border border-red-400/30 px-1.5 py-0.5 text-[10px] text-red-300">已撤销</span>
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
        <div className="mt-5 border-t border-white/10 pt-5">
          <h3 className="text-xs font-medium text-white/70">KP：标记成长点</h3>
          <GrowthCheckForm
            roomId={props.roomId}
            gameId={props.gameId}
            characters={props.characters}
            characterSkills={props.characterSkills}
            skillOptions={props.skillOptions}
            returnTo={"/rooms/" + props.roomId}
          />
        </div>
      ) : null}

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
