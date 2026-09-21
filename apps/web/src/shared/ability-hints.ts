import type { RulePack } from "@touhou/rules";

/** 战斗 / 车卡 UI 展示用的能力提示；按能力实例 id 索引。 */
export interface AbilityHint {
  readonly name: string;
  readonly description: string;
  readonly kind?: "PASSIVE" | "ACTIVE" | "FREE";
  readonly costText?: string;
}

function costTableText(costTable: readonly number[]): string {
  if (costTable.length === 0) return "";
  return "逐级消费 " + costTable.join(" / ") + " 点";
}

/**
 * 把规则包里的能力类别 / 变体 / 属性使实例 / 妖力特技条目，
 * 统一整理成「id → 名称 + 效果说明」的提示表。
 *
 * 战斗面板选中能力后只需查这张表，就能在控件旁直接显示效果，
 * 玩家不用背规则书。
 */
export function buildAbilityHints(pack: RulePack): Record<string, AbilityHint> {
  const hints: Record<string, AbilityHint> = {};
  const elements = pack.elements ?? {};

  for (const category of Object.values(pack.abilities.categories)) {
    const baseDescription = category.description ?? "";
    hints[category.id] = {
      name: category.name,
      description: baseDescription,
      costText: costTableText(category.costTable)
    };

    for (const variant of Object.values(category.variants)) {
      hints[category.id + "#" + variant.id] = {
        name: category.name + "·" + variant.name,
        description: variant.description ?? baseDescription,
        costText: costTableText(variant.costTable)
      };
    }

    // 属性使按元素拆成实例 id：ELEMENTALIST:FIRE。
    if (category.id === "ELEMENTALIST") {
      for (const element of Object.values(elements)) {
        hints["ELEMENTALIST:" + element.id] = {
          name: element.name + "·属性使",
          description:
            element.description === undefined || element.description.trim().length === 0
              ? baseDescription
              : element.name + "：" + element.description,
          costText: costTableText(category.costTable)
        };
      }
    }
  }

  for (const definition of Object.values(pack.abilities.definitions)) {
    hints[definition.id] = {
      name: definition.name,
      description: definition.description ?? "",
      kind: definition.kind,
      costText:
        definition.cost !== undefined
          ? "习得消费 " + definition.cost + " 点"
          : definition.costNote
    };
  }

  return hints;
}
