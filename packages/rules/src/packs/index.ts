import type { PackRegistry } from "../merge";
import { COC7_BASELINE } from "./coc7-baseline";
import { TOUHOU_EXT } from "./touhou-ext";

export { COC7_BASELINE } from "./coc7-baseline";
export { TOUHOU_EXT } from "./touhou-ext";

/** 内置规则包注册表。后续可换成从数据库 RulePack 表加载。 */
export function builtinRegistry(): PackRegistry {
  return {
    [COC7_BASELINE.id]: COC7_BASELINE,
    [TOUHOU_EXT.id]: TOUHOU_EXT
  };
}
