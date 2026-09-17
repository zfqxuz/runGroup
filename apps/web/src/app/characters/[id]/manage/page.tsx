import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { compile, evaluate } from "@touhou/formula";
import {
  ATTRIBUTE_KEYS,
  builtinRegistry,
  compileParsedRulePack,
  computeDerived,
  resolveRulePack,
  type AttributeKey,
  type AttributeSet
} from "@touhou/rules";
import { updateCharacterCardFormAction, updateCharacterFormAction } from "@/server/actions/character-manage";
import { convertCardKindAction, equipCardAction, unequipCardAction } from "@/server/actions/card";
import { auth } from "@/server/auth";
import { prisma } from "@/server/db/prisma";
import {
  CARD_KIND_LABELS,
  RARITY_LABELS,
  WEAPON_TYPES,
  cardRarityBorderClass,
  parseCardStats,
  type CardKind
} from "@/shared/card";
import { magicEffectLabel } from "@/shared/magic";
import { availableEra, occupationSlotCandidates, toOccupationView } from "@/shared/occupation";

export const dynamic = "force-dynamic";

const inputClass =
  "w-full rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-sakura-500";
const labelClass = "flex flex-col gap-1 text-xs text-white/50";

const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量 STR",
  con: "体质 CON",
  siz: "体型 SIZ",
  dex: "敏捷 DEX",
  app: "外貌 APP",
  int: "智力 INT",
  pow: "意志 POW",
  edu: "教育 EDU",
  luck: "幸运 LUCK"
};

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : {};
}

function pointMapOf(value: unknown): Record<string, number> {
  const record = recordOf(value);
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(record)) {
    const number = Math.floor(Number(raw));
    if (Number.isFinite(number) && number > 0) out[key] = number;
  }
  return out;
}

export default async function ManageCharacterPage({
  params,
  searchParams
}: {
  params: { id: string };
  searchParams: { roomId?: string; card?: string; error?: string; saved?: string };
}) {
  const session = await auth();
  if (session === null) redirect("/login");

  const character = await prisma.character.findUnique({ where: { id: params.id } });
  if (character === null) notFound();

  const roomId = searchParams.roomId ?? null;
  const isOwner = character.userId === session.user.id;
  let isKP = false;
  if (isOwner === false) {
    if (roomId === null) notFound();
    const membership = await prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: session.user.id } }
    });
    if (membership === null || membership.role !== "KP") notFound();
    const entry = await prisma.roomCharacterEntry.findUnique({
      where: { roomId_characterId: { roomId, characterId: character.id } }
    });
    if (entry === null || entry.status !== "APPROVED") notFound();
    isKP = true;
  }

  const system = character.system === "TOUHOU" ? "TOUHOU" : "COC7";
  const pack = resolveRulePack(system === "TOUHOU" ? "touhou-ext" : "coc7-baseline", builtinRegistry());
  const compiled = compileParsedRulePack(pack);

  const occupations = await prisma.occupation.findMany({
    where: { system, era: { in: [...availableEra(character.era)] } },
    orderBy: { code: "asc" }
  });
  const occupation = occupations.find((item) => item.id === character.occupationId) ?? null;
  const occupationView = occupation === null ? null : toOccupationView(occupation);
  const skillProfile = occupationView?.skillProfile ?? null;

  const attributes: AttributeSet = {
    str: character.str,
    con: character.con,
    siz: character.siz,
    dex: character.dex,
    app: character.app,
    int: character.int,
    pow: character.pow,
    edu: character.edu,
    luck: character.luck
  };
  const outcome = computeDerived(compiled, { attributes, race: character.race });
  const vars = outcome.attributes as unknown as Record<string, number>;
  const context = { vars, consts: pack.const };
  const skillBases: Record<string, number> = {};
  for (const skill of compiled.skills) skillBases[skill.id] = Math.floor(evaluate(skill.base, context));
  const occupationMax = Math.floor(evaluate(compiled.skillPoints.occupationMax, context));
  const interestMax = Math.floor(evaluate(compiled.skillPoints.interestMax, context));
  const raceRule = character.race === null ? undefined : pack.races[character.race];
  const interestExpression =
    raceRule?.interestPoints === undefined
      ? compiled.skillPoints.interest
      : compile(raceRule.interestPoints, { vars: [...ATTRIBUTE_KEYS] });
  const interestPool = Math.floor(evaluate(interestExpression, context));
  const occupationPool =
    occupation === null
      ? 0
      : Math.floor(evaluate(compile(occupation.pointsFormula, { vars: [...ATTRIBUTE_KEYS] }), context));

  const allocation = recordOf(character.skillAllocation);
  const occupationAdded = pointMapOf(allocation.occupation);
  const interestAdded = pointMapOf(allocation.interest);
  const existingSlots = recordOf(allocation.slots);
  const skills = recordOf(character.skills);
  const raceMods = recordOf(character.raceMods);
  const ageAllocation = recordOf(raceMods.ageAllocation);
  const backstory = recordOf(character.backstory);

  const equipped = await prisma.card.findMany({ where: { characterId: character.id }, orderBy: { createdAt: "asc" } });
  const library = await prisma.card.findMany({
    where: { ownerId: character.userId, scope: "COMPENDIUM", characterId: null, system: character.system },
    orderBy: { createdAt: "desc" }
  });
  const editingCard = searchParams.card === undefined ? null : equipped.find((card) => card.id === searchParams.card) ?? library.find((card) => card.id === searchParams.card) ?? null;

  const returnTo = "/characters/" + character.id + "/manage" + (roomId === null ? "" : "?roomId=" + roomId);

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-6 px-6 py-12">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={roomId === null ? "/characters/" + character.id : "/rooms/" + roomId + "/characters/" + character.id} className="text-xs text-white/40 transition hover:text-white/70">
            ← 返回角色
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">角色管理 · {character.name}</h1>
          <p className="mt-1 text-sm text-white/50">
            {system} · {occupation?.name ?? "未选择职业"}
            {isKP ? " · KP 模式（技能熟练度只读）" : ""}
          </p>
        </div>
        <span className="text-[11px] text-white/35">属性 / 技能点 / 装备 / 背景故事都在这一页</span>
      </header>

      {searchParams.error === undefined ? null : (
        <p className="rounded-lg border border-red-400/30 bg-red-400/5 px-4 py-3 text-sm text-red-300">{searchParams.error}</p>
      )}
      {searchParams.saved === undefined ? null : (
        <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-300">已保存</p>
      )}

      <form action={updateCharacterFormAction} className="flex flex-col gap-6">
        <input type="hidden" name="characterId" value={character.id} />
        <input type="hidden" name="roomId" value={roomId ?? ""} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="system" value={system} />
        <input type="hidden" name="era" value={character.era ?? ""} />
        <input type="hidden" name="chargenMethod" value={typeof raceMods.method === "string" ? raceMods.method : "manual"} />

        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">基本信息</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <label className={labelClass}>角色名<input name="name" defaultValue={character.name} className={inputClass} /></label>
            <label className={labelClass}>玩家名<input name="playerName" defaultValue={character.playerName ?? ""} className={inputClass} /></label>
            <label className={labelClass}>性别<input name="gender" defaultValue={character.gender ?? ""} className={inputClass} /></label>
            <label className={labelClass}>年龄<input name="age" type="number" min={15} max={90} defaultValue={character.age ?? 30} className={inputClass} /></label>
            <label className={labelClass}>住地<input name="residence" defaultValue={character.residence ?? ""} className={inputClass} /></label>
            <label className={labelClass}>
              职业
              <select name="occupationId" defaultValue={character.occupationId ?? ""} className={inputClass}>
                <option value="">（未选择职业）</option>
                {occupations.map((item) => (
                  <option key={item.id} value={item.id}>{item.code} · {item.name}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">基础属性与资源</h2>
          <p className="mt-1 text-[11px] text-white/40">编辑基础属性会按 COC7 规则重算技能基础值、技能点池与衍生值；下方年龄补正用于改年龄时重新分配。</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(ATTRIBUTE_KEYS as readonly AttributeKey[]).map((key) => (
              <label key={key} className={labelClass}>
                {ATTRIBUTE_LABELS[key] ?? key}
                <input name={"attr_" + key} type="number" defaultValue={character[key]} className={inputClass} />
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {(["str", "con", "siz", "dex"] as const).map((key) => (
              <label key={key} className={labelClass}>
                年龄扣减 {key.toUpperCase()}
                <input name={"age_" + key} type="number" min={0} defaultValue={Number(ageAllocation[key] ?? 0)} className={inputClass} />
              </label>
            ))}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <label className={labelClass}>当前 HP<input name="hp" type="number" defaultValue={character.hp} className={inputClass} /></label>
            <label className={labelClass}>当前 MP<input name="mp" type="number" defaultValue={character.mp} className={inputClass} /></label>
            <label className={labelClass}>当前 SAN<input name="san" type="number" defaultValue={character.san} className={inputClass} /></label>
            <label className={labelClass}>当前 DP<input name="dp" type="number" defaultValue={character.dp} className={inputClass} /></label>
          </div>
          <p className="mt-3 text-[11px] text-white/35">
            派生：HP {outcome.derived.maxHp} · MP {outcome.derived.maxMp} · SAN {outcome.derived.maxSan} · DP {outcome.derived.maxDp}
            · 职业点池 {occupationPool} · 兴趣点池 {interestPool} · 本职上限 {occupationMax} · 兴趣上限 {interestMax}
          </p>
        </section>

        {skillProfile === null ? null : (
          <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
            <h2 className="text-sm font-medium text-white/80">职业空位</h2>
            <p className="mt-1 text-[11px] text-white/40">与房间车卡同一套空位校验；改动职业后需要重新分配。</p>
            <div className="mt-4 flex flex-col gap-3">
              {skillProfile.slots.map((slot) => {
                const picked = Array.isArray(existingSlots[slot.id]) ? (existingSlots[slot.id] as unknown[]).filter((item): item is string => typeof item === "string") : [];
                const candidates = occupationSlotCandidates(slot, compiled.skills.map((skill) => skill.id));
                return (
                  <div key={slot.id} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
                    <p className="text-[11px] text-white/50">{slot.symbol} · {slot.kind} · 选 {slot.pick} 项</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {Array.from({ length: slot.pick }).map((_value, index) => (
                        <select key={index} name={"slot_" + slot.id + "_" + String(index)} defaultValue={picked[index] ?? ""} className={inputClass + " max-w-xs"}>
                          <option value="">（不选）</option>
                          {candidates.map((candidate) => (
                            <option key={candidate.skillId} value={candidate.skillId}>{candidate.label}</option>
                          ))}
                        </select>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">技能（职业点 / 兴趣点）</h2>
          {isKP ? (
            <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2 text-[11px] text-amber-200">
              KP 不能修改技能熟练度；下方加点只读，改动属性后系统会按规则重算基础值。
            </p>
          ) : null}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="text-[11px] text-white/40">
                <tr>
                  <th className="py-2">技能</th>
                  <th className="py-2">基础</th>
                  <th className="py-2">职业点</th>
                  <th className="py-2">兴趣点</th>
                  <th className="py-2">成长</th>
                  <th className="py-2">总值</th>
                  <th className="py-2">困难 / 极限</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {compiled.skills.map((skill) => {
                  const occ = occupationAdded[skill.id] ?? 0;
                  const interest = interestAdded[skill.id] ?? 0;
                  const base = skillBases[skill.id] ?? 0;
                  const growth = Math.max(0, (Number(skills[skill.id] ?? 0)) - base - occ - interest);
                  const total = base + occ + interest + growth;
                  return (
                    <tr key={skill.id}>
                      <td className="py-1.5 text-white/70">{skill.name}</td>
                      <td className="py-1.5 font-mono text-white/45">{base}</td>
                      <td className="py-1.5">
                        <input name={"occ_" + skill.id} type="number" min={0} defaultValue={occ} disabled={isKP} className="w-20 rounded border border-white/15 bg-ink-900 px-2 py-1 font-mono text-xs text-white disabled:opacity-40" />
                      </td>
                      <td className="py-1.5">
                        <input name={"int_" + skill.id} type="number" min={0} defaultValue={interest} disabled={isKP} className="w-20 rounded border border-white/15 bg-ink-900 px-2 py-1 font-mono text-xs text-white disabled:opacity-40" />
                      </td>
                      <td className="py-1.5 font-mono text-white/45">{growth}</td>
                      <td className="py-1.5 font-mono text-white/80">{total}</td>
                      <td className="py-1.5 font-mono text-white/45">{Math.floor(total / 2)} / {Math.floor(total / 5)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
          <h2 className="text-sm font-medium text-white/80">背景故事与经历</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {([
              ["appearance", "角色外貌"], ["beliefs", "思想与信念"], ["significantPeople", "重要之人"],
              ["meaningfulPlaces", "意义非凡之地"], ["treasuredPossessions", "宝贵之物"], ["traits", "特质"],
              ["secrets", "难言之隐"], ["scars", "伤口和疤痕"], ["phobias", "恐惧症和狂躁症"]
            ] as const).map(([key, label]) => (
              <label key={key} className={labelClass}>
                {label}
                <textarea name={"bs_" + key} rows={2} defaultValue={typeof backstory[key] === "string" ? (backstory[key] as string) : ""} className={inputClass} />
              </label>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {([
              ["bs_experiences", "experiences", "调查员经历 JSON"],
              ["bs_mythosExperiences", "mythosExperiences", "神话相关 JSON"],
              ["bs_companions", "companions", "调查员伙伴 JSON"],
              ["bs_spellDetails", "spellDetails", "法术一览 JSON"]
            ] as const).map(([field, key, label]) => (
              <label key={key} className={labelClass}>
                {label}
                <textarea name={field} rows={3} defaultValue={JSON.stringify(backstory[key] ?? [])} className={inputClass + " font-mono text-[11px]"} />
              </label>
            ))}
            <label className={labelClass}>
              法术名称（供施法持有判定，JSON 字符串数组）
              <textarea name="bs_spells" rows={3} defaultValue={JSON.stringify(backstory.spells ?? [])} className={inputClass + " font-mono text-[11px]"} />
            </label>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Link href={"/characters/" + character.id} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-white/60 transition hover:border-white/35">取消</Link>
          <button type="submit" className="rounded-lg bg-sakura-500 px-5 py-2 text-xs font-medium text-white transition hover:bg-sakura-400">保存角色</button>
        </div>
      </form>

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">已装备（{equipped.length}）· 列表模式</h2>
        {equipped.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">还没有装备</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {equipped.map((card) => {
              const stats = (["SPELLCARD", "WEAPON", "ITEM"] as readonly string[]).includes(card.type) ? parseCardStats(card.type as CardKind, card.stats) : null;
              const selectable = stats?.selectableEffects ?? [];
              const active = stats === null || stats.equippedEffects === null || stats.equippedEffects.length === 0
                ? (stats?.effects.map((_effect, index) => index) ?? [])
                : stats.equippedEffects;
              return (
                <div key={card.id} className={"flex flex-col gap-2 rounded-lg border-2 bg-emerald-400/5 px-3 py-2.5 " + cardRarityBorderClass(card.rarity)}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/80">{card.name}</p>
                      <p className="text-[11px] text-white/35">{card.type} · {RARITY_LABELS[card.rarity]}</p>
                      {stats === null || stats.effects.length === 0 ? null : (
                        <p className="mt-1 text-[11px] text-emerald-200/80">生效：{active.map((index) => stats.effects[index]).filter((effect): effect is NonNullable<typeof effect> => effect !== undefined).map((effect) => magicEffectLabel(effect)).join(" + ")}</p>
                      )}
                    </div>
                    <form action={unequipCardAction}>
                      <input type="hidden" name="cardId" value={card.id} />
                      <button type="submit" className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/50 transition hover:border-white/35 hover:text-white">卸下</button>
                    </form>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Link href={returnTo + (returnTo.includes("?") ? "&" : "?") + "card=" + card.id} className="rounded-md border border-sakura-500/40 px-2 py-1 text-[11px] text-sakura-400 transition hover:bg-sakura-500/10">编辑属性</Link>
                    {card.type === "WEAPON" || card.type === "ITEM" ? (
                      <form action={convertCardKindAction}>
                        <input type="hidden" name="cardId" value={card.id} />
                        <input type="hidden" name="targetKind" value={card.type === "WEAPON" ? "ITEM" : "WEAPON"} />
                        <button type="submit" className="rounded-md border border-sky-400/40 px-2 py-1 text-[11px] text-sky-300 transition hover:bg-sky-400/10">{card.type === "WEAPON" ? "转为道具" : "转为武器"}</button>
                      </form>
                    ) : null}
                  </div>
                  {selectable.length === 0 ? null : (
                    <form action={equipCardAction} className="rounded-md border border-white/10 bg-ink-950/40 p-2">
                      <input type="hidden" name="cardId" value={card.id} />
                      <input type="hidden" name="characterId" value={character.id} />
                      <p className="text-[11px] text-white/40">换效果</p>
                      <div className="mt-1 flex flex-col gap-1">
                        {stats?.effects.map((effect, index) => {
                          const isSelectable = selectable.includes(index);
                          return (
                            <label key={index} className="flex items-center gap-2 text-[11px] text-white/60">
                              {isSelectable ? (
                                <input type="checkbox" name="selectedEffects" value={index} defaultChecked={active.includes(index)} />
                              ) : (
                                <span className="inline-block h-3 w-3 rounded-sm border border-emerald-400/50 bg-emerald-400/20" />
                              )}
                              {magicEffectLabel(effect)}
                            </label>
                          );
                        })}
                      </div>
                      <button type="submit" className="mt-2 rounded-md border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-300 transition hover:bg-emerald-400/10">保存效果</button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {editingCard === null ? null : (
        <section className="rounded-xl border border-sakura-500/30 bg-sakura-500/5 p-5">
          <h2 className="text-sm font-medium text-sakura-300">编辑装备属性 · {editingCard.name}</h2>
          <p className="mt-1 text-[11px] text-white/40">直接编辑这张卡本体（卡唯一）。</p>
          <form action={updateCharacterCardFormAction} className="mt-4 flex flex-col gap-4">
            <input type="hidden" name="cardId" value={editingCard.id} />
            <input type="hidden" name="characterId" value={character.id} />
            <input type="hidden" name="roomId" value={roomId ?? ""} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="grid gap-4 sm:grid-cols-3">
              <label className={labelClass}>卡名<input name="name" defaultValue={editingCard.name} className={inputClass} /></label>
              <label className={labelClass}>副标题<input name="subtitle" defaultValue={editingCard.subtitle ?? ""} className={inputClass} /></label>
              <label className={labelClass}>
                类型
                <select name="kind" defaultValue={editingCard.type} className={inputClass}>
                  {(["ITEM", "WEAPON", "SPELLCARD"] as const).map((kind) => (
                    <option key={kind} value={kind}>{CARD_KIND_LABELS[kind]}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className={labelClass}>说明<input name="description" defaultValue={editingCard.description ?? ""} className={inputClass} /></label>
            <div className="grid gap-4 sm:grid-cols-4">
              <label className={labelClass}>目标阵营
                <select name="targeting" defaultValue={String(recordOf(editingCard.stats).targeting ?? "ENEMY")} className={inputClass}>
                  {["SELF", "ALLY", "ENEMY", "ANY"].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className={labelClass}>作用范围
                <select name="targetScope" defaultValue={String(recordOf(editingCard.stats).targetScope ?? "ONE")} className={inputClass}>
                  {["SELF", "ONE", "ALL"].map((item) => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>
              <label className={labelClass}>装备时可选效果下标（逗号分隔）
                <input name="selectableEffects" defaultValue={(Array.isArray(recordOf(editingCard.stats).selectableEffects) ? (recordOf(editingCard.stats).selectableEffects as number[]) : []).join(",")} className={inputClass} />
              </label>
              <label className={labelClass}>武器类型
                <select name="weaponType" defaultValue={String(recordOf(editingCard.stats).weaponType ?? "BRAWL")} className={inputClass}>
                  {WEAPON_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.damage}</option>)}
                </select>
              </label>
            </div>
            <div className="grid gap-4 sm:grid-cols-4">
              <label className={labelClass}>MP 消耗<input name="costMp" type="number" defaultValue={Number(recordOf(recordOf(editingCard.stats).cost).mp ?? 0)} className={inputClass} /></label>
              <label className={labelClass}>SAN 消耗<input name="costSan" defaultValue={String(recordOf(recordOf(editingCard.stats).cost).san ?? "")} className={inputClass} /></label>
              <label className={labelClass}>使用次数<input name="costUses" type="number" defaultValue={recordOf(recordOf(editingCard.stats).cost).uses === null || recordOf(recordOf(editingCard.stats).cost).uses === undefined ? "" : String(recordOf(recordOf(editingCard.stats).cost).uses)} className={inputClass} /></label>
              <label className={labelClass}>冷却轮次<input name="costCooldown" type="number" defaultValue={Number(recordOf(recordOf(editingCard.stats).cost).cooldownRounds ?? 0)} className={inputClass} /></label>
            </div>
            <div className="flex flex-wrap gap-4 text-xs text-white/60">
              <label className="flex items-center gap-2"><input type="checkbox" name="usableIn_COMBAT" defaultChecked={(Array.isArray(recordOf(editingCard.stats).usableIn) ? (recordOf(editingCard.stats).usableIn as string[]) : ["COMBAT"]).includes("COMBAT")} />战斗内可用</label>
              <label className="flex items-center gap-2"><input type="checkbox" name="usableIn_FIELD" defaultChecked={(Array.isArray(recordOf(editingCard.stats).usableIn) ? (recordOf(editingCard.stats).usableIn as string[]) : []).includes("FIELD")} />战斗外可用</label>
              <label className={labelClass + " flex-1"}>道具说明<input name="itemEffect" defaultValue={String(recordOf(editingCard.stats).effect ?? "")} className={inputClass} /></label>
            </div>
            <label className={labelClass}>
              效果 JSON（通用 14 种效果数组）
              <textarea name="effectsJson" rows={5} defaultValue={JSON.stringify(recordOf(editingCard.stats).effects ?? [], null, 1)} className={inputClass + " font-mono text-[11px]"} />
            </label>
            <div className="flex justify-end gap-2">
              <Link href={returnTo} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-white/60 transition hover:border-white/35">取消</Link>
              <button type="submit" className="rounded-lg bg-sakura-500 px-5 py-2 text-xs font-medium text-white transition hover:bg-sakura-400">保存装备属性</button>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-ink-800/50 p-5">
        <h2 className="text-sm font-medium text-white/80">从卡库装备（{library.length}）</h2>
        {library.length === 0 ? (
          <p className="mt-3 text-xs text-white/35">卡库是空的</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {library.map((card) => {
              const stats = (["SPELLCARD", "WEAPON", "ITEM"] as readonly string[]).includes(card.type) ? parseCardStats(card.type as CardKind, card.stats) : null;
              const selectable = stats?.selectableEffects ?? [];
              return (
                <form key={card.id} action={equipCardAction} className={"flex flex-col gap-2 rounded-lg border-2 bg-ink-900/60 px-3 py-2.5 " + cardRarityBorderClass(card.rarity)}>
                  <input type="hidden" name="cardId" value={card.id} />
                  <input type="hidden" name="characterId" value={character.id} />
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-white/70">{card.name}</p>
                      <p className="text-[11px] text-white/30">{card.type} · {RARITY_LABELS[card.rarity]}</p>
                    </div>
                    <button type="submit" className="shrink-0 rounded-md border border-sakura-500/40 px-2 py-1 text-[11px] text-sakura-400 transition hover:bg-sakura-500/10">装备</button>
                  </div>
                  {selectable.length === 0 ? null : (
                    <div className="flex flex-col gap-1">
                      {stats?.effects.map((effect, index) => (
                        <label key={index} className="flex items-center gap-2 text-[11px] text-white/60">
                          {selectable.includes(index) ? <input type="checkbox" name="selectedEffects" value={index} defaultChecked /> : <span className="inline-block h-3 w-3 rounded-sm border border-emerald-400/50 bg-emerald-400/20" />}
                          {magicEffectLabel(effect)}
                        </label>
                      ))}
                    </div>
                  )}
                </form>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
