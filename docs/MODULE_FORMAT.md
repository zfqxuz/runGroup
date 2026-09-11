# 团本标准格式 v1
## 供 AI / 作者将非标团本转换为可导入包

状态：已确认，作为导入、编辑、保存的统一格式。

---

## 1. 目的

定义一种人与 AI 都能生成、平台能解析、资源能打包的团本格式。

标准格式由两部分组成：

1. 一个 Markdown 主文件 `module.md`。
2. 一个资源目录包，可以压成 `.zip` 导入。

平台导入后会：

- 校验元信息。
- 校验标准章节。
- 扫描并规范资源路径。
- 保存为可编辑的团本。
- 允许 KP 后续继续编辑、保存和替换资源。

---

## 2. 包结构

标准包根目录：

```
module-package/
  module.md
  assets/
    images/
    maps/
    handouts/
    audio/
    video/
  characters/
    npcs.yaml
    pcs/
  README.md
```

说明：

- `module.md`：必需。
- `assets/`：可选。
- `characters/`：可选。
- 允许外层只有一层目录，例如：

```
红魔馆异变调查.zip
  └── module.md
  └── assets/
```

导入时平台会自动去掉单层包装目录。

---

## 3. 文件路径规范

### 3.1 内部逻辑路径

导入后，所有资源保存为相对路径：

```
assets/images/<module-slug>/<asset-id>.<ext>
assets/maps/<module-slug>/<asset-id>.<ext>
assets/handouts/<module-slug>/<asset-id>.<ext>
assets/audio/<module-slug>/<asset-id>.<ext>
assets/video/<module-slug>/<asset-id>.<ext>
characters/<module-slug>/<file>
```

### 3.2 路径字符规则

每个路径片段必须满足：

- 只允许小写英文字母、数字、点、下划线、短横线。
- 正则：`^[a-z0-9][a-z0-9._-]*$`
- 不包含空格、中文、反斜杠、冒号、问号、星号、双引号、尖括号、竖线。
- 不允许 `..`、`.`、空路径段。
- 不允许绝对路径。
- 扩展名必须白名单。

允许的扩展名：

```
.png .jpg .jpeg .webp .gif .svg
.pdf .md .txt .json .yaml .yml
.mp3 .ogg .wav .mp4 .webm
```

### 3.3 自动规范化

如果原包路径不合规：

- 平台保留原文件名到 `ModuleAsset.originalName`。
- 平台生成新的 slug 文件名。
- 自动改写 `module.md` 中的资源引用。
- 导入报告会列出改写记录。

### 3.4 安全规则

导入时拒绝：

- 加密 zip。
- zip 内符号链接。
- 可执行文件。
- 绝对路径、`..` 路径穿越。
- 单个文件超过 20MB。
- 包内文件数超过 500。
- 压缩包超过 50MB。

---

## 4. module.md 元信息

`module.md` 必须以 YAML Front Matter 开头：

```yaml
---
spec: touhou-module/v1
id: red-mansion-incident
title: 红魔馆异变调查
system: TOUHOU
era: FANTASY
author: 示例作者
version: 1.0.0
summary: 幻想乡红雾异变的调查团。
background: 红雾覆盖幻想乡，人类与妖怪都受到影响的异变背景。
occupationRecommendation: 巫女、魔法使、人偶师、占卜师。
difficulty: N
players:
  min: 2
  max: 5
duration: 3-5 小时
tags:
  - 幻想乡
  - 调查
  - 弹幕战
warnings:
  - 轻度恐怖
license: CC-BY-NC-SA
---
```

字段说明：

| 字段 | 必填 | 说明 |
|---|---|---|
| `spec` | 是 | 固定 `touhou-module/v1` |
| `id` | 是 | 小写 slug，包内唯一 |
| `title` | 是 | 团本标题 |
| `system` | 是 | `COC7` 或 `TOUHOU` |
| `era` | 是 | `CLASSIC`、`MODERN`、`FANTASY` |
| `author` | 是 | 作者 |
| `version` | 是 | 语义化版本 |
| `summary` | 是 | 一句话简介 |
| `background` | 否 | 广场公开的背景 / 时代氛围 |
| `occupationRecommendation` | 否 | 广场公开的推荐职业 / 角色方向 |
| `difficulty` | 否 | `E / N / H / L / EX / PH` 或 `LOW / MEDIUM / HIGH` |
| `players` | 否 | 建议人数 |
| `duration` | 否 | 预计时长 |
| `tags` | 否 | 标签数组 |
| `warnings` | 否 | 内容警告 |
| `license` | 否 | 授权协议 |

---

## 5. 标准章节

`module.md` 正文必须包含以下一级章节，顺序固定：

```markdown
## 元信息
## 真相与背景
## 剧情梗概
## 开场钩子
## 关键NPC
## 地点与场景
## 线索
## 遭遇与战斗
## 道具与手书
## 怪物与神话生物
## 结局分支
## 奖励与成长
## KP备注
## 附录
```

规则：

- 标题必须完全匹配。
- 允许某章节内容为“无”。
- 不允许缺少任何标准章节。
- 额外章节必须放在 `## 附录` 之后。
- 章节内可以使用任意 Markdown。
- 资源引用必须使用相对路径。

---

## 6. 资源引用

图片：

```markdown
![红魔馆外观](assets/images/red-mansion-incident/01-exterior.webp)
```

地图：

```markdown
![一楼地图](assets/maps/red-mansion-incident/floor-1.webp)
```

手书：

```markdown
[玩家手书 01](assets/handouts/red-mansion-incident/handout-01.pdf)
```

音频：

```markdown
[背景音乐](assets/audio/red-mansion-incident/theme.mp3)
```

规则：

- 引用路径必须是相对路径。
- 引用文件必须存在于包中。
- 平台导入后会把这些相对路径改写为可访问的资产 URL。
- 外部链接允许，但必须单独标注，且不保证长期可用。

---

## 7. 结构化扩展块

章节内可以使用受控 fenced block，方便后续编辑器读取结构化数据：

````markdown
## 关键NPC

```yaml module-npc
id: marisa
name: 雾雨魔理沙
role:  allies
motivation: 调查异变
secret: 偷偷拿走了书
```
````

已定义块类型：

- `module-chapter`
- `module-npc`
- `module-scene`
- `module-encounter`
- `module-clue`
- `module-item`
- `module-magic`
- `module-ending`
- `module-reward`

导入时这些块不会只停留在 JSON：平台会把它们解析成**只读模板表**
`ChapterTemplate / NpcTemplate / SceneTemplate / EncounterTemplate / ClueTemplate / ItemTemplate / MagicTemplate`。
KP 在房间准备页点击「应用团本预设到房间」时，再从模板克隆出当前房间的
`RoomChapter / Card / Scene + Map / Clue / Encounter / Room 魔法规则`。

### 7.1 结构化块字段

`module-npc`：

```yaml
id: npc-marina
name: 深海祭司
tier: BOSS            # MINION / STANDARD / ELITE / BOSS
rarity: EPIC          # COMMON / UNCOMMON / RARE / EPIC / LEGENDARY
race: null
tags: [MYTHOS]
description: ...
portrait: assets/images/demo-marina/portrait.png
token: assets/images/demo-marina/token.png
attributes: { str: 70, con: 65, siz: 60, dex: 50, app: 30, int: 60, pow: 80, edu: 40, luck: 35 }
skills: { DODGE: 40, FIGHTING_BRAWL: 55, OCCULT: 60 }
maxHp: 35
maxMp: 15
maxSan: 0
maxDp: 0
isPublic: false
```

`module-item`：

```yaml
id: item-dagger
name: 祭祀匕首
itemType: WEAPON      # WEAPON / ITEM / TOME / ARTIFACT / EVIDENCE
description: ...
rarity: RARE
quantity: 1
image: assets/images/demo-dagger.png
damage: 1d6
range: MELEE          # MELEE / NEAR / FAR
skillId: FIGHTING_BRAWL
accuracyMod: 0
effect: 可选
```

`module-clue`：

```yaml
id: clue-footprint
title: 湿漉漉的脚印
content: ...
image: assets/handouts/footprint.png
isPublic: false
linkedItemId: item-dagger
```

`module-scene`：

```yaml
id: scene-hall
name: 审判庭
description: ...
narration: ...
background: assets/maps/hall.png
width: 1600
height: 1000
gridSize: 70
gridType: SQUARE      # SQUARE / HEX / NONE
bgColor: "#111827"
showGrid: true
showFog: true
layers:
  - name: 地板
    type: TILE
    image: assets/maps/floor.png
    zIndex: 1
tokens:
  - npcId: npc-marina
    x: 800
    y: 500
```

`module-encounter`：

```yaml
id: enc-cellar
title: 地下室遭遇
chapterId: chapter-1
sceneId: scene-cellar
trigger: 打开暗门后
npcs: [npc-marina]
items: [item-dagger]
```

`module-magic`：

```yaml
id: spell-banish
name: 驱逐深潜者
skill: OCCULT         # COC7 默认 OCCULT，东方默认 MAGIC
mpCost: "3"
sanCost: "1d3"
damage: "1d6"
target: ONE           # SELF / ONE / ALL
description: ...
```

缺少可选字段时平台使用默认值；`module-ending` / `module-reward` 目前作为结局与奖励的只读结构化数据保存。
第一版仍允许只有普通 Markdown 正文，但那样不会生成任何卡 / 场景 / 线索模板。

---

## 8. 人物资源

`characters/` 目录可选，用于放置团本配套角色素材。

支持：

- `characters/npcs.yaml`
- `characters/pcs/` 下的角色卡文件
- `characters/` 下的图片与附件

导入行为：

- `characters/npcs.yaml` 会被解析为 `NpcTemplate`（只读）。
- 其余 `characters/` 文件作为团本附件保存。
- 不自动创建房间成员。
- 角色 / PC 不自动通过审核；玩家角色仍走 xlsx 导入与入房审核流程。
- KP 在准备页应用团本预设后，`NpcTemplate` 才会克隆成房间 `Card(type=NPC)`。

---

## 9. 最小示例

```
example-module.zip
  module.md
  assets/
    images/
      example-module/
        cover.webp
```

`module.md`：

```markdown
---
spec: touhou-module/v1
id: example-module
title: 示例团本
system: COC7
era: MODERN
author: AI
version: 1.0.0
summary: 一个用于验证导入的最小团本。
---

## 元信息

- 系统：COC7
- 年代：现代

## 真相与背景

无。

## 剧情梗概

无。

## 开场钩子

无。

## 关键NPC

无。

## 地点与场景

无。

## 线索

无。

## 遭遇与战斗

无。

## 道具与手书

无。

## 怪物与神话生物

无。

## 结局分支

无。

## 奖励与成长

无。

## KP备注

无。

## 附录

![封面](assets/images/example-module/cover.webp)
```

---

## 10. AI 转换非标团本的步骤

AI 把旧团本转换为标准格式时，按以下顺序执行：

1. 读取原团本：docx / pdf / txt / md / 网页 / 图片。
2. 提取元信息：标题、作者、系统、年代、版本、简介、人数、时长、警告。
3. 建立资源目录：
   - 所有图片放入 `assets/images/<slug>/`。
   - 所有地图放入 `assets/maps/<slug>/`。
   - 所有 handout 放入 `assets/handouts/<slug>/`。
   - 所有音频 / 视频放入对应目录。
4. 按标准 14 章节重排内容。
5. 把原文中的图片 / 附件移动到资源目录，并改为相对路径。
6. 检查每个引用都有对应文件。
7. 输出 `module.md` 与资源包。
8. 自查：
   - Front Matter 字段齐全。
   - 14 个标准 H2 都存在。
   - 没有绝对路径。
   - 没有 `..`。
   - 没有不合规路径字符。
   - 没有缺失资源。
   - 所有图片有 alt 文本。

---

## 11. 导入校验报告

平台导入后生成报告：

- 元信息错误。
- 缺失章节。
- 缺失资源。
- 路径改写记录。
- 文件体积警告。
- 不支持的扩展名。
- 结构化块解析错误。

错误分为：

- `ERROR`：阻止导入。
- `WARNING`：允许导入，但需要 KP 确认。
- `INFO`：路径改写、大小提示等。

---

## 12. 编辑与保存

- KP 可以在团本管理页编辑 `module.md` 正文。
- 保存时重新校验 Front Matter 与 14 个章节。
- 保存时重新扫描资源引用。
- 新资源通过上传按钮加入 `assets/`。
- 保存不会自动重置已经开始的局。
- 如果新版本删除了当前局正在使用的资源，提示 KP 并保留旧资源直到本局结束。
- 每次保存版本号按语义化规则递增。

---

## 13. 兼容规则

- 缺少可选字段时使用默认值。
- 旧版本包自动升级到 `touhou-module/v1`。
- 未知 Front Matter 字段保留到 `Module.metadata`。
- 未知结构化块保留原文，不阻止导入。


## 14. 模板与房间实例

- 模板层（只读，无 `roomId`）：
  - `ChapterTemplate` / `NpcTemplate` / `SceneTemplate`
  - `EncounterTemplate` / `ClueTemplate` / `ItemTemplate` / `MagicTemplate`
- 房间实例层（可编辑，有 `roomId`）：
  - `RoomChapter` / `Card` / `Scene + Map + MapLayer` / `Clue` / `Encounter`
  - `Room.ruleOverride.magic`（由 `MagicTemplate` 生成）
- 克隆入口：房间准备页「应用团本预设到房间」。
- 切换团本预设时，本房间上一次预设生成的对象整批替换；玩家手动创建的对象不受影响。
- 底层图片 / 音频 Asset 仍然共享引用，不随房间复制。
