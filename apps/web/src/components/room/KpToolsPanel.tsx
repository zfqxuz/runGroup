"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Ack } from "@/shared/socket";
import { WEAPON_TYPES } from "@/shared/card";
import { SPECIALTY_BASE_IDS, SPECIALTY_BASE_LABELS, type SpecialtyCandidate } from "@/shared/specialty";

interface UnitOption {
  readonly ref: string;
  readonly name: string;
  readonly kind: "PLAYER" | "NPC";
}

interface ConditionView {
  readonly id: string;
  readonly type: string;
  readonly duration: { readonly unit: string; readonly remaining: number; readonly note?: string };
  readonly visibility: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

interface UnitValues {
  readonly hp?: number;
  readonly maxHp?: number;
  readonly mp?: number;
  readonly maxMp?: number;
  readonly san?: number;
  readonly maxSan?: number;
  readonly conditions?: readonly ConditionView[];
  readonly flags?: {
    readonly majorWound?: boolean;
    readonly dying?: boolean;
    readonly unconscious?: boolean;
    readonly dead?: boolean;
  };
  readonly skills?: Readonly<Record<string, number>>;
}

interface Props {
  readonly roomId: string;
  readonly units: readonly UnitOption[];
}

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-xs text-white/80 outline-none focus:border-sakura-500";

const CUSTOM_CONDITION_SUGGESTIONS = [
  "DOT",
  "POISON",
  "DISEASE",
  "CURSE",
  "BOUND",
  "STUN",
  "CONTROL",
  "ARMOR",
  "POSSESS"
];

const DAMAGE_TYPES = ["火焰", "溺水", "窒息", "毒气", "坠落", "电击", "极寒", "酸液"];

const MEDICAL_ACTIONS = [
  ["FIRST_AID", "急救（受伤后 1 小时内）"],
  ["MEDICINE", "医学（超过一天需困难成功）"],
  ["NATURAL_HEALING", "自然恢复（未重伤每日 1 HP）"],
  ["WEEKLY_RECOVERY", "重伤每周恢复检定（CON）"]
] as const;

function numberOr(value: string, fallback: number): number {
  const number = Number(value);
  if (Number.isFinite(number) === false) return fallback;
  return Math.max(0, Math.floor(number));
}

export default function KpToolsPanel(props: Props) {
  const [unitRef, setUnitRef] = useState(props.units[0]?.ref ?? "");
  const [values, setValues] = useState<UnitValues>({});
  const [source, setSource] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [socketReady, setSocketReady] = useState(false);
  const [tab, setTab] = useState<"MEDICAL" | "ENVIRONMENT" | "CONDITION" | "QUICK" | "REFERENCE" | "SPECIALTY">("MEDICAL");

  const [medicalAction, setMedicalAction] = useState<(typeof MEDICAL_ACTIONS)[number][0]>("FIRST_AID");
  const [hours, setHours] = useState("1");
  const [days, setDays] = useState("1");

  const [damageType, setDamageType] = useState(DAMAGE_TYPES[0] ?? "火焰");
  const [damageExpr, setDamageExpr] = useState("1d6");
  const [damageRounds, setDamageRounds] = useState("0");
  const [damageNote, setDamageNote] = useState("");

  const [conditionType, setConditionType] = useState("POISON");
  const [conditionUnit, setConditionUnit] = useState("ROUND");
  const [conditionRemaining, setConditionRemaining] = useState("3");
  const [conditionNote, setConditionNote] = useState("");
  const [conditionVisibility, setConditionVisibility] = useState("PUBLIC");
  const [timeUnit, setTimeUnit] = useState("HOUR");
  const [timeSteps, setTimeSteps] = useState("1");

  const [skillId, setSkillId] = useState("");
  const [pushReason, setPushReason] = useState("");
  const [spendLuck, setSpendLuck] = useState("0");

  const [calcHp, setCalcHp] = useState("5");
  const [calcMaxHp, setCalcMaxHp] = useState("10");
  const [calcMajorWound, setCalcMajorWound] = useState(false);
  const [calcHours, setCalcHours] = useState("1");
  const [calcDays, setCalcDays] = useState("1");
  const [specialtyCandidates, setSpecialtyCandidates] = useState<SpecialtyCandidate[]>([]);
  const [candidateBaseId, setCandidateBaseId] = useState<string>(SPECIALTY_BASE_IDS[0]);
  const [candidateName, setCandidateName] = useState("");
  const [specialtyMessage, setSpecialtyMessage] = useState<string | null>(null);
  const [specialtyLoaded, setSpecialtyLoaded] = useState(false);

  const socketRef = useRef<Socket | null>(null);
  const unitRefRef = useRef(unitRef);
  unitRefRef.current = unitRef;

  useEffect(() => {
    let cancelled = false;
    const socket = io({ path: "/api/socket", autoConnect: false, transports: ["websocket"] });
    socketRef.current = socket;
    async function bootstrap(): Promise<void> {
      const response = await fetch("/api/socket-ticket", { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; ticket?: string };
      if (cancelled || payload.ok === false || payload.ticket === undefined) return;
      socket.auth = { ticket: payload.ticket };
      socket.connect();
    }
    void bootstrap();
    socket.on("connect", () => {
      if (cancelled === false) setSocketReady(true);
    });
    socket.on("disconnect", () => {
      if (cancelled === false) setSocketReady(false);
    });
    socket.on("room:refresh", (payload: { roomId?: string }) => {
      if (cancelled === false && payload?.roomId === props.roomId) requestValues();
    });
    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.close();
    };
  }, [props.roomId]);

  function loadSpecialtyCandidates(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) return;
    setSpecialtyLoaded(false);
    socket.emit(
      "room:specialty-candidates",
      { roomId: props.roomId },
      (result: Ack & { candidates?: SpecialtyCandidate[] }) => {
        if (result.ok === false) {
          setSpecialtyMessage(result.error ?? "读取专精候选失败");
          return;
        }
        setSpecialtyCandidates(result.candidates ?? []);
        setSpecialtyLoaded(true);
        setSpecialtyMessage(null);
      }
    );
  }

  function requestValues(): void {
    const socket = socketRef.current;
    const targetRef = unitRefRef.current;
    if (socket === null || socket.connected === false || targetRef.length === 0) return;
    socket.emit(
      "room:unit-values",
      { roomId: props.roomId, unitRef: targetRef },
      (result: Ack & { source?: string; values?: UnitValues }) => {
        if (result.ok === false) {
          setMessage(result.error ?? "读取单位数值失败");
          return;
        }
        setValues(result.values ?? {});
        setSource(result.source ?? null);
      }
    );
  }

  useEffect(() => {
    if (socketReady === false) return;
    setMessage(null);
    requestValues();
  }, [socketReady, unitRef]);

  useEffect(() => {
    if (socketReady === false) return;
    loadSpecialtyCandidates();
  }, [socketReady]);

  function emitTool(
    event: string,
    payload: Record<string, unknown>,
    onDone?: (result: Ack & { text?: string; note?: string }) => void
  ): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setMessage("连接已断开，请刷新后重试");
      return;
    }
    socket.emit(event, { roomId: props.roomId, unitRef, visibility: "PUBLIC", ...payload }, (result: Ack & { text?: string; note?: string }) => {
      if (result.ok === false) {
        setMessage(result.error ?? "操作失败");
        return;
      }
      setMessage(result.note ?? result.text ?? "操作完成");
      requestValues();
      onDone?.(result);
    });
  }

  const selectedUnit = props.units.find((item) => item.ref === unitRef) ?? null;
  const conditions = values.conditions ?? [];
  const skillOptions = Object.keys(values.skills ?? {}).slice(0, 400);

  return (
    <section className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-emerald-200">KP 工作台 · 医疗 / 环境 / 状态 / 快捷检定</h2>
          <p className="mt-0.5 text-[10px] text-white/45">
            真实规则动作：急救、医学、自然恢复、重伤周检、环境伤害、状态编辑、幸运检定、孤注一掷。
          </p>
        </div>
        <button
          type="button"
          onClick={requestValues}
          className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-white/60 transition hover:border-white/35"
        >
          刷新数值
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {props.units.length === 0 ? (
          <span className="rounded-lg border border-white/10 bg-ink-900/40 px-3 py-2 text-[11px] text-white/40">
            当前没有可操作单位（专精候选 / 武器伤害表仍可用）
          </span>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">目标单位</span>
            <select value={unitRef} onChange={(event) => setUnitRef(event.target.value)} className={inputClass + " min-w-[180px]"}>
              {props.units.map((unit) => (
                <option key={unit.ref} value={unit.ref}>
                  {unit.name}（{unit.kind === "NPC" ? "NPC" : "玩家"}）
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="rounded-lg border border-white/10 bg-ink-900/40 px-3 py-1.5 font-mono text-[11px] text-white/60">
          HP {values.hp ?? "?"}/{values.maxHp ?? "?"} · MP {values.mp ?? "?"}/{values.maxMp ?? "?"} · SAN {values.san ?? "?"}/
          {values.maxSan ?? "?"}
          {source === null ? "" : " · " + source}
        </div>
        {values.flags?.dead ? <span className="rounded border border-red-400/50 px-2 py-0.5 text-[10px] text-red-300">死亡</span> : null}
        {values.flags?.dying ? <span className="rounded border border-red-400/50 px-2 py-0.5 text-[10px] text-red-300">濒死</span> : null}
        {values.flags?.majorWound ? <span className="rounded border border-amber-400/50 px-2 py-0.5 text-[10px] text-amber-300">重伤</span> : null}
        {values.flags?.unconscious ? <span className="rounded border border-white/20 px-2 py-0.5 text-[10px] text-white/50">昏迷</span> : null}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {(
          [
            ["MEDICAL", "医疗与恢复"],
            ["ENVIRONMENT", "环境 / 持续伤害"],
            ["CONDITION", "状态编辑器"],
            ["QUICK", "幸运 / 孤注一掷 / 计算器"],
            ["REFERENCE", "武器 / 伤害表"],
            ["SPECIALTY", "专精候选"]
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={
              "rounded-full border px-3 py-1 text-[11px] transition " +
              (tab === key ? "border-emerald-400/60 text-emerald-200" : "border-white/15 text-white/50 hover:border-white/35")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "MEDICAL" ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">医疗动作</span>
            <select
              value={medicalAction}
              onChange={(event) => setMedicalAction(event.target.value as (typeof MEDICAL_ACTIONS)[number][0])}
              className={inputClass}
            >
              {MEDICAL_ACTIONS.map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          {(medicalAction === "FIRST_AID" || medicalAction === "MEDICINE") ? (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">受伤后小时数</span>
              <input value={hours} onChange={(event) => setHours(event.target.value)} inputMode="numeric" className={inputClass + " w-24"} />
            </label>
          ) : null}
          {medicalAction === "NATURAL_HEALING" ? (
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">恢复天数</span>
              <input value={days} onChange={(event) => setDays(event.target.value)} inputMode="numeric" className={inputClass + " w-24"} />
            </label>
          ) : null}
          <button
            type="button"
            onClick={() =>
              emitTool("room:medical", {
                characterId: selectedUnit?.ref.startsWith("character:") ? selectedUnit.ref.slice(10) : "",
                action: medicalAction,
                hoursSinceInjury: numberOr(hours, 1),
                days: numberOr(days, 1)
              })
            }
            disabled={selectedUnit === null || selectedUnit.kind !== "PLAYER"}
            className="rounded-lg bg-emerald-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            执行医疗
          </button>
          {selectedUnit?.kind === "NPC" ? <span className="text-[10px] text-white/35">医疗动作目前只支持玩家角色。</span> : null}
        </div>
      ) : null}

      {tab === "ENVIRONMENT" ? (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">伤害类型</span>
            <select value={damageType} onChange={(event) => setDamageType(event.target.value)} className={inputClass}>
              {DAMAGE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">每轮伤害</span>
            <input value={damageExpr} onChange={(event) => setDamageExpr(event.target.value)} className={inputClass + " w-24 font-mono"} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">持续轮数（0 = 只结算一次）</span>
            <input value={damageRounds} onChange={(event) => setDamageRounds(event.target.value)} inputMode="numeric" className={inputClass + " w-28"} />
          </label>
          <input
            value={damageNote}
            onChange={(event) => setDamageNote(event.target.value)}
            placeholder="备注（可选）"
            className={inputClass + " min-w-[140px] flex-1"}
          />
          <button
            type="button"
            onClick={() =>
              emitTool("room:environment-damage", {
                damageType,
                expression: damageExpr,
                rounds: numberOr(damageRounds, 0),
                note: damageNote
              })
            }
            className="rounded-lg bg-orange-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-orange-300"
          >
            施加环境伤害
          </button>
        </div>
      ) : null}

      {tab === "CONDITION" ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">状态 key</span>
              <input list="condition-types" value={conditionType} onChange={(event) => setConditionType(event.target.value)} className={inputClass + " w-40"} />
              <datalist id="condition-types">
                {CUSTOM_CONDITION_SUGGESTIONS.map((type) => <option key={type} value={type} />)}
              </datalist>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">时间单位</span>
              <select value={conditionUnit} onChange={(event) => setConditionUnit(event.target.value)} className={inputClass}>
                {["ROUND", "CHARGE", "MINUTE", "HOUR", "DAY", "NARRATIVE"].map((unit) => (
                  <option key={unit} value={unit}>{unit}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">剩余</span>
              <input value={conditionRemaining} onChange={(event) => setConditionRemaining(event.target.value)} inputMode="numeric" className={inputClass + " w-20"} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">可见性</span>
              <select value={conditionVisibility} onChange={(event) => setConditionVisibility(event.target.value)} className={inputClass}>
                <option value="PUBLIC">公开</option>
                <option value="PARTY">队伍</option>
                <option value="KP">仅 KP</option>
              </select>
            </label>
            <input
              value={conditionNote}
              onChange={(event) => setConditionNote(event.target.value)}
              placeholder="说明（可选）"
              className={inputClass + " min-w-[140px] flex-1"}
            />
            <button
              type="button"
              onClick={() =>
                emitTool("room:condition-add", {
                  type: conditionType,
                  unit: conditionUnit,
                  remaining: numberOr(conditionRemaining, 0),
                  visibility: conditionVisibility,
                  note: conditionNote
                })
              }
              className="rounded-lg bg-sky-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-sky-300"
            >
              添加状态
            </button>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            {conditions.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-white/35">当前没有状态。</p>
            ) : (
              conditions.map((condition) => (
                <div key={condition.id} className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-1.5 last:border-b-0">
                  <span className="text-[11px] text-white/70">
                    <span className="font-mono text-emerald-300">{condition.type}</span>
                    {" · "}{condition.duration.unit} {condition.duration.remaining}
                    {condition.duration.note ? " · " + condition.duration.note : ""}
                    {" · "}{condition.visibility}
                  </span>
                  <button
                    type="button"
                    onClick={() => emitTool("room:condition-remove", { conditionId: condition.id })}
                    className="rounded border border-red-400/40 px-2 py-0.5 text-[10px] text-red-300 transition hover:bg-red-400/10"
                  >
                    移除
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/5 p-3">
            <div className="min-w-[180px]">
              <p className="text-[11px] font-medium text-cyan-200">推进叙事时间（D-3 幻觉 / 疯狂倒计时）</p>
              <p className="mt-0.5 text-[10px] text-white/40">按 MINUTE / HOUR / DAY 扣减所有角色限时状态，到期自动移除。</p>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">单位</span>
              <select value={timeUnit} onChange={(event) => setTimeUnit(event.target.value)} className={inputClass}>
                <option value="MINUTE">分钟</option>
                <option value="HOUR">小时</option>
                <option value="DAY">天</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">数量</span>
              <input value={timeSteps} onChange={(event) => setTimeSteps(event.target.value)} inputMode="numeric" className={inputClass + " w-20"} />
            </label>
            <button
              type="button"
              onClick={() => emitTool("room:advance-time", { unit: timeUnit, steps: numberOr(timeSteps, 1) })}
              className="rounded-lg bg-cyan-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-cyan-300"
            >
              推进时间
            </button>
          </div>
        </div>
      ) : null}

      {tab === "QUICK" ? (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-ink-900/40 p-3">
            <h3 className="text-[11px] text-white/60">幸运检定 / 消耗幸运</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">消耗幸运点</span>
                <input value={spendLuck} onChange={(event) => setSpendLuck(event.target.value)} inputMode="numeric" className={inputClass + " w-24"} />
              </label>
              <button
                type="button"
                onClick={() => emitTool("room:luck-check", { spendLuck: numberOr(spendLuck, 0) })}
                disabled={selectedUnit === null || selectedUnit.kind !== "PLAYER"}
                className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                投幸运检定
              </button>
            </div>
            <p className="mt-2 text-[10px] text-white/35">消耗幸运会在成功后从角色卡扣除；只能对玩家角色使用。</p>
          </div>

          <div className="rounded-lg border border-white/10 bg-ink-900/40 p-3">
            <h3 className="text-[11px] text-white/60">孤注一掷（重掷技能）</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">技能</span>
                <input list="kp-skill-options" value={skillId} onChange={(event) => setSkillId(event.target.value)} placeholder="FIGHTING_BRAWL" className={inputClass + " w-48 font-mono"} />
                <datalist id="kp-skill-options">
                  {skillOptions.map((id) => <option key={id} value={id} />)}
                </datalist>
              </label>
              <input
                value={pushReason}
                onChange={(event) => setPushReason(event.target.value)}
                placeholder="玩家如何孤注一掷"
                className={inputClass + " min-w-[140px] flex-1"}
              />
              <button
                type="button"
                onClick={() =>
                  emitTool("room:push-roll", {
                    characterId: selectedUnit?.ref.startsWith("character:") ? selectedUnit.ref.slice(10) : "",
                    skillId,
                    reason: pushReason
                  })
                }
                disabled={selectedUnit === null || selectedUnit.kind !== "PLAYER" || skillId.trim().length === 0}
                className="rounded-lg bg-fuchsia-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-40"
              >
                孤注一掷
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-ink-900/40 p-3 lg:col-span-2">
            <h3 className="text-[11px] text-white/60">治疗计算器（只读估算，不写回战斗）</h3>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">当前 HP</span>
                <input value={calcHp} onChange={(event) => setCalcHp(event.target.value)} inputMode="numeric" className={inputClass + " w-20"} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">最大 HP</span>
                <input value={calcMaxHp} onChange={(event) => setCalcMaxHp(event.target.value)} inputMode="numeric" className={inputClass + " w-20"} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">受伤后小时</span>
                <input value={calcHours} onChange={(event) => setCalcHours(event.target.value)} inputMode="numeric" className={inputClass + " w-20"} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">恢复天数</span>
                <input value={calcDays} onChange={(event) => setCalcDays(event.target.value)} inputMode="numeric" className={inputClass + " w-20"} />
              </label>
              <label className="flex items-center gap-1 pt-4 text-[11px] text-white/55">
                <input type="checkbox" checked={calcMajorWound} onChange={(event) => setCalcMajorWound(event.target.checked)} />
                重伤
              </label>
            </div>
            <p className="mt-2 font-mono text-[11px] text-white/60">
              {(() => {
                const hp = numberOr(calcHp, 0);
                const maxHp = Math.max(1, numberOr(calcMaxHp, 1));
                const h = numberOr(calcHours, 0);
                const d = Math.max(1, numberOr(calcDays, 1));
                const firstAid = h <= 1 ? "急救可用：成功 +1 HP、稳定濒死" : "急救已超过 1 小时：不可用";
                const medicine = h > 24 ? "医学需困难成功：1D3" : "医学常规成功：1D3";
                const natural = calcMajorWound ? "重伤：不能每日自然恢复" : "自然恢复：" + Math.min(d, maxHp - hp) + " HP（" + d + " 天）";
                const weekly = calcMajorWound ? "重伤周检：成功 1D3 / 极难 2D3，回到半血以上移除重伤" : "未重伤：无需周检";
                return [firstAid, medicine, natural, weekly].join(" ｜ ");
              })()}
            </p>
          </div>
        </div>
      ) : null}

      {tab === "REFERENCE" ? (
        <div className="mt-3 space-y-3">
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full min-w-[720px] text-left text-[11px]">
              <thead className="bg-white/5 text-white/45">
                <tr>
                  <th className="px-3 py-2">武器</th>
                  <th className="px-3 py-2">使用技能</th>
                  <th className="px-3 py-2">伤害</th>
                  <th className="px-3 py-2">类型</th>
                  <th className="px-3 py-2">射程</th>
                  <th className="px-3 py-2">距离档 / 射击数</th>
                </tr>
              </thead>
              <tbody>
                {WEAPON_TYPES.map((weapon) => (
                  <tr key={weapon.id} className="border-t border-white/5 text-white/70">
                    <td className="px-3 py-1.5 font-medium text-white/85">{weapon.label}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-white/55">{weapon.skillId}</td>
                    <td className="px-3 py-1.5 font-mono text-amber-200">{weapon.damage}</td>
                    <td className="px-3 py-1.5">
                      {weapon.damageType === "BLUNT" ? "钝击" : weapon.damageType === "IMPALING" ? "贯穿" : "不可贯穿（霰弹）"}
                    </td>
                    <td className="px-3 py-1.5">{weapon.range === "MELEE" ? "接触" : weapon.range === "NEAR" ? "近距" : "远距"}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-white/55">
                      {weapon.damageBands === undefined
                        ? ""
                        : weapon.damageBands
                            .map((band) => band.label + " " + band.expression + "（" + (band.maxFeet === null ? "不限" : band.maxFeet === "DEX" ? "DEX 英尺" : band.maxFeet + " 英尺") + "）")
                            .join(" / ")}
                      {weapon.shots === undefined ? "" : (weapon.damageBands === undefined ? "" : " · ") + "射击 " + weapon.shots.join("/") + " 次"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border border-white/10 bg-ink-900/40 p-3 text-[11px] leading-relaxed text-white/60">
            <p className="font-medium text-white/75">伤害与重伤规则参考</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>单次伤害 ≥ 最大 HP → 当场死亡；≥ 最大 HP 的一半 → 重伤并倒地，随后进行 CON 检定，失败昏迷。</li>
              <li>已重伤且 HP 归零 → 濒死；下一轮结束起每轮 CON 检定，失败死亡。</li>
              <li>极限 / 大成功：钝击取最大武器伤害 + DB；贯穿武器额外掷一次武器伤害骰；霰弹枪（不可贯穿）不额外掷。</li>
              <li>火器 / 投掷不能被闪避或反击，只能“不应对 / 寻找掩体”；寻找掩体成功后攻击者获得 1 枚惩罚骰。</li>
              <li>霰弹枪近距离档按 DEX 英尺计算；普通档 2D6。</li>
              <li>投掷最大射程 = STR/5 码；超出时行动被服务端拒绝。</li>
              <li>未重伤角色每天自然恢复 1 HP；重伤每周 CON 检定，成功 1D3、极难 2D3，回到半血以上移除重伤。</li>
            </ul>
          </div>
        </div>
      ) : null}

      {tab === "SPECIALTY" ? (
        <div className="mt-3 space-y-3">
          <div className="rounded-lg border border-white/10 bg-ink-900/40 p-3 text-[11px] text-white/55">
            为「外语 / 科学 / 驾驶 / 生存 / 技艺 / 射击」维护房间级候选名称；车卡页会作为专精名称下拉候选（仍可自由输入）。保存到 `Room.ruleOverride.specialtyCandidates`。
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">基础技能</span>
              <select value={candidateBaseId} onChange={(event) => setCandidateBaseId(event.target.value)} className={inputClass}>
                {SPECIALTY_BASE_IDS.map((baseId) => (
                  <option key={baseId} value={baseId}>{SPECIALTY_BASE_LABELS[baseId] ?? baseId}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">候选名称</span>
              <input
                value={candidateName}
                disabled={specialtyLoaded === false}
                onChange={(event) => setCandidateName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  const name = candidateName.trim();
                  if (name.length === 0) return;
                  setSpecialtyCandidates((prev) => prev.some((item) => item.baseId === candidateBaseId && item.name === name) ? prev : [...prev, { baseId: candidateBaseId, name }]);
                  setCandidateName("");
                }}
                placeholder="例：拉丁语 / 生物学 / 沙漠"
                className={inputClass + " w-44"}
              />
            </label>
            <button
              type="button"
              disabled={specialtyLoaded === false}
              onClick={() => {
                const name = candidateName.trim();
                if (name.length === 0) {
                  setSpecialtyMessage("请填写候选名称");
                  return;
                }
                setSpecialtyCandidates((prev) =>
                  prev.some((item) => item.baseId === candidateBaseId && item.name === name)
                    ? prev
                    : [...prev, { baseId: candidateBaseId, name }]
                );
                setCandidateName("");
                setSpecialtyMessage(null);
              }}
              className="rounded-lg border border-emerald-400/40 px-4 py-2 text-xs text-emerald-200 transition hover:bg-emerald-400/10"
            >
              添加到列表
            </button>
          </div>
          <div className="overflow-hidden rounded-lg border border-white/10">
            {specialtyLoaded === false ? (
              <p className="px-3 py-2 text-[11px] text-white/35">正在读取专精候选…</p>
            ) : specialtyCandidates.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-white/35">还没有候选；先在左侧添加。</p>
            ) : (
              SPECIALTY_BASE_IDS.map((baseId) => {
                const rows = specialtyCandidates.filter((item) => item.baseId === baseId);
                if (rows.length === 0) return null;
                return (
                  <div key={baseId} className="border-b border-white/5 px-3 py-2 last:border-b-0">
                    <p className="text-[10px] text-white/35">{SPECIALTY_BASE_LABELS[baseId] ?? baseId}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {rows.map((item) => (
                        <span key={item.name} className="inline-flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[11px] text-white/70">
                          {item.name}
                          <button
                            type="button"
                            onClick={() => setSpecialtyCandidates((prev) => prev.filter((candidate) => !(candidate.baseId === item.baseId && candidate.name === item.name)))}
                            className="text-red-300 transition hover:text-red-200"
                          >
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={specialtyLoaded === false}
              onClick={() => {
                const socket = socketRef.current;
                if (socket === null || socket.connected === false) {
                  setSpecialtyMessage("连接已断开，请刷新后重试");
                  return;
                }
                socket.emit(
                  "room:specialty-candidates-save",
                  { roomId: props.roomId, candidates: specialtyCandidates },
                  (result: Ack & { candidates?: SpecialtyCandidate[] }) => {
                    if (result.ok === false) {
                      setSpecialtyMessage(result.error ?? "保存失败");
                      return;
                    }
                    setSpecialtyCandidates(result.candidates ?? specialtyCandidates);
                    setSpecialtyMessage("已保存 " + (result.candidates?.length ?? specialtyCandidates.length) + " 条专精候选");
                  }
                );
              }}
              className="rounded-lg bg-emerald-400 px-4 py-2 text-xs font-medium text-white transition hover:bg-emerald-300"
            >
              保存专精候选
            </button>
            <button
              type="button"
              onClick={loadSpecialtyCandidates}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35"
            >
              重新读取
            </button>
            {specialtyMessage === null ? null : <span className="text-[11px] text-white/55">{specialtyMessage}</span>}
          </div>
        </div>
      ) : null}

      {message === null ? null : <p className="mt-3 text-[11px] text-white/55">{message}</p>}
    </section>
  );
}
