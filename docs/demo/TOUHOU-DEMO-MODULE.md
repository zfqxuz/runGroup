---
spec: touhou-module/v1
id: touhou-demo-false-moon
title: 迷途竹林的假月
system: TOUHOU
era: FANTASY
author: bdmin
version: 1.0.0
summary: 幻想乡的竹林里升起了一轮只在满月夜出现的假月。调查异变、收集线索，并在假月祭坛前决定要守护谁的真实。
background: |
  幻想乡进入夏末，迷途竹林连续三晚被不属于这个季节的月光照亮。
  人类村落里开始出现“月亮掉进竹林”的传言，连永远亭的兔子都变得躁动不安。
  博丽灵梦委托路过的主角们进入竹林调查：是谁在制造假月，又为什么要把所有人引到竹林深处？
occupationRecommendation: |
  推荐技能：侦查、聆听、图书馆使用、交涉-通用、幻想知识、闪避、战斗-弹幕。
  推荐身份：巫女、魔法使、妖怪、半妖、人类村落调查员。
---

## 元信息

- **人数**：1 KP + 2~4 名玩家
- **时长**：2~3 小时
- **风格**：轻调查 + 一场 Boss 战 + 一个温柔的选择
- **系统**：Touhou-COC7 或 Touhou-DP 均可，结构块中的 NPC 使用东方技能表。
- **内容警告**：不存在。

## 真相与背景

异变的真相与永远亭的月兔实验有关：一只失败的月兔妖精偷走了「月之碎片」，想用它在竹林里造出一轮永远不会消失的满月。她并不知道碎片会吸引月之都的注意，也不知道假月正在慢慢吞噬竹林里的妖怪。

幕后并不存在真正的反派。假月兽是月之碎片溢出的力量形成的守护者，它只是在阻止任何人靠近碎片。玩家可以选择：

1. 破坏碎片，让假月消失；
2. 带走碎片，交给永远亭处理；
3. 说服月兔妖精亲手归还碎片。

## 剧情梗概

1. **开场**：博丽灵梦在神社发布委托，玩家得到一张被月光照亮的竹林地图。
2. **调查**：进入迷途竹林，发现发光的竹叶、月兔脚印与一块带温度的月之碎片。
3. **接触**：遇见月兔妖精，她否认一切，但她的篮子底下有碎片粉末。
4. **深入**：假月祭坛出现，假月兽从月光中现身。
5. **结局**：战斗或说服；碎片被破坏、归还或带走，竹林恢复正常的夜色。

```yaml module-chapter
id: chapter-invitation
title: 第一节 竹林的邀请
summary: 接受灵梦的委托，进入迷途竹林，发现发光的竹节与月兔妖精的踪迹。
orderIndex: 0
```

```yaml module-chapter
id: chapter-false-moon
title: 第二节 假月
summary: 追踪铃进入竹林深处，假月祭坛出现，假月兽从月光中现身。
orderIndex: 1
```

```yaml module-chapter
id: chapter-truth
title: 第三节 月之碎片
summary: 在战斗、说服与归还之间做出选择，让竹林恢复正常的夜色。
orderIndex: 2
```

## 开场钩子

深夜的博丽神社，赛钱箱旁边摆着一封没有署名的信：

> “竹林里的月亮不会落下。再这样下去，迷路的人都会变成月亮的影子。”

灵梦把信推给主角们：“总之，先去竹林看看。别又被卷进什么麻烦里。”

## 关键NPC

```yaml module-npc
id: npc-mokou
name: 藤原妹红
subtitle: 竹林的不死鸟
tier: ELITE
rarity: RARE
race: null
tags: [ALLY, BOSS]
description: 在竹林深处巡逻的蓬莱人。她讨厌麻烦，但更讨厌有人把竹林烧掉。
attributes: { str: 70, con: 75, siz: 60, dex: 65, app: 50, int: 55, pow: 70, edu: 45, luck: 45 }
skills: { DODGE: 45, MELEE: 70, DANMAKU: 65, SPOT_HIDDEN: 45, GENSOU_LORE: 40, RESIST: 35 }
maxHp: 18
maxMp: 160
maxSan: 60
maxDp: 120
isPublic: true
```

```yaml module-npc
id: npc-moon-fairy
name: 月兔妖精·铃
subtitle: 任性的假月制造者
tier: STANDARD
rarity: UNCOMMON
race: null
tags: [NPC, FAIRY]
description: 一只从永远亭偷偷跑出来的月兔妖精。她想让大家永远记住她做的满月。
attributes: { str: 25, con: 35, siz: 30, dex: 80, app: 60, int: 45, pow: 55, edu: 20, luck: 55 }
skills: { DODGE: 50, DANMAKU: 60, STEALTH: 55, FLIGHT: 70, GENSOU_LORE: 20 }
maxHp: 8
maxMp: 140
maxSan: 40
maxDp: 90
isPublic: false
spellcards:
  - cardId: npc-moon-fairy-sc-spell
    name: 月符「静默之月」
    stats:
      mode: CONSUMPTION
      danmaku: 月光化作无声的弹幕，从假月方向倾泻而下。
      mpCost: 5
      hpRatio: null
      durationTicks: null
      clearTargets: null
      enhanceType: SPELL
      enhanceValue: 1
      effects:
        - type: DAMAGE
          amount: 2d6
      targeting: ENEMY
      targetScope: ONE
      combat:
        mode: SPELL
        skillId: DANMAKU
        activationTarget: 15
        resistAttribute: pow
```

```yaml module-npc
id: npc-false-moon
name: 假月兽
subtitle: 月之碎片的守护者
tier: BOSS
rarity: EPIC
race: null
tags: [MONSTER, MOON]
description: 由月之碎片溢出的力量形成，外形像一只披着月光的巨狼。它没有恶意，只是在阻止碎片被带走。
attributes: { str: 65, con: 70, siz: 65, dex: 55, app: 5, int: 30, pow: 80, edu: 5, luck: 40 }
skills: { DODGE: 35, MELEE: 65, DANMAKU: 70, RESIST: 45 }
weapons:
  - name: 月光利爪
    damage: 1d8+db
    range: MELEE
    skillId: MELEE
    notes: 命中后目标灵光被暂时压制。
maxHp: 22
maxMp: 200
maxSan: 0
maxDp: 150
isPublic: true
spellcards:
  - cardId: npc-false-moon-sc-weapon
    name: 月兽符「银牙」
    stats:
      mode: CONSUMPTION
      danmaku: 假月兽挥出一排银色月光獠牙。
      mpCost: 3
      hpRatio: null
      durationTicks: null
      clearTargets: null
      enhanceType: MELEE
      enhanceValue: 1
      effects: []
      targeting: ENEMY
      targetScope: ONE
      combat:
        mode: WEAPON
        skillId: MELEE
        damage: "2d6+db"
        damageType: IMPALING
        range: MELEE
  - cardId: npc-false-moon-sc-armor
    name: 月兽符「守护之月」
    stats:
      mode: DECLARATION
      danmaku: 一层薄薄的月光覆盖在假月兽身上。
      mpCost: 4
      hpRatio: 1
      durationTicks: 60
      clearTargets: ALL
      enhanceType: SPELL
      enhanceValue: 1
      effects: []
      targeting: SELF
      targetScope: SELF
      combat:
        mode: ARMOR
        armorRatio: 1
```

## 地点与场景

```yaml module-scene
id: scene-bamboo
name: 迷途竹林
description: 竹叶间漏下的光不是银色，而是带着不自然的粉紫色。
narration: 你们钻进竹林，空气里有一股淡淡的月见草味。远处的竹子每隔几步就有一圈发光的节疤。
width: 1600
height: 1000
gridType: SQUARE
gridSize: 70
bgColor: "#10231b"
showGrid: true
showFog: true
```

```yaml module-scene
id: scene-shrine
name: 博丽神社
description: 委托开始的地方，夜晚能看到异常明亮的月亮。
narration: 神社的灯火在风里摇晃，赛钱箱旁边还压着那封没有署名的信。
width: 1200
height: 800
gridType: SQUARE
gridSize: 70
bgColor: "#1b1226"
showGrid: true
```

```yaml module-scene
id: scene-moon-altar
name: 假月祭坛
description: 竹林中央的空地，地面刻着粗糙的月相图，假月兽守在中央。
narration: 假月低低地挂在竹梢之间，像一只巨大的眼睛。空地中央，一块发光的碎片悬在半空。
width: 1800
height: 1200
gridType: SQUARE
gridSize: 70
bgColor: "#111827"
showGrid: true
showFog: true
tokens:
  - npcId: npc-false-moon
    x: 900
    y: 600
```

## 线索

```yaml module-clue
id: clue-glowing-bamboo
title: 发光的竹节
content: 竹节上的光有温度，靠近时会让人想起某个已经忘记的满月夜。灵梦说这不是自然现象。
isPublic: true
```

```yaml module-clue
id: clue-fairy-basket
title: 月兔妖精的篮子
content: 篮子底下沾着一层细碎的银色粉末。铃坚持说那是“竹粉”，但她的耳朵在说谎时会抖。
isPublic: false
```

```yaml module-clue
id: clue-moon-fragment
title: 月之碎片
content: 碎片会回应月光，也会吸引附近的妖怪。若把它带离竹林，假月就会失控。
isPublic: false
linkedItemId: item-moon-fragment
```

## 遭遇与战斗

```yaml module-encounter
id: enc-fake-moon
title: 假月祭坛的守护者
chapterId: chapter-false-moon
sceneId: scene-moon-altar
trigger: 玩家试图触碰月之碎片，或说出“把碎片还回去”
npcs: [npc-false-moon]
items: [item-moon-fragment]
```

```yaml module-encounter
id: enc-fairy-talk
title: 与铃的第一次接触
chapterId: chapter-invitation
sceneId: scene-bamboo
trigger: 玩家在竹林里追踪发光竹节
npcs: [npc-moon-fairy]
items: []
```

战斗提示：假月兽不会追击逃出祭坛的角色。玩家把碎片交给铃，或把它打碎，战斗就会结束。

## 道具与手书

```yaml module-item
id: item-moon-fragment
name: 月之碎片
itemType: EVIDENCE
description: 一块温暖到有些烫手的银色碎片。它会在满月下微微脉动。
rarity: EPIC
quantity: 1
```

```yaml module-item
id: item-bamboo-blade
name: 竹叶刀
itemType: WEAPON
description: 妹红用竹叶临时缠成的短刀，轻便但不太耐用。
rarity: UNCOMMON
quantity: 1
damage: 1d6+db
range: MELEE
skillId: MELEE
accuracyMod: 0
```

## 怪物与神话生物

假月兽并非真正的月之都造物，而是月之碎片溢出的力量形成的守护者。它对“归还碎片”的宣言没有敌意，但对“带走碎片”非常敏感。KP 可用以下规则处理：

- 假月兽每轮首次受到伤害时，若攻击者声明“我只是想帮忙”，它本回合不会反击；
- 玩家可以花费一个行动进行一次交涉-通用或幻想知识检定，成功则让假月兽停止攻击一轮；
- 碎片被破坏或归还后，假月兽立刻消散。

## 结局分支

- **破坏碎片**：假月炸成一地银色光点，竹林恢复黑暗。铃会哭，但永远亭会派人来处理后事。
- **归还永远亭**：妹红带路，铃跟着去道歉。竹林恢复，主角们得到永远亭的谢礼。
- **说服铃自己归还**：最佳结局。铃学会为自己的任性负责，假月兽安静消散。
- **带走碎片**：假月会跟着主角离开，竹林暂时安静，但永远亭会派人追查碎片的去向。

## 奖励与成长

- 完成调查：全体成长检定 +1 次。
- 说服铃：额外获得「月之碎片研究笔记」，可学习一个与月光有关的法术或获得 +5 幻想知识成长。
- 击败假月兽但未伤害铃：获得妹红的认可，竹林巡逻路线解锁。

## KP备注

- 本团本适合教学：第一幕几乎没有战斗，第二幕让玩家自己决定是否先谈。
- 如果玩家完全不调查直接冲向祭坛，假月兽会更强：给它 +20 DP 或 +2 先攻。
- 铃不是坏人。尽量让她的动机在对话里露出至少两次。
- 月之碎片可以是道具、线索，也可以是谈判筹码；不要在玩家做出选择前给出唯一的“正确答案”。

## 附录

### 快速开团

1. 把本文件作为标准团本导入。
2. 在房间准备页选择本团本并点击「应用团本预设到房间」。
3. 玩家创建或导入角色，KP 通过审核。
4. 应用预设后，房间会生成：1 个章节、3 个场景、3 个 NPC、2 个道具、3 条线索、2 场遭遇。

### YAML 块速查

- `module-chapter`：章节
- `module-npc`：NPC / Boss
- `module-scene`：场景
- `module-clue`：线索
- `module-item`：道具 / 武器 / 证物
- `module-encounter`：遭遇
- `module-magic`：魔法（本 Demo 未使用）

### 版权

本 Demo 为原创示例，仅用于演示 Touhou-COC7 / Touhou-DP 团本格式与预设应用流程。
