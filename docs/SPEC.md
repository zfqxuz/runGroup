# 跑团平台 Spec v1.3
## 房间、局、团本与局内状态

状态：已确认，等待开发指令。

---

## 1. 目标

- 准备页是唯一的开局准备入口。
- 开局条件固定：所有 KP/PL 准备完成，且每名 PL 至少有一张审核通过的角色卡。
- KP 不能强制开始。
- 房间长期存在，可以连续跑多个“局”。
- 人物卡、人物身上的物品、个人库内容跨局保留。
- 每个局有自己的局内状态，包括当前章节、场景、遭遇、时间、旗标、计数器。
- 暂停、掉线、服务器重启后，重新加入房间可以读取进度继续。
- 一个局跑完后，KP 可以结束本局，房间回到准备状态，再开下一个团本。
- 团本正文第一版支持纯文本 / Markdown，但必须按 CoC7 团本要素组织内容。
- 角色成长必须单独标注，不能静默改基础卡。

---

## 2. 核心概念

| 概念 | 说明 |
|---|---|
| 房间 Room | 长期容器。成员、角色库、卡牌库、聊天等都属于房间的长期数据 |
| 局 Game | 一次完整跑团。一个房间可以先后存在多个局 |
| 团本 Module | 一个局使用的剧本 / 模组 |
| 局内状态 GameState | 当前局跑到哪里的可变状态 |
| 局内角色 GameCharacter | 某个角色在当前局中的 HP / MP / SAN / 状态 / 存活情况 |
| 角色 Character | 玩家绑定的长期角色卡，跨局保留 |
| 成长 Advancement | 局外成长记录，带来源、类型与额外标注 |
| 准备 ready | 成员在准备页确认可以开始 / 继续 |

---

## 3. 生命周期

### 3.1 房间

房间长期存在，不因一局结束而解散。

房间状态：

```
LOBBY -> PLAYING -> PAUSED -> COMBAT -> ENDED
```

- `LOBBY`：准备页。
- `PLAYING`：跑团页进行中。
- `PAUSED`：当前局暂停，等待全员重新准备后继续。
- `COMBAT`：当前局内正在战斗。
- `ENDED`：房间被 KP 手动关闭归档。

一局结束不等于房间结束：

- 局结束后，`Game.status = ENDED`。
- 房间回到 `LOBBY`，可以准备下一局。
- 长期的成员、角色、物品、成长记录全部保留。

### 3.2 局 Game

`Game.status`：

```
PREPARING -> PLAYING -> PAUSED -> PLAYING -> ENDED
PLAYING <-> COMBAT
```

- `PREPARING`：本局准备阶段。
- `PLAYING`：本局进行中。
- `PAUSED`：本局暂停，状态已持久化。
- `COMBAT`：本局战斗进行中。
- `ENDED`：本局结束。

同一房间同一时间只能有一个未结束的局。

### 3.3 开始与继续条件

已确认规则：

1. 开始新局：
   - 所有非旁观成员 `ready = true`。
   - 每名 PL 至少有一张 `APPROVED` 的角色卡。
   - 操作者必须是 KP。
   - KP 不能强制开始。
2. 从暂停继续：
   - 所有非旁观成员重新准备完成。
   - KP 点击“继续跑团”。
   - 服务端读取上一份 `GameState` 和战斗快照，恢复到中断位置。
3. 旁观成员：
   - 不计入开始条件。
   - 不参与 ready。
4. 服务端必须重复校验，不能只依赖前端按钮 disabled。

---

## 4. 局内状态 GameState

每个局拥有一个 `GameState`，它是当前进度的事实来源。

字段：

```prisma
model GameState {
  gameId             String   @id
  moduleId           String?
  moduleVersion      String?
  currentChapterId   String?
  currentSceneId     String?
  currentEncounterId String?
  gameTime           String?
  paused             Boolean  @default(false)
  flags              Json     @default("{}")
  counters           Json     @default("{}")
  custom             Json     @default("{}")
  version            Int      @default(1)
  updatedAt          DateTime @updatedAt

  game Game @relation(fields: [gameId], references: [id], onDelete: Cascade)
}
```

用途：

- `moduleId`：本局使用的团本。
- `currentChapterId`：当前章节。
- `currentSceneId`：当前场景。
- `currentEncounterId`：当前遭遇。
- `gameTime`：团内时间，例如“第 3 天 20:14”。
- `paused`：是否暂停。
- `flags`：布尔 / 字符串旗标，例如 `boss_defeated`。
- `counters`：数值计数器，例如 `sanity_loss_total`。
- `custom`：KP 自定义状态，例如支线进度、随机事件。
- `version`：乐观锁版本，避免并发覆盖。

持久化原则：

- 能规范化的数据不放 JSON。
- 聊天、掷骰、线索、笔记、战斗分别使用已有表。
- 每次房间状态变化都写入数据库。
- Socket 内存只是缓存，服务器重启后从数据库恢复。

---

## 5. 团本 Module

### 5.1 使用方式

- 一个局绑定一个团本。
- 团本可以复用，也可以每局新建。
- 同一个局的团本可以在跑团过程中更新文字、修正描述，不重置成员、聊天、战斗与局内状态。
- 新开一个局时，KP 选择团本，进入新的准备阶段。
- 旧局结束后保留历史团本、局记录、GameState 与角色成长记录。

### 5.2 团本要素

根据 CoC7 常见结构，第一版团本正文至少应支持以下要素：

1. **元信息**
   - 标题
   - 作者
   - 版本
   - 规则系统：COC7 / TOUHOU
   - 年代：1920 / 现代 / 幻想乡
   - 难度
   - 建议人数
   - 预计时长
   - 内容警告
2. **真相与背景**
   - KP 背景
   - 事件真相
   - 历史时间线
3. **剧情梗概**
   - 一句话简介
   - 剧情主线
   - 关键转折
4. **开场钩子**
   - 角色被卷入的原因
   - 与角色背景相关的钩子
5. **关键 NPC**
   - 姓名
   - 身份
   - 动机
   - 秘密
   - 属性 / 技能
   - 对玩家的态度
6. **地点与场景**
   - 地点描述
   - 可调查内容
   - 核心线索
   - 可选线索
   - 触发事件
7. **线索**
   - 核心线索
   - 可选线索
   - 发现条件
   - 失败后果
8. **遭遇与战斗**
   - 触发条件
   - 敌人 / 怪物
   - 战术
   - 战场环境
   - 战胜 / 战败结果
9. **道具与 handout**
   - 玩家可见文本
   - 图片 / 文件
   - 特殊物品
10. **怪物与神话生物**
    - 数据
    - 特殊能力
    - SAN 损失
11. **结局分支**
    - 成功结局
    - 失败结局
    - 部分成功
    - 悲剧结局
12. **奖励与成长**
    - SAN 奖励
    - 技能成长
    - 物品奖励
    - 剧情影响
13. **KP 备注**
    - 节奏建议
    - 可选规则
    - 应变方案
14. **附录**
    - 地图
    - 时间线
    - 关系图
    - 随机事件表

### 5.3 ModuleContent v1

第一版使用纯文本 / Markdown，正文按上述要素分标题。

```json
{
  "format": "markdown",
  "text": "## 元信息\n...\n## 真相与背景\n...",
  "sections": [
    { "id": "meta", "title": "元信息", "content": "..." },
    { "id": "truth", "title": "真相与背景", "content": "..." }
  ],
  "tags": [],
  "warnings": []
}
```

- `format`：`markdown` 或 `text`。
- `text`：完整正文。
- `sections`：可选的结构化切片，便于后续 UI 导航。
- `tags` 和 `warnings` 用于筛选与内容提示。

---

## 6. 角色跨局与成长

### 6.1 角色归属

- 角色卡绑定玩家账号，不绑定房间。
- 同一个角色可以在多个房间、多个局中重复使用。
- 角色进入每个局时，先走带入审核。
- KP 通过后，玩家可以把该角色设为当前局角色。

### 6.2 局内角色状态

新增 `GameCharacter`：

```prisma
model GameCharacter {
  id          String  @id @default(cuid())
  gameId      String
  characterId String
  userId      String
  status      String  @default("ALIVE")
  currentHp   Int
  currentMp   Int
  currentSan  Int
  currentDp   Int     @default(0)
  conditions  Json    @default("[]")
  state       Json    @default("{}")
  createdAt   DateTime @default(now()) @db.Timestamptz(3)
  updatedAt   DateTime @updatedAt

  game      Game      @relation(fields: [gameId], references: [id], onDelete: Cascade)
  character Character @relation(fields: [characterId], references: [id])
  user      User      @relation(fields: [userId], references: [id])

  @@unique([gameId, characterId])
  @@index([userId])
}
```

- 基础 `Character` 保存长期数值。
- `GameCharacter` 保存当前局内的 HP / MP / SAN / 状态。
- 战斗中的伤害、回复、疯狂等只改 `GameCharacter` 和战斗快照。
- 局结束时，若角色存活：
  - `GameCharacter.status = ALIVE`。
  - 本局产生的永久成长写入 `CharacterAdvancement`。
  - 临时战斗状态不写回基础卡。

### 6.3 成长标注

新增 `CharacterAdvancement`：

```prisma
model CharacterAdvancement {
  id          String   @id @default(cuid())
  characterId String
  gameId      String?
  kind        String
  target      String?
  delta       Int?
  note        String?
  createdAt   DateTime @default(now()) @db.Timestamptz(3)

  character Character @relation(fields: [characterId], references: [id], onDelete: Cascade)
  game      Game?     @relation(fields: [gameId], references: [id])

  @@index([characterId, createdAt])
}
```

- `kind`：`ATTRIBUTE` / `SKILL` / `SAN` / `ITEM` / `RELATIONSHIP` / `OTHER`。
- `target`：例如 `str`、`SPOT_HIDDEN`。
- `delta`：数值变化。
- `note`：额外说明，例如“模组奖励：目睹真相后意志 +1”。
- 角色详情页和准备页必须显示成长来源与标注。
- 基础属性 / 技能可以更新，但必须有对应成长记录。

---

## 7. 存档、暂停与恢复

### 7.1 持久化范围

| 内容 | 存储 |
|---|---|
| 房间、成员、角色、物品 | PostgreSQL |
| 当前局、当前团本 | `Game` / `Module` |
| 当前章节 / 场景 / 遭遇 / 时间 / 旗标 | `GameState` |
| 角色局内 HP / MP / SAN / 状态 | `GameCharacter` |
| 聊天 | `Message` |
| 掷骰 | `DiceRoll` |
| 线索 | `Clue` / `ClueDiscovery` |
| 笔记 | `Note` |
| 战斗 | `Combat` / `CombatParticipant` / `CombatAction` / `CombatSnapshot` |
| 成长 | `CharacterAdvancement` |

### 7.2 暂停

- KP 可以随时暂停当前局。
- 暂停时立即写入：`GameState`、`GameCharacter`、进行中的 `CombatSnapshot`。
- `Game.status = PAUSED`，`Room.status = PAUSED`。
- 暂停期间：
  - 禁止聊天。
  - 禁止掷骰。
  - 禁止提交战斗行动。
  - 允许查看历史。

### 7.3 继续

- 所有非旁观成员重新 ready。
- KP 点击继续跑团。
- 服务端读取 `GameState` 和最新战斗快照。
- 恢复 `Room.status`、当前场景、遭遇、战斗视图。
- Socket 向所有在线成员广播完整状态。

### 7.4 重连与重启

- 数据库是唯一事实源。
- 玩家刷新、断线、换设备后，重新进入房间：
  1. 校验成员身份。
  2. 读取当前 `Game`。
  3. 读取 `GameState`。
  4. 读取 `GameCharacter` 与当前角色。
  5. 读取最近消息、掷骰。
  6. 若 `Game.status = COMBAT`，读取最新 `CombatSnapshot`。
  7. 页面恢复到中断位置。
- 服务重启后按同样顺序恢复。
- 不允许因服务器重启丢失当前局、当前场景或进行中的战斗。

---

## 8. 局结束后开新局

- KP 可以结束当前局。
- 结束时：
  1. 写入最终 `GameState`。
  2. 写入角色存活状态。
  3. KP 确认成长与奖励。
  4. 写入 `CharacterAdvancement`。
  5. `Game.status = ENDED`。
  6. 房间回到 `LOBBY`。
- 房间不 disband。
- 成员、角色、物品、卡片、成长记录继续保留。
- KP 可以：
  - 选择已有团本开新局。
  - 创建新团本开新局。
  - 继续使用同一批角色。
  - 允许玩家换角色。

---

## 9. 接口

### 9.1 Server Actions

| Action | 权限 | 说明 |
|---|---|---|
| `toggleReadyAction` | 非旁观成员 | 切换自己的 ready |
| `startGameAction` | KP | 新局开始，校验全员 ready 与每人有审核通过角色 |
| `pauseGameAction` | KP | 暂停并保存状态 |
| `resumeGameAction` | KP | 全员 ready 后继续，读取上次进度 |
| `endGameAction` | KP | 结束当前局，回到准备页 |
| `upsertModuleAction` | KP | 创建 / 更新团本 |
| `setActiveCharacterAction` | PL | 选择本局当前角色 |
| `updateGameStateAction` | KP | 更新章节 / 场景 / 遭遇 / 时间 / 旗标 / 计数器 |
| `reviewEntry` | KP | 审核角色卡带入 |
| `reviewCardEntries` | KP | 批量审核卡牌带入 |

### 9.2 Socket

| 事件 | 说明 |
|---|---|
| `room:join` | 返回成员、消息、当前局、GameState、当前角色与战斗 ID |
| `room:state:update` | 广播 GameState 变化 |
| `scene:change` | 广播场景切换 |
| `encounter:start` | 广播遭遇开始 |
| `clue:reveal` | 广播线索公开 |
| `room:pause` | 广播暂停 / 继续 |
| `room:end` | 广播本局结束 |

---

## 10. 页面

### 10.1 准备页 `/rooms/[id]/prepare`

必须包含：

- 房间基础信息与邀请码。
- 当前团本信息。
- 成员准备状态列表。
- 我的准备按钮。
- 车卡入口。
- 角色带入审核与当前角色选择。
- 卡牌带入审核。
- NPC / Boss 准备。
- 团本管理。
- KP 开始按钮，显示 `readyCount / requiredCount`。
- 每名 PL 是否有通过审核角色的检查提示。

### 10.2 跑团页 `/rooms/[id]`

必须包含：

- 当前团本 / 章节 / 场景 / 遭遇 HUD。
- 当前团内时间。
- 暂停 / 继续状态。
- 当前角色面板。
- 角色局内 HP / MP / SAN。
- 场景与遭遇控制。
- 线索与笔记。
- 战斗面板。
- 聊天与掷骰。
- 断线重连状态。

---

## 11. 数据模型总览

新增 / 修改：

- `Room`：长期存在，可关联多个 `Game`。
- `RoomMember`：增加 `ready`；使用 `activeCharacterId`。
- `Game`：房间内的一次跑团。
- `GameState`：局内可变状态。
- `GameCharacter`：角色在本局的 HP / MP / SAN / 状态。
- `CharacterAdvancement`：成长记录与额外标注。
- `Module`：团本；一个局绑定一个团本。
- `ModuleChapter` / `Encounter` / `Scene`：后续结构化团本扩展。
- 现有 `Message` / `DiceRoll` / `Combat` / `CombatSnapshot` 继续使用。

`Game` 建议结构：

```prisma
model Game {
  id         String   @id @default(cuid())
  roomId     String
  moduleId   String?
  status     String   @default("PREPARING")
  title      String
  startedAt  DateTime?
  endedAt    DateTime?
  createdBy  String
  createdAt  DateTime @default(now()) @db.Timestamptz(3)
  updatedAt  DateTime @updatedAt

  room       Room          @relation(fields: [roomId], references: [id], onDelete: Cascade)
  module     Module?       @relation(fields: [moduleId], references: [id])
  state      GameState?
  characters GameCharacter[]
  advancements CharacterAdvancement[]

  @@index([roomId, status])
}
```

---

## 12. 验收标准

1. 加入房间后进入准备页，默认未准备。
2. 任意非旁观成员未准备时，KP 无法开始。
3. 任意 PL 没有审核通过角色时，KP 无法开始。
4. 服务端拒绝绕过前端的强制开始请求。
5. 全员准备且每名 PL 有通过角色后，KP 可以开始新局。
6. 开始后角色 HP / MP / SAN 写入 `GameCharacter`。
7. KP 可以暂停，暂停后聊天、掷骰、战斗行动被服务端拒绝。
8. 全员重新准备后，KP 可以继续，并读取上次 `GameState` 与战斗快照。
9. 玩家断线、刷新、服务器重启后，重新进入房间能继续当前进度。
10. 一局结束后，房间回到 LOBBY，可以开新团本。
11. 上一局角色、物品、成长记录保留。
12. 团本更新不重置成员、聊天、战斗、成长记录。

---

## 13. 开发阶段

### Phase 1：准备页与开局闸门
- `RoomMember.ready`。
- `Game` / `GameState` 基础迁移。
- `toggleReadyAction`。
- `startGameAction` 全员 ready + 每名 PL 有通过角色校验。
- 准备页成员状态、开始按钮。

### Phase 2：当前角色与局内角色
- `GameCharacter` 迁移。
- `setActiveCharacterAction`。
- 角色选择 UI。
- 准备页 / 跑团页显示当前角色。
- 局内 HP / MP / SAN 展示。

### Phase 3：团本管理
- `upsertModuleAction`。
- 团本编辑页 / 准备页面板。
- ModuleContent v1。
- 跑团页只读团本展示。

### Phase 4：局内状态与暂停
- `GameState` 更新 action。
- 暂停 / 继续。
- 场景 / 遭遇开关。
- 跑团页 HUD。
- Socket 状态广播。

### Phase 5：结束、成长与跨局
- `endGameAction`。
- `CharacterAdvancement`。
- 结束本局回到准备页。
- 用同一批角色开下一局。
- 跨局 E2E。

### Phase 6：重连与恢复
- `room:join` 返回完整状态。
- 战斗快照恢复。
- 服务器重启恢复。
- 重连 E2E。

---

## 14. 已确认决策

1. 开始条件是所有非旁观成员 ready。
2. KP 不允许强制开始。
3. 每名 PL 必须至少有一张通过审核的角色才能开始。
4. 团本更新语义是：一局结束后，房间不解散，KP 可以换另一个团本开新局。
5. 角色卡和角色身上的物品跨局保留。
6. 角色局内有独立状态，局结束时记录为存活。
7. 局外成长必须写入额外成长标注。
8. 需要暂停和继续；继续时读取上次进度。
9. 团本正文第一版使用纯文本 / Markdown，并按 CoC7 团本要素分节。
10. 本 Spec 确认后，等待开发指令再进入编码。
