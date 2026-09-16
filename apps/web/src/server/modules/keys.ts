/**
 * 模块实体 sourceKey / id 的通用归一化。
 *
 * 这里必须保留 Unicode 字母和数字（包括中文），否则：
 * - npc-沃尔特-科比特 / item-浮空匕首 / clue-湿漉漉的脚印 等中文 id
 *   会被抹成 npc- / item- / clue-，在同一个 module 内互相覆盖；
 * - 法术、物品、线索的 sourceKey 冲突会让模板/房间规则丢实体。
 */
export function normalizeEntityKey(input: string, fallback: string, maxLength = 80): string {
  const normalized = String(input ?? "")
    .toLowerCase()
    .normalize("NFKD")
    // \p{L} 包含中英文等所有 Unicode 字母，\p{N} 包含阿拉伯数字。
    .replace(/[^\p{L}\p{N}._:-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, maxLength);
  return normalized.length > 0 ? normalized : fallback;
}
