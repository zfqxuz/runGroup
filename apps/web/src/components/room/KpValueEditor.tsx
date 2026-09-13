"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import type { Ack } from "@/shared/socket";

interface UnitOption {
  readonly ref: string;
  readonly name: string;
  readonly kind: "PLAYER" | "NPC";
}

interface Props {
  readonly roomId: string;
  readonly units: readonly UnitOption[];
}

interface UnitValuesAck extends Ack {
  readonly source?: string;
  readonly values?: {
    readonly hp?: number;
    readonly maxHp?: number;
    readonly mp?: number;
    readonly maxMp?: number;
    readonly san?: number;
    readonly maxSan?: number;
    readonly dp?: number;
    readonly maxDp?: number;
    readonly attributes?: Record<string, number>;
    readonly skills?: Record<string, number>;
  };
}

const SOURCE_LABELS: Record<string, string> = {
  COMBAT: "战斗中实时数值",
  GAME: "当前局数值",
  CARD: "角色卡 / NPC 卡数值"
};

const VITALS = [
  ["hp", "HP"],
  ["maxHp", "最大 HP"],
  ["mp", "MP"],
  ["maxMp", "最大 MP"],
  ["san", "SAN"],
  ["maxSan", "最大 SAN"],
  ["dp", "DP"],
  ["maxDp", "最大 DP"]
] as const;

const ATTRIBUTES = [
  ["str", "力量"],
  ["con", "体质"],
  ["siz", "体型"],
  ["dex", "敏捷"],
  ["app", "外貌"],
  ["int", "智力"],
  ["pow", "意志"],
  ["edu", "教育"],
  ["luck", "幸运"]
] as const;

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-2 py-1.5 text-xs text-white/80 outline-none focus:border-sakura-500";

function optionalNumber(value: string): number | undefined {
  const text = value.trim();
  if (text.length === 0) return undefined;
  const number = Number(text);
  if (Number.isFinite(number) === false) return undefined;
  return Math.max(0, Math.floor(number));
}

export default function KpValueEditor(props: Props) {
  const [unitRef, setUnitRef] = useState(props.units[0]?.ref ?? "");
  const [vitals, setVitals] = useState<Record<string, string>>({});
  const [attributes, setAttributes] = useState<Record<string, string>>({});
  const [skillsText, setSkillsText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [socketReady, setSocketReady] = useState(false);
  const socketRef = useRef<Socket | null>(null);

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
    return () => {
      cancelled = true;
      socket.removeAllListeners();
      socket.close();
    };
  }, []);

  function applyValues(values: UnitValuesAck["values"]): void {
    if (values === undefined) return;
    const nextVitals: Record<string, string> = {};
    for (const [key] of VITALS) {
      const value = values[key as keyof typeof values];
      if (typeof value === "number") nextVitals[key] = String(value);
    }
    setVitals(nextVitals);
    const nextAttributes: Record<string, string> = {};
    for (const [key] of ATTRIBUTES) {
      const value = values.attributes?.[key];
      if (typeof value === "number") nextAttributes[key] = String(value);
    }
    setAttributes(nextAttributes);
    const nextSkills = values.skills ?? {};
    setSkillsText(
      Object.entries(nextSkills)
        .map(([id, value]) => id + ":" + String(value))
        .join("\n")
    );
  }

  function requestValues(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false || unitRef.length === 0) return;
    setLoading(true);
    socket.emit(
      "room:unit-values",
      { roomId: props.roomId, unitRef },
      (result: UnitValuesAck) => {
        setLoading(false);
        if (result.ok === false) {
          setMessage(result.error ?? "读取实时数值失败");
          return;
        }
        applyValues(result.values);
        setSource(result.source ?? null);
        setMessage(null);
      }
    );
  }

  useEffect(() => {
    if (socketReady === false) return;
    requestValues();
  }, [socketReady, unitRef]);

  function setVital(key: string, value: string): void {
    setVitals((prev) => ({ ...prev, [key]: value }));
  }

  function setAttribute(key: string, value: string): void {
    setAttributes((prev) => ({ ...prev, [key]: value }));
  }

  function submit(): void {
    const socket = socketRef.current;
    if (socket === null || socket.connected === false) {
      setMessage("连接已断开，请刷新后重试");
      return;
    }
    if (unitRef.length === 0) {
      setMessage("请选择要修改的单位");
      return;
    }
    const parsedVitals: Record<string, number> = {};
    for (const [key] of VITALS) {
      const value = optionalNumber(vitals[key] ?? "");
      if (value !== undefined) parsedVitals[key] = value;
    }
    const parsedAttributes: Record<string, number> = {};
    for (const [key] of ATTRIBUTES) {
      const value = optionalNumber(attributes[key] ?? "");
      if (value !== undefined) parsedAttributes[key] = value;
    }
    const parsedSkills: Record<string, number> = {};
    for (const line of skillsText.split(/[\n,，]/)) {
      const text = line.trim();
      if (text.length === 0) continue;
      const pieces = text.split(/[:：=]/);
      const id = (pieces[0] ?? "").trim();
      const value = optionalNumber((pieces[1] ?? "").trim());
      if (id.length > 0 && value !== undefined) parsedSkills[id] = value;
    }
    setMessage(null);
    socket.emit(
      "room:adjust-values",
      {
        roomId: props.roomId,
        unitRef,
        values: { ...parsedVitals, attributes: parsedAttributes, skills: parsedSkills }
      },
      (result: Ack) => {
        if (result.ok) {
          setMessage("数值已应用。");
          requestValues();
        } else {
          setMessage(result.error ?? "数值调整失败");
        }
      }
    );
  }

  if (props.units.length === 0) return null;

  return (
    <section className="rounded-xl border border-purple-400/30 bg-purple-400/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-purple-200">KP 数值调整（玩家 / NPC）</h2>
          <p className="mt-0.5 text-[10px] text-white/45">
            任意阶段可用：HP / MP / SAN / DP、九项属性、技能。非战斗写入角色卡 / NPC 卡，
            战斗中同时实时同步到战斗单位。留空表示不修改。
          </p>
        </div>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-[10px] text-white/35">目标单位</span>
        <select value={unitRef} onChange={(event) => setUnitRef(event.target.value)} className={inputClass}>
          {props.units.map((unit) => (
            <option key={unit.ref} value={unit.ref}>
              {unit.name}（{unit.kind === "NPC" ? "NPC" : "玩家"}）
            </option>
          ))}
        </select>
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {VITALS.map(([key, label]) => (
          <label key={key} className="flex flex-col gap-1">
            <span className="text-[10px] text-white/35">{label}</span>
            <input
              value={vitals[key] ?? ""}
              onChange={(event) => setVital(key, event.target.value)}
              inputMode="numeric"
              className={inputClass}
            />
          </label>
        ))}
      </div>

      <details open className="mt-3 rounded-lg border border-white/10 bg-ink-900/40 p-2">
        <summary className="cursor-pointer text-[11px] text-white/50">属性（留空不改）</summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ATTRIBUTES.map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-[10px] text-white/35">{label} {key.toUpperCase()}</span>
              <input
                value={attributes[key] ?? ""}
                onChange={(event) => setAttribute(key, event.target.value)}
                inputMode="numeric"
                className={inputClass}
              />
            </label>
          ))}
        </div>
      </details>

      <details className="mt-2 rounded-lg border border-white/10 bg-ink-900/40 p-2">
        <summary className="cursor-pointer text-[11px] text-white/50">技能（ID:数值，每行一项）</summary>
        <textarea
          value={skillsText}
          onChange={(event) => setSkillsText(event.target.value)}
          rows={4}
          placeholder="FIGHTING_BRAWL:70"
          className={inputClass + " mt-2 w-full font-mono"}
        />
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={submit}
          className="rounded-lg bg-purple-400 px-4 py-2 text-xs font-medium text-ink-900 transition hover:bg-purple-300"
        >
          应用数值
        </button>
        <button
          type="button"
          onClick={requestValues}
          className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/60 transition hover:border-white/35"
        >
          重新读取实时值
        </button>
        {source === null ? null : (
          <span className="text-[10px] text-white/35">
            {SOURCE_LABELS[source] ?? source}{loading ? " · 读取中…" : ""}
          </span>
        )}
        {message === null ? null : <span className="text-[11px] text-white/55">{message}</span>}
      </div>
    </section>
  );
}
