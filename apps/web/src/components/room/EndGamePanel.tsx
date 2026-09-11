"use client";

import { useState } from "react";
import { endGameWithAdvancementsAction } from "@/server/actions/room";
import type { AdvancementKind } from "@/shared/game";

interface CharacterOption {
  readonly id: string;
  readonly name: string;
  readonly currentHp: number;
  readonly maxHp: number;
  readonly currentMp: number;
  readonly maxMp: number;
  readonly currentSan: number;
  readonly maxSan: number;
  readonly status: string;
}

interface Props {
  readonly roomId: string;
  readonly gameId: string;
  readonly characters: readonly CharacterOption[];
  readonly pendingGrowthCount: number;
}

interface RowState {
  readonly characterId: string;
  readonly kind: AdvancementKind;
  readonly target: string;
  readonly delta: string;
  readonly note: string;
}

const KIND_OPTIONS: readonly { readonly value: AdvancementKind; readonly label: string }[] = [
  { value: "SAN", label: "SAN" },
  { value: "SKILL", label: "技能" },
  { value: "ATTRIBUTE", label: "属性" },
  { value: "ITEM", label: "物品" },
  { value: "RELATIONSHIP", label: "关系" },
  { value: "OTHER", label: "其他" }
];

const TARGET_PLACEHOLDER: Record<AdvancementKind, string> = {
  SAN: "无需填写",
  SKILL: "技能 id，例如 FIGHTING_BRAWL",
  ATTRIBUTE: "属性键，例如 int / edu / luck",
  ITEM: "物品名",
  RELATIONSHIP: "关系名",
  OTHER: "奖励 / 成长说明键"
};

const inputClass =
  "rounded-lg border border-white/15 bg-ink-900 px-3 py-2 text-sm outline-none focus:border-sakura-500";

export default function EndGamePanel({ roomId, gameId, characters, pendingGrowthCount }: Props) {
  const firstCharacterId = characters[0]?.id ?? "";
  const [rows, setRows] = useState<RowState[]>([]);

  function addRow(): void {
    setRows((current) => [
      ...current,
      { characterId: firstCharacterId, kind: "SAN", target: "", delta: "", note: "" }
    ]);
  }

  function updateRow(index: number, patch: Partial<RowState>): void {
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number): void {
    setRows((current) => current.filter((_, rowIndex) => rowIndex !== index));
  }

  const payload = rows.map((row) => ({
    characterId: row.characterId,
    kind: row.kind,
    target: row.target.trim().length > 0 ? row.target.trim() : null,
    delta: row.delta.trim().length > 0 ? Number(row.delta) : null,
    note: row.note.trim().length > 0 ? row.note.trim() : null
  }));

  return (
    <form action={endGameWithAdvancementsAction} className="flex flex-col gap-4 rounded-xl border border-white/10 bg-ink-800/50 p-5">
      <input type="hidden" name="roomId" value={roomId} />
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="rows" value={JSON.stringify(payload)} />
      {pendingGrowthCount === 0 ? null : (
        <label className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/5 px-3 py-2 text-xs text-amber-100">
          <input type="checkbox" name="resolveGrowth" value="1" defaultChecked className="mt-0.5" />
          <span>
            结束前自动进行 {pendingGrowthCount} 个待检定成长点（CoC 幕间：d100 大于技能值或 96-100 时 +1d10）。
          </span>
        </label>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-white/80">批量成长 / 奖励</h2>
          <p className="mt-1 text-[11px] text-white/35">
            可一次给多名角色录入结束奖励；留空则直接结束本局。属性 / 技能 / SAN 会同步到基础角色卡，并写入成长记录。
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          disabled={characters.length === 0}
          className="rounded-lg border border-spirit-400/40 px-3 py-1.5 text-xs text-spirit-300 transition hover:bg-spirit-400/10 disabled:opacity-40"
        >
          + 添加一条
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/15 px-4 py-6 text-center text-xs text-white/35">
          暂无批量成长。可以直接确认结束，或先添加奖励。
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((row, index) => (
            <div key={index} className="grid gap-3 rounded-lg border border-white/10 bg-ink-900/50 p-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">角色</span>
                <select
                  value={row.characterId}
                  onChange={(event) => updateRow(index, { characterId: event.target.value })}
                  className={inputClass}
                >
                  {characters.map((character) => (
                    <option key={character.id} value={character.id}>
                      {character.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">类型</span>
                <select
                  value={row.kind}
                  onChange={(event) => updateRow(index, { kind: event.target.value as AdvancementKind })}
                  className={inputClass}
                >
                  {KIND_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">目标</span>
                <input
                  value={row.target}
                  onChange={(event) => updateRow(index, { target: event.target.value })}
                  placeholder={TARGET_PLACEHOLDER[row.kind]}
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] text-white/35">数值变化</span>
                <input
                  value={row.delta}
                  onChange={(event) => updateRow(index, { delta: event.target.value })}
                  type="number"
                  step="1"
                  placeholder={row.kind === "SAN" ? "例：+1 / -3" : "非零整数"}
                  className={inputClass}
                />
              </label>
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-[10px] text-white/35">备注</span>
                  <input
                    value={row.note}
                    onChange={(event) => updateRow(index, { note: event.target.value })}
                    placeholder="来源 / 说明"
                    className={inputClass}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => removeRow(index)}
                  className="rounded-lg border border-red-400/30 px-2.5 py-2 text-xs text-red-300 transition hover:bg-red-400/10"
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
        <p className="max-w-xl text-[11px] leading-relaxed text-amber-200/80">
          确认后：Game 置为 ENDED，房间回到 LOBBY，全员取消准备。角色、物品、成长记录跨局保留。
        </p>
        <button
          type="submit"
          className="rounded-lg bg-sakura-500 px-5 py-2.5 text-sm font-medium text-ink-900 transition hover:bg-sakura-400"
        >
          确认结束本局
        </button>
      </div>
    </form>
  );
}
