# 东方千幻抄扩展修复方案（按偏离程度从高到低）

> 依据：`docs/TOUHOU-RULES-FACTCHECK-v2.md`（COC7 底座口径）。
> 本次只修复 v2 中仍判为「违背」的 7 条；缺失/KP行为/不可达条目在本文末给出后续计划，不在本轮一次性铺开。

## 0. 隔离原则

1. **不改 COC7 基线行为**：`packages/rules/src/packs/coc7-baseline.ts` 的派生公式、判定阈值、战斗默认值、医疗与成长规则保持原样。
2. **走 TOUHOU 分支或规则包配置**：新增行为必须满足以下之一：
   - 只挂在 `TOUHOU_EXT` 的规则包字段上；
   - 在代码中显式判断 `pack.system === "TOUHOU"`；
   - 只对局部状态（如 `declaration`、`grazePoints`）生效，这些状态在 COC7 流程中永远为空/为 0。
3. **向后兼容旧战斗快照**：新增字段在 `apps/web/src/server/combat/runtime.ts` 中补默认值，旧快照可继续加载。
4. **每项修复带单元测试**，并跑 COC7 回归脚本。

## 1. P0 违背修复（已执行）

### P0-1（4.3）同一张符卡每场只能使用一次

- 问题：展开型 SC 被击破后可以重复展开；只有消费型检查了 `usedSpellCards`。
- 修复：
  - `apps/web/src/server/combat/spellcards.ts`：把“本场已使用过”检查移到两种模式之前，服务端准备动作统一拦截。
  - `packages/combat/src/combat.ts` 的 `resolveSpellcard`：两种模式都在结算时写入 `usedSpellCards`，并在函数入口再做一次防御性检查。
- 测试：`packages/combat/src/__tests__/combat.test.ts` 新增“同一张符卡每场只能使用一次”。

### P0-2（4.6）展开型 SC 独立 HP 上限

- 问题：东方包默认 `hpRatio = "2"`，展开 HP 是本体最大 HP 的 2 倍。
- 修复：
  - `packages/rules/src/packs/touhou-ext.ts` 默认改为 `hpRatio: "1"`（与本体最大 HP 相同）。
  - `apps/web/src/components/room/CardBuilder.tsx` 的兜底值改为 1；卡牌编辑页文案注明千幻抄默认为 1。
  - `apps/web/prisma/seed.ts` 的演示符卡同步改为 1。
- 说明：存量用户卡如果曾保存 `hpRatio: 2/3`，仍保留原值，需要 KP 在卡牌编辑页手动改回 1；这是有意的，避免迁移误伤自定义卡。

### P0-3（4.7）SC 被击破时溢出伤害无效

- 问题：`applyDamageToParticipant` 在 SC HP 被打空后，把剩余伤害继续结算到本体。
- 修复：`packages/combat/src/combat.ts` 中只要目标处于展开状态，伤害全部由 SC 承受；SC 归零后直接击破并丢弃溢出伤害，同时写战斗日志。
- 测试：更新“展开型先吃伤害，击破时清除队列中的弹幕”，新增溢出日志断言。

### P0-4（4.10）SC 强化数值真正参与结算

- 问题：卡牌 `enhanceType` / `enhanceValue` 会被载入，但战斗引擎从不读取；`spellcard.enhance` 配置也是死配置。
- 修复：
  - `packages/combat/src/types.ts`：`SpellDeclaration` 记录 `enhanceType` / `enhanceValue`；`ActionSubmission` 增加服务端写入的强化字段。
  - `packages/combat/src/combat.ts`：
    - 展开时把强化信息写入 declaration；
    - 新增 `spellcardEnhanceForAttack`：MELEE 增加命中并乘伤害（读取规则包 `accuracyMod` / `damageMultiplier`），DANMAKU 增加 `damageFlat`，AREA 使用卡牌倍率；
    - 新增 `spellcardEnhanceForSpell`：SPELL 强化给通用法术伤害/治疗增加 `abilityMod` 与卡牌倍率；
    - `resolveAttack` 与 `applyMagicEffect` 接入上述强化值。
  - `apps/web/src/server/combat/spellcards.ts`：准备符卡动作时把强化字段写入 submission，客户端无法伪造。
- 测试：`combat.test.ts` 新增“展开型符卡强化近战伤害”。

### P0-5（4.12）消费型 SC 执行卡面效果

- 问题：消费型 SC 只做无条件清弹，卡面 `effects` 从未结算。
- 修复：
  - `apps/web/src/server/combat/spellcards.ts`：把卡牌 `effects` / `targeting` / `targetScope` 解析进战斗动作。
  - `packages/combat/src/combat.ts`：消费型 SC 仍保留“附带消弹”的扩展设计，但随后调用 `resolveTargetedEffects` 结算卡面效果。
  - `apps/web/src/components/room/CombatBoard.tsx`：当符卡带单体效果时增加目标选择；文案改为“发动一次、结算卡面效果并消弹”。
- 测试：`combat.test.ts` 新增“消费型符卡会结算卡面效果”。

### P0-6（6.14）防御对抗

- 问题：东方 `DEFEND` 固定扣 10 灵力、固定减 30，不做任何检定。
- 修复：
  - `packages/rules/src/schema.ts` / `compile.ts` / `damage.ts`：`damage.defend` 增加可选 `failReduce`；`DEFEND_REDUCE` 改为：`defenseSuccess=true` 免伤，否则按 `failReduce` 固定减伤；旧 `cost×reduceMultiplier` 逻辑保留给没有 `failReduce` 的规则包。
  - `packages/rules/src/packs/touhou-ext.ts`：TOUHOU 防御改为 `cost: "0"`、`failReduce: "30"`，不再扣灵力。
  - `packages/combat/src/combat.ts`：TOUHOU 的 DEFEND 反应会掷 `MELEE` 技能与攻击方成功等级比较，成功免伤、失败减伤。
- 测试：更新旧“防御消耗灵力”测试，新增“防御对抗失败时按 failReduce 固定减伤”。

### P0-7（6.26）擦弹点数

- 问题：成功闪避直接回“伤害一半的灵力”，没有擦弹点数和消费入口。
- 修复：
  - `packages/combat/src/types.ts`：参战单位增加 `grazePoints` 与下一次攻击的擦弹伤害加值字段。
  - `packages/combat/src/combat.ts`：
    - 成功 DODGE（TOUHOU）改为积攒擦弹点数，不再直接回灵；
    - 新增 `resolveGrazeSpend`：PASS 行动可消费擦弹点，5:1 回灵、1:1 强化下一次近战、2:1 强化下一次远程；
    - 下一次对应攻击结算时消耗预存伤害加值。
  - `packages/rules/src/packs/touhou-ext.ts`：`dodge.grazeMpGainRatio` 置 0，避免管线再回灵。
  - `packages/combat/src/filter.ts`、`apps/web/src/components/room/CombatBoard.tsx`：战斗视图显示擦弹点数与三个消费按钮。
  - `apps/web/src/server/combat/runtime.ts`：旧快照补 `grazePoints = 0`。
- 测试：更新“擦弹成功”测试，新增“兑换灵力”“强化下一次近战伤害”。

## 2. P1 缺失（分批推进）

> 这些属于千幻抄专属内容缺口，不是自动流程错误；补内容时同样遵守第 0 节隔离原则。
> 本轮先落地「种族与特殊能力」；其余条目仍按顺序排期。

### 2.1 已完成（第一批）：种族与特殊能力（v2: 2.9、2.11）

**数据层**
- `touhou-ext.ts` 补齐 wiki 种族：新增 `DEMON`（恶魔）与 `ABERRATION`（怪异），保留已实现的 `HOURAI` / `HANYOU`。
- 新增 `RaceSchema.tier` 并登记 wiki 的 A-D 级别：A 吸血鬼 / 恶魔；B 亡灵 / 天狗 / 妖怪 / 怪异；
  C 魔法使 / 河童 / 付丧神 / 妖兽；D 人类 / 妖精；蓬莱人 / 半妖留空。
- 新增 `RaceSchema.abilities` 结构化能力表（`id` / `name` / `description` / `automated` / `tags` / `params`），
  并给全部 14 个 TOUHOU 种族登记能力；旧 `flags` 保留以兼容 UI 与旧数据。
- 新增 `SUNLIGHT` 状态，供吸血鬼阳光弱点使用。

**规则 / 战斗自动化（仅 TOUHOU 生效）**
- 伤害管线新增 `RACE_MOD` 步骤；只有 `touhou-ext` 的 pipeline 包含它，COC7 基线不受影响。
- `raceIncomingMultiplier()`：按种族能力 tags 匹配攻击技能（如妖怪对 `MAGIC` / `SPIRIT_ARTS`）
  或目标状态 key（如吸血鬼对 `SUNLIGHT`），命中时应用 `params.multiplier`。
- `resolveRoundRaceAbilities()`：每轮开始为带 `REGEN` 能力的种族（怪异）自动回 HP。
- `applyRaceImmortalSurvival()`：蓬莱人 HP 归零时保留 `reviveHp`（默认 1），不进入重伤 / 濒死 / 死亡流程。
- 参战单位新增 `race` / `raceFlags`，由 `setup.ts` 从 `computeDerived` 注入；旧战斗快照在 `runtime.ts` 补默认值。

**测试与隔离**
- `packages/rules/src/__tests__/touhou-races.test.ts`：种族名单、结构化能力、RACE_MOD 的 TOUHOU / COC7 隔离。
- `packages/combat/src/__tests__/touhou-races.test.ts`：妖怪魔法弱点、普通攻击不误伤、吸血鬼阳光弱点、
  无种族不触发、怪异再生、蓬莱人不死、普通种族可死亡。
- COC7 单位 `race` 为 null，且 COC7 pipeline 无 `RACE_MOD`，因此不读取种族能力、不改变任何判定。

**仍需 KP / 后续能力系统承接的种族能力**（已在数据中登记，`automated: false`）：
幽体化、灵力回 HP、动物会话 / 变身、本体绑定、水栖、契约 / 黑暗视觉、吸血 / 魅惑、妖精月再生、
技能学习限制（人类不可学妖术）等。这些依赖能力系统或叙事裁定，不在本轮硬编码。

### 2.2 已完成（第二批）：属性相克（v2: 5.1、5.2 部分）

**数据层**
- 新增 `ElementSchema`（`id` / `name` / `strongAgainst` / `weakTo`）与 `RulePackSchema.elements`，
  模组可整体覆盖属性表。
- `touhou-ext` 定义十属性：木、火、土、金、水、风、雷、冷气、光、暗；
  登记五行相克与风雷 / 冷气 / 光暗关系，`weakTo` 由相克关系反向对齐并加测试。
- 新增 `ElementRulesSchema`（`weaknessDamage` / `weaknessFlat` / `sameElementDamage` / `sameElementFlat`）。
- `RaceSchema.elements`：河童水、天狗风、亡灵 / 吸血鬼 / 恶魔暗等先天元素。
- `MagicSpellSchema.element` 与 DAMAGE 效果的 `element`：法术默认元素 + 效果级覆盖。
- 武器卡 `stats.element`：`WeaponStatsSchema` 新增字段，服务端 `attackOptionsForParticipant` 解析。

**战斗结算（仅 TOUHOU）**
- 伤害管线新增 `ELEMENT_MOD` 步骤；只有 `touhou-ext` pipeline 包含它。
- `resolveElementAdjustment()`：攻击元素克制目标元素时附加 `2d6`（掷骰失败回退 `+5`），
  同属性时附加 `-2d6`；弱点与同属性同时成立时按千幻抄「不重复叠加」取弱点。
- 抵抗修正：弱点使防守方本次应对检定目标 `-3`，同属性 `+3`；
  由 `weaknessResistMod` / `sameElementResistMod` 配置，仅对 DODGE / DEFEND / COUNTER 生效。
- 攻击 / 法术 / 道具 DAMAGE 效果都走同一属性判定；routine 多段攻击逐段携带元素。
- 参战单位新增 `elements`，旧快照在 `runtime.ts` 按 race 回填。

**测试与隔离**
- `packages/rules/src/__tests__/touhou-elements.test.ts`：6 条（属性表、相克双向一致、种族元素、
  ELEMENT_MOD 与 COC7 隔离）。
- `packages/combat/src/__tests__/touhou-elements.test.ts`：8 条（弱点、同属性、不叠加、无元素不触发、
  应对检定目标 -3 / +3 / 不修正）。
- COC7 基线 `elements` 为空且 pipeline 不含 `ELEMENT_MOD`，传入属性值也不改变伤害。

**仍未覆盖的 5.2 / 5.3**：「属性明显时全判定 ±1」属情境裁定，保留为 KP 行为；
属性使能力（每种属性独立等级、基本 / 追加能力、与妖术组合、范围与脱离）留待能力系统批次。

### 2.3 后续条目（未铺开）

1. **千幻抄能力体系**（v2: 2.14、2.17、2.18、7.x–11.x）
   - 神术·阴阳术 / 魔法 / 属性使 / 妖力 / 妖术 / 特技的能力等级、能力点、法术表、习得与成长。
   - 建议新增 `abilities` 规则包字段和通用“能力等级”模型，复用现有 effects 结算，不覆盖 COC7 技能。
2. **DP 机制**（v2: 2.8、3.5、6.5、6.6、6.9、6.13、6.17、6.18、6.21、6.22、6.33 等）
   - 如果要做完整 DP 战斗，需要独立于现有 ATB 的“回合 + DP 宣言 + 消费骰”模式；建议做成 TOUHOU 可选战斗模式，保留 ATB 作为现有房规。
3. **SC 完整规则**（v2: 4.1、4.2、4.4、4.8、4.9、4.11、4.13–4.17）
   - 开卡 3 张、战斗前 SC 宣言数、展开任意时机、展开/消费回复 DP、LSC、符卡战胜负条件。
4. **属性相克 · 剩余部分**（v2: 5.2 判定 / 抵抗修正、5.3 属性使能力）
   - 在已有元素表上补抵抗 / 全判定修正与属性使的能力等级、法术表；建议随能力系统一起做。
5. **成长体系**（v2: 13.x）
   - A-F 成长等级、特性值/技能/能力/HP系数与SC成长表、妖术与锻炼 60% 上限。
6. **其他规则**（v2: 14.x）
   - 千幻抄移动公式、灵力自然恢复、30分钟苏醒、应急治疗 DC18、财产/重量/遮挡物。

## 3. P2 KP行为 / 不可达

- KP行为条目继续用自由掷骰、暗骰、KP 数值面板和局内 JSON 承载，不强行自动化。
- 不可达条目（如 GM 用敌方骰数×3.5 省略掷骰）可在 DP 模式落地后再评估。

## 4. 验证记录

### 4.1 P0 违背修复

- `npm run typecheck`：rules / combat / web 均通过。
- `npm test`：全部 workspace 通过（combat 110、rules 99、formula 54、web 5）。
- `npm run build --workspace @touhou/web`：通过。
- COC7 回归：
  - `npm run verify:coc7-starter`：PASS；
  - `npm run verify:combat-options`：PASS；
  - `npm run verify:chargen-rules`：PASS；
  - `npm run verify:character-draft`：PASS。
- COC7 专项测试文件 `packages/combat/src/__tests__/coc7-fixes.test.ts` 全部通过。

### 4.2 P1 第一批：种族与特殊能力

- `npm run typecheck`：rules / combat / web 均通过。
- `npm test`：全部 workspace 通过（新增 rules 6 条、combat 7 条）。
- `npm run build --workspace @touhou/web`：通过。
- COC7 回归四个脚本全部 PASS（与 P0 相同）。
- 新增测试：
  - `packages/rules/src/__tests__/touhou-races.test.ts`：6 条；
  - `packages/combat/src/__tests__/touhou-races.test.ts`：7 条。

### 4.3 P1 第二批：属性相克

- `npm run typecheck`：rules / combat / web 均通过。
- `npm test`：全部 workspace 通过（rules 113、combat 122、formula 54、web 5）。
- `npm run build --workspace @touhou/web`：通过。
- COC7 回归四个脚本全部 PASS。
- 新增测试：
  - `packages/rules/src/__tests__/touhou-elements.test.ts`：6 条；
  - `packages/combat/src/__tests__/touhou-elements.test.ts`：8 条；
  - `packages/rules/src/__tests__/magic.test.ts` 追加 2 条元素继承测试。

## 5. 风险与回滚

- 擦弹点数上线后，旧战斗中的“闪避回灵”手感会变化；新战斗从 0 开始，旧快照兼容为 0。若需要临时恢复旧手感，把 `touhou-ext.damage.dodge.grazeMpGainRatio` 从 `"0"` 改回 `"0.5"` 并禁用擦弹消费按钮即可。
- 存量符卡 `hpRatio` 不会自动迁移；KP 可在卡牌编辑页改为 1。若批量迁移需要另写数据脚本。
- 所有新增字段都有默认值，旧战斗快照加载不会报错。
- COC7 流程未改动判定、战斗默认值、车卡、医疗与成长路径；新增代码路径在 COC7 下由 `pack.system` 或空 `declaration` 短路。
