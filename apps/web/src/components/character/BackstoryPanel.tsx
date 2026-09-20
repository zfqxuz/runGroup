import { characterBackstoryOf } from "@/shared/backstory";

const FIELD_LABELS: ReadonlyArray<readonly [string, (value: NonNullable<ReturnType<typeof characterBackstoryOf>>) => string | null]> = [
  ["角色外貌", (value) => value.appearance],
  ["思想与信念", (value) => value.beliefs],
  ["重要之人", (value) => value.significantPeople],
  ["意义非凡之地", (value) => value.meaningfulPlaces],
  ["宝贵之物", (value) => value.treasuredPossessions],
  ["特质", (value) => value.traits],
  ["难言之隐", (value) => value.secrets],
  ["伤口和疤痕", (value) => value.scars],
  ["恐惧症和狂躁症", (value) => value.phobias]
];

/** 角色卡的背景故事 / 调查员经历 / 神话相关 / 法术一览 / 调查员伙伴。 */
export default function BackstoryPanel({ value }: { value: unknown }) {
  const backstory = characterBackstoryOf(value);
  if (backstory === null) return null;
  const fields = FIELD_LABELS.map(([label, read]) => ({ label, text: read(backstory) })).filter(
    (field): field is { label: string; text: string } => field.text !== null
  );

  return (
    <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <h2 className="text-sm font-medium text-white/80">背景故事与经历</h2>

      {fields.length === 0 ? null : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.label} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
              <p className="text-[11px] text-white/40">{field.label}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-white/75">{field.text}</p>
            </div>
          ))}
        </div>
      )}

      {backstory.experiences.length === 0 ? null : (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-white/60">调查员经历</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {backstory.experiences.map((experience, index) => (
              <li key={index} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <p className="text-xs text-white/70">{experience.module}</p>
                {experience.change === null ? null : (
                  <p className="mt-1 whitespace-pre-wrap text-[11px] text-white/45">{experience.change}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {backstory.mythosExperiences.length === 0 ? null : (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-white/60">神话相关（第三类接触）</h3>
          <ul className="mt-2 flex flex-col gap-2">
            {backstory.mythosExperiences.map((entry, index) => (
              <li key={index} className="rounded-lg border border-purple-400/20 bg-purple-400/5 px-3 py-2">
                <p className="text-xs text-purple-200/80">{entry.name}</p>
                <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/50">
                  {entry.result === null ? null : <div>获得结果：{entry.result}</div>}
                  {entry.note === null ? null : <div>备注：{entry.note}</div>}
                  {entry.cumulative === null ? null : <div>累计：{entry.cumulative}</div>}
                </dl>
              </li>
            ))}
          </ul>
        </div>
      )}

      {backstory.spells.length === 0 ? null : (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-white/60">法术一览</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {backstory.spells.map((spell, index) => {
              const detail = backstory.spellDetails.find((item) => item.name === spell);
              return (
                <div key={spell + ":" + String(index)} className="rounded-lg border border-spirit-400/20 bg-spirit-400/5 px-3 py-2">
                  <p className="text-xs text-spirit-300">{spell}</p>
                  {detail === null || detail === undefined ? null : (
                    <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-white/45">
                      {detail.cost === null ? null : <span>代价：{detail.cost}</span>}
                      {detail.effect === null ? null : <span>作用：{detail.effect}</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {Object.keys(backstory.abilities).length === 0 && backstory.abilityTier === null ? null : (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-white/60">
            千幻抄能力{backstory.abilityTier === null ? "" : "（" + backstory.abilityTier + " 级能力点）"}
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(backstory.abilities).map(([id, level]) => (
              <span
                key={id}
                className="rounded-lg border border-spirit-400/25 bg-spirit-400/5 px-3 py-1.5 font-mono text-[11px] text-spirit-200"
              >
                {id} Lv{level}
              </span>
            ))}
          </div>
        </div>
      )}

      {backstory.companions.length === 0 ? null : (
        <div className="mt-5">
          <h3 className="text-xs font-medium text-white/60">调查员伙伴</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {backstory.companions.map((companion, index) => (
              <div key={index} className="rounded-lg border border-white/10 bg-ink-900/60 px-3 py-2">
                <p className="text-xs text-white/75">
                  {companion.name}
                  {companion.player === null ? null : <span className="text-white/35"> · {companion.player}</span>}
                </p>
                <div className="mt-1 flex flex-col gap-0.5 text-[11px] text-white/45">
                  {companion.note === null ? null : <span>{companion.note}</span>}
                  {companion.change === null ? null : <span>造成改变：{companion.change}</span>}
                  {companion.module === null ? null : <span>相遇模组：{companion.module}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
