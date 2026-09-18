"use client";

import { useEffect, useMemo, useState } from "react";
import { MAGIC_EFFECT_DEFINITIONS, defaultMagicEffectValues, magicEffectDefinition, serializeMagicEffect } from "@/shared/magic-effects";

interface Draft {
  readonly id: string;
  type: string;
  values: Record<string, string>;
}

export interface NpcCardOption {
  readonly id: string;
  readonly name: string;
  readonly key?: string;
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
  /** 受控回调：每次效果变化都会回传序列化 JSON（非表单场景使用）。 */
  readonly onChange?: (serialized: string) => void;
  /** 只允许添加这些效果类型；不传表示全部允许。 */
  readonly allowedTypes?: readonly string[];
  /** 召唤效果可绑定的 NPC 卡；只展示名称，不展示 id。 */
  readonly npcCards?: readonly NpcCardOption[];
  /**
   * 召唤绑定写入方式：
   * - card：写入 cardId（房间卡编辑）；
   * - name：写入 name/key（团本编辑器暂无房间 Card id）。
   */
  readonly npcBinding?: "card" | "name";
}) {
  const allowedSet = props.allowedTypes === undefined ? null : new Set(props.allowedTypes);
  const allowedDefinitions = MAGIC_EFFECT_DEFINITIONS.filter(
    (definition) => allowedSet === null || allowedSet.has(definition.type)
  );
  const npcCards = props.npcCards ?? [];
  const npcBinding = props.npcBinding ?? "card";
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    props.initialEffects
      .map((effect, index) => draftFromEffect(effect, index))
      .filter((draft): draft is Draft => draft !== null)
  );
  const [newType, setNewType] = useState<string>(
    (props.allowedTypes === undefined ? MAGIC_EFFECT_DEFINITIONS[0]?.type : allowedDefinitions[0]?.type) ?? "DAMAGE"
  );
  const effectiveNewType = allowedDefinitions.some((definition) => definition.type === newType)
    ? newType
    : (allowedDefinitions[0]?.type ?? "");
  const [mode, setMode] = useState<"form" | "json">("form");
  const [jsonText, setJsonText] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const serialized = useMemo(
    () => JSON.stringify(drafts.map((draft) => serializeMagicEffect(draft.type, draft.values))),
    [drafts]
  );

  useEffect(() => {
    props.onChange?.(serialized);
    // onChange 只用于向上同步，不参与依赖，避免父组件重渲染导致循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  function updateValue(id: string, key: string, value: string): void {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, values: { ...draft.values, [key]: value } } : draft))
    );
  }

  function updateValues(id: string, patch: Record<string, string>): void {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, values: { ...draft.values, ...patch } } : draft))
    );
  }

  function npcOptionById(id: string): NpcCardOption | undefined {
    return npcCards.find((card) => card.id === id);
  }

  function npcValueOf(draft: Draft): string {
    if (npcBinding === "name") {
      const name = (draft.values.name ?? "").trim();
      const selected = npcCards.find(
        (card) => card.name === name || (card.key !== undefined && card.key === name)
      );
      return selected?.id ?? (name.length > 0 ? "__custom__" : "");
    }
    return draft.values.cardId ?? "";
  }

  function changeNpc(draftId: string, value: string): void {
    const option = value.length === 0 || value === "__custom__" ? undefined : npcOptionById(value);
    if (npcBinding === "name") {
      if (option === undefined) {
        // 不绑定具体卡时保留玩家已经填写的召唤物名字 / 标识，只清掉 cardId。
        if (value.length === 0) updateValues(draftId, { cardId: "" });
        return;
      }
      updateValues(draftId, { cardId: "", name: option.name, key: option.key ?? option.name });
      return;
    }
    if (option === undefined) {
      updateValues(draftId, { cardId: value });
      return;
    }
    updateValues(draftId, { cardId: option.id, name: option.name, key: option.key ?? option.name });
  }

  function changeType(id: string, type: string): void {
    setDrafts((current) =>
      current.map((draft) => (draft.id === id ? { ...draft, type, values: defaultMagicEffectValues(type) } : draft))
    );
  }

  function removeDraft(id: string): void {
    setDrafts((current) => current.filter((draft) => draft.id !== id));
  }

  function moveDraft(id: string, direction: -1 | 1): void {
    setDrafts((current) => {
      const index = current.findIndex((draft) => draft.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.length) return current;
      const next = [...current];
      const currentDraft = next[index];
      const targetDraft = next[target];
      if (currentDraft === undefined || targetDraft === undefined) return current;
      next[index] = targetDraft;
      next[target] = currentDraft;
      return next;
    });
  }

  function addDraft(): void {
    if (effectiveNewType.length === 0) return;
    // 用当前允许的默认效果，避免换成道具卡后仍加入 DAMAGE。
    setNewType(effectiveNewType);
    setDrafts((current) => [...current, draftFromType(effectiveNewType)]);
  }

  function switchMode(next: "form" | "json"): void {
    if (next === "json") {
      setJsonText(serialized);
      setJsonError(null);
    }
    setMode(next);
  }

  function applyJson(text: string): void {
    setJsonText(text);
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed) === false) {
        setJsonError("请填写效果列表，例如：伤害 1d6。");
        return;
      }
      const next = parsed
        .map((effect, index) => draftFromEffect(effect, index))
        .filter((draft): draft is Draft => draft !== null);
      if (next.length !== parsed.length) {
        setJsonError("有无法识别的效果，已忽略。");
      } else {
        setJsonError(null);
      }
      setDrafts(next);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : "格式解析失败");
    }
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
          <div className="flex overflow-hidden rounded border border-white/15">
            {(["form", "json"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => switchMode(item)}
                className={
                  "px-2 py-1 text-[10px] transition " +
                  (mode === item ? "bg-sakura-500/15 text-sakura-300" : "text-white/45 hover:bg-white/5")
                }
              >
                {item === "form" ? "表单编辑" : "高级编辑"}
              </button>
            ))}
          </div>
          <select value={effectiveNewType} onChange={(event) => setNewType(event.target.value)} disabled={allowedDefinitions.length === 0} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75 disabled:opacity-40">
            {allowedDefinitions.map((definition) => (
              <option key={definition.type} value={definition.type}>
                {definition.label}（{definition.type}）
              </option>
            ))}
          </select>
          <button type="button" onClick={addDraft} disabled={allowedDefinitions.length === 0} className="rounded border border-spirit-400/40 px-2 py-1 text-xs text-spirit-300 transition hover:bg-spirit-400/10 disabled:opacity-40">
            + 添加效果
          </button>
        </div>
      </div>

      {mode === "json" ? (
        <div className="flex flex-col gap-1">
          <textarea
            value={jsonText}
            onChange={(event) => applyJson(event.target.value)}
            rows={10}
            spellCheck={false}
            className="w-full rounded border border-white/15 bg-ink-900 px-3 py-2 font-mono text-[11px] text-white/80 outline-none focus:border-sakura-500"
            placeholder='[{"type":"DAMAGE","amount":"1d6"}]'
          />
          {jsonError === null ? (
            <p className="text-[10px] text-emerald-300/70">格式正确，已同步到表单。</p>
          ) : (
            <p className="text-[10px] text-red-300">{jsonError}</p>
          )}
        </div>
      ) : null}

      {mode === "form" && drafts.length === 0 ? (
        <p className="rounded border border-dashed border-white/15 px-3 py-4 text-center text-xs text-white/35">
          当前没有效果，点击「+ 添加效果」开始组合。
        </p>
      ) : null}

      {mode === "form" ? drafts.map((draft, index) => {
        const definition = magicEffectDefinition(draft.type);
        if (definition === null) return null;
        return (
          <div key={draft.id} className="rounded-lg border border-white/10 bg-ink-900/50 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] text-white/30">#{index + 1}</span>
              <select value={draft.type} onChange={(event) => changeType(draft.id, event.target.value)} className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75">
                {MAGIC_EFFECT_DEFINITIONS.filter(
                  (item) => allowedSet === null || allowedSet.has(item.type) || item.type === draft.type
                ).map((item) => (
                  <option key={item.type} value={item.type}>
                    {item.label}（{item.type}）
                  </option>
                ))}
              </select>
              <span className="text-[10px] text-white/35">{definition.summary}</span>
              {allowedSet !== null && allowedSet.has(draft.type) === false ? (
                <span className="rounded border border-red-400/40 px-1.5 py-0.5 text-[10px] text-red-300">当前卡类型不允许该效果，请更换或删除</span>
              ) : null}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveDraft(draft.id, -1)}
                  disabled={index === 0}
                  className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/55 transition hover:bg-white/5 disabled:opacity-30"
                >
                  上移
                </button>
                <button
                  type="button"
                  onClick={() => moveDraft(draft.id, 1)}
                  disabled={index === drafts.length - 1}
                  className="rounded border border-white/15 px-2 py-1 text-[10px] text-white/55 transition hover:bg-white/5 disabled:opacity-30"
                >
                  下移
                </button>
                <button type="button" onClick={() => removeDraft(draft.id)} className="rounded border border-red-400/30 px-2 py-1 text-[10px] text-red-300 transition hover:bg-red-400/10">
                  删除
                </button>
              </div>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {definition.fields.map((field) => {
                const npcValue = field.kind === "npc-card" ? npcValueOf(draft) : "";
                const hasCustomNpc =
                  field.kind === "npc-card" &&
                  (npcBinding === "name"
                    ? npcValue === "__custom__"
                    : npcValue.length > 0 && npcOptionById(npcValue) === undefined);
                return (
                  <label key={field.key} className="flex flex-col gap-1">
                    <span className="text-[10px] text-white/35">
                      {field.label}
                      {field.required === true ? " *" : ""}
                    </span>
                    {field.kind === "npc-card" ? (
                      <select
                        value={npcValue}
                        onChange={(event) => changeNpc(draft.id, event.target.value)}
                        className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75 outline-none focus:border-sakura-500"
                      >
                        <option value="">不绑定，按名字匹配</option>
                        {npcCards.map((card) => (
                          <option key={card.id} value={card.id}>
                            {card.name}
                          </option>
                        ))}
                        {hasCustomNpc ? (
                          <option value={npcBinding === "name" ? "__custom__" : npcValue}>
                            {npcBinding === "name"
                              ? ((draft.values.name ?? "").trim() || "当前绑定")
                              : "当前绑定（未找到 NPC 卡）"}
                          </option>
                        ) : null}
                      </select>
                    ) : (
                      <input
                        value={draft.values[field.key] ?? ""}
                        onChange={(event) => updateValue(draft.id, field.key, event.target.value)}
                        placeholder={field.placeholder}
                        className="rounded border border-white/15 bg-ink-900 px-2 py-1 text-xs text-white/75 outline-none focus:border-sakura-500"
                      />
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        );
      }) : null}

      <details className="rounded border border-white/10 bg-ink-900/30 p-2">
        <summary className="cursor-pointer text-[10px] text-white/35">查看当前组合</summary>
        <pre className="mt-2 max-h-40 overflow-auto text-[10px] text-white/45">{serialized}</pre>
      </details>
    </div>
  );
}
