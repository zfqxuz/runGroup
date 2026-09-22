# dsh 助手技能化设计（DSH Skill Router）

> 目标：把 dsh 从「团本编辑悬浮球」升级成贯穿**团本、准备、跑团、战斗**四个阶段的助手平台。
> 当前实现见 [`MODULE-DSH-ASSISTANT.md`](MODULE-DSH-ASSISTANT.md)。

## 1. 背景

现状：dsh 只接了一条链路 —— 团本编辑页的悬浮球，把 `module.json` 和自然语言意见交给 headless dsh，拿回完整团本后写回数据库、小版本 +1。

问题：

- 能力入口单一：只有团本编辑页能看到 dsh。
- 没有能力边界：系统提示词靠「不要改什么」约束，缺少可组合、可授权、可审计的技能单元。
- 跑团中完全用不上：KP 调属性、查规则、生成 NPC、总结剧情仍然纯手工。
- 页面导航/操作引导缺失：新 KP 不知道「给 NPC 加符卡」要去哪个页面。

目标：

1. 技能化：每个能力是一个有明确输入/输出/权限边界的 **Skill**。
2. 全阶段：团本调整、准备阶段、跑团中、战斗中都能按需调用。
3. KP 新交互：用自然语言调整属性、技能、资源，并**先预览 diff、确认后再落库**。
4. 页面导航：dsh 能回答「去哪点」并直接给出深链接 / 一键跳转。
5. 安全：读写分离、人工确认、审计 + 可撤销、白名单 + 角色门槛。

## 2. 概念模型

| 概念 | 说明 |
|---|---|
| **Skill** | 一个可调用能力，如 `module.edit` / `kp.adjustStats` / `nav.guide`。 |
| **Stage** | 触发阶段：`MODULE`（团本）/ `PREP`（准备）/ `GAME`（跑团中）/ `COMBAT`（战斗）/ `GLOBAL`（任意页面）。 |
| **Audience** | 谁可以用：`KP` / `PLAYER` / `AUTHOR` / `ADMIN`；可叠加。 |
| **Effect** | `READ`（只读、可直接返回）或 `WRITE`（产出 patch，必须确认后由应用落库）。 |
| **Context Pack** | 技能声明的**有界上下文快照**（不是整库），以 `context.json` 注入 dsh 工作目录。 |
| **Patch** | WRITE 技能的结构化变更，Zod 校验通过才能进入 diff / apply。 |
| **Run** | 一次技能执行记录：谁、在哪个房间/团本、用了哪个 skill、输入摘要、patch、是否应用、耗时。 |

## 3. 阶段 × 技能矩阵

| Skill | Stage | Audience | Effect | 一句话 |
|---|---|---|---|---|
| `module.edit` | MODULE | AUTHOR, KP | WRITE | 自然语言修改团本（现有能力） |
| `module.review` | MODULE | AUTHOR, KP | READ | 一致性 / 数值 / 格式体检 |
| `module.explain` | MODULE | AUTHOR, KP | READ | 解释某章、某 NPC、某条规则 |
| `nav.guide` | GLOBAL | 全员 | READ | 「我要做 X，去哪里点」+ 深链接 |
| `nav.goto` | GLOBAL | 全员 | READ | 返回一个可点击的跳转动作 |
| `page.explain` | GLOBAL | 全员 | READ | 解释当前页面的字段与流程 |
| `prep.audit` | PREP | KP | READ | 检查车卡 / 卡牌 / 团本预设缺什么 |
| `prep.npcFromText` | PREP | KP | WRITE | 一段文本 → NPC 卡草稿 |
| `prep.batchEquip` | PREP | KP | WRITE | 批量装备已通过卡牌 |
| `kp.adjustStats` | GAME, COMBAT | KP | WRITE | 自然语言调整属性 / 技能 / HP/MP/SAN/DP |
| `kp.rule` | GAME, COMBAT | KP | READ | 规则速查 + 骰式 + 裁定建议 |
| `kp.recap` | GAME | KP | READ | 总结本场 / 最近 N 条日志与聊天 |
| `kp.sceneOps` | GAME | KP | WRITE | 建场景 / 放 Token / 快捷 NPC |
| `kp.npcVoice` | GAME | KP | READ | 用 NPC 口吻生成台词（含人设约束） |
| `kp.growth` | GAME | KP | WRITE | 提议幕间成长与奖励 |
| `combat.explain` | COMBAT | 全员 | READ | 解释一次攻击 / 应对 / DP 消耗 |
| `combat.suggest` | COMBAT | 全员 | READ | 给当前行动者提合法建议 |
| `global.search` | GLOBAL | 全员 | READ | 搜团本 / 卡牌 / 规则条目 |

> `WRITE` 技能只产出 patch，**永远由应用服务端落库**，dsh 不直接写数据库。

## 4. 重点：`kp.adjustStats`（KP 调属性新思路）

### 4.1 交互

KP 在房间/战斗页的 KP 工具区点「用 dsh 调整」，悬浮球自动带入当前选中单位：

> **KP**：灵梦刚才被月符打中，HP -5；她这轮受到月光加护，意志 +10 到 90，闪避 +15。
>
> **dsh**：准备把灵梦调整为：
> - HP 42 → 37
> - POW 80 → 90
> - DODGE 70 → 85
>
> 其中 POW 会同时影响意志相关衍生值；确认应用吗？
>
> `[确认应用] [只改 HP] [取消]`

### 4.2 Patch Schema（示意）

```ts
const StatPatchSchema = z.object({
  target: z.object({
    kind: z.enum(["CHARACTER", "NPC", "COMBAT_PARTICIPANT"]),
    ref: z.string()           // characterId / 运行时 participant.id
  }),
  source: z.enum(["GAME", "COMBAT", "CARD"]),   // 改的是局内值还是卡面
  changes: z.array(z.object({
    field: z.enum([
      "hp", "maxHp", "mp", "maxMp", "san", "maxSan", "dp", "maxDp",
      "str", "con", "siz", "dex", "app", "int", "pow", "edu", "luck",
      "skill:DODGE", "skill:DANMAKU", /* … */
    ]),
    mode: z.enum(["SET", "DELTA"]),
    value: z.number()
  })).min(1).max(50),
  reason: z.string().max(300)     // 写入审计与战斗日志
});
```

### 4.3 服务端流程

1. `POST /api/dsh/run { skillId:"kp.adjustStats", context:{ roomId, gameId?, combatId?, targetRef }, message }`。
2. 技能 `buildContext` 只读取：目标单位当前数值、最近 20 条日志、规则/派生公式要点、KP 权限内的可改字段清单。
3. dsh 写 `result.json = { reply, patch }`。
4. 应用侧 Zod 校验 + **权限校验**：
   - 只能改当前房间/战斗的合法单位；
   - 只能改 KP 有权限的字段（卡面与局内值分开）；
   - 数值 clamp（HP ≤ maxHp 等）。
5. 返回 NDJSON `patch` 事件，前端渲染 diff；KP 确认后调用既有服务：
   - 局内 → `KpValueEditor` 的 socket `combat:adjust` / game state 更新；
   - 卡面 → 角色卡更新 action（仅 KP/本人）。
6. 应用成功后写 `DshSkillRun`（含 patch 与反向 patch），并把 `reason` 追加到战斗日志 / 审计。

### 4.4 为什么不让 dsh 直接改

- 模型输出不稳定，直接写库无法回滚；
- 需要区分「卡面值 / 局内值 / 战斗快照」三类数据；
- 需要房间角色与白名单双重授权；
- 需要给玩家/其它 KP 一个可解释的 diff 与审计记录。

## 5. 技术架构

### 5.1 Skill 接口

```ts
export interface DshSkill<TCtx, TPatch = never> {
  readonly id: string;
  readonly stage: readonly DshStage[];
  readonly audience: readonly DshAudience[];
  readonly effect: "READ" | "WRITE";
  /** 有界上下文；只允许返回白名单字段。 */
  buildContext(input: DshRunInput): Promise<TCtx>;
  /** 拼任务说明（系统提示词 + 数据来源 + 输出契约）。 */
  buildTask(ctx: TCtx, input: DshRunInput): string;
  /** 解析 result.json；WRITE 技能返回 Zod 校验后的 patch。 */
  parseResult(raw: unknown, ctx: TCtx): { reply: string; patch?: TPatch };
  /** WRITE：把 patch 应用到数据库；必须返回反向 patch 供撤销。 */
  apply?(patch: TPatch, ctx: TCtx): Promise<{ undo: unknown }>;
}
```

### 5.2 注册表

`apps/web/src/server/dsh/skills/registry.ts`：

```ts
export const DSH_SKILLS = {
  "module.edit": moduleEditSkill,
  "nav.guide": navGuideSkill,
  "kp.adjustStats": kpAdjustStatsSkill,
  // …
} satisfies Record<string, DshSkill<unknown, unknown>>;
```

API 层只依赖注册表，新增技能不改路由。

### 5.3 API

统一入口，保留现有 module 路由作为兼容包装：

```
POST /api/dsh/run
body: { skillId, roomId?, gameId?, combatId?, moduleId?, targetRef?, message, history? }
resp: NDJSON
  { type:"thinking", text }
  { type:"progress", text }
  { type:"patch", patch }        // WRITE
  { type:"final", reply, runId }
  { type:"error", error }
```

### 5.4 持久化（建议新增）

```prisma
model DshSkillRun {
  id        String   @id @default(cuid())
  skillId   String
  userId    String
  roomId    String?
  moduleId  String?
  effect    String   // READ / WRITE
  input     Json
  patch     Json?
  applied   Boolean  @default(false)
  undo      Json?
  durationMs Int
  createdAt DateTime @default(now())
  @@index([roomId, createdAt])
  @@index([userId, createdAt])
}
```

### 5.5 前端

- 复用并扩展 `DshAssistantBall`：新增 `stage` / `skillHints` / `targetRef` props。
- 新增 `<DshPatchDiff>`：表格化展示字段、旧值 → 新值、来源（卡面/局内）。
- 页面挂载点：
  - 团本页：`module.edit` / `module.review`（已有）
  - 房间准备页：`prep.audit` / `prep.npcFromText`
  - KP 工具区 / 战斗页：`kp.adjustStats` / `kp.rule` / `kp.recap`
  - 全局右下角：`nav.guide` / `page.explain`
- `nav.goto` 的跳转动作由前端执行：`{ type:"action", action:"navigate", href }` → 悬浮球显示「带我去」按钮。

## 6. 权限与安全

| 层 | 规则 |
|---|---|
| 白名单 | 复用 `SystemSetting`，按技能域配置：`ai.dsh.skills.whitelist` / `ai.dsh.kp.whitelist` |
| 角色 | `module.*` 仅作者/本房 KP；`kp.*` 仅本房 KP；`combat.suggest` 仅当前行动者/ KP |
| 数据 | Context Pack 只注入白名单字段；不把 `DATABASE_URL` 等密钥传给 dsh（现有 runner 已做） |
| 写入 | 只产出 patch；Zod 校验 + 权限校验 + clamp 后才应用；不做「整库覆盖」 |
| 审计 | 每次 run 落 `DshSkillRun`；WRITE 应用后写房间/战斗日志与 `reason` |
| 撤销 | `apply` 返回 `undo`；KP 可在 10 分钟内一键撤销 |
| 资源 | 复用 `DSH_MAX_CONCURRENT=1`、`DSH_TASK_TIMEOUT_MS`；长任务只允许团本域 |

## 7. 落地路线

> 实现状态（2026-09-22）：Phase 0 已落地，Phase 1 的只读技能已落地 4 个；
> Phase 2 / 3 未开始。已实现部分见下。

### Phase 0（基础设施）✅ 已实现
- `DshSkill` 接口 + 注册表：`server/dsh/skills/{types,registry,prompts}.ts`。
- 统一入口 `POST /api/dsh/run`（NDJSON）+ `GET /api/dsh/context`；旧 module 路由保留兼容。
- 路由 → 上下文推导：`shared/dsh-context.ts`；有界上下文包：`server/dsh/context.ts`。
- 编排：`server/dsh/turn.ts`；`module.edit` 委托既有 `runModuleDshTurn`。
- 全局悬浮球：`components/dsh/DshAssistantBall.tsx`，挂在 `app/layout.tsx`，可拖动 + localStorage 记忆位置。
- 白名单沿用 `ai.moduleDsh.whitelist`（按 skill 域细分待做）。
- ⏳ 待做：`DshSkillRun` 审计表（当前写入技能仍走 `AdminAuditLog`）。

### Phase 1（低风险高价值）部分已实现
- ✅ `nav.guide`（页面导航 + 深链接）。
- ✅ `kp.rule`（规则速查）。
- ✅ `module.explain`（团本解读）。
- ✅ `combat.explain`（战斗解读）。
- ⏳ 待做：`page.explain`、`nav.goto`、`combat.suggest`。

### Phase 2（KP 调属性，未开始）
- `kp.adjustStats`：Context Pack + Patch Schema + diff UI + 确认应用 + 撤销。
- 先覆盖局内 HP/MP/SAN/DP/属性/技能；卡面值单独一步确认。
- E2E：两个浏览器，KP 用自然语言改属性 → diff → 确认 → 战斗页数值与日志更新。

### Phase 3（准备与跑团扩展，未开始）
- `prep.audit` / `prep.npcFromText` / `prep.batchEquip`。
- `kp.recap` / `kp.npcVoice` / `kp.sceneOps` / `kp.growth`。
- `module.review`。

## 8. 与现有代码的映射

| 现有 | 复用/改造 |
|---|---|
| `server/dsh/runner.ts` | 保持为传输层，不感知 skill |
| `server/dsh/module-assistant.ts` | 保留为 `module.edit` 的执行体（`turn.ts` 调用，未物理搬迁） |
| `server/dsh/access.ts` | 当前白名单已生效；按 skill 域细分待做 |
| `api/modules/[moduleId]/dsh/route.ts` | 保留兼容 |
| `api/dsh/run` + `api/dsh/context` | 新增统一入口与技能发现 |
| `server/dsh/context.ts` + `shared/dsh-context.ts` | 新增：路由 → 有界上下文包 |
| `server/dsh/skills/registry.ts` | 新增：技能注册表 |
| `components/dsh/DshAssistantBall.tsx` | 新增：全局可拖动悬浮球（替换 `components/module/DshAssistantBall.tsx`） |
| `KpValueEditor` / `KpToolsPanel` / `CombatBoard` | 挂载 KP 技能入口 |
| `SystemSetting` | 存技能白名单与开关 |
