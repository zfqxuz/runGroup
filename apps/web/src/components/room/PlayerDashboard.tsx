"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import type { CombatLifecycle, CombatJoinAck, CombatUpdate, JoinAck, RoomRefresh, RoomUpdate } from "@/shared/socket";

export interface DashboardCondition {
  readonly id: string;
  readonly type: string;
  readonly unit: string;
  readonly remaining: number;
  readonly note: string | null;
}

export interface DashboardWeapon {
  readonly name: string;
  readonly damage: string | null;
  readonly skillLabel: string | null;
  readonly rangeText: string | null;
}

export interface DashboardItem {
  readonly name: string;
  readonly location: string | null;
  readonly status: string | null;
  readonly note: string | null;
}

export interface DashboardData {
  readonly characterId: string;
  readonly name: string;
  readonly occupation: string | null;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly san: number;
  readonly maxSan: number;
  readonly dp: number;
  readonly maxDp: number;
  readonly attributes: Readonly<Record<string, number>>;
  readonly conditions: readonly DashboardCondition[];
  readonly portraitUrl: string | null;
  readonly equipment: {
    readonly weapons: readonly DashboardWeapon[];
    readonly items: readonly DashboardItem[];
    readonly assets: {
      readonly creditRating: string | null;
      readonly cash: number | null;
      readonly cashUnit: string | null;
      readonly otherAssetsValue: string | null;
    } | null;
  };
}

interface Props {
  readonly roomId: string;
  readonly data: DashboardData | null;
  readonly activeCombatIds: readonly string[];
}

interface Vitals {
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  san: number;
  maxSan: number;
  dp: number;
  maxDp: number;
  conditions: DashboardCondition[];
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  str: "力量", con: "体质", siz: "体型", dex: "敏捷", app: "外貌",
  int: "智力", pow: "意志", edu: "教育", luck: "幸运"
};

const CONDITION_LABELS: Record<string, string> = {
  MAJOR_WOUND: "重伤", PRONE: "倒地", UNCONSCIOUS: "昏迷", DYING: "濒死", DEAD: "死亡",
  INSANITY: "疯狂", POSSESS: "夺舍", ARMOR: "护甲", STUN: "眩晕", CONTROL: "控制",
  DOT: "持续伤害", POISON: "中毒", DISEASE: "疾病", CURSE: "诅咒", BOUND: "束缚", SILENCE: "沉默",
  SUMMON: "召唤物"
};

const POSITIVE_TYPES = new Set(["ARMOR", "STATUS:HASTE", "HEAL"]);

interface StatTone {
  readonly bar: string;
  readonly text: string;
  readonly card: string;
}

/** 健康比例对应的强调色；低血量走战斗界面同款 黄 / 红 阈值。 */
const HEALTHY_TONES: Record<string, StatTone> = {
  emerald: { bar: "bg-emerald-400", text: "text-emerald-300", card: "border-emerald-400/40 bg-emerald-400/10" },
  sky: { bar: "bg-sky-400", text: "text-sky-300", card: "border-sky-400/40 bg-sky-400/10" },
  violet: { bar: "bg-violet-400", text: "text-violet-300", card: "border-violet-400/40 bg-violet-400/10" },
  amber: { bar: "bg-amber-400", text: "text-amber-300", card: "border-amber-400/40 bg-amber-400/10" }
};
const MID_TONE: StatTone = { bar: "bg-amber-400", text: "text-amber-300", card: "border-amber-400/50 bg-amber-400/15" };
const LOW_TONE: StatTone = { bar: "bg-red-400", text: "text-red-300", card: "border-red-400/60 bg-red-400/15" };

function statTone(current: number, max: number, healthy: string): StatTone {
  const ratio = max > 0 ? current / max : 0;
  if (ratio <= 0.25) return LOW_TONE;
  if (ratio <= 0.5) return MID_TONE;
  return HEALTHY_TONES[healthy] ?? MID_TONE;
}

function conditionLabel(type: string): string {
  if (type.startsWith("STATUS:")) return "状态 " + type.slice(7);
  return CONDITION_LABELS[type] ?? type;
}

function conditionTone(type: string): string {
  if (POSITIVE_TYPES.has(type) || type.startsWith("STATUS:HASTE")) {
    return "border-emerald-400/40 bg-emerald-400/10 text-emerald-200";
  }
  const negative = new Set(["MAJOR_WOUND", "PRONE", "UNCONSCIOUS", "DYING", "DEAD", "INSANITY", "POSSESS", "STUN", "CONTROL", "DOT", "POISON", "DISEASE", "CURSE", "BOUND", "SILENCE"]);
  if (negative.has(type)) return "border-red-400/40 bg-red-400/10 text-red-200";
  return "border-white/15 bg-white/5 text-white/60";
}

/**
 * 玩家看板：仅显示当前视角自己的角色，实时展示 HP / MP / SAN / DP、属性与 buff / debuff。
 * 只订阅自己所在战斗的更新；地图左侧，与右侧跑团日志对称。
 */
export default function PlayerDashboard(props: Props) {
  const initial = props.data;
  const [vitals, setVitals] = useState<Vitals | null>(() =>
    initial === null
      ? null
      : {
          hp: initial.hp, maxHp: initial.maxHp,
          mp: initial.mp, maxMp: initial.maxMp,
          san: initial.san, maxSan: initial.maxSan,
          dp: initial.dp, maxDp: initial.maxDp,
          conditions: [...initial.conditions]
        }
  );
  const socketRef = useRef<Socket | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (initial === null) return;
    setVitals({
      hp: initial.hp, maxHp: initial.maxHp,
      mp: initial.mp, maxMp: initial.maxMp,
      san: initial.san, maxSan: initial.maxSan,
      dp: initial.dp, maxDp: initial.maxDp,
      conditions: [...initial.conditions]
    });
  }, [initial]);

  useEffect(() => {
    if (props.data === null) return;
    let cancelled = false;
    const socket = io({ path: "/api/socket", autoConnect: false, transports: ["websocket"] });
    socketRef.current = socket;
    const characterId = props.data.characterId;
    const combatIds = new Set(props.activeCombatIds);

    function applyCombatView(view: CombatUpdate["view"]): void {
      const participant = view.participants.find((item) => item.id === characterId);
      if (participant === undefined) return;
      // 战斗视图只下发自己看得到的数值；maxMp / maxSan 没有单独字段时保留服务端初始值。
      setVitals((prev) => ({
        hp: participant.hp ?? prev?.hp ?? 0,
        maxHp: participant.maxHp ?? prev?.maxHp ?? 0,
        mp: participant.mp ?? prev?.mp ?? 0,
        maxMp: prev?.maxMp ?? 0,
        san: participant.san ?? prev?.san ?? 0,
        maxSan: prev?.maxSan ?? 0,
        dp: participant.dp ?? prev?.dp ?? 0,
        maxDp: prev?.maxDp ?? 0,
        conditions: participant.conditions.map((condition) => ({
          id: condition.id,
          type: condition.type,
          unit: condition.unit,
          remaining: condition.remaining,
          note: condition.note
        }))
      }));
    }

    async function bootstrap(): Promise<void> {
      const response = await fetch("/api/socket-ticket", { method: "POST" });
      const payload = (await response.json()) as { ok: boolean; ticket?: string };
      if (cancelled) return;
      if (payload.ok === false || payload.ticket === undefined) return;
      socket.auth = { ticket: payload.ticket };
      socket.connect();
    }

    socket.on("connect", () => {
      if (cancelled) return;
      socket.emit("room:join", props.roomId, (_result: JoinAck) => undefined);
      for (const combatId of combatIds) {
        socket.emit("combat:join", combatId, (result: CombatJoinAck) => {
          if (result.ok && result.view !== undefined) applyCombatView(result.view);
        });
      }
    });
    socket.on("combat:update", (payload: CombatUpdate) => {
      if (cancelled) return;
      applyCombatView(payload.view);
    });
    socket.on("combat:started", (payload: CombatLifecycle) => {
      if (cancelled) return;
      if (payload.roomId !== props.roomId) return;
      router.refresh();
    });
    socket.on("room:refresh", (payload: RoomRefresh) => {
      if (cancelled || payload.roomId !== props.roomId) return;
      router.refresh();
    });
    socket.on("room:update", (payload: RoomUpdate) => {
      if (cancelled || payload.roomId !== props.roomId) return;
      router.refresh();
    });

    void bootstrap();
    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.close();
    };
  }, [props.data, props.roomId, props.activeCombatIds, router]);

  if (props.data === null || vitals === null) return null;

  const rows: readonly { readonly label: string; readonly current: number; readonly max: number; readonly healthy: string }[] = [
    { label: "HP", current: vitals.hp, max: vitals.maxHp, healthy: "emerald" },
    { label: "MP", current: vitals.mp, max: vitals.maxMp, healthy: "sky" },
    { label: "SAN", current: vitals.san, max: vitals.maxSan, healthy: "violet" },
    { label: "DP", current: vitals.dp, max: vitals.maxDp, healthy: "amber" }
  ];

  return (
    <aside className="flex h-[420px] min-h-0 min-w-0 flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-ink-800/50 p-4 sm:h-[480px] lg:h-[560px] xl:h-[620px]">
      <header className="flex items-start gap-3">
        {props.data.portraitUrl === null ? (
          <span className="flex h-20 w-16 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-ink-900 text-lg text-white/40">
            {props.data.name.slice(0, 1)}
          </span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={props.data.portraitUrl}
            alt={props.data.name}
            className="h-20 w-16 shrink-0 rounded-lg border border-white/15 object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-white/85">{props.data.name}</h2>
          <p className="mt-0.5 truncate text-[11px] text-white/35">{props.data.occupation ?? "我的角色"}</p>
          {props.data.equipment.assets === null ? null : (
            <p className="mt-1 truncate text-[10px] text-white/40">
              信用 {props.data.equipment.assets.creditRating ?? "—"}
              {props.data.equipment.assets.cash === null
                ? ""
                : " · 现金 " + String(props.data.equipment.assets.cash) + (props.data.equipment.assets.cashUnit ?? "")}
            </p>
          )}
        </div>
      </header>

      <div className="grid grid-cols-2 gap-2">
        {rows.map((row) => {
          const ratio = row.max > 0 ? Math.max(0, Math.min(1, row.current / row.max)) : 0;
          const tone = statTone(row.current, row.max, row.healthy);
          const percent = (ratio * 100).toFixed(1);
          return (
            <div key={row.label} className={"rounded-lg border px-2.5 py-2 " + tone.card}>
              <div className="flex items-baseline justify-between gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-white/55">{row.label}</span>
                <span className={"font-mono text-lg font-semibold leading-none " + tone.text}>{row.current}</span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
                <div className={"h-full rounded-full " + tone.bar} style={{ width: percent + "%" }} />
              </div>
              <p className="mt-1 text-right font-mono text-[10px] text-white/40">/ {row.max}</p>
            </div>
          );
        })}
      </div>

      <div>
        <p className="text-[11px] text-white/40">属性</p>
        <div className="mt-1.5 grid grid-cols-3 gap-1">
          {Object.entries(props.data.attributes).map(([key, value]) => (
            <span key={key} className="rounded border border-white/10 bg-ink-900/60 px-1.5 py-1 text-center text-[10px] text-white/60">
              {ATTRIBUTE_LABELS[key] ?? key}
              <span className="ml-1 font-mono text-white/80">{value}</span>
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="text-[11px] text-white/40">装备与物品</p>
        {props.data.equipment.weapons.length === 0 && props.data.equipment.items.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-white/30">暂无武器 / 随身物品</p>
        ) : (
          <ul className="mt-1.5 flex flex-col gap-1">
            {props.data.equipment.weapons.map((weapon) => (
              <li key={"weapon-" + weapon.name} className="rounded border border-red-400/25 bg-red-400/5 px-2 py-1">
                <span className="text-[11px] text-white/75">🗡 {weapon.name}</span>
                <span className="ml-1 text-[10px] text-white/40">
                  {weapon.skillLabel ?? ""}
                  {weapon.damage === null ? "" : " · " + weapon.damage}
                  {weapon.rangeText === null ? "" : " · " + weapon.rangeText}
                </span>
              </li>
            ))}
            {props.data.equipment.items.map((item) => (
              <li key={"item-" + item.name} className="rounded border border-white/10 bg-ink-900/50 px-2 py-1">
                <span className="text-[11px] text-white/70">🎒 {item.name}</span>
                <span className="ml-1 text-[10px] text-white/40">
                  {item.location ?? ""}
                  {item.status === null ? "" : " · " + item.status}
                  {item.note === null ? "" : " · " + item.note}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-[11px] text-white/40">状态（buff / debuff）</p>
        {vitals.conditions.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-white/30">当前没有特殊状态</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {vitals.conditions.map((condition) => (
              <span
                key={condition.id}
                className={"rounded border px-1.5 py-0.5 text-[10px] " + conditionTone(condition.type)}
                title={condition.note ?? undefined}
              >
                {conditionLabel(condition.type)}
                {condition.unit === "NARRATIVE" || condition.remaining <= 0
                  ? ""
                  : condition.unit === "ROUND"
                    ? " · " + String(condition.remaining) + "轮"
                    : " · " + String(condition.remaining) + "格"}
              </span>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
