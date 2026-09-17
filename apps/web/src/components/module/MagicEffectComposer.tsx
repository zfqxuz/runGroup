"use client";

import { useMemo, useState } from "react";
import { MAGIC_EFFECT_DEFINITIONS, defaultMagicEffectValues, magicEffectDefinition, serializeMagicEffect } from "@/shared/magic-effects";

interface Draft {
  readonly id: string;
  type: string;
  values: Record<string, string>;
}

function draftFromEffect(value: unknown, index: number): Draft | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type.toUpperCase() : "";
  const definition = magicEffectDefinition(type);
  if (definition === null) return null;
  const values: Record<string, string> = {};
  for (const field of definition.fields) {
    const raw = record[field.key];
    if (Array.isArray(raw)) values[field.key] = raw.map((item) => String(item)).join(", ");
    else if (raw === undefined || raw === null) values[field.key] = field.defaultValue;
    else values[field.key] = String(raw);
  }
  return { id: "effect-" + String(index), type, values };
}

function draftFromType(type: string): Draft {
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : "effect-" + String(Date.now()) + "-" + String(Math.random());
  return { id, type, values: defaultMagicEffectValues(type) };
}

export default function MagicEffectComposer(props: {
  readonly name: string;
  readonly initialEffects: readonly unknown[];
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    props.initialEffects
      .map((effect, index) => draftFromEffect(effect, index))
      .filter((draft): draft is Draft => draft !== null)
  );
  const [newType, setNewType] = useState<string>(MAGIC_EFFECT_DEFINITIONS[0]?.type ?? "DAMAGE");

  const serialized = useMemo(
    () => JSON.stringify(drafts.map((draft) => serializeMagicEffect(draft.type, draft.values))),
    [drafts]
  );

  function updateValue(id: string, key: string, value: string): void {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, values: { ...draft.values, [key]: value } } : draft))
    );
  }

  function changeType(id: string, type: string): void {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, type, values: defaultMagicEffectValues(type) } : draft))
    );
  }

  function removeDraft(id: string): void {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  function addDraft(): void {
    setDrafts((current) => [...current, draftFromType(newType)]);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-ink-950/40 p-3">
      <input type="hidden" name={props.name} value={serialized} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs text-white/70">魔法效果组合</p>
          <p className="text-[10px] text-white/35">选择任意基础效果，按顺序组合成一条法术。</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={newType} onChange={(event) => setNewType(event.target.value)} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75">
            {MAGIC_EFFECT_DEFINITIONS.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {definition.label}（{definition.type}）
              </option>
            ))}
          </select>
          <button type="button" onClick={addDraft} className="rounded border border-spirit-400/40 px-2 py-1 text-xs text-spirit-300 transition hover:bg-spirit-400/10">
            + 添加效果
          </button>
        </div>
      </div>

      {drafts.length === 0 ? (
        <p className="rounded border border-dashed border-white/15 px-3 py-4 text-center text-xs text-white/35">
          当前没有效果，点击「+ 添加效果」开始组合。
        </p>
      ) : null}

      {drafts.map((draft, index) => {
        const definition = magicEffectDefinition(draft.type);
        if (definition === null) return null;
        return (
          <div key={draft.id} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-white/30">#{index + 1}</span>
              <select value={draft.type} onChange={(event) => changeType(draft.id, event.target.value)} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75">
                {MAGIC_EFFECT_DEFINITIONS.map((item) => (
                  <option key={item.type} value={item.type}>
                    {item.label}（{item.type}）
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-white/35">{definition.summary}</span>
              <button type="button" onClick={() => removeDraft(draft.id)} className="ml-auto rounded border border-red-400/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10">
                删除
              </button>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {definition.fields.map((field) => (
                <label key={field.key} className="flex flex-col gap-1">
                  <span className="text-[10px] text-white/35">
                    {field.label}
                    {field.required === true ? " *" : ""}
                  </span>
                  <input
                    value={draft.values[field.key] ?? ""}
                    onChange={(event) => updateValue(draft.id, field.key, event.target.value)}
                    placeholder={field.placeholder}
                    className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75 outline-none focus:border-sakura-500"
                  />
                </label>
              ))}
            </div>
          </div>
        );
      })}

      <details className="rounded border border-white/10 bg-ink-900/30 p-2">
        <summary className="cursor-pointer text-[10px] text-white/35">查看当前组合 JSON</summary>
        <pre className="mt-2 max-h-40 overflow-auto text-[10px] text-white/45">{serialized}</pre>
      </details>
    </div>
  );
}
