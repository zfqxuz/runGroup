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

**仍未覆盖的 5.2**：「属性明显时全判定 ±1」属情境裁定，保留为 KP 行为。

**5.3 属性使（结构化支持已落地）**：
- 能力实例 id `CATEGORY:SUFFIX`（如 `ELEMENTALIST:FIRE`）：`splitAbilityInstanceId` /
  `resolveAbilityCategory`；`abilitySpendTotal` / `validateAbilitySpend` / 成长校验都按实例累计。
- 车卡 UI 为属性使逐属性（`pack.elements`）生成独立等级，并可选择发动特性值 {知性}/{感觉}；
  写入 `backstory.abilities` / `backstory.abilityAttributes`，战斗时 `resolveAbility` 读取实例等级与特性值。
- 仍未覆盖：属性使具体法术表（9.2）、基本 / 追加能力内容、与妖术组合、范围与脱离；
  这些需要 wiki 法术表内容由规则包 / 模组补齐。

### 2.3 已完成（第三批）：能力体系 · 发动 / 抵抗 / 共用执行器（v2: 2.17、2.18、6.11、7.x–11.x 部分）

**共用执行器（低风险重构）**
- 从 `resolveMagic` 中提取 `executeSpellEffects()` 与 `spellCostFor()`：
  COC7 魔法、千幻抄能力、道具都走同一个 `resolveTargetedEffects` 效果执行器。
- `resolveMagic` 的消耗、SAN 掷骰 salt、判定与结算顺序保持原样，COC7 行为不变（原 magic 测试全部通过）。

**规则数据**
- 新增 `AbilityRulesSchema`（`categories`：`activationAttribute` / `costTable` / `spellsPerLevel`）与 `RulePackSchema.abilities`。
- `MagicSpellSchema` 增加 `abilityId` / `requiredLevel` / `activation` / `resist`：
  法术仍放在 `magic.spells` 里，能力字段只是把它接入能力流程。
- `touhou-ext` 登记五类能力与消费表：
  神术·阴阳术 5/10/15/20/25/25、魔法 5/10/15/20/25/25、属性使 4/8/12/16/20/20、
  妖术 1/2/4/6/8/10/12/12、特技 1/2/4/6/8/10/12/12；并补〈抵抗〉技能。
- 规则工具 `abilityCostForLevel` / `abilityTotalCost` / `abilityLevelForPoints` / `abilitySpellCountIssue`
  （消费表、按点数反推等级、按每级上限校验法术数量）。
- 车卡能力点预算 `pointBudgets`（A/B/C/D = 30/25/20/15）与
  `abilityPointBudget` / `abilitySpendTotal` / `validateAbilitySpend`；车卡 UI / DB 接线留待后续。

**战斗流程（仅 TOUHOU）**
- 新增 `resolveAbility()`：校验已习得等级 → 掷 `{特性值}+Lv+3D6`（可配置 1D100）→
  **无论成败都扣灵力** → 成功后再走抵抗判定 → 最后复用 `executeSpellEffects()`。
- 抵抗：`{属性}+〈抵抗〉+3D6 ≥ 10 + 术者 Lv + 达成值×2 的十位数`，可配置属性 / 技能 / 骰式。
- 参战单位新增 `abilityLevels`：角色从 `sourceData.abilities` / `backstory.abilities` 读入，
  NPC 从 `NpcStats.abilities` 读入；旧快照补空对象。
- COC7 基线 `abilities.enabled=false`，且 dispatcher 仅对 `pack.system==="TOUHOU"` 分流，COC7 仍走原 `resolveMagic`。

**本批未覆盖的能力体系内容**：能力点车卡 UI / DB 接线、每级习得法术数量校验接入 UI、成长消费（13.4）、
DP 骰上限（依赖 DP 机制）、妖力 / 特技 / 锻炼的常时被动层、`BARRIER` 结界（需要范围 / 位置模型）。

### 2.4 已完成（第四批）：能力效果缺口 DISPEL / LvD（v2: 7.x–11.x 效果部分）

- `MagicEffect` 新增 `DISPEL`：按 `keys` 驱散状态（空数组驱散全部），可选 `declaration` 同时击破
  目标展开中的符卡（复用既有 `breakDeclaration` 清弹逻辑）。
- `DAMAGE` / `HEAL` 新增等级缩放字段：
  - `levelDice: { die, perLevel }`：每 `perLevel` 级追加 1 颗 `die` 面骰（LvD）；
  - `levelBonus`：固定值表达式，可用 `abilityLv` 变量（+Lv / ×Lv）。
- `resolveAbility` 把能力等级写入 `submission.abilityLevel`；普通 COC7 / TOUHOU 魔法路径为空，
  因此缩放字段对非能力法术不生效。
- 测试：rules `magic.test.ts` 追加 DISPEL / 缩放解析；combat `touhou-abilities.test.ts` 追加
  `+Lv`、`LvD`、普通路径不缩放、DISPEL 指定 key / 全部状态 / 击破符卡。

### 2.5 已完成（第五批）：14.x 恢复 / 移动 + 灵力归零昏迷

**规则层纯函数**（`packages/rules/src/touhou.ts`）
- `touhouMovement`：地面 = {身体}+〈运动〉；飞行 = ({知性}或{身体}+〈飞行〉)×2（m/s）。
- `resolveTouhouNaturalHealing`：每小时 1 HP；有〈应急处置〉/〈医学〉每小时额外 + 技能等级（14.5）。
- `resolveTouhouEmergencyCare`：{知性}+〈应急处置/医学〉+3D6，DC18；成功恢复达成值半数，耗时 30 分钟（14.6）。
- `resolveTouhouMpRecovery`：清醒每 10 分钟 +1；连续睡 3 小时回满（14.8）。
- `TOUHOU_WAKE_MINUTES = 30`：HP 回复后约 30 分钟苏醒（14.4，供时间推进流程使用）。

**战斗层**
- 千幻抄 14.3：灵力归零即昏迷、行动不能。新增 `mpExhausted` 标记；所有扣灵点（施法、能力、符卡、
  规则外法术、MP 吸取、伤害管线 MP 消耗）都会触发；灵力恢复（MP 回复、吸取、擦弹兑换）会解除昏迷。
- 千幻抄允许治疗 / 回灵类法术选中「已灵力归零但未死亡」的队友；敌人伤害仍跳过倒地目标。

**未覆盖的 14.x**：移动公式接入追逐（需要 m/s → MOV 的换算决策）、重量 / 财产、遮挡物 / 掩体判定。

### 2.6 已完成（第六批）：成长等级 A-F 与消费表（v2: 13.1–13.4、13.6）

**数据**（来自 wiki 成长等级页）
- `AbilityRulesSchema.growthRanks`：A-F 四类成长量，`touhou-ext` 登记：
  - 特性值 10/8/6/4/2/1；技能 18/15/12/9/6/3；能力 12/10/8/6/4/2；
  - HP 系数 0.8/0.6/0.4/0.2/0.1/0.1；SC 0.7/0.6/0.5/0.4/0.3/0.1。

**规则工具**（`packages/rules/src/growth-touhou.ts`）
- `touhouGrowthGrant`：把 GM 给的 4 个等级分配到「特性值 / 技能 / 能力 / HP&SC」。
- `touhouAttributeGrowthCost`：n→n+1 花费 n+1。
- `touhouSkillGrowthStepCost` / `touhouSkillGrowthCost` / `touhouSkillGrowthIssue`：
  升到 L 级花 L 点、5 级及以后固定 5 点、一次最多 1 级。
- `touhouAbilityGrowthCost`：复用开卡消费表（神术/魔法 5/10/15/20/25…、属性使 4/8/12/16/20…、
  妖术与锻炼 1/2/4/6/8/10/12…）。
- `touhouRestrictedGrowthCap` / `touhouRestrictedGrowthIssue`：妖术 / 锻炼单个能力最多用成长能力点的 60%（向上取整）。
- `touhouSpellcardPoolAfter` / `touhouSpellcardCount`：SC 持有数从 3 起按小数累计、实际数量向下取整。
- `touhouHpCoefficientAfter` / `touhouHpFromCoefficient`：HP 系数从 ×4 起累计，HP = ceil(10 + 耐久×系数)。
- `touhouYoujutsuCountCap` / `touhouYoujutsuCountIssue`：妖术总数上限 = 最高级 Lv+2。

**本批未覆盖**：术式版神术（3/6/9…）与妖弹化妖术（2/3/5…）的变体消费表。

**后续已补（本批之后）**：
- ✅ 成长 UI / DB 接线：`Character.sourceData.touhouGrowth` 记录成长点池，
  KP 在结束页按 A-F 分配四类成长量，玩家在准备页消费（特性值 / 技能 / 能力），
  写入 `CharacterAdvancement`；妖术 / 锻炼单项 60% 限制生效。
- ✅ HP 系数接入 `maxHp`：`computeDerived` 支持 `constOverrides.HP_COEFFICIENT`，
  角色按 `sourceData.touhouGrowth.hpCoefficient`（开卡 4）计算最大 HP；
  成长 HP 系数时同步更新 `maxHp` / `hp`。

### 2.7 已完成（第七批）：千幻抄 HP/宣言公式 + DP 模式核心

**用户已确认的决策**
- 东方拓展**只使用 DP 模式**（`combat.mode: "DP"`），ATB 仅保留给 COC7 / 历史数据。
- SC 宣言在进入战斗前完成：发起方与应战方各自从可用符卡中选择不超过本场上限的张数；
  上限按「能使用 SC 的人数」自动计算。
- 允许改 DB / UI，但改动只能作用于东方模式。
- HP 使用千幻抄公式 `ceil(10 + 耐久 × HP系数)`。

**已落地**
- HP：`const.HP_COEFFICIENT=4`，`derived.maxHp = ceil(10 + con * HP_COEFFICIENT)`。
- SC 宣言：`SpellCardRulesSchema.battleDeclaration`（perMember 2.5 / CEIL / min 1，可配置）+
  `spellcardSideUsableCount()` / `spellcardBattleDeclarationRules()`。
- DP 规则：`COMBAT_MODES` 新增 `"DP"`；`DpRulesSchema`（regen / minRegen / maxDicePerCheck）；
  `touhou-ext.dp` 登记 `ceil((int + dex)/3)`、最低 2、单次最多 3D。
- DP 行动消耗：`DpRulesSchema.actionCosts`（弹幕 3、射击/回避/防御 1/骰、追击 2/目标、近战 1+1/骰、
  抵抗最多 3D），支持模组 / 房间 ruleOverride 覆盖；`dpEconomySummary()` 用于资源经济估算，
  对照表见 `docs/TOUHOU-DP-ECONOMY.md`。
- 尺度作为房间参数：`const.ATTR_SCALE`（特性值 = floor(COC7 属性 / 系数)），
  作用于 HP/MP/SAN/DP 与 DP 回复；准备页新增 `RoomDpEconomyPanel` 让 KP 实时试算本房间角色并保存，
  服务端 `setTouhouAttributeScaleAction`（仅 KP、仅东方）。
- DP 回合核心：`packages/combat/src/dp.ts` —— `beginDpRound`（种族再生 + DP 回复 + 进入宣言）、
  `declareDp`（声明后按 DP 从高到低排序，同值 PC 先于 NPC）、`endDpTurn`（轮转）、
  `dpRegenFor`、`grantDpWaitBonus`（待机下轮回复 +2）；`CombatState.dp` 保存一轮宣言状态。
- UI 仅放开 DP 模式类型，尚未开放选择；TOUHOU 仍暂用 ATB，待 DP 行动结算完成后一次性切换。

**DP / SC 后续里程碑**
1. DP 行动结算（进行中）：
   - ✅ 数值换算：`const.SKILL_SCALE`（技能等级 = floor(技能值 / SKILL_SCALE)）与 `const.ATTR_SCALE`；
     判定原语 `dpRoll` = `{特性值} + 〈技能〉Lv + N D6`；`spendDp` 消耗与不足拦截。
   - ✅ 弹幕：固定 DP、无判定、全体；目标回避扣 DP、DP 不足吃固定伤害。
   - ✅ 射击：DP 骰数、3D6 对抗、回避 / 防御应对、防御失败按〈近战武器〉等级×2 减伤。
   - ✅ 追击：每目标 2 DP、固定达成值 `{特性值}+〈追击〉+10`、每 +2DP +10、目标数上限 `ceil(Lv/2)+1`。
   - ✅ 近战：接近判定（{身体}+〈回避〉 vs 目标 {身体}+max(〈回避〉,〈弹幕〉+15)）→ 命中判定 →
     应对 → 伤害；接近与命中各自消费 DP 骰。
   - ✅ 能力发动：DP 模式改为消费 DP 骰的 `{特性值}+Lv+ND6`（`dp.maxDicePerCheck`，默认 3），
     失败仍扣灵力；`dp.actionCosts.abilityPerDie` 可配。
   - ✅ 抵抗：DP 模式 `{意志/耐久}+〈抵抗〉+ND6`（`resistMaxDice`，默认 3），消耗 `resistPerDie`×骰数；
     目标值 `10+施术者 Lv+达成值×2 的十位数`；DP 不足自动抵抗失败。
   - ✅ 千幻抄伤害公式（规则层 `packages/rules/src/touhou-dp.ts`）：射击/能力 `能力 LvD+特性`、
     追击 `能力 Lv÷2 D+特性`、近战 `{身体}+锻炼 LvD+武器 Lv`；submission 提供
     `damageAbilityId` / `damageTrainingId` / `damageWeaponSkill` 时启用，否则回退卡面 damage。
   - ✅ SC 强化接入 DP：弹幕 / 射击 / 追击用 `DANMAKU` flat 加值，近战用 `MELEE` accuracyMod（接近）
     与 damageMultiplier；与 `spellcardEnhanceForAttack` 共用同一份规则包配置。
   - ✅ 6.12 / 6.26 擦弹：DP 成功回避射击 / 追击 / 近战获得骰数点擦弹；回避弹幕 +1；防御不获得。
   - ✅ 6.21 待机：DP 中 `PASS`（非擦弹消费）使下一回合 DP 回复 +2。
   - ✅ 6.11 能力：DP 中原则上每回合只能发动一次能力（`abilityUsedThisRound`，回合开始重置）。
   - ✅ 掩护 / 身代：队友声明 `COVER` + `coverTargetId`，掷 `{感觉}+〈回避〉+ND6`（`coverPerDie`×骰数）
     对抗攻击达成值；成功由掩护者代替承受伤害，失败原目标无减伤承受；同一掩护者一轮一次
     （`coverUsedThisRound`，`beginDpRound` 重置）。作用于射击 / 追击 / 近战；能力伤害走抵抗流程。
     前卫位置暂由 KP / 后续位置模型约束。
2. ✅ 接线：`setup.ts` / `socket/combat.ts` 增加 DP 分支（回合 → 宣言 → 逐个行动 → 反应窗口 → 轮转），
   TOUHOU 的 `combat.mode` 已切到 `"DP"`：
   - 规则包 `touhou-ext.combat.mode = "DP"`（`dp-economy.test.ts` 锁定）。
   - `setup.ts` 创建 DP 战斗时调用 `beginDpRound`，`dbPhase` 把 `DP_DECLARATION` 映射为 DB 的 `ACTION`。
   - socket 新增 `combat:dp-declare`（KP 可代任意单位声明）；`tryResolveCombat` 在 DP 下每次只结算
     当前行动者并调用 `resolveDpTurn` 轮转；`combat:action` 支持 `dpAction` / `dpDice` /
     `dpSecondaryDice` / `dpTargetIds` / `dpEscalation` / 伤害公式字段。
   - `reactionTargetIdsForAction` 对 DP 射击 / 追击 / 近战额外返回目标队友，作为掩护窗口；
     `combat:reaction` 支持 `dpDice` 与 `coverTargetId`；应对选项 `PASS/DEFEND/DODGE/COVER`（能力另加 `RESIST`）。
   - `CombatView` 新增 `dp`（已声明 / 顺序 / 当前行动者）与 `participant.abilityLevels`。
   - `CombatBoard` 新增 DP 宣言面板、DP 行动面板（弹幕 / 射击 / 追击 / 近战 + 骰数 + 能力 / 锻炼）、
     应对窗口 DP 骰数与掩护目标选择。
   - 新增 web 回归脚本 `verify:dp-combat`。
3. SC 宣言流程（已实现 UI）：
   - ✅ 每方 SC 池：`CombatState.spellcardBattle.sideUsable`，由 `setup.ts` 在创建战斗时按
     「有装备 SC 的角色人数」用 `spellcardSideUsableCount()` 计算；引擎与
     `prepareSpellcardAction` 在池用完时拦截（`SPELLCARD_POOL_EMPTY`）。
   - ✅ 战前选牌：`combat/new` 的 `CombatUnitPicker` 按当前选择实时列出双方 SC，
     并显示「已选 / 上限」，超过上限的复选框禁用；提交 `allyCards` / `enemyCards`。
   - ✅ 服务端 `CreateCombatOptions.spellcardDeclarations` 校验卡归属与上限，
     写入 `spellcardBattle.declaredCardIds`；未宣言的卡不能发动
     （`SPELLCARD_NOT_DECLARED`，准备阶段即拦截）。
   - ✅ 4.17 跨战斗消耗：新增 `SpellcardUsage(roomId, characterId, cardId)` 表与迁移；
     战前候选与战斗创建都会过滤本章节已用 SC（按房间记账），
     提交 / 任意时机展开成功时写入使用记录。
   - ✅ 严格「章节」边界：`SpellcardUsage.chapterKey` 参与唯一约束（迁移 `20260920130000_spellcard_chapter`）；
     `currentChapterIdOfRoom()` 读取 GameState.currentChapterId，候选 / 结算 / 记录都按章节分组，
     不同章节可各使用一次同一张符卡；房间级旧记录（chapterKey=""）继续兼容。
4. SC 完整规则（部分完成）：
   - ✅ 4.8 / 4.12：展开型 SC 展开、消费型 SC 发动时回复 `ceil(DP 上限/2)` DP
     （`recoverSpellcardDp`，日志 `SPELLCARD_DP_RECOVER`）。
   - ✅ 4.11：击破展开型 SC 的一方按自己的 DP 自然回复量回复 DP
     （`grantDeclarationBreakerDp`，日志 `SPELLCARD_BREAK_DP_RECOVER`）；
     主动放弃展开中的 SC 由敌对阵营一人回复 DP（PASS + `abandonDeclaration`，
     日志 `SPELLCARD_ABANDONED`）。
   - ✅ 4.15 LSC：展开时可勾选 LSC；使用后 `lscUsed` 阻止本场再用符卡；
     LSC 被击破时立刻气绝（`unconscious` / `defeated`）、DP 与 DP 上限归零（30 分钟口径），
     日志 `LSC_DECLARED` / `LSC_BROKEN`；`CombatBoard` 增加 LSC 勾选。
     30 分钟后 `recoverTouhouLscLimits()` 恢复 DP 上限与初始值（回合开始 / 载入检查，
     日志 `LSC_DP_RECOVERED`）。
   - ✅ 4.9 任意时机展开：`resolveSpellcardImmediate()` 复用符卡校验与结算；
     socket 新增 `combat:immediate-spellcard`（只允许当前应对窗口的目标），
     展开后按 PASS 继续结算，攻击伤害先由新展开的 SC 承受；
     `CombatBoard` 应对窗口列出可展开的符卡按钮。
   - ✅ 4.16 符卡战余量：`spellcardBattleSummary()` / `CombatView.spellcardBattle` 给出每方
     可用 / 已用 / 剩余 SC 与存活人数；KP 视图显示「SC 剩余 x/y」，全部存活为 0 但仍有 SC 时提示 KP 裁定。
     （HP 归零 = 行动不能，因此「全灭」判定仍由引擎结束战斗。）
   - ✅ 4.17 跨战斗消耗（见里程碑 3）。

### 2.8 后续条目（未铺开）

1. **千幻抄能力体系 · 剩余部分**（v2: 2.17、2.18、7.x–11.x）
   - ✅ 能力点与等级的车卡 / 成长流程（已实现）。
   - ✅ **能力变体**：`AbilityCategorySchema.variants` 支持替代习得路径与攻击种类限制；
     登记神术术式版（3/6/9/12/15/15，禁射击 / 追击 / 弹幕）与妖术妖弹化（2/3/5/7/9/11/13，Lv8 起 13）。
   - ✅ **妖力类别**：新增 `YOURIKI`；车卡 UI / 消费者工具支持 `CATEGORY`、`CATEGORY:SUFFIX`、`CATEGORY#VARIANT` 三种实例 id。
   - ✅ **每级习得数量**：`abilitySpellCountIssue` 接入车卡 UI 与服务端保存拦截（按 `magic.spells.abilityId` 归类）。
   - ✅ **种族免费 / 限制**：`RaceSchema.freeAbilityLevels` / `disallowedAbilityCategories`；
     妖怪免费 3 级妖术，人类禁止妖力 / 妖术（属性使组合为例外开关）。
   - ✅ **妖力 / 特技常时被动层**：`AbilityDefinitionSchema.passives`（属性 / 技能 / 衍生 / 伤害 / 应对 / 命中 /
     移动 / 擦弹追加）+ `grazeBonusPer`；`collectAbilityPassiveMods` 在战斗准备时求值；
     DP 战斗的伤害、回避 / 防御 / 掩护 / 抵抗、命中、擦弹与追逐移动已接入。
   - ✅ **妖力 / 特技列表**（wiki 抓取）：`packs/data/touhou-abilities.ts` 登记 19 个条目
     （名称 / 消费点数 / 说明）；`AbilityDefinitionSchema.cost` / `costPerLevel` / `costNote`
     接入能力点预算与车卡 UI；高速飞行（移动 +Lv）、擦弹判定大（每 3 点擦弹 +1）、
     被弹判定小（弹幕 DP 消耗与伤害 -1）、气功（射击/近战 +LvD、弹幕 +Lv）、
     集中力（PASS 宣言，下次防御/回避 DP 减免 max(3, floor(maxDp/6)×每骰)）已自动化。
     未自动化条目由 KP 按说明结算。
   - ✅ **wiki 法术 / 能力速查表**：`RulePack.spellReferences` + `packs/data/touhou-spell-references.ts`
     登记 85 条（神术·阴阳术 15、魔法 59、属性使 9、妖术 2），保留目标值 / 灵力 / 范围 / 时间 / 说明；
     每条新增 `automation` 状态（BUILTIN / PARTIAL / KP，默认 KP）；当前 20 条 BUILTIN、0 条 PARTIAL、65 条 KP；
     房间页新增「法术·能力速查表」面板（分类 / 系别 / 搜索 / 自动化状态徽标 / 数量汇总）。
   - ✅ **内置可结算法术子集**：`touhou-ext.magic.spells` 登记 加持 / 恢复术 / 治愈术 / 转灵术 / 护盾术 / 破魔结界 /
     属性使·生成 / 属性使·消灭 / 属性使·强化攻击 / 属性使·武器生成 / 属性使·觉醒 / 属性使·属性赋予 /
     魔法战斗系·燃烧弹 / 光束 / 飞弹 / 切裂术 / 爆射 / 广域射击 /
     神术·祈福 / 灵缚 / 神凭（HEAL Lv×5、DISPEL、MP_RESTORE、
     TEMP_DP ceil(Lv×1.5)、CREATE_COVER 强度 Lv×4、解除状态/结界/生成物、ATTACK_BUFF +1D / 弹幕 +2、
     ELEMENTAL_WEAPON 近战 +属性使 Lv、battleAttack 强化 DP 攻击）；
     TOUHOU 房间启用魔法且无模组法术时，`applyMagicRulesToRoom` 回退使用内置法术。
   - ✅ **属性使·强化攻击（ATTACK_BUFF）**：下一次近战 / 射击 / 追击追加 +bonusDice D，弹幕伤害 +danmakuDamage；
     `uses` 限制生效次数、`durationTicks` 控制持续，重复施展取高值不叠加；DP 战斗的射击 / 追击 / 近战 / 弹幕
     结算后消费，战斗视图展示剩余次数。
   - ✅ **属性使·武器生成（ELEMENTAL_WEAPON）**：生成近战武器，近战伤害 +属性使 Lv（可叠通常武器加值），
     攻击附带由能力实例后缀（`ELEMENTALIST:FIRE`）推导的属性，并参与属性相克；未习得剑闪时远程 / 弹幕
     不获得加值（`canRanged=false`）；到期轮清理，战斗视图展示武器属性与加值。
   - ✅ **属性使·觉醒**：`SUMMON` 支持 `abilityId` / `perLevel`；没有模组召唤模板时按
     属性使 Lv×2 生成通用战斗单位（属性 = 判定值，HP = 10 + Lv），入战并受召唤持续时间约束。
   - ✅ **魔法战斗系 DP 攻击（battleAttack）**：`MagicSpell.battleAttack` 描述法术强化哪种 DP 攻击；
     玩家在 DP 攻击时携带 `attackSpellId`，引擎校验后扣除灵力并应用追加骰 / 固定伤害 / 弹幕 DP 减少 /
     多目标 / 无视前卫后卫。内置燃烧弹（弹幕 +2 伤 / 回避 DP +1）、光束（射击 +ceil(魔法 Lv/2)D）、
     飞弹（追击 +ceil(魔法 Lv/2)D）、切裂术（近战 +ceil(魔法 Lv/2)D）、爆射（多目标射击 +ceil(魔法 Lv/2)D、
     无视前卫后卫）、广域射击（多目标射击）。
   - ✅ **神术追加可结算法术**：`CHECK_BUFF`（祈福：按发动达成值×2 的十位数给所有行动达成加值）、
     `DP_REGEN_BUFF`（神凭：战斗短期预知，10 分钟 DP 回复 +1）、灵缚（CONTROL，抵抗失败跳过下一次行动）；
     修正了抵抗技能未习得时把特性值当技能重复计算的问题。
   - ✅ **能力类别级法术**：`resolveAbility` / `dpAbilityLevel` 支持 `abilityId=类别` 时回退到同类别实例最高等级
     （如 `ELEMENTALIST:FIRE` 支撑 `abilityId=ELEMENTALIST` 的生成/消灭）。
   - ✅ **追加 DP（护盾术）**：`MagicEffect TEMP_DP`；追加 DP 只用于回避 / 防御 / 弹幕减免，
     消费时优先扣追加 DP，支持到期轮次；战斗视图展示追加 DP。
   - ✅ **DP 属性相克修正**：DP 射击 / 追击 / 近战现在与 ATB 一样应用 ELEMENT_MOD
     （弱点 / 同属性伤害与应对修正）；`MagicEffect ELEMENT_BUFF`（属性赋予）
     授予 `grantedElement`，攻击未指定元素时自动使用；战斗视图展示当前属性。
   - ✅ **剩余 65 条 KP 条目已有明确边界**：速查表逐条标注 `automation=KP`，包括神术结界系
     （禁域 / 禁则 / 识域 / 转移 / 封印）、属性使流动 / 偏向 / 广域效果 / 隐蔽、魔法幻觉 / 精神 / 知觉 /
     物体操作系等。其中依赖「地图 / 位置」的一批现已具备底层能力（见下），其余由 KP 裁定；
     不再作为「待补引擎」的开放 TODO。
   - ✅ **复用房间现有地图（Scene/Map/Token）**：不新建地图模型。`CombatState.grid` +
     `participant.position` 由 `syncCombatPositions` 从 runtime 的 `sceneGrid` / `tokenPositions` 注入；
     `combatDistanceFeet` / `combatDistanceMeters` 支持 SQUARE / HEX / NONE 三种网格；
     `scene:token:move` 成功后刷新所有进行中战斗的坐标并广播 `combat:update`。
     ⏳ 在此之上接 7.5 AREA 锚点、范围判定与「效果范围脱离」窗口即可，不需要重做地图。
   - ✅ `BARRIER` 结界（7.5，wiki 表 7.1 数值已落地）：`RulePack.barrier`
     （tiers 2/5/10/15/20/25/30/40m + extended +10m/+1Lv/目标+2/灵力+2；castRange 30m；
     resizeMpCost 2；duration = 神术 Lv×2 小时；dodge = 达成值 + floor(大小/2)；
     结界内 2m² 回避 -3 / 1m² -8；restack；dispelNeedsContest）；
     `MagicEffect BARRIER` 支持 `sizeMeters` / anchor，查表得到必要 Lv / 目标值 / 灵力 / 持续 / 惩罚；
     伤害优先由结界吸收、击破溢出无效；DISPEL 可解除结界（记录目标值）；
     重复展开支持 REPLACE / REFRESH / STACK；扩大缩小按 HP 比例迁移；战斗视图显示大小 / 必要 Lv / 惩罚。
     ⏳ AREA 范围与「效果范围脱离」已具备地图坐标 / 距离底层（复用房间 Scene/Map/Token），仍需接锚点判定与脱离窗口。
2. **DP 机制 · 剩余**（v2: 2.8、3.5、6.5、6.6、6.9、6.13、6.17、6.18、6.21、6.22、6.33 等）
   - 回合 / 宣言 / DP 回复核心已完成；剩余行动结算与 socket 接线（见 2.7 里程碑 1–2）。
3. **SC 完整规则**（v2: 4.1、4.2、4.4、4.8、4.9、4.11、4.13–4.17）
   - 开卡 3 张、战斗前 SC 宣言数、展开任意时机、展开/消费回复 DP、LSC、符卡战胜负条件。
4. **属性相克 · 剩余部分**（v2: 5.2 判定 / 抵抗修正、5.3 属性使能力）
   - 在已有元素表上补抵抗 / 全判定修正与属性使的能力等级、法术表；建议随能力系统一起做。
5. **成长体系 · 剩余**（v2: 13.x）
   - 成长流程 UI / DB、术式版与妖弹化变体表、HP 系数接入 maxHp。
6. **其他规则 · 剩余**（v2: 14.x）
   - ✅ 6.18 其他行动：DP 新增 `dpAction: "SKILL"`（调查 / 感知等），最多 3D、消耗 DP，
     也可直接 PASS 不判定；UI 提供技能 / 特性值 / 目标值 / 骰数选择。
   - ✅ 移动公式接入追逐：`touhouMovement`（地面 / 飞行）接入 `chaseBaseMov`，新增〈运动〉技能与
     `TOUHOU_MOV_PER_MPS` 换算常量（默认 1 m/s = 1 MOV），并叠加常时移动加值。
   - ✅ 重量 / 财产（14.3/14.4，wiki 数值）：`{身体}×10kg`、拖拽 `×1.5`；
     `RulePack.inventory`（currencyName=円 / subunit=钱 / 100钱=1円 / startingProperty=10 /
     livingCostPerDay=0.1 / foodCost 5~10钱 / propertyTradeRate / overloadPenaltyPerUnit）；
     卡片新增 `weight`；`resolveCarryCapacity` / `resolveDragCapacity` / `resolveEncumbrance` /
     `resolveProperty` / `resolveFoodCostRange` 纯函数；角色装备汇总 `totalWeight`。
   - ✅ 遮挡物 / 掩体（14.5，wiki 规则）：`CoverState`（强度 / 挡视线 / 到期）；`combat:set-cover`（KP）；
     完整遮挡（有强度 + 挡视线）完全阻止里外攻击，攻击遮挡物无需判定、只结算伤害固定值部分、溢出不穿透；
     非完整 / 无强度遮挡提供应对 +Lv×2；到期自动清理；视图展示掩体。

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

### 4.4 P1 第三批：能力体系发动 / 抵抗

- `npm run typecheck`：rules / combat / web 均通过。
- `npm test`：全部 workspace 通过（rules 120、combat 130、formula 54、web 5）。
- `npm run build --workspace @touhou/web`：通过。
- COC7 回归四个脚本全部 PASS；原有 COC7 / TOUHOU magic 测试不变。
- 新增测试：
  - `packages/rules/src/__tests__/touhou-abilities.test.ts`：7 条（类别、消费表、工具函数、习得数量、COC7 隔离、〈抵抗〉）；
  - `packages/combat/src/__tests__/touhou-abilities.test.ts`：5 条（成功、失败仍扣灵、等级门槛、抵抗成功 / 失败）。

### 4.5 P1 第四批：DISPEL / LvD

- `npm run typecheck`：rules / combat / web 均通过。
- `npm test`：全部 workspace 通过（rules 122、combat 135、formula 54、web 5）。
- `npm run build --workspace @touhou/web`：通过。
- COC7 回归四个脚本全部 PASS。
- 新增测试：combat `touhou-abilities.test.ts` 扩到 10 条（含 `+Lv` / `LvD` / 普通路径不缩放 / DISPEL）；
  rules `magic.test.ts` 追加 DISPEL 与缩放解析断言。

### 4.6 P1 第五批：14.x 恢复 / 移动 + 灵力归零昏迷

- `npm run typecheck`：rules / combat / web 均通过。
- `npm test`：全部 workspace 通过（rules 133、combat 138、formula 54、web 5）。
- `npm run build --workspace @touhou/web`：通过。
- COC7 回归四个脚本全部 PASS。
- 新增测试：
  - `packages/rules/src/__tests__/touhou-rules.test.ts`：11 条（移动 / 自然治愈 / 应急治疗 / 灵力恢复）；
  - `packages/combat/src/__tests__/touhou-mp-exhaustion.test.ts`：3 条（归零昏迷 / 队友唤醒 / COC7 隔离）。

### 4.7 P1 第六批：车卡能力点预算

- `npm run typecheck`：rules / combat / web 均通过。
- `npm test`：全部 workspace 通过（rules 135、combat 138、formula 54、web 5）。
- `npm run build --workspace @touhou/web`：通过。
- COC7 回归四个脚本全部 PASS。
- 新增规则工具 `abilityPointBudget` / `abilitySpendTotal` / `validateAbilitySpend`；
  `touhou-abilities.test.ts` 扩到 9 条（含 A-D 预算、超支 / 未知类别校验）。
- 说明：本批只到规则层；车卡 UI、DB 字段与角色草稿接线仍待后续（见第 2.6 节）。

### 4.8 P1 第七批：成长等级 A-F

- `npm run typecheck`：rules / combat / web 均通过。
- `npm test`：全部 workspace 通过（rules 146、combat 138、formula 54、web 5）。
- `npm run build --workspace @touhou/web`：通过。
- COC7 回归四个脚本全部 PASS。
- 新增测试 `packages/rules/src/__tests__/touhou-growth.test.ts`：11 条
  （成长等级表、四类分配、特性值 / 技能 / 能力消费、60% 上限、SC 池、HP 系数、妖术数量上限）。
- 说明：本批到规则层；成长流程 UI / DB 与 HP 系数接入 maxHp 仍待后续。

## 5. 风险与回滚

- 擦弹点数上线后，旧战斗中的“闪避回灵”手感会变化；新战斗从 0 开始，旧快照兼容为 0。若需要临时恢复旧手感，把 `touhou-ext.damage.dodge.grazeMpGainRatio` 从 `"0"` 改回 `"0.5"` 并禁用擦弹消费按钮即可。
- 存量符卡 `hpRatio` 不会自动迁移；KP 可在卡牌编辑页改为 1。若批量迁移需要另写数据脚本。
- 所有新增字段都有默认值，旧战斗快照加载不会报错。
- COC7 流程未改动判定、战斗默认值、车卡、医疗与成长路径；新增代码路径在 COC7 下由 `pack.system` 或空 `declaration` 短路。
