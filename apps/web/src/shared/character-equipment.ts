/** 角色携带的装备 / 物品 / 资产：从 Character.sourceData 宽容读取，供角色页与看板共用。 */

export interface CharacterItem {
  readonly status: string | null;
  readonly location: string | null;
  readonly name: string;
  readonly note: string | null;
}

export interface CharacterWeapon {
  readonly name: string;
  readonly type: string | null;
  readonly skillLabel: string | null;
  readonly damage: string | null;
  readonly rangeText: string | null;
  readonly attacks: string | null;
  readonly capacity: string | null;
  readonly malfunction: string | null;
  readonly success: number | null;
}

export interface CharacterAssets {
  readonly creditRating: string | null;
  readonly cash: number | null;
  readonly cashUnit: string | null;
  readonly otherAssetsValue: string | null;
}

export interface CharacterEquipment {
  readonly weapons: readonly CharacterWeapon[];
  readonly items: readonly CharacterItem[];
  readonly assets: CharacterAssets | null;
  /** 14.10 所有携带物品 / 武器的重量合计。 */
  readonly totalWeight: number;
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && Array.isArray(value) === false
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function characterEquipmentOf(sourceData: unknown): CharacterEquipment {
  const source = recordOf(sourceData);
  const rawWeapons = Array.isArray(source.weapons) ? source.weapons : [];
  const weapons: CharacterWeapon[] = [];
  for (const raw of rawWeapons) {
    const item = recordOf(raw);
    const name = stringOrNull(item.name);
    if (name === null) continue;
    weapons.push({
      name,
      type: stringOrNull(item.type),
      skillLabel: stringOrNull(item.skillLabel),
      damage: stringOrNull(item.damage),
      rangeText: stringOrNull(item.rangeText),
      attacks: stringOrNull(item.attacks),
      capacity: stringOrNull(item.capacity),
      malfunction: stringOrNull(item.malfunction),
      success: numberOrNull(item.success)
    });
  }
  const rawItems = Array.isArray(source.items) ? source.items : [];
  const items: CharacterItem[] = [];
  let totalWeight = 0;
  for (const raw of rawItems) {
    const item = recordOf(raw);
    const weight = numberOrNull(recordOf(item.stats).weight);
    if (weight !== null) totalWeight += Math.max(0, weight);
    const name = stringOrNull(item.name);
    if (name === null) continue;
    items.push({
      status: stringOrNull(item.status),
      location: stringOrNull(item.location),
      name,
      note: stringOrNull(item.note)
    });
  }
  const rawAssets = recordOf(source.assets);
  const assets =
    Object.keys(rawAssets).length === 0
      ? null
      : {
          creditRating: stringOrNull(rawAssets.creditRating),
          cash: numberOrNull(rawAssets.cash),
          cashUnit: stringOrNull(rawAssets.cashUnit),
          otherAssetsValue: stringOrNull(rawAssets.otherAssetsValue)
        };
  return { weapons, items, assets, totalWeight };
}
