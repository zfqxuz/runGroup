import { RulePackError } from "./errors";
import {
  RulePackSchema,
  type RulePack,
  type RulePackInput,
  type RulePackOverlay
} from "./schema";

type Plain = Record<string, unknown>;

const isPlainObject = (value: unknown): value is Plain =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

/**
 * 深合并：
 *  - 对象递归合并
 *  - 数组整体替换（技能表 / 管线这类有序结构合并会错位）
 *  - undefined 表示「保留基线」
 */
export function deepMerge(base: unknown, overlay: unknown): unknown {
  if (overlay === undefined) return base;
  if (isPlainObject(base) && isPlainObject(overlay)) {
    const result: Plain = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
      if (value === undefined) continue;
      result[key] = key in result ? deepMerge(result[key], value) : value;
    }
    return result;
  }
  return overlay;
}

export type PackRegistry = Readonly<Record<string, RulePackInput | RulePackOverlay>>;

function parseRef(reference: string): { id: string; version: string } {
  const at = reference.lastIndexOf("@");
  if (at <= 0) {
    throw new RulePackError("SCHEMA_INVALID", `无法解析 extends 引用 "${reference}"`, { reference });
  }
  return { id: reference.slice(0, at), version: reference.slice(at + 1) };
}

/** 沿 extends 链解析出一个完整 RulePack，并做最终 schema 校验。 */
export function resolveRulePack(id: string, registry: PackRegistry): RulePack {
  const seen = new Set<string>();

  const resolve = (key: string): RulePackInput => {
    if (seen.has(key)) {
      throw new RulePackError("DERIVED_CYCLE", `extends 链出现环: ${key}`, { pack: key });
    }
    seen.add(key);

    const raw = registry[key];
    if (raw === undefined) {
      throw new RulePackError("SCHEMA_INVALID", `找不到规则包 "${key}"`, {
        pack: key,
        available: Object.keys(registry)
      });
    }
    const ownExtends = Array.isArray(raw.extends) ? (raw.extends as string[]) : [];
    let merged: unknown = {};
    for (const reference of ownExtends) {
      const target = parseRef(reference);
      merged = deepMerge(merged, resolve(target.id));
    }
    merged = deepMerge(merged, raw);
    seen.delete(key);
    return merged as RulePackInput;
  };

  const parsed = RulePackSchema.safeParse(resolve(id));
  if (!parsed.success) {
    throw new RulePackError("SCHEMA_INVALID", `规则包 "${id}" 合并后未通过校验`, {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}
