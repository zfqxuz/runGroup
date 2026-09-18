# COC7 入门规则偏差修复方案

> 输入：`docs/COC7-STARTER-RULES-FACTCHECK.md`（107 条逐条核查）
> 目标：按“违背 > 不可达 > 缺失 > KP行为”的偏差等级，从高到低设计可落地、可回归、可回滚的修复方案。
> 本文件只做方案设计，不修改系统代码。

---

## 0. 修复原则

1. **先修“违背”**：自动流程已经产出错误结果的，优先级最高；这些规则不修，再多内容也只是建立在错误判定之上。
2. **区分“完整版 7e”与“本书入门版”**：战斗判定类错误（闪避、反击、极限伤害、火器掩体、MP 溢出）在完整版 7e 与本书中同样成立，应作为 COC7 公共修复；建卡固定数组、96–100 成长等仅属于入门简化流程的差异，应用房间/规则模式开关解决。
3. **配置驱动，而非硬编码**：沿用现有 `RulePack` / `RuleOverride` / `Room` 配置链；行为开关进入规则包与房间覆盖，便于后续补完整版规则。
4. **服务端权威**：所有伤害、命中修正、距离档、反击伤害由服务端按角色实际装备/规则包推导；客户端只能选择意图，不能提交最终数值。
5. **快照向后兼容**：`CombatState`、`CombatParticipantState` 新增字段全部可选并带默认值；旧战斗快照恢复后不崩。
6. **东方扩展隔离**：公共修复集中在 `pack.system === "COC7"` 或明确的 COC7 子分支中，不改变 TOUHOU 的 ATB / 符卡手感。
7. **每条修复必须有金标准用例**：以规则书中的原文例子（食尸鬼、闪避/反击、极限伤害、霰弹枪、苏珊记者卡等）作为验收断言。

---

## 1. 偏差等级 → 修复优先级

| 修复等级 | 偏差等级 | 含义 | 处理策略 |
|---|---|---|---|
| **P0** | 违背 | 自动流程产出与规则书冲突 | 必须修复；战斗类立即进入下一版 |
| **P1** | 不可达 | 原生 + KP 操作都无法在系统内表达 | 先做基础设施，再逐条接入 |
| **P2** | 缺失 | 缺数据/内容/轻量接口 | 补规则包数据、后台表、UI 与结算动作 |
| **P3** | KP行为 | 能手工执行但系统不自动 | 低优先级；合并成 KP 快捷工具，而非逐条做完整引擎 |

---

## 2. 修复路线图总表

| 阶段 | 编号 | 修复项 | 偏差等级 | 事实核查条目 | 依赖 | 工作量 |
|---|---|---|---|---|---|---|
| Phase 0 | I-1 | 百分骰奖励/惩罚骰与难度参数基础设施 | 基础设施（修复 P0/P1 前置） | 2.5/2.6/2.9/2.10 | 无 | M |
| Phase 0 | I-2 | 武器元数据统一（技能、类型、距离档、贯穿、射击数） | 基础设施 | 1.29/4.12/4.15/4.22/4.23 | 无 | M |
| Phase 0 | I-3 | 规则包/房间“完整版/入门版”模式位 | 基础设施 | 1.15/1.17/7.3 | 无 | S |
| P0 | F-1 | 闪避与攻击成功等级比较 | 违背 | 4.8 | I-1 | S |
| P0 | F-2 | 反击同级判定与反击伤害 | 违背 | 4.9/4.11 | I-2/F-1 | M |
| P0 | F-3 | 极限/贯穿伤害 | 违背 | 4.12 | I-2 | M |
| P0 | F-4 | 火器不可闪避/寻找掩体 | 违背 | 4.18 | I-1/I-2 | M |
| P0 | F-5 | 霰弹枪距离档 | 违背 | 4.23 | I-2 | S/M |
| P0 | R-1 | MP 不足转扣 HP | 违背 | 1.11 | 无 | S/M |
| P0 | G-1 | 技能检定难度与成长标记一致性 | 违背 | 2.5/2.6 | I-1 | S |
| P0 | G-2 | 96–100 成长规则配置化 | 违背（版本差异） | 7.3 | I-3 | S |
| P0 | C-1 | 入门版固定数组+固定技能分配建卡 | 违背（版本差异） | 1.15/1.16/1.17 | I-3 | L |
| P0 | C-2 | 剑/武器技能推断与反击技能选项 | 违背 | 1.29/4.5 | I-2 | S/M |
| P0 | C-3 | 多语言/科学/驾驶/生存专精独立记录 | 违背/缺失 | 1.26/1.27/1.28 | I-2 | L |
| P1 | U-1 | 战斗内奖励/惩罚骰接入（寡不敌众、震慑、姿态等） | 不可达 | 2.10/3.5/4.20 | I-1 | M |
| P1 | U-2 | 手枪 2/3 连射 | 不可达 | 4.15 | I-1/I-2 | M |
| P1 | U-3 | 怪物同一轮多次攻击 | 不可达 | 4.21 | U-2 的队列抽象 | M/L |
| P1 | U-4 | 寡不敌众 | 不可达 | 4.20 | U-1 | S |
| P1 | U-5 | 战技（缴械/踢倒/擒拿） | 不可达 | 4.19 | I-1/F-1 | M/L |
| P1 | U-6 | 距离与近距离奖励（含投掷射程） | 不可达 | 1.32/4.16 | I-1/I-2/场景地图 | M/L |
| P1 | U-7 | 准备火器 +50 DEX、DEX 平手调序 | 缺失 | 4.2/4.14 | 无 | S/M |
| P2 | D-1 | 入门武器表/伤害表数据 | 缺失 | 4.22/6.1 | I-2 | M |
| P2 | D-2 | 环境伤害与持续伤害 | 缺失 | 5.11/6.1/6.2/6.3 | D-1 | M |
| P2 | D-3 | SAN 检定、疯狂与发作表 | 缺失 | 3.1–3.10 | I-1/条件系统 | L |
| P2 | D-4 | 急救/医学/自然恢复/重伤周检 | 缺失 | 1.22/1.23/5.6–5.10 | 条件系统 | M/L |
| P2 | D-5 | 科学/驾驶/生存专精数据与选择 UI | 缺失 | 1.27/1.28 | C-3 | M |
| P2 | D-6 | 属性半值/五分之一值与信用评级阶级显示 | 缺失 | 1.4/1.18/1.19/8.1 | 无 | S |
| P3 | K-1 | KP 掷骰/治疗/疯狂快捷工具 | KP行为 | 2.7/2.11/3.x/5.x/6.x | P0/P1 | M |
| P3 | K-2 | 判定日志中文化 | KP行为 | 2.4 | 无 | S |
| P3 | K-3 | 自定义职业/更多内容编辑器 | KP行为 | 1.14 | C-1 | M |

---

# Phase 0：先做三个基础设施

## I-1 百分骰奖励/惩罚骰与难度参数

### 为什么先做
当前 `resolveCheck(pack, roll, target)` 只能判定一个已掷出的 D100，没有“奖励骰/惩罚骰/难度要求”参数。它同时卡住：
- 2.5 发起检定不能声明难度；
- 2.6 自动成长标记把常规成功当成功；
- 2.9 奖励/惩罚骰；
- 2.10 战斗内自动检定无法注入修正；
- 4.20 寡不敌众；
- 4.18 火器掩体的惩罚骰；
- 3.5 疯狂发作 9/10 的行动惩罚骰。

### 接口设计
在 `packages/formula` 增加百分位专用骰函数：

```ts
export interface PercentileRoll {
  readonly roll: number;          // 最终 D100 结果
  readonly ones: number;          // 个位 0–9
  readonly tens: readonly number[]; // 十位（0,10,...,90），可能两枚
  readonly bonusDice: number;
  readonly penaltyDice: number;
  readonly detail: string;        // 供日志展示
}

export function rollPercentile(
  rng: Rng,
  bonusDice = 0,
  penaltyDice = 0
): PercentileRoll;
```

在 `packages/rules` 增加难度判定：

```ts
export type CheckDifficulty = "REGULAR" | "HARD" | "EXTREME";
export const REQUIRED_RANK: Record<CheckDifficulty, number> = {
  REGULAR: CHECK_RANK.REGULAR,
  HARD: CHECK_RANK.HARD,
  EXTREME: CHECK_RANK.EXTREME
};
export function meetsDifficulty(check: CheckOutcome, difficulty: CheckDifficulty): boolean {
  return check.rank >= REQUIRED_RANK[difficulty];
}
```

### 战斗引擎改法
- `resolveAttack` / 闪避 / 反击里所有 `rollDie(rng, 100)` 替换为 `rollPercentile`，并接受 `{ attackBonusDice, attackPenaltyDice, defenseBonusDice, defensePenaltyDice }`。
- 新增内部函数：
```ts
function rollCheckWithModifiers(
  pack: CompiledRulePack,
  rng: Rng,
  target: number,
  modifiers: { bonusDice?: number; penaltyDice?: number } = {}
): { roll: number; check: CheckOutcome; detail: string }
```
- `resolveCheck` 保持纯函数；只在掷骰层组合修正。
- 战斗日志新增：`奖励骰 x1 → 十位取 2/7，结果 24`、`惩罚骰 x1 → 十位取 6/0，结果 61`。

### 技能检定接入
扩展 socket 事件 `dice:skill-check` 的 payload：

```ts
{
  roomId: string;
  characterId: string;
  skillId: string;
  visibility: DiceVisibility;
  difficulty?: "REGULAR" | "HARD" | "EXTREME"; // 默认 REGULAR
  bonusDice?: number;   // 0–2
  penaltyDice?: number; // 0–2
}
```

服务端流程：
1. 校验奖励/惩罚骰数量，先抵消 `min(bonus, penalty)`；
2. 用 `rollPercentile` 掷骰；
3. `resolveCheck` 得到成功等级；
4. `success = meetsDifficulty(check, difficulty)`；
5. 只有 `success === true` 才写入 `GrowthCheck`；
6. 日志输出中文成功等级：大成功/极难成功/困难成功/常规成功/失败/大失败。

### UI
`RoomPlay` 技能检定区增加：
- 难度下拉：常规 / 困难 / 极难；
- 奖励骰 0–2、惩罚骰 0–2（两个 stepper）；
- 自由掷骰区保留现有任意表达式。

### 测试
- 单测：奖励骰取低十位、惩罚骰取高十位、二者抵消、00+0=100 边界。
- 单测：常规/困难/极难判定；roll=25 目标 60 → HARD，difficulty=EXTREME 判定失败。
- E2E：困难检定掷出常规成功，不生成增长点；极难成功掷出后生成。

---

## I-2 武器元数据统一

### 现状问题
`WeaponTypeDefinition` 只有 `skillId/range/damage`；xlsx 导入有 `impale/attacks/capacity/malfunction`，但战斗层不读；`CombatAttackOption` 只有 `skillId/damage/weaponName/source`；因此：
- 极限/贯穿伤害不知道武器类型；
- 霰弹枪多档伤害永远取第一档；
- 连射数、准备状态无处表达；
- 剑/刀技能推断错误。

### 目标数据结构
`apps/web/src/shared/card.ts`：

```ts
export interface WeaponTypeDefinition {
  readonly id: string;
  readonly label: string;
  readonly skillId: string;
  readonly range: "MELEE" | "NEAR" | "FAR";
  readonly damageType: "BLUNT" | "IMPALING" | "NONE"; // 新增：钝击 / 贯穿 / 不可贯穿
  readonly damageBands: readonly {
    readonly label: string;       // 近距离 / 普通 / 远距离
    readonly expression: string;  // 4d6 / 2d6 / 1d6
    readonly maxFeet: number | "DEX" | null; // 触发距离，null=不限；"DEX" 表示按角色 DEX 计算
  }[];
  readonly shots?: readonly number[]; // [1,2,3] 表示可连射数
  readonly requiresReady?: boolean;   // 是否需要准备
}
```

推荐内置表（对齐入门书）：

| 武器 | 技能 | 伤害 | 类型 |
|---|---|---|---|
| 徒手 | `FIGHTING_BRAWL` | `1d3+db` | BLUNT |
| 小刀 | `FIGHTING_BRAWL` | `1d4+db` | IMPALING |
| 砍刀 | `FIGHTING_BRAWL` | `1d8+db` | IMPALING |
| 短棒 | `FIGHTING_BRAWL` | `1d6+db` | BLUNT |
| 棒球棍 | `FIGHTING_BRAWL` | `1d8+db` | BLUNT |
| 剑 | `格斗（剑）` | 按武器卡数据；无数据时 `1d8+db` | IMPALING |
| 手枪 | `FIREARMS_HANDGUN` | `1d10` | IMPALING |
| 霰弹枪 | `FIREARMS_RIFLE` | 近 `4d6` / 普通 `2d6` | NONE（不可贯穿；极限伤害无额外骰） |
| 步枪 | `FIREARMS_RIFLE` | `2d6+4` | IMPALING |
| 弓/弩 | `FIREARMS_BOW` | `1d8+db` | IMPALING |

### 服务端统一
- `CombatAttackOption` 扩展为携带 `damageType/damageBands/shots/requiresReady`；
- `apps/web/src/server/socket/combat.ts` 在收到 `DANMAKU` 时，用服务端 `attackOptions` 覆盖客户端所有相关字段（现在只覆盖 damage）；
- `packages/combat` 的 `ActionSubmission` 增加 `weapon?: WeaponProfile`，由服务端填充；纯引擎测试可手动传。

### 测试
- `verify:combat-options`：霰弹枪有两档伤害；手枪 shots=[1,2,3]；剑映射到 `格斗（剑）`；
- `verify:npc-weapons`：团本 NPC 武器元数据不丢失。

---

## I-3 规则包/房间“完整版/入门版”模式位

### 设计
在 `RulePackSchema` 增加：

```ts
chargen: z.object({
  mode: z.enum(["CORE_OCCUPATION", "STARTER_QUICKSTART"]).default("CORE_OCCUPATION"),
  starter: z.object({
    attributeArray: z.array(z.number().int()).length(8).default([40,50,50,50,60,60,70,80]),
    skillValues: z.array(z.number().int()).length(9).default([70,60,60,50,50,50,40,40,40]),
    interestCount: z.number().int().default(4),
    interestBonus: z.number().int().default(20),
    allowMythosAtCreation: z.boolean().default(false)
  }).optional()
}).default({ mode: "CORE_OCCUPATION" }),

check: z.object({
  // 现有字段...
  skillImprovement: z.object({
    autoPassFrom96: z.boolean().default(true) // 完整版默认 true；入门模式覆盖为 false
  }).default({ autoPassFrom96: true })
})
```

`Room.ruleOverride` 已支持 JSON 覆盖，可直接写入 `chargen.mode = "STARTER_QUICKSTART"`、`check.skillImprovement.autoPassFrom96=false`，避免新增数据库列。

### UI
- 房间准备/配置页新增“建卡规则版本：完整版 / 入门版”切换；
- 入门版房间在 `CharacterBuilder` 显示固定数组 + 固定技能分配面板；
- 完整版保持现有职业点池模型。

---

# P0：违背类修复（最高优先级）

## F-1 闪避与攻击成功等级比较（4.8）

### 现状
`resolveAttack` 对闪避只调用 `isSuccess(dodgeCheck.result)`；随后 `GRAZE_RESOLVE` 在成功时直接把伤害归零。规则要求攻击者成功等级必须高于闪避者，**同级闪避成功**。

### 修复
在 `packages/combat/src/combat.ts` 的闪避分支：

```ts
const dodgeCheck = resolveCheck(ctx.pack, dodgeRoll, dodgeTarget);
defenseSuccess = dodgeCheck.rank >= attackCheck.rank;
```

注意：
- `attackCheck` 在进入防御分支前已经保证是成功（失败会提前 return）；
- 攻击大成功 rank=5，闪避大成功 rank=5 时仍闪避成功（同级闪避成功）；
- 攻击极限 rank=4，闪避困难 rank=3 → 命中；这与书中“03 极难攻击 vs 20 困难闪避”的例子一致。

### 测试
- 攻击 HARD vs 闪避 REGULAR → 命中；
- 攻击 EXTREME vs 闪避 EXTREME → 闪避成功；
- 攻击 HARD vs 闪避 HARD → 闪避成功；
- 保留日志输出双方成功等级。

---

## F-2 反击同级判定与反击伤害（4.9、4.11）

### 问题
- 引擎把通用 `resolveOpposed` 套到反击上：成功等级相同时先比目标值（技能值），防守方技能更高时反击成功，违反战斗章“同级攻击者获胜”。
- 即使反击成功，只把本次攻击伤害归零，不向攻击者结算反击伤害。

### 修复一：同级判定
反击分支不再使用 `resolveOpposed`，改为：

```ts
const counterCheck = resolveCheck(ctx.pack, counterRoll, counterTarget);
defenseSuccess = counterCheck.rank > attackCheck.rank; // 防守方必须更高
```

`resolveOpposed` 保留给“通用对抗检定”或其它同级的特殊逻辑。

### 修复二：反击伤害
在 `DefenseReaction` / `CombatReactionPayload` 增加：

```ts
readonly damage?: string;       // 反击武器伤害表达式
readonly weaponName?: string;
```

服务端在收到 `COUNTER` 反应时：
1. 校验 `skill` 是防守方实际可用的 `FIGHTING_*` 技能；
2. 从 `runtime.attackOptions.get(defenderId)` 找到对应武器的 `damage`；
3. 把 damage 写入 reaction（忽略客户端直接提交的 damage）；
4. 引擎在 `defenseSuccess === true` 时：

```ts
const counterDamageSource = expandDamageBonus(
  reaction.damage ?? "1d3+db",
  defender.damageBonus
);
const counterRollResult = rollDice(parseDice(counterDamageSource), rng);
const applied = applyDamageToParticipant(ctx, attacker, absorbWithArmor(attacker, counterRollResult.total).remaining);
pushLog(... "反击伤害骰" ...);
pushLog(... "反击伤害结算" ...);
```

规则限制“反击伤害至多常规水平”：这里不应用极限/贯穿加成，正常掷伤害即可。

### UI
- 反击技能下拉不再固定 `FIGHTING_BRAWL`，改为该单位会用的所有 `FIGHTING_*`（从 `attackOptions` 过滤），并显示武器名与伤害；
- 日志新增“反击伤害骰 / 反击伤害结算”徽章。

### 测试（金标准）
- 书页例子：苏珊困难成功反击、食尸鬼常规成功 → 苏珊反击成功，食尸鬼掉 `1d3`；
- 双方同为常规成功、防守方技能更高 → 攻击者仍然命中；
- 防守方极限 vs 攻击者困难 → 反击成功且造成伤害。

---

## F-3 极限/贯穿伤害（4.12）

### 规则
攻击达到极难成功：
- 钝击：最大武器伤害 + DB；
- 贯穿（刀刃、子弹）：最大武器伤害 + DB + 额外掷一次武器伤害骰。

### 伤害拆分工具
在 `packages/rules/src/damage.ts` 新增：

```ts
export function splitDamageBonus(damage: string, damageBonus: string): {
  base: string;        // 武器伤害，如 1d6
  bonus: string;       // DB，如 1d4 / -2 / 0
};

export function maxDamageOf(expression: string): number; // 各骰取最大 + 固定值，负值保留
```

`expandDamageBonus` 仍用于普通伤害；极限伤害不直接对它取字符串最大值，而是分别处理 base 与 bonus，避免 `1d6+1d4` 把 DB 当成武器骰。

### 战斗接入
`ActionSubmission` 增加：

```ts
readonly damageType?: "BLUNT" | "IMPALING" | "NONE";
```

服务端从 `CombatAttackOption` 填充。

在 `resolveAttack` 内计算：

```ts
const damageMode =
  attackCheck.result === "EXTREME" || attackCheck.result === "CRITICAL"
    ? (isImpaling ? "EXTREME_IMPALING" : "EXTREME_BLUNT")
    : "NORMAL";

const damageTotal =
  damageMode === "NORMAL" ? rollDice(parseDice(expandDamageBonus(baseDamage, db)), rng).total
  : damageMode === "EXTREME_BLUNT" ? maxDamageOf(baseDamage) + maxDamageOf(db)
  : maxDamageOf(baseDamage) + maxDamageOf(db) + rollDice(parseDice(baseDamage), rng).total;
```

### 日志
- `攻击结果=极难成功 → 钝击极限伤害：最大 6 + DB 4 = 10`；
- `攻击结果=极难成功 → 贯穿极限伤害：最大 8 + DB 2 + 额外 1d8[...] = …`。

### 测试
- 钝器 `1d6+1d4` 极限 → 10；
- 小刀 `1d4+db(1d4)` 极限 → 4+4+1d4；
- 普通成功 → 仍正常掷骰；
- 大成功按极限处理。

---

## F-4 火器不可闪避 / 寻找掩体（4.18）

### 规则
- 子弹不能被闪避；
- 目标可进行闪避技能检定“寻找掩体”；
- 掩体成功：攻击者本次射击承受一枚惩罚骰；
- 寻找掩体者放弃下一次攻击（若本轮已攻击过，则放弃下一轮）。

### 反应类型
在 `CombatReactionPayload` 增加 `"SEEK_COVER"`；服务端 `allowedReactionTypesForParticipant` 对火器攻击返回 `["PASS", "SEEK_COVER"]`：移除 `DODGE` 与 `COUNTER`。

判定火器：攻击技能以 `FIREARMS_` 开头，或武器 `range` 为 `NEAR/FAR`（投掷是否允许掩体由规则包配置，默认不允许）。

### 引擎流程
原来先掷攻击再处理反应，需要调整为“先决定掩体修正，再掷攻击”：

```ts
let attackModifiers = { bonusDice: 0, penaltyDice: 0 };
let loseNextAction = false;

if (reaction.type === "SEEK_COVER") {
  const coverCheck = rollCheckWithModifiers(...defender DODGE...);
  if (isSuccess(coverCheck.result)) {
    attackModifiers.penaltyDice += 1;
  }
  loseNextAction = true; // 无论成功与否
}

const attack = rollCheckWithModifiers(... actor skill ... attackModifiers...);

// 攻击成功后才进入伤害流程；SEEK_COVER 不再产生防御免伤
```

如果目标同时被多次射击，每次掩体成功都给该次攻击加惩罚骰；`loseNextAction` 只记录一次。

### “放弃下一次攻击”
`CombatParticipantState` 增加：

```ts
skipNextAction?: number; // 默认 0
```

在 `applyForcedSkips` 中，轮到该单位且 `skipNextAction > 0` 时自动提交 `PASS` 并减 1。若其本轮已经行动过，计数器会保留到下一轮，正好符合“放弃下一轮”。

### UI
- 火器攻击的应对面板显示：不应对 / 寻找掩体；
- 掩体选择后日志显示：`寻找掩体检定成功，攻击者本次射击承受 1 枚惩罚骰；掩体者放弃下次攻击`。

### 测试
- 火器攻击不提供闪避/反击；
- 掩体成功 → 攻击掷骰带 1 惩罚骰；
- 掩体失败 → 攻击无修正；
- 两种情况下掩体者下次行动都被跳过。

---

## F-5 霰弹枪距离档（4.23）

### 方案
使用 I-2 的 `damageBands`：

```ts
damageBands: [
  { label: "近距离", expression: "4d6", maxFeet: "DEX" }, // 书中：DEX 英尺内
  { label: "普通", expression: "2d6", maxFeet: null }
]
```

分三步：
1. **先支持手动选择**：攻击面板出现“距离档”下拉；服务端按所选档位覆盖 damage，客户端不能提交伤害；
2. **再接场景地图距离**：双方都有 Token 时，从 `SceneBoard` 六边形距离换算英尺，自动选档；没有 Token 时回退手动档；
3. **极限伤害使用所选档位**：近距离 4d6 极限 = 24 + DB + 额外 4d6；普通 2d6 按 2d6 处理。

### 测试
- 选择普通档 → `2d6`；
- 近距离档 → `4d6`；
- 极限 + 普通档 → 12 + DB + 额外 2d6；
- 霰弹枪永不触发贯穿额外骰（`damageType` 为不可贯穿）。

---

## R-1 MP 不足转扣 HP（1.11）

### 规则
MP 耗尽后，后续法术/装置消耗的 MP 直接从 HP 扣除；形式由 KP 选择。
当前系统：战斗外直接返回“MP 不足”；战斗内施法把 MP 钳到 0，既不拒绝也不扣 HP（等于免费施法）。

### 配置
在 `RulePackSchema` 增加（或放进现有 `magic` 之上的通用资源规则）：

```ts
magicPoint: z.object({
  overflowToHp: z.boolean().default(true),
  hpPerMp: z.number().int().positive().default(1),
  allowOverdraftToZero: z.boolean().default(true)
}).default({})
```

### 共用函数
在 `packages/rules` 新增：

```ts
export interface MagicPointSpend {
  readonly mpAfter: number;
  readonly hpLoss: number;
  readonly shortfall: number;
  readonly allowed: boolean;
}
export function spendMagicPoints(
  currentMp: number,
  currentHp: number,
  cost: number,
  rules: { overflowToHp: boolean; hpPerMp: number }
): MagicPointSpend;
```

### 战斗内
- `resolveMagic`、`resolveItem`、`resolveSpellcard` 统一走该函数；
- 不足部分通过新的 `loseHpDirect(ctx, participant, hpLoss)` 扣除：
  - 不走 `MAJOR_WOUND` 的“单次伤害达到一半”判定（规则说的是 HP 损失，不是攻击创伤）；
  - 但 HP 归零时仍按现有 0 HP 规则进入昏迷 / 濒死 / 死亡；
  - 记录日志：`MP 2 不足以支付 5 点法术；缺口 3 点从 HP 扣除，HP 12→9`；
- 若 `overflowToHp=false`，维持现在的“MP 不足”拒绝逻辑。

### 战斗外
- `apps/web/src/server/magic/out-of-combat.ts` 使用同一函数；
- 同步 `Character.hp` 与 `GameCharacter.currentHp`；
- HP 归零时写入 `UNCONSCIOUS` 条件并提示 KP，后续治疗走 P2 医疗系统。

### 测试
- 战斗内：MP=2，术式消耗 5 → MP=0、HP-3、法术正常结算；
- 战斗外：MP=1，消耗 3 → HP-2，不再直接报“MP 不足”；
- `overflowToHp=false` 时行为回退。

---

## G-1 技能检定难度与成长标记一致性（2.5、2.6）

依赖 I-1。修复后：
- `dice:skill-check` 可以携带 `difficulty`；
- `success = meetsDifficulty(check, difficulty)`；
- 只有满足 KP 所声明难度时才写入成长点；
- 日志明确“困难成功（达成要求）/ 常规成功（未达成困难要求）”。

同时为 `GrowthCheckForm`/手动标记增加 `requiredDifficulty` 可选字段，KP 补标记时也能标注。

### 测试
- 目标 60，roll 25，difficulty=HARD → 成功且标记成长；
- 目标 60，roll 40，difficulty=HARD → 日志 HARD 不成立，不标记成长；
- 目标 60，roll 13，difficulty=EXTREME → 成功且标记。

---

## G-2 96–100 成长规则配置化（7.3）

- `RulePack.check.skillImprovement.autoPassFrom96` 默认 `true`；
- `COC7_STARTER_QUICKSTART` 模式将其覆盖为 `false`；
- `resolveGrowthChecks` 接受一个 `mode/autoPassFrom96` 参数：
```ts
isGrowthCheckPassed(roll, beforeValue, autoPassFrom96) {
  return roll > beforeValue || (autoPassFrom96 && roll >= 96);
}
```
- 结算日志根据模式写“高于技能值”或“96–100 必成长”。

### 测试
- 技能 85，roll 97，入门模式 → 不成长；
- 完整版模式 → +1D10。

---

## C-1 入门版固定数组+固定技能分配建卡（1.15、1.16、1.17）

### 规则回顾
- 属性：八项分配 `40/50/50/50/60/60/70/80`；幸运单独 `3D6×5`；
- 技能：八项本职 + 信用评级，分配 `70/60/60/50/50/50/40/40`，直接设值、忽略基础值；
- 个人兴趣：四项非本职，在基础值上各 +20%；
- 创建时不能点克苏鲁神话（除 KP 同意）。

### 实现
1. **规则模式**：`chargen.mode = "STARTER_QUICKSTART"`（I-3）。
2. **属性**：`AttributeMethodSchema` 增加 `FIXED_ARRAY`：
```ts
{
  kind: "FIXED_ARRAY",
  id: "starter-array",
  label: "入门版固定数组",
  values: [40,50,50,50,60,60,70,80],
  luck: { dice: "3d6", multiplier: 5 }
}
```
   - 校验：八项属性必须是给定多重集合的一个排列；幸运必须是 `3d6×5` 的合法值。
3. **技能**：`CharacterDraftInput` 增加：
```ts
readonly chargenProfile: "CORE" | "STARTER";
readonly starterSkills?: {
  readonly occupational: Record<string, number>; // 选中的八项本职技能及其最终值
  readonly credit: number;                        // 信用评级最终值
  readonly interests: readonly string[];          // 四项非本职
};
```
   - 校验：八项本职互不重复；八项本职值 + 信用评级值合计九个数字，其多重集合必须恰好等于 `[70,60,60,50,50,50,40,40,40]`；信用评级可以取九值中的任意一个（书中示例为 40），其余八值分配给八项本职；个人兴趣四项 +20 且不能是本职，也不能是克苏鲁神话。
4. **跳过完整版限制**：入门模式下：
   - 不使用职业点池（`skillPoints.occupation`）与兴趣点池；
   - 不检查 80/70 车卡上限；
   - 不检查职业的信用评级范围（书中记者示例 CR 40 可通过）；
   - 不要求职业空位模型，玩家可以选任意八项技能作为本职（同时解决 1.14 的自设职业问题）。
5. **克苏鲁神话**：入门模式默认禁止；完整版模式增加 `allowMythosAtCreation` 房间开关（默认 false），需要 KP 显式打开。
6. **UI**：`CharacterBuilder` 增加入门模式面板：
   - 固定数组分配器；
   - 幸运掷骰按钮；
   - 八项本职技能多选 + 九值分配；
   - 四项兴趣技能 +20 预览；
   - 克苏鲁神话置灰。

### 测试（金标准：书中的苏珊）
- 属性 40/50/50/50/60/60/70/80 合法；
- 技能九值分配合法；
- 记者 + 信用评级 40 可通过（不再被 9–30 拒绝）；
- 克苏鲁神话不可点；
- 四项兴趣 +20 后总值可超过 70/80。

---

## C-2 剑/武器技能推断与反击技能选项（1.29、4.5）

### 修复
在 I-2 的 `WeaponTypeDefinition.skillId` 基础上，重写 `inferWeaponSkillId`：

```ts
if (explicitSkillId && known.has(explicitSkillId)) return explicitSkillId;

if (range === "MELEE") {
  const n = weapon.name.toLowerCase();
  if (/剑|sword/.test(n)) return "格斗（剑）";
  if (/斧|axe/.test(n)) return "FIGHTING_AXE";
  if (/矛|spear/.test(n)) return "格斗（矛）";
  if (/鞭|whip/.test(n)) return "格斗（鞭子）";
  return "FIGHTING_BRAWL"; // 徒手、小刀、棍棒、砍刀
}
```

### 反击技能选项
- 防守方反击下拉从 `attackOptions` 中过滤 `FIGHTING_*`，而不只是 `FIGHTING_BRAWL`；
- 无武器时回退徒手 `1d3+db`；
- 服务端二次校验技能与伤害。

### 测试
- 手动创建剑卡 → 攻击技能为 `格斗（剑）`；
- 斧卡 → `FIGHTING_AXE`；
- 持剑角色防守时可选 `格斗（剑）` 反击，伤害为剑的伤害。

---

## C-3 多语言/科学/驾驶/生存专精独立记录（1.26、1.27、1.28）

### 数据模型
`Character.skills` 是 JSON map，可以承载复合 key。约定：

```text
LANGUAGE_OTHER#西班牙语
LANGUAGE_OTHER#法语
SCIENCE#生物学
ART_CRAFT#摄影
驾驶#飞行器
SURVIVAL#沙漠
格斗（剑）          // 已有独立 id，保持原样
```

### 实现要点
1. 新增工具函数：
```ts
export function splitSkillKey(key: string): { baseId: string; specialty?: string };
export function makeSkillKey(baseId: string, specialty?: string): string;
```
2. `buildEffectiveSkills`：
   - 未加点的技能仍按规则包基础值；
   - 已加点的复合 key 取其基础技能公式，再写入完整 key；
   - 同一基础技能可以有多个专精条目。
3. 技能检定 target 查找顺序：完整 key → 基础 key。
4. 导入 `packSkillId`：
   - `外语（西班牙语）` → `LANGUAGE_OTHER#西班牙语`；
   - `科学（生物学）` → `SCIENCE#生物学`；
   - `驾驶（飞行器）` → `驾驶#飞行器`（规则包已有基础技能 `驾驶`）；
   - `生存（沙漠）` → `SURVIVAL#沙漠`；
   - `射击（弩）` → `FIREARMS_BOW#弩` 或统一 `FIREARMS_BOW`，至少不能落到手枪。
5. `skills[skillKey] = total` 按 key 合并，不再 `max` 去重。
6. UI 技能列表显示“基础（专精）”标签；车卡页增加“添加语言/科学/技艺/驾驶/生存专精”按钮。
7. 成长/奖励/撤销 target 直接使用完整 key，现有 advancement 系统无需改表。

### 迁移
- 旧角色已有 `LANGUAGE_OTHER` 单条记录保持原样；
- 旧导入导致的重复合并无法还原，但新导入不再丢；
- 可选：为旧角色提供“专精拆分”手工迁移工具。

### 测试
- 两个外语条目并存且分别加点；
- 科学（生物学）+ 科学（化学）并存；
- 复合 key 用于 `dice:skill-check` 与成长记录。

---

# P1：不可达类修复（依赖 Phase 0）

## U-1 战斗内奖励/惩罚骰接入（2.10 / 3.5 / 4.20）

I-1 完成后，在 `resolveAttack` / 闪避 / 反击中允许传入修正：

```ts
interface AttackModifiers {
  readonly bonusDice: number;
  readonly penaltyDice: number;
}
```

由服务端与引擎统一计算：
- 寡不敌众（U-4）；
- 掩体（F-4）；
- 连射（U-2）；
- 疯狂发作 9/10 的“所有行动惩罚骰”（从 `GameCondition.INSANITY.data.penaltyDice` 读）；
- 战技体格差（U-5）；
- 自定义状态的 `attackBonusDice` / `defenseBonusDice`。

日志必须展示修正来源，避免黑箱。

## U-2 手枪 2/3 连射（4.15）

### 方案
- `ActionSubmission.shots?: 1 | 2 | 3`；服务端根据武器 `shots` 校验；
- 选择方式：攻击面板出现“射击次数：1 / 2 / 3”；
- 每次射击：
  - 攻击检定各承受 1 枚惩罚骰；
  - 目标对整轮连射仍只选择一次应对（PASS / SEEK_COVER；若规则包允许近战反击则按近战处理），但每次射击分别掷防御；
  - 每次伤害独立结算、独立记录日志；
- 需要 3 次反应请求时，使用 `runtime.pendingVolley` 队列；KP 可强制按 PASS 结算剩余射击。

> 简化说明：首版把整轮连射当作一个动作、目标只选择一次应对类型，但每次射击分别掷防御与结算伤害；真正的“逐发分别选择应对”留到后续版本。

### 后续完整版
- 支持每发射击独立选择应对（尤其对 2–3 个不同目标）；
- 支持弹匣/装弹量。

### 测试
- 1 发无惩罚骰；
- 3 发各带 1 惩罚骰；
- 每发独立命中/伤害；
- 客户端无法篡改 shots（服务端按武器数据覆盖）。

## U-3 怪物同一轮多次攻击（4.21）

在 U-2 的 `ActionSubmission.attackRoutine` 抽象上扩展：

```ts
readonly attacks?: readonly {
  skill: string;
  targetId: string;
  damage?: string;
}[];
```

- `CombatParticipantState.attacksPerTurn` 由 NPC 卡/规则包配置；
- 引擎在当前行动位内按 routine 顺序逐个结算；
- 每个目标分别接收反应请求；支持“爪击+撕咬”等不同技能；
- 未提交剩余攻击时，KP 可强制空过或由 AI/默认选择。

## U-4 寡不敌众（4.20）

- `CombatParticipantState` 增加 `reactionsThisRound: number`；
- 每次某单位实际选择并执行 DODGE / COUNTER 时 +1；
- 回合开始时归零（`beginInitiativeRound` / ATB 轮次推进）；
- 近战攻击（`FIGHTING_*`）对已经 `reactionsThisRound > 0` 的目标获得 1 枚奖励骰；
- 火器攻击不受影响；
- 对应 P1 的 U-1。

### 测试
- 食尸鬼三次攻击苏珊：第一次正常，第二/三次各 +1 奖励骰；
- 目标 PASS 之后不触发寡不敌众；
- 火器攻击始终不加。

## U-5 战技（4.19）

### 动作
`ActionKind` 增加 `"MANEUVER"`，socket 白名单同步；payload：

```ts
{
  kind: "MANEUVER";
  maneuver: "DISARM" | "TRIP" | "GRAPPLE";
  targetId: string;
  skill?: "FIGHTING_BRAWL";
}
```

### 结算
1. 服务端校验目标同场景、存活、未参战互斥等；
2. 比较 Build：
```ts
const diff = defenderBuild - attackerBuild;
if (diff >= 3) return "对方体格高 3 点以上，战技无法进行";
const penaltyDice = Math.min(2, Math.max(0, diff));
```
3. 攻击检定用上述惩罚骰；目标可正常 DODGE / COUNTER；
4. 成功效果：
   - `TRIP`：目标 `prone = true`，直到其消耗一次行动起身；
   - `DISARM`：目标一张已装备武器卡本场战斗 `disarmed`，攻击面板不再出现；
   - `GRAPPLE`：设置 `grappledBy`；被擒抱者所有行动带惩罚骰，可用一次 `FIGHTING_BRAWL` 对抗挣脱；
5. UI：行动面板新增“战技”区；参战卡显示“倒地 / 被缴械 / 被擒抱”。

### 测试
- Build 差 -1/-2 → 1/2 枚惩罚骰；差 -3 → 拒绝；
- 成功缴械后目标失去该武器攻击选项；
- 擒抱后的行动惩罚骰接入 U-1。

## U-6 距离与近距离奖励（1.32、4.16）

### 场景距离
- 战斗已绑定 `sceneId`；若双方都有地图 Token，读取六边形距离；
- 地图需提供“每格英尺数”配置（默认 5 英尺/格，可房间覆盖）；
- 战斗视图下发 `distanceFeet` 与 `rangeBand`。

### 规则效果
- 手枪/步枪点射：距离 ≤ DEX/5 英尺 → 攻击 +1 奖励骰；
- 霰弹枪：距离 ≤ DEX 英尺 → 4d6，否则 2d6；
- 投掷：最远 = STR/5 码；超出直接不允许；失败落点由 KP 裁定；
- 没有 Token/地图时回退到手动距离档选择。

## U-7 准备火器 +50 DEX、DEX 平手调序（4.2、4.14）

- `CombatParticipantState` 增加 `initiativeMod?: number`；
- 准备状态：
  - 战斗单位选择器中，持火器单位可勾选“武器已准备”；
  - 或在战斗开始前由 KP 统一标记；
  - `buildInitiativeOrder` 的 score = 属性公式 + `initiativeMod`；
- KP 调序：
  - 新增 socket 事件 `combat:initiative-order`，服务端调用现有 `setInitiativeOrder`；
  - `CombatBoard` 显示顺序列表，KP 可上移/下移；
  - 解决 DEX 平手“KP 决定顺序”和准备火器手动调序。

---

# P2：缺失类修复（补数据/内容/轻量接口）

## D-1 入门武器表与伤害表
- 将入门规则书武器表落成 compendium 武器卡（含 I-2 元数据）；
- `CardBuilder` 增加“高级 / JSON”模式，允许手工覆盖伤害表达式、贯穿标记与伤害档；
- 规则包可携带 `damageTemplates`（轻度/中度/重度/致命/终结/血肉横飞），KP 面板提供“伤害表”按钮：选择等级 → 掷骰 → 应用到选中单位。

## D-2 环境伤害与持续伤害
- `GameCondition` 扩展 `DOT` / `HAZARD` 数据结构：`damageExpression`、`trigger: "ROUND_END"|"TURN_START"|"NARRATIVE"`、`source`；
- 新增战斗事件 `ENVIRONMENT_TICK`：每轮结束统一结算环境伤害；
- 支持窒息（每轮 CON，失败后每轮受伤）、毒药（极难减半）、燃烧/强酸等；
- 无战斗时由 KP 快捷工具手动推进。

## D-3 SAN 检定、疯狂与发作表
分三期：
1. **SAN 检定**：socket 新增 `dice:sanity-check`；payload 支持成功/失败损失表达式或固定值；自动扣 `GameCharacter.currentSan`；失败触发“非自愿动作”提示；损失 ≥5 自动提示 INT 检定。
2. **临时疯狂**：INT 检定；`INSANITY` 条件（`HOUR` / `BOUT_ROUND`）；1D10 疯狂发作表数据与掷骰 UI；9/10 惩罚骰接入 U-1；1D10 小时后自动/手动清除。
3. **长期影响**：恐惧症/狂躁症内置表、背景条目修改入口、不定性疯狂与精神分析治疗，接 D-4。

## D-4 医疗与恢复
- 新增房间动作：急救、医学、精神分析、每周重伤恢复、每日自然恢复；
- 参数：施术者、目标、时间点、是否满足时限；
- 结算：技能/体质检定、HP/SAN 变化、重伤/濒死状态更新；
- 时间推进：`GameState.gameTime` 或新增 `GameClock`（小时/天）；
- 规则书差异：急救 1 小时内、医学超 1 天困难、濒死先急救、重伤周检 1D3/极难 2D3、恢复到半值移除重伤。

## D-5 科学/驾驶/生存专精数据
若 C-3 已实现复合 key，本项只需补：
- 基础技能 `驾驶` 与 `SURVIVAL` 的候选专精数据；
- 后台/JSON 编辑器可增删专精候选。

## D-6 属性半值/五分之一值与信用评级阶级
- 角色页、房间角色页、车卡页的属性块显示 `普通 / 困难 / 极限`；
- 信用评级旁显示阶级标签（身无分文/贫困/普通/小康/富裕/豪富）；
- 纯 UI，无 DB 变更。

## D-7 后台内容编辑器
- 职业/武器/伤害表/疯狂表/恐惧症表统一进 RulePack 或后台 JSON；
- 提供 `/admin/rulepacks/[packId]` 的表格化编辑，避免 JSON 手改。

---

# P3：KP行为自动化（低优先级，合并为工具而不是完整引擎）

这些规则当前可由 KP 自由掷骰 + 数值面板完成，建议做成“KP 快捷工具”：

| 工具 | 覆盖条目 |
|---|---|
| 自由检定宏：技能/属性/幸运/群体幸运，支持暗骰与修正骰 | 2.3/2.11/2.12 |
| 孤注一掷按钮：失败后第二次掷骰并记录风险备注 | 2.7 |
| 快速伤害：伤害表、按轮持续伤害、窒息/毒药模板 | 6.1–6.3 |
| 治疗计算器：急救/医学/精神分析/自然恢复/周检 | 1.22–1.24/5.6–5.10 |
| 疯狂工具：SAN 检定、INT 检定、1D10 发作表、恐惧症/狂躁症写入背景 | 3.1–3.10 |
| 条件编辑器：为玩家/NPC 添加自定义状态与持续时间 | 3.x/4.x |
| 中文判定标签：大成功/极难/困难/常规/失败/大失败 | 2.4 |

这些工具应复用 P0/P1 的掷骰、难度、条件与日志基础设施，不重复实现规则。

---

# 验收：规则书金标准用例

建议新增 `apps/web/scripts/verify:coc7-starter-compat.ts`，固定 RNG 种子，至少覆盖：

1. **闪避比较**：攻击极难 03 / 闪避困难 20 → 命中而非闪避；
2. **同级闪避**：攻击常规 vs 闪避常规 → 闪避成功；
3. **反击伤害**：苏珊困难反击 vs 食尸鬼常规 → 食尸鬼掉 `1d3`；
4. **同级反击**：攻击常规 vs 反击常规（防守技能更高）→ 攻击者仍然命中；
5. **极限伤害**：钝器 `1d6+1d4` 极难成功 → 10；小刀 `1d4+db(1d4)` 极难成功 → 4+4+1d4；
6. **火器掩体**：射击 vs 掩体成功 → 攻击带 1 惩罚骰，掩体者下次行动 PASS；
7. **霰弹枪**：普通档 `2d6`，近距档 `4d6`；
8. **MP 溢出**：MP 2 消耗 5 → HP -3，不免费施法；
9. **成长**：入门模式技能 85 掷 97 不成长；完整模式成长；
10. **苏珊建卡**：记者 + 信用评级 40 在入门模式合法；克苏鲁神话置灰。

---

# 发布、兼容与回滚

1. **默认行为切换**：
   - 战斗核心修正（F-1/F-2/F-3/F-4/F-5、R-1、G-1）建议对 COC7 默认开启；
   - 建议上线前用生产快照回放关键战斗，确认没有依赖旧错误判定的房间；
   - TOUHOU 走原分支，避免影响 ATB/符卡。
2. **快照兼容**：
   - 所有新增 `CombatParticipantState` 字段可选，`loadCombatRuntime` 统一补默认值；
   - 旧进行中战斗在部署后继续时，新规则立即生效，需在更新日志提示。
3. **配置形态**：
   - 优先使用 `RuleOverride` JSON 承载 `chargen.mode` / `check.skillImprovement` / 兼容开关，避免迁移；
   - 若需要房间级 UI 开关，再加 `Room` 可选列与迁移。
4. **回滚**：
   - 每项战斗规则建议有独立规则包 flag（`combat.variants.*`）；
   - 出问题时只关闭对应 flag，无需回滚整包。
5. **上线顺序**：
   - Phase 0（基础设施，默认不改变输出）
   - F-1/F-2/F-3 → R-1 → G-1/G-2 → C-1/C-2 → C-3
   - U-1/U-2/U-4/U-7 → U-5/U-6 → U-3
   - D-1 → D-2 → D-4 → D-3 → D-5/D-6
   - P3 工具最后合并。

---

# 建议的任务拆分

| 批次 | 内容 | 预估 |
|---|---|---|
| 批次 1 | I-1、I-2、F-1、F-2、F-3 | 1 个开发周期 |
| 批次 2 | F-4、F-5、R-1、G-1、G-2 | 1 个开发周期 |
| 批次 3 | I-3、C-1、C-2、C-3 | 1–2 个开发周期 |
| 批次 4 | U-1、U-2、U-4、U-7 | 1–2 个开发周期 |
| 批次 5 | U-5、U-6、U-3 | 2 个开发周期 |
| 批次 6 | D-1、D-2、D-6、D-7 | 1–2 个开发周期 |
| 批次 7 | D-4、D-3、D-5 | 2–3 个开发周期 |
| 批次 8 | P3 KP 工具 | 1 个开发周期 |

> “开发周期”仅用于排期粒度参考，具体以实际人力为准。

---

## 12. 本轮已执行状态（按优先级）

### 已完成
- [x] **I-1 百分骰奖励/惩罚骰 + 难度参数**：`rollPercentile`、`meetsDifficulty`；`dice:skill-check` 支持难度/奖励骰/惩罚骰；RoomPlay 增加难度、奖励骰、惩罚骰选择；成长标记只在达到所声明难度时写入。
- [x] **I-2 武器元数据**：`WeaponTypeDefinition` 增加 `damageType/damageBands/shots`；内置武器表补齐小刀/砍刀/短棒/棒球棍/剑/霰弹枪/步枪；服务端攻击选项携带并覆盖这些字段。
- [x] **I-3 完整版/入门版模式位**：`RulePack.chargen`、`magicPoint`、`check.skillImprovement` 配置；COC7 基线新增 `starter-quickstart`（FIXED_ARRAY）车卡方式；首页快速建卡与 `/rooms/new` 可选择。
- [x] **F-1 闪避比较成功等级**：闪避成功必须 `dodge.rank >= attack.rank`，攻击者更高才命中。
- [x] **F-2 反击同级与反击伤害**：反击必须 `counter.rank > attack.rank`；反击成功会从防守方装备解析伤害并结算给攻击者；反击技能下拉支持全部 `FIGHTING_*`。
- [x] **F-3 极限/贯穿伤害**：极难/大成功时钝击取最大武器+DB；贯穿额外掷一次武器伤害骰；`NONE`（霰弹）不额外掷。
- [x] **F-4 火器掩体**：COC7 火器/投掷移除闪避与反击，只能 PASS/SEEK_COVER；掩体成功使攻击者获得 1 枚惩罚骰；掩体者 `skipNextAction`，下次行动自动跳过。
- [x] **F-5 霰弹枪距离档**：多档伤害拆成 `damageBands`；服务端按 `rangeBand` 覆盖伤害；CombatBoard 攻击与追逐攻击均可选择距离档。
- [x] **R-1 MP 不足转扣 HP**：`spendMagicPoints`；战斗内 MAGIC/ITEM 与战斗外施法均按规则包 `magicPoint.overflowToHp` 扣 HP；HP 归零进入失去战斗能力/昏迷。
- [x] **G-1 技能检定难度一致性**：成长标记改用 `meetsDifficulty`。
- [x] **G-2 96–100 成长配置化**：`resolveGrowthChecks` 接受 `autoPassFrom96`；以 `starter-quickstart` 开局的房间自动关闭该完整版条款。
- [x] **C-1 入门版固定建卡**：`validateCharacterDraft` 新增 FIXED_ARRAY 分支；支持固定属性数组、八项本职+信用评级九值分配、四项兴趣 +20、信用评级 40、禁用克苏鲁神话；CharacterBuilder 新增入门版技能面板；`verify:coc7-starter` 回归通过。
- [x] **C-2 剑/武器技能推断与反击技能**：剑→`格斗（剑）`、斧/矛/鞭按专精映射；反击 UI/服务端支持全部格斗专精并带武器伤害。
- [x] **C-3 多专精数据表示（后端部分）**：导入 `外语（X）`→`LANGUAGE_OTHER#X`、`科学（X）`→`SCIENCE#X`、`驾驶（X）`→`驾驶#X`、`生存（X）`→`SURVIVAL#X`、`射击（弩）`→`FIREARMS_BOW#弩`；房间技能检定列表与复合 key 技能检定已接入；编辑角色时保留复合 key。
- [x] **U-4 寡不敌众（P1）**：`reactionsThisRound` 每轮重置；目标本轮已经闪避/反击后，后续近战攻击自动 +1 奖励骰；新增单测覆盖。
- [x] **U-2 手枪连射（P1）**：`shots` 1–3；每发各带 1 枚惩罚骰；同一动作内共享一次掩体检定、逐发掷攻击/防御/伤害；CombatBoard 增加射击次数选择。
- [x] **U-7 准备火器 + DEX 调序（P1）**：`initiativeMod` 参与先攻排序；`combat:ready-weapon` 标记持火器单位 +50 DEX；KP 可拖动上/下调整先攻顺序（`combat:initiative-order`）。
- [x] **D-6 属性半值/五分之一值与信用评级阶级（P2）**：车卡页、角色页、房间角色页显示困难/极限值；信用评级显示身无分文/贫困/普通/小康/富裕/豪富。
- [x] **U-5 战技（P1）**：新增 `MANEUVER` 行动与 `DISARM/TRIP/GRAPPLE`；体格差惩罚骰、差 3+ 不可行；成功应用倒地/被缴械/被擒抱；被擒抱行动带惩罚骰；被缴械只能徒手攻击；CombatBoard 增加战技面板与状态徽章。
- [x] **U-3 怪物同一轮多次攻击（P1，部分）**：NPC 武器带 `attacks` 时可用现有 `shots` 机制在同一动作内重复同一攻击；CombatBoard 可选射击/攻击次数。不同技能/多目标 routine 仍待做。
- [x] **U-6 近距离奖励（P1，部分 → 地图距离已接）**：火器攻击面板保留“近距离点射 +1 奖励骰”；霰弹枪距离档已有。新增纯规则模块 `packages/combat/src/range.ts`（距离档匹配 / 近距离奖励 / 投掷射程）与地图几何 `gridDistanceFeet`；服务端在普通攻击时从战斗绑定场景的双方 Token 坐标自动换算英尺距离，覆盖伤害档，并限制投掷 `STR/5` 码射程。追逐攻击与战斗 UI 展示距离仍待后续。
- [x] **U-1 战斗内通用修正（P1）**：攻击、闪避、反击统一读取自定义状态 `attackBonusDice / attackPenaltyDice / defenseBonusDice / defensePenaltyDice`（布尔 true = 1，数值上限 5）；被擒抱、疯狂发作、寻找掩体、寡不敌众、连射与近距离点射全部汇总为“修正来源”，写入攻击 / 闪避 / 反击日志，避免黑箱。疯狂发作的防御惩罚骰现对反击同样生效。
- [x] **D-3 SAN 检定、疯狂与发作表（P2，三阶段）**：`resolveSanityCheck`、损失 5+ 的 INT 检定、`INSANITY` 小时条件；`dice:madness-bout` 使用 1D10 疯狂发作表并写入 1D10 轮 `INSANITY`，9/10 条目的行动惩罚骰已接入战斗攻击/防御检定。本轮新增：9/10 条目从 `PHOBIAS/MANIAS` 表抽取具体恐惧症/躁狂症并写入 `character.backstory.phobias`（聊天提示“已写入角色背景”）；新增 `dice:reality-check` 现实检定，失败写入 `HALLUCINATION` 并延长 `INSANITY` 1 小时，成功解除幻觉；RoomPlay 增加“现实检定”按钮。
- [x] **D-4 医疗与恢复（P2，房间动作已接入）**：纯规则模块 `packages/rules/src/medical.ts` 覆盖急救（1 小时时限 / +1 HP / 稳定濒死）、医学（超过一天需困难成功 / 未稳定濒死的濒死者不可用 / 1D3）、自然恢复（未重伤每日 1 HP）、重伤周检（成功 1D3 / 极难 2D3 / 回到半血移除重伤）。新增 socket `room:medical` 与 KP 工作台“医疗与恢复”面板：服务端按角色实际急救/医学技能与 CON 掷骰，结果同时写回 `GameCharacter` 与战斗 participant。剩余：叙事时间自动推进（受伤小时数目前由 KP 在面板输入）。
- [x] **D-6 属性半值/五分之一值与信用评级阶级（P2）**：已在前轮完成。

### 尚未完成的后续项（本轮已全部收口）
- [x] **C-3 UI 部分 / D-5 专精选择**：手工建卡页新增“添加专精”面板（外语 / 科学 / 驾驶 / 生存 / 技艺 / 射击），以 `BASE#专精` 复合 key 合成可分配技能行；服务端 draft 对新角色的复合 key 按基础技能求值 + 职业 / 兴趣点写回 `skills`。浏览器用例断言 `LANGUAGE_OTHER#拉丁语 = 41`。
- [x] **D-5 专精候选数据与选择 UI**：KP 工作台新增“专精候选”页，按基础技能维护候选列表，保存到 `Room.ruleOverride.specialtyCandidates`（规则包编译会忽略该未知键，不影响校验）；建卡页把候选渲染为“专精名称”下拉，玩家仍可自由输入。浏览器用例验证 KP 添加“拉丁语”后建卡页出现候选。
- [x] **U-3 不同技能 / 多目标 routine**：`ActionSubmission` 新增 `routine: RoutineAttackStep[]`，同一行动内可按顺序换技能 / 换目标 / 连射，最多 8 步；服务端按步骤解析实际装备、地图距离档与奖励骰，引擎逐条走攻击 / 闪避 / 反击 / 伤害管线。CombatBoard 新增“多目标 / 多技能攻击 routine”面板。浏览器用例验证同一行动内 `FIGHTING_BRAWL → 防御者1`、`FIREARMS_HANDGUN → 防御者2` 两步真实结算。
- [x] **U-6 剩余**：战斗运行时读取场景 Token 坐标，`CombatView` 附带网格与坐标，普通攻击面板常驻显示实际英尺距离；追逐面板显示“最近敌人地图距离”，追逐攻击也按地图距离自动覆盖伤害档与近距离奖励骰。浏览器用例验证 35/70 英尺普通攻击展示，以及追逐中 70 英尺触发霰弹枪远距离 2d6 档。
- [x] **D-2 环境与持续伤害**：`room:environment-damage` 按 COC7 重伤 / 昏迷 / 濒死 / 死亡规则结算；DOT 写成条件（表达式 + 轮数），引擎在回合结束时自动结算 DOT 并扣减轮数（`resolveRoundEndDotDamage`，接入 `resolvePending` 与 `endTurn`）。浏览器用例验证环境伤害 + 两轮跳过触发 DOT 自动伤害与剩余轮数递减。
- [x] **D-3 时间推进联动**：新增 `room:advance-time`，按 MINUTE / HOUR / DAY 扣减所有角色限时状态并在到期时移除，写入日志；幻觉 / 临时疯狂可随叙事时间自然到期。浏览器用例验证 HALLUCINATION（1 小时）推进 1 小时后自动移除。
- [x] **D-1 武器 / 伤害表**：KP 工作台新增“武器 / 伤害表”页，列出全部内置武器（技能、伤害、类型、射程、距离档、射击数）与重伤 / 濒死 / 极限贯穿 / 火器掩体 / 投掷射程 / 自然恢复规则参考。
- [x] **D-7 后台内容编辑器（表格化第一阶段）**：管理后台规则包版本编辑器新增“技能表”表单模式，可逐行编辑 id / 名称 / 类别 / 基础表达式、添加与删除技能行，并与 JSON 模式共用同一份配置，保存为可发布的草稿版本。浏览器用例走真实后台：ADMIN 登录 → 从内置包复制建包 → 表单编辑技能 → 保存新版本 → DB 断言。
- [x] **G-2 成长规则展示**：成长面板新增常驻徽章，显示房间实际生效的 96–100 成长规则（完整版 / 入门版）。浏览器用例断言显示“完整版”。
- [x] **P3 KP 快捷工具**：KP 工作台包含幸运检定 / 消耗幸运、孤注一掷、治疗计算器、条件编辑器、环境伤害、时间推进；仍保留判定日志中文化与独立“疯狂工具”面板为后续增强（不影响已覆盖规则）。

### 本轮验证
- `npm run typecheck`：通过。
- `npm test`：combat 103 / formula 54 / rules 99，全部通过（256 tests）。
- `npm run build`：通过。
- `npm run verify:combat-options -w @touhou/web`：PASS。
- `npm run verify:coc7-starter -w @touhou/web`：PASS。
- 真实 Chromium 浏览器全量 Playwright：**24 passed**，覆盖 D-1 ~ D-5、D-7、G-2、U-1 ~ U-7、C-1/C-3 与真实双人开团流程。

## 13. 真实浏览器端到端验证（补充）

- 新增 Playwright 用例：`apps/web/e2e/coc7-compliance.spec.ts`，全部通过页面点击 / 选择 / 提交完成，覆盖 C-1/I-3/D-6、I-1/G-1/D-3、F-1、F-2、F-3、F-4、F-5、U-1、U-2、U-4、U-5、U-6 地图距离与投掷射程、U-7、R-1。
- 运行方式：`cd apps/web && bash scripts/run-e2e-web.sh e2e/coc7-compliance.spec.ts --project=chromium`
- 结果：新增合规用例 **14 passed**；新增完整双玩家真实跑团用例 **1 passed**；仓库全量 Playwright 套件 **18 passed**。
- 完整真实流程用例：`apps/web/e2e/coc7-full-game.spec.ts`。两个独立浏览器上下文注册两个用户，真实创建房间、邀请码加入、xlsx 导入角色（并断言 `LANGUAGE_OTHER#拉丁语` 复合 key 与“长剑”→`格斗（剑）`推断）、KP 审核、创建场景与放置 Token、准备、开始跑团、从 Token 发起战斗，并由两名玩家各自浏览器完成攻击/闪避/不应对/战技/手枪三连射。
- 详细矩阵与未覆盖项见 `docs/COC7-BROWSER-E2E-REPORT.md`。
- 浏览器 E2E 发现并修复三个真实缺陷：
  1. NPC 武器元数据在运行时重载后丢失（`setup.ts` 写 `__participantId`，`options.ts` 反查）。
  2. `combat:action` 未复制 `maneuver`，导致战技从页面提交时报“缺少战技类型”（`socket/combat.ts`）。
  3. 编辑导入角色时 `LANGUAGE_OTHER#拉丁语` 等专精复合 key 被误判为“不属于规则包技能”（`draft.ts` 改为按 `#` 前基础技能校验）。
- 仍无页面入口、因此无法浏览器验证：U-3 完整 routine、U-6 追逐距离、C-3 手工专精 UI、D-4 房间医疗动作、D-1/D-2/D-5/D-7、G-2 可见展示。
