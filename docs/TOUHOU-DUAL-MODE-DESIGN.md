# 东方拓展双模式设计（Touhou-COC7 / Touhou-DP）

> 目标：同一套东方角色 / 技能 / 种族内容，可以运行在两种战斗规则下。
> - **Touhou-COC7（偏标准 CoC7）**：战斗完全走 CoC7 d100 规则；东方扩展只提供角色、技能、种族、符卡数据。
> - **Touhou-DP（偏千幻抄）**：走现有 DP 骰池、弹幕、擦弹、符卡独立 HP、能力体系、结界、属性相克、14.x。
>
> 房间战斗模式选择 `DP` = Touhou-DP；选择其他模式（INITIATIVE / ATB）= Touhou-COC7。
> CoC7 baseline 房间（`pack.system === "COC7"`）不受影响。

---

## 1. 模式判定与单一开关

建议新增两个纯判定函数，所有分支只依赖它们：

```ts
export function isTouhouDp(pack: CompiledRulePack, state: CombatState): boolean {
  return pack.system === "TOUHOU" && state.mode === "DP";
}

export function isTouhouCoc7(pack: CompiledRulePack, state: CombatState): boolean {
  return pack.system === "TOUHOU" && state.mode !== "DP";
}
```

原则：
- **DP 专属逻辑**（DP 宣言、骰池、擦弹、弹幕、SC 独立 HP、LSC、SC 池、结界 7.5、能力点发动、属性相克 DP 加成）全部加 `isTouhouDp` 短路。
- **CoC7 专属逻辑**（d100 命中、武器伤害、护甲、SAN、魔法点、先攻 / ATB）在 `isTouhouCoc7` 下走标准 `resolveAttack` / `resolveMagic` / `resolvePending`。
- 所有新增字段对另一种模式为 `null`，加入时不改变旧行为。

---

## 2. 规则差异总表

| 维度 | Touhou-COC7（非 DP） | Touhou-DP（mode = DP） |
|---|---|---|
| 车卡 | CoC7 属性 / 职业 / 技能点 + 东方种族、东方技能、东方背景 | CoC7 基础 + 千幻抄能力点、能力等级、成长 A–F |
| 属性 | 3d6×5 / 点数分配，CoC7 属性 | 同左，但 DP 公式按 ATTR_SCALE 重新解释 |
| 技能 | 东方技能表 + CoC7 技能表，d100 判定 | 东方技能表，3D6 / DP 骰池判定 |
| 种族 | 14 东方种族 traits 作为 CoC7 角色特性 | 同左，但额外接种族免费能力 / 限制类别 |
| 战斗回合 | INITIATIVE / ATB：CoC7 先攻或进度条 | DP 宣言 → 排序 → 行动 → 应对 → 轮转 |
| 攻击 | 斗殴 / 射击 / 火器 / 投掷，d100 低骰成功 | 弹幕 / 射击 / 追击 / 近战 / 其他判定 |
| 伤害 | 武器伤害 + DB；极限成功额外武器骰 | 能力 LvD / 特性值 / 锻炼公式；属性相克修正 |
| 防御 | 闪避 / 格斗反击 / 寻找掩体 | 回避 / 防御 / 反击 / 掩护；擦弹点 |
| 弹幕 | 不存在“弹幕 DP 减少”；AOE 用 CoC7 规则裁定 | 弹幕无判定打全体，回避 DP 减少，擦弹 +1 |
| 擦弹 | 不启用 | 核心资源；擦弹点可回灵 / 强化攻击 |
| 灵力 / MP | CoC7 魔法点（MP），灵力=MP | 灵力 + DP 双资源 |
| 符卡使用 | **视为武器**：用 CoC7 攻击行动打出 | 展开 / 消费：独立结算、SC 池、LSC |
| 展开型符卡 | **视为护甲**：提供护甲点 / 减伤，到期或耗尽结束 | 独立 HP，优先承受伤害，击破清弹 |
| 符卡效果 | **视为魔法**：用 CoC7 魔法 / 技能检定结算 | 能力发动：DP 骰、达成值、抵抗、LvD |
| 符卡被击破 | **视为武器损毁**：该符卡本场不可再用 | LSC 气绝、清弹、DP 归零等 |
| 符卡强化 | 映射为武器命中 / 伤害加值（可复用 `spellcardEnhanceForAttack`） | 按千幻抄 SC 强化表结算 |
| 属性相克 | 可选：作为伤害加减值（KP 可关） | 完整 10 元素表，接入 DP 射击 / 追击 / 近战 / 法术 |
| 7.5 结界 | 不使用；可用 CoC7 掩体 / 护甲替代 | 完整结界：大小表、HP 吸收、AREA、惩罚、DISPEL |
| 地图 / 距离 | 可用 CoC7 距离档；也可用 Token 实际英尺 | 距离 / AREA：复用 Scene/Map/Token 坐标 |
| 重量 / 财产 | CoC7 装备与负重 | 14.3 / 14.4：{身体}×10kg、円/钱、拖拽 |
| 成长 | CoC7 成长 / 技能成长 | 千幻抄 A–F 成长等级、HP 系数、SC 池 |
| 追逐 | CoC7 追逐规则 | 现有追逐 E2E + 移动公式 |

---

## 3. Touhou-COC7 细则

### 3.1 符卡作为 CoC7 武器

新增符卡战斗档案 `SpellCardCombatProfile`：

```ts
interface SpellCardCombatProfile {
  /** WEAPON：普通武器攻击；ARMOR：展开型护甲；SPELL：发动魔法效果。 */
  mode: "WEAPON" | "ARMOR" | "SPELL";
  /** CoC7 攻击技能 id（如 FIGHTING_BRAWL / FIREARMS_HANDGUN / THROW）。 */
  skillId?: string;
  /** 伤害表达式，如 "2d6+db"。 */
  damage?: string;
  damageType?: "BLUNT" | "IMPALING" | "NONE";
  range?: "MELEE" | "NEAR" | "FAR";
  damageBands?: { label: string; expression: string; maxFeet: number | "DEX" | null }[];
  shots?: number[];
  accuracyMod?: number;
  element?: string | null;
  /** ARMOR：护甲点数 = 角色最大 HP × armorRatio；不填时退回 hpRatio。 */
  armorRatio?: number;
  /** 可用次数；null = 不限制。 */
  uses?: number | null;
}
```

映射规则：
- 符卡选择“使用”时，按 `combat.mode` 分发：
  - `WEAPON`：走 `resolveAttack`，`submission.spellCardId` 反查档案，`skill` / `damage` / `range` / `shots` 全部由服务端注入。
  - `ARMOR`：走展开结算，但产出的不是 `declaration.hp`，而是 `participant.armor` / `spellcardArmor`。
  - `SPELL`：走 `resolveMagic`，效果列表来自卡面 `effects`。
- 符卡武器可以享受 `spellcardEnhanceForAttack`：`accuracyMod` / `flatDamage` / `damageMultiplier`。
- 符卡武器不创建独立 HP；它只是一个带额外命中 / 伤害的 CoC7 武器。
- 服务端仍然只接受 `spellCardId`，数值由卡面解析，客户端不能伪造。

### 3.2 符卡效果视为魔法

- 燃料：CoC7 MP / SAN；`mpCost` / `sanCost` 从卡面读取。
- 检定：优先使用角色 `MAGIC`；没有 `MAGIC` 时回退 `OCCULT`；仍没有则 `POW`。
- 目标：`targeting` / `targetScope` 沿用当前卡面字段。
- 持续性效果：
  - `DOT`：按 CoC7 回合 / 轮计算。
  - `ARMOR`：直接进入护甲层。
  - `STATUS` / `STUN` / `CONTROL`：沿用通用状态，但清除规则按 CoC7 回合。
- 抵抗：CoC7 模式下建议用 POW 对抗（POW 对抗表），不使用千幻抄 `touhouResistTargetValue`。

### 3.3 持续性符卡视为护甲

- `DECLARATION` 符卡不再生成独立 HP。
- 护甲值优先级：
  1. 卡面 `combat.armorRatio × maxHp`
  2. 退回 `hpRatio × maxHp`
  3. 都没有时按 `enhanceValue` / 默认 0 处理并提示 KP
- 护甲生命周期：
  - 展开时写入 `spellcardArmor = { cardId, points, maxPoints, expiresAtRound }`。
  - 受击时先扣护甲，再扣 HP；与其他护甲叠加规则由规则包配置（建议取最大或累加二者择一）。
  - 到期或耗尽 → 视为“符卡被击破”。
- `damageMultiplier`（如有）映射为护甲期间的伤害倍率。

### 3.4 符卡击破视为武器损毁

- 新增 `brokenSpellCards: string[]`。
- 护甲耗尽、或展开被解除 / 击破时：
  - 该 `cardId` 加入 `brokenSpellCards`，本场不可再使用。
  - 若该符卡同时是 `WEAPON`，从可攻击武器列表中移除（等同该武器损毁 / 缴械）。
  - 日志：`SPELLCARD_DESTROYED`。
- 不触发千幻抄的“击破清弹”“LSC 气绝”“DP 归零”。
- 章节隔离（千幻抄 4.17）在 CoC7 模式下不启用，改为 `oncePerCombat`。

### 3.5 千幻抄专属内容在 CoC7 模式的降级策略

| 千幻抄内容 | CoC7 模式处理 |
|---|---|
| DP 宣言 / DP 骰池 | 关闭 |
| 擦弹点 / 擦弹强化 | 关闭 |
| 弹幕 DP 减少 | 关闭；AOE 用 CoC7 规则 |
| 能力点发动 | 转为普通魔法 / 技能发动，d100 检定 |
| 能力 LvD / +Lv | 可映射为固定伤害加值或骰数加值，写在 `combat` 档案 |
| 结界 7.5 | 不使用；用护甲 / 掩体代替 |
| 属性相克 | 可选开关：作为伤害加减值，不绑定 DP |
| 14.x 重量 / 财产 | 可继续用于探索与交易；不进入 d100 战斗核心 |
| 符卡章节隔离 | 关闭；用 oncePerCombat / 卡面 uses |
| LSC | 关闭；LSC 只是叙事标签 |

---

## 4. Touhou-DP 模式

保留现有全部规则：
- DP 宣言、DP 回复、排序、待机 +2。
- 行动：弹幕 / 射击 / 追击 / 近战 / 其他判定。
- 应对：回避 / 防御 / 反击 / 掩护；集中力；擦弹点。
- 符卡：展开型独立 HP、消费型效果、LSC、SC 池、章节隔离。
- 能力体系：6 类、变体、发动 / 抵抗、常时被动。
- 属性相克：10 元素、DP 伤害与应对修正。
- 7.5 结界：大小表、HP 吸收、AREA（复用 Scene/Map/Token）、DISPEL。
- 14.x：移动、重量 / 财产、遮挡。
- 成长 A–F。

Touhou-COC7 的 `combat` 档案在 DP 模式下**忽略**，不改变现有符卡结算。

---

## 5. 数据模型改动

### 5.1 符卡卡面

`SpellCardStatsSchema` 增加可选的 `combat` 块（不填时按旧行为，仅 DP 模式可用）：

```ts
combat: SpellCardCombatProfile.nullable().optional()
```

### 5.2 参战单位

```ts
// CombatParticipantState
brokenSpellCards?: string[];
spellcardArmor?: {
  cardId: string;
  points: number;
  maxPoints: number;
  expiresAtRound: number | null;
  damageMultiplier: number;
} | null;
```

### 5.3 房间战斗模式

- 现有 `CombatMode = "INITIATIVE" | "ATB" | "DP"` 不变。
- 房间设置：
  - CoC7 房间：仍选 INITIATIVE / ATB。
  - 东方房间：显示两项——`标准 CoC7 规则`（INITIATIVE）与 `千幻抄 DP`（DP）。
- 旧 ATB 东方房间：迁移为 Touhou-COC7，忽略快照中的 DP 字段。

### 5.4 ActionSubmission

新增可选：

```ts
spellcardCombatMode?: "WEAPON" | "ARMOR" | "SPELL";
```

由服务端根据卡面解析后注入，客户端不可伪造。

---

## 6. 服务端 / UI 改动

### 6.1 房间设置
- 东方房间战斗模式二选一；文案明确“标准 CoC7” vs “千幻抄 DP”。
- 规则包 `pack.combat.mode` 仍保留，房间 `combatMode` 覆盖。

### 6.2 战斗选项
- `attackOptionsForParticipant`：
  - Touhou-COC7：普通武器 + `combat.mode = WEAPON` 的符卡。
  - Touhou-DP：现有 DP 行动 + 符卡展开 / 消费。
- `validateCombatAction`：
  - `SPELLCARD` + `WEAPON` → 走 CoC7 攻击校验（技能、射程、次数）。
  - `SPELLCARD` + `SPELL` → 走魔法校验（MP / SAN）。
  - `SPELLCARD` + `ARMOR` → 走展开校验（持续时间、护甲值）。

### 6.3 战斗板
- Touhou-COC7：
  - 隐藏 DP 宣言 / 擦弹 / 弹幕面板。
  - 符卡显示为武器按钮（命中 / 伤害 / 射程）。
  - 展开型符卡显示“护甲”条与到期；击破显示“已毁”。
- Touhou-DP：保持现状。
- 两模式共用 `combat:update` / 快照。

### 6.4 速查表面板
- 速查条目标注适用模式：
  - `DP_ONLY` / `COC7_OK` / `BOTH`。
- 当前 `automation` 字段保留，另加 `mode` 过滤。

---

## 7. 兼容与迁移

| 旧数据 | 处理 |
|---|---|
| COC7 baseline 房间 | 完全不变 |
| 东方 ATB 房间 | 视为 Touhou-COC7；忽略 DP 相关字段 |
| 东方 DP 房间 | 视为 Touhou-DP；行为不变 |
| 旧符卡（无 `combat` 块） | DP 模式按旧行为；CoC7 模式给出“缺少武器 / 护甲档案”提示，KP 可手动裁定 |
| 旧快照含 `declaration` | CoC7 模式把 `declaration` 转为临时护甲，或提示 KP |
| `SpellcardUsage` 章节记录 | 仅 DP 模式使用 |

---

## 8. 测试矩阵

| 用例 | Touhou-COC7 | Touhou-DP |
|---|---|---|
| 符卡攻击 | d100 命中，武器伤害，极限成功 | DP 射击 / 弹幕，DP 消耗 |
| 展开型符卡 | 护甲点吸收伤害，耗尽即毁 | 独立 HP，击破清弹 |
| 消费型符卡 | 魔法检定，MP / SAN | 能力发动，DP 骰，抵抗 |
| 符卡被击破 | `brokenSpellCards`，本场不可再用 | LSC 气绝 / 清弹 / DP 归零 |
| 属性相克 | 可选伤害加减值 | 完整元素表 + DP 修正 |
| 地图距离 | 可用 Token 实际英尺，也可用距离档 | 复用 Scene/Map/Token，AREA 结界 |
| 隔离回归 | COC7 starter / combat-options / chargen 全 PASS | DP E2E 全 PASS |
| 同卡双模式 | 同一张 SC 在两种模式产生不同结算 | 同左 |

---

## 8.5 已确认决策（2026-09）

1. **能力映射**：采用做法 A——能力类别 → CoC7 技能，法术走 d100；被动映射为角色特性加值；无法数值化的标 KP。
2. **符卡武器技能**：采用卡面显式 `combat.skillId`，与现有武器卡同构；`enhanceType` 只做旧卡兜底。
3. **符卡护甲**：采用方案 A——`maxHp × armorRatio`（缺省回退 `hpRatio`）作为护甲池，耗尽即符卡损毁。
4. **属性相克**：Touhou-COC7 默认开启，作为伤害加减值。
5. **迁移**：没有在途团；非 DP 即标准 CoC7，不做运行中旧战斗迁移。
6. **LSC / 章节隔离**：仅 DP 模式；标准 CoC7 使用 `oncePerCombat` / 卡面 `uses`。

### 已实现（本轮）

- 房间战斗模式：东方房间可选「标准 CoC7」或「千幻抄 DP」。
- 符卡 `combat` 档案 schema（WEAPON / ARMOR / SPELL）。
- Touhou-COC7：符卡武器走 `resolveAttack`；持续型符卡按护甲池结算，耗尽加入 `brokenSpellCards`。
- 浏览器 E2E：标准模式下符卡武器 d100 攻击、持续型符卡展开护甲。

### 待实现

- 能力类别 → CoC7 技能的完整映射与 UI。
- 符卡 `SPELL` 模式的 d100 法术检定与抵抗。
- DP 模式的浏览器 E2E 覆盖。
- 双模式速查表适用模式标注。

## 9. 需要确认的开放项

1. Touhou-COC7 是否保留东方能力体系（神术 / 魔法 / 属性使 / 妖术）作为魔法技能，还是只保留种族 + 技能 + 符卡？
2. 符卡作为武器时，攻击技能是卡面 `skillId`、按 `enhanceType` 映射，还是统一走某个东方技能？
3. 展开型符卡护甲值公式：`armorRatio × maxHp`、直接 `hpRatio`，还是新卡面字段？
4. Touhou-COC7 下属性相克是否默认开启？
5. 旧 ATB 东方房间迁移为 Touhou-COC7 是否可接受？
6. LSC / 章节隔离是否只保留在 DP 模式？

---

## 10. 推荐落地顺序

1. 模式判定 `isTouhouDp` / `isTouhouCoc7` + 房间模式 UI（DP / 标准）。
2. 符卡 `combat` 档案 schema + 服务端解析。
3. Touhou-COC7：符卡武器走 `resolveAttack`。
4. Touhou-COC7：展开型符卡 → 护甲；击破 → `brokenSpellCards`。
5. Touhou-COC7：消费型符卡 → `resolveMagic`。
6. 战斗板 / 选项 / 校验分模式。
7. 速查表适用模式标注。
8. 双模式隔离测试 + 旧房间迁移。
