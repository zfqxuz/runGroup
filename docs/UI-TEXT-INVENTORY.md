# 用户可见文案清单（UI Text Inventory）

用途：在「你的修改」列里填新文案，回给开发即可。ID 规则：`文件名-序号`。

- 抽取范围：`apps/web/src/app`、`apps/web/src/components`、`apps/web/src/shared` 里的中文文案、按钮、标签、placeholder、提示语等。
- 自动抽取可能包含少量注释/变量名，可直接忽略。

## 本轮修订说明（建议文案见「你的修改」列）

- 未填写 = 建议保留原文。
- `删除` = 建议从页面移除该文案或片段（实现注释、代码拼接残片、重复/无关说明）。
- 改写原则：
  1. 页面上不出现数据库、服务端、环境变量、字段名、状态枚举、JSON 结构、解析链路、容器、部署等实现术语。
  2. 说明文字只回答「用户能做什么 / 会发生什么」，尽量一句话讲清；不复述底层原理，不重复已经由按钮或标题表达的意思。
  3. 规则数值与文件格式（如 1d100、96–100、xlsx、.md）属于玩法或操作必需信息，保留。
- 部分界面必须填写技术标识（技能 ID、JSON 数组、状态 JSON）才能真正工作。本轮文案先隐藏了技术称谓，但要彻底不露技术细节，需要开发把输入项改成选择器或可视化编辑器；相关位置见文末「清单外风险」。
- 你之前已在「你的修改」列手填的 3 条（`app-admin-magic-roomid-page-tsx-3/5/6`）已按原样保留。
- 含 `searchParams` 或变量名的行多为自动抽取残片：`删除` 表示建议把所在整句一起简化，而不是只删片段；见文末「清单外风险」。


## `app/(auth)/login/page.tsx`

| ID | 原文 | 你的修改                          |
|---|---|-------------------------------|
| `app-auth-login-page-tsx-1` | 登录 |                               |
| `app-auth-login-page-tsx-2` | 东方 TRPG 线上跑团平台 | |
| `app-auth-login-page-tsx-3` | 用户名 |                               |
| `app-auth-login-page-tsx-4` | 密码 |                               |
| `app-auth-login-page-tsx-5` | 还没有账号？ |                               |
| `app-auth-login-page-tsx-6` | 注册 |                               |
| `app-auth-login-page-tsx-7` | 用户名或密码不正确 |                               |
| `app-auth-login-page-tsx-8` | 登录中… |                               |

## `app/(auth)/register/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-auth-register-page-tsx-1` | 注册 |  |
| `app-auth-register-page-tsx-2` | 创建一个账号，开始跑团 |  |
| `app-auth-register-page-tsx-3` | 用户名（登录用，字母数字下划线连字符） | 用户名（3-32 位，仅字母、数字、_、-） |
| `app-auth-register-page-tsx-4` | 显示名（可留空） |  |
| `app-auth-register-page-tsx-5` | 密码（至少 8 位） |  |
| `app-auth-register-page-tsx-6` | 已有账号？ |  |
| `app-auth-register-page-tsx-7` | 去登录 |  |
| `app-auth-register-page-tsx-8` | 注册失败 |  |
| `app-auth-register-page-tsx-9` | 注册成功，但自动登录失败，请手动登录 | 注册成功，请登录。 |
| `app-auth-register-page-tsx-10` | 注册中… |  |
| `app-auth-register-page-tsx-11` | 注册并登录 |  |

## `app/admin/audit/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-audit-page-tsx-1` | ← 管理后台 |  |
| `app-admin-audit-page-tsx-2` | 审计日志 |  |
| `app-admin-audit-page-tsx-3` | 时间 |  |
| `app-admin-audit-page-tsx-4` | 操作人 |  |
| `app-admin-audit-page-tsx-5` | 动作 |  |
| `app-admin-audit-page-tsx-6` | 目标 |  |
| `app-admin-audit-page-tsx-7` | 详情 |  |

## `app/admin/games/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-games-page-tsx-1` | ← 管理后台 |  |
| `app-admin-games-page-tsx-2` | 游戏局 |  |
| `app-admin-games-page-tsx-3` | 房间 |  |
| `app-admin-games-page-tsx-4` | 团本 |  |
| `app-admin-games-page-tsx-5` | 状态 |  |
| `app-admin-games-page-tsx-6` | 创建 / 结束 |  |
| `app-admin-games-page-tsx-7` | 准备中 |  |
| `app-admin-games-page-tsx-8` | 进行中 |  |
| `app-admin-games-page-tsx-9` | 已暂停 |  |
| `app-admin-games-page-tsx-10` | 战斗中 |  |
| `app-admin-games-page-tsx-11` | 已结束 |  |
| `app-admin-games-page-tsx-12` | 无团本 |  |
| `app-admin-games-page-tsx-13` | 未结束 |  |

## `app/admin/layout.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-layout-tsx-1` | 管理后台 |  |
| `app-admin-layout-tsx-2` | ← 返回前台 |  |
| `app-admin-layout-tsx-3` | 返回前台 |  |
| `app-admin-layout-tsx-4` | 总览 |  |
| `app-admin-layout-tsx-5` | 用户 |  |
| `app-admin-layout-tsx-6` | 房间 |  |
| `app-admin-layout-tsx-7` | 团本 |  |
| `app-admin-layout-tsx-8` | 游戏局 |  |
| `app-admin-layout-tsx-9` | 规则包 |  |
| `app-admin-layout-tsx-10` | 魔法 |  |
| `app-admin-layout-tsx-11` | 系统设置 |  |
| `app-admin-layout-tsx-12` | 审计日志 |  |

## `app/admin/magic/[roomId]/page.tsx`

| ID | 原文 | 你的修改            |
|---|---|-----------------|
| `app-admin-magic-roomid-page-tsx-1` | ← 魔法管理 |                 |
| `app-admin-magic-roomid-page-tsx-2` | 1. 房间开关 |                 |
| `app-admin-magic-roomid-page-tsx-3` | 控制是否把团本 structured.magic 合并进 Room.ruleOverride。关闭后最终规则包不会带团本魔法。 | 关闭后最终规则包不会带团本魔法。 |
| `app-admin-magic-roomid-page-tsx-4` | 去准备页 → |                 |
| `app-admin-magic-roomid-page-tsx-5` | 2. 团本 structured.magic | 2. 团本特有魔法 |
| `app-admin-magic-roomid-page-tsx-6` | 模板/导出的团本里如果有 spells 数据，会在这里显示；没有则说明导入时没有生成结构化魔法。 | 团本导入时生成的魔法表达式。 |
| `app-admin-magic-roomid-page-tsx-7` | 从团本重新同步 |                 |
| `app-admin-magic-roomid-page-tsx-8` | 查看团本管理 → |                 |
| `app-admin-magic-roomid-page-tsx-9` | 由「启用魔法规则 / 从团本同步」写入；如果 enabled=false，它会覆盖绑定规则包里的魔法配置。 | 删除 |
| `app-admin-magic-roomid-page-tsx-10` | 4. 最终生效规则包 |                 |
| `app-admin-magic-roomid-page-tsx-11` | 当前没有生效法术。 | 当前没有生效魔法。 |
| `app-admin-magic-roomid-page-tsx-12` | 名称 |                 |
| `app-admin-magic-roomid-page-tsx-13` | 技能 |                 |
| `app-admin-magic-roomid-page-tsx-14` | 目标 |                 |
| `app-admin-magic-roomid-page-tsx-15` | 效果 |                 |
| `app-admin-magic-roomid-page-tsx-16` | Room.ruleOverride 原始 JSON | 原始配置（仅管理员） |
| `app-admin-magic-roomid-page-tsx-17` | 已开启 |                 |
| `app-admin-magic-roomid-page-tsx-18` | 未开启 |                 |
| `app-admin-magic-roomid-page-tsx-19` | （同步 |                 |
| `app-admin-magic-roomid-page-tsx-20` | 条法术） |                 |
| `app-admin-magic-roomid-page-tsx-21` | 关闭房间魔法 |                 |
| `app-admin-magic-roomid-page-tsx-22` | 开启房间魔法 |                 |
| `app-admin-magic-roomid-page-tsx-23` | 未选择团本 |                 |
| `app-admin-magic-roomid-page-tsx-24` | · 没有 structured.magic | · 团本无魔法数据 |
| `app-admin-magic-roomid-page-tsx-25` | 无直接效果 |                 |

## `app/admin/magic/effects/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-magic-effects-page-tsx-1` | ← 魔法管理 |  |
| `app-admin-magic-effects-page-tsx-2` | 魔法效果目录 |  |
| `app-admin-magic-effects-page-tsx-3` | 这里是底层可枚举的基础能力。单个法术 = 从下面任选若干效果，按顺序组合成 | 法术由若干基础效果组合而成。 |
| `app-admin-magic-effects-page-tsx-4` | 数组。 | 删除 |
| `app-admin-magic-effects-page-tsx-5` | 组合示例 |  |
| `app-admin-magic-effects-page-tsx-6` | 下面一条法术同时具有「伤害 + 眩晕 + 护甲」，战斗引擎会按数组顺序依次结算。 | 示例：伤害 + 眩晕 + 护甲，按顺序结算。 |
| `app-admin-magic-effects-page-tsx-7` | 示例组合法术 |  |
| `app-admin-magic-effects-page-tsx-8` | （必填） |  |
| `app-admin-magic-effects-page-tsx-9` | （可选） |  |
| `app-admin-magic-effects-page-tsx-10` | · 默认 |  |

## `app/admin/magic/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-magic-page-tsx-1` | ← 管理后台 |  |
| `app-admin-magic-page-tsx-2` | 魔法管理 |  |
| `app-admin-magic-page-tsx-3` | 查看每个房间的魔法配置链路：房间开关 → 团本 structured.magic → Room.ruleOverride → 最终生效规则包。 | 查看各房间的魔法开关与生效情况。 |
| `app-admin-magic-page-tsx-4` | 查看支持的基础魔法效果 → |  |
| `app-admin-magic-page-tsx-5` | 已开启魔法开关的房间 |  |
| `app-admin-magic-page-tsx-6` | 团本中解析出魔法的房间 |  |
| `app-admin-magic-page-tsx-7` | selected module structured.magic 非空 | 已选团本含魔法数据 |
| `app-admin-magic-page-tsx-8` | 开关 + 有法术数据 | 开关开启且团本有魔法 |
| `app-admin-magic-page-tsx-9` | 还需要规则包版本 / 冲突检查确认最终生效 | 待规则包确认 |
| `app-admin-magic-page-tsx-10` | 房间 |  |
| `app-admin-magic-page-tsx-11` | 魔法开关 |  |
| `app-admin-magic-page-tsx-12` | 选中团本 |  |
| `app-admin-magic-page-tsx-13` | 团本魔法 |  |
| `app-admin-magic-page-tsx-14` | 绑定规则包 |  |
| `app-admin-magic-page-tsx-15` | 操作 |  |
| `app-admin-magic-page-tsx-16` | 还没有房间。 |  |
| `app-admin-magic-page-tsx-17` | 已开启 |  |
| `app-admin-magic-page-tsx-18` | 未开启 |  |
| `app-admin-magic-page-tsx-19` | 查看链路 | 查看详情 |
| `app-admin-magic-page-tsx-20` | 内置 / 未绑定 | 内置包 / 未绑定 |
| `app-admin-magic-page-tsx-21` | 未选择 |  |
| `app-admin-magic-page-tsx-22` | 启用 |  |
| `app-admin-magic-page-tsx-23` | 关闭 |  |

## `app/admin/modules/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-modules-page-tsx-1` | ← 管理后台 |  |
| `app-admin-modules-page-tsx-2` | 团本管理 |  |
| `app-admin-modules-page-tsx-3` | 搜索 |  |
| `app-admin-modules-page-tsx-4` | 团本 |  |
| `app-admin-modules-page-tsx-5` | 归属 |  |
| `app-admin-modules-page-tsx-6` | 数据 |  |
| `app-admin-modules-page-tsx-7` | 发布 |  |
| `app-admin-modules-page-tsx-8` | 操作 |  |
| `app-admin-modules-page-tsx-9` | 已发布 |  |
| `app-admin-modules-page-tsx-10` | 未发布 |  |
| `app-admin-modules-page-tsx-11` | 删除 |  |
| `app-admin-modules-page-tsx-12` | 按标题搜索 |  |
| `app-admin-modules-page-tsx-13` | 未指定 |  |
| `app-admin-modules-page-tsx-14` | 平台/无主 | 平台 |
| `app-admin-modules-page-tsx-15` | 独立团本 |  |
| `app-admin-modules-page-tsx-16` | 房间： |  |
| `app-admin-modules-page-tsx-17` | 下架 |  |

## `app/admin/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-page-tsx-1` | 管理后台 |  |
| `app-admin-page-tsx-2` | 平台数据、规则包与 AI 导入配置的总控台。 | 管理平台数据与配置。 |
| `app-admin-page-tsx-3` | 最近游戏局 |  |
| `app-admin-page-tsx-4` | 暂无游戏局。 |  |
| `app-admin-page-tsx-5` | 最近管理操作 |  |
| `app-admin-page-tsx-6` | 暂无操作记录。 |  |
| `app-admin-page-tsx-7` | 用户管理 |  |
| `app-admin-page-tsx-8` | 角色、禁用状态与管理员权限 |  |
| `app-admin-page-tsx-9` | 房间管理 |  |
| `app-admin-page-tsx-10` | 房间状态、成员、规则包绑定与删除 |  |
| `app-admin-page-tsx-11` | 团本管理 |  |
| `app-admin-page-tsx-12` | 全站团本发布、下架与删除 |  |
| `app-admin-page-tsx-13` | 规则包管理 |  |
| `app-admin-page-tsx-14` | 创建、版本、发布、绑房与导入导出 | 创建、版本、发布与绑定房间 |
| `app-admin-page-tsx-15` | 魔法管理 |  |
| `app-admin-page-tsx-16` | 逐房间查看魔法链路：开关 / 团本 / 覆盖 / 最终生效 | 查看各房间的魔法开关与生效情况 |
| `app-admin-page-tsx-17` | 游戏局 |  |
| `app-admin-page-tsx-18` | 查看全站开局与结束状态 |  |
| `app-admin-page-tsx-19` | 系统设置 |  |
| `app-admin-page-tsx-20` | DeepSeek 等平台级配置 | AI 导入等平台配置 |
| `app-admin-page-tsx-21` | 审计日志 |  |
| `app-admin-page-tsx-22` | 所有管理员操作留痕 |  |
| `app-admin-page-tsx-23` | 用户 |  |
| `app-admin-page-tsx-24` | 注册账号总数 |  |
| `app-admin-page-tsx-25` | 房间 |  |
| `app-admin-page-tsx-26` | 含已结束 |  |
| `app-admin-page-tsx-27` | 团本 |  |
| `app-admin-page-tsx-28` | 全站团本总数 |  |
| `app-admin-page-tsx-29` | 历史与进行中 |  |
| `app-admin-page-tsx-30` | 规则包 |  |
| `app-admin-page-tsx-31` | DB 管理的规则包 | 可编辑规则包 |
| `app-admin-page-tsx-32` | 审计记录 |  |
| `app-admin-page-tsx-33` | 管理员操作留痕 |  |
| `app-admin-page-tsx-34` | 管理员 |  |

## `app/admin/rooms/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-rooms-page-tsx-1` | ← 管理后台 |  |
| `app-admin-rooms-page-tsx-2` | 房间管理 |  |
| `app-admin-rooms-page-tsx-3` | 房间 |  |
| `app-admin-rooms-page-tsx-4` | KP / 成员 |  |
| `app-admin-rooms-page-tsx-5` | 规则包 |  |
| `app-admin-rooms-page-tsx-6` | 状态 |  |
| `app-admin-rooms-page-tsx-7` | 操作 |  |
| `app-admin-rooms-page-tsx-8` | 改状态 |  |
| `app-admin-rooms-page-tsx-9` | 删除 |  |
| `app-admin-rooms-page-tsx-10` | 准备中 |  |
| `app-admin-rooms-page-tsx-11` | 跑团中 |  |
| `app-admin-rooms-page-tsx-12` | 已暂停 |  |
| `app-admin-rooms-page-tsx-13` | 战斗中 |  |
| `app-admin-rooms-page-tsx-14` | 已结束 |  |
| `app-admin-rooms-page-tsx-15` | 内置默认包 |  |

## `app/admin/rulepacks/[packId]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-rulepacks-packid-page-tsx-1` | ← 规则包列表 |  |
| `app-admin-rulepacks-packid-page-tsx-2` | 导出 JSON | 导出规则包 |
| `app-admin-rulepacks-packid-page-tsx-3` | 归档 |  |
| `app-admin-rulepacks-packid-page-tsx-4` | 发布 |  |
| `app-admin-rulepacks-packid-page-tsx-5` | 删除整个规则包（无绑定时可用） | 删除规则包（未被房间使用时可用） |
| `app-admin-rulepacks-packid-page-tsx-6` | 魔法规则 |  |
| `app-admin-rulepacks-packid-page-tsx-7` | 该版本没有 `magic` / `spells`。房间里的魔法通常来自团本 `structured.magic`， 也可以在下面的完整 RulePack JSON 里加入 `magic` 字段后发布新版本。 | 该版本未配置魔法。魔法通常随团本导入，也可在下方的高级编辑中添加。 |
| `app-admin-rulepacks-packid-page-tsx-8` | 去魔法管理查看房间生效链路 → | 查看房间魔法生效情况 → |
| `app-admin-rulepacks-packid-page-tsx-9` | 名称 |  |
| `app-admin-rulepacks-packid-page-tsx-10` | 技能 |  |
| `app-admin-rulepacks-packid-page-tsx-11` | 目标 |  |
| `app-admin-rulepacks-packid-page-tsx-12` | 效果 |  |
| `app-admin-rulepacks-packid-page-tsx-13` | 新建版本 |  |
| `app-admin-rulepacks-packid-page-tsx-14` | 新版本默认草稿。发布后可在“绑定房间”中选择。 | 新版本为草稿，发布后可绑定房间。 |
| `app-admin-rulepacks-packid-page-tsx-15` | 版本号 |  |
| `app-admin-rulepacks-packid-page-tsx-16` | 备注 |  |
| `app-admin-rulepacks-packid-page-tsx-17` | 规则集配置（表单 / JSON 双模式） | 规则集配置 |
| `app-admin-rulepacks-packid-page-tsx-18` | 保存草稿版本 |  |
| `app-admin-rulepacks-packid-page-tsx-19` | 导入 JSON 版本 | 导入规则包版本 |
| `app-admin-rulepacks-packid-page-tsx-20` | 上传一个完整 RulePack JSON 文件，作为新草稿版本落库。 | 上传规则包文件，创建新的草稿版本。 |
| `app-admin-rulepacks-packid-page-tsx-21` | JSON 文件 | 规则包文件 |
| `app-admin-rulepacks-packid-page-tsx-22` | 导入版本 |  |
| `app-admin-rulepacks-packid-page-tsx-23` | 草稿 |  |
| `app-admin-rulepacks-packid-page-tsx-24` | 已发布 |  |
| `app-admin-rulepacks-packid-page-tsx-25` | 已归档 |  |
| `app-admin-rulepacks-packid-page-tsx-26` | · 内置包 |  |
| `app-admin-rulepacks-packid-page-tsx-27` | · 创建者 |  |
| `app-admin-rulepacks-packid-page-tsx-28` | 未发布 |  |
| `app-admin-rulepacks-packid-page-tsx-29` | 发布于 |  |
| `app-admin-rulepacks-packid-page-tsx-30` | 未指定 |  |
| `app-admin-rulepacks-packid-page-tsx-31` | 无直接效果 |  |

## `app/admin/rulepacks/[packId]/versions/[versionId]/export/route.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-rulepacks-packid-versions-versionid-ex-1` | 未登录 | 请先登录 |
| `app-admin-rulepacks-packid-versions-versionid-ex-2` | 无权访问 |  |
| `app-admin-rulepacks-packid-versions-versionid-ex-3` | 版本不存在 |  |

## `app/admin/rulepacks/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-rulepacks-page-tsx-1` | ← 管理后台 |  |
| `app-admin-rulepacks-page-tsx-2` | 规则包管理 |  |
| `app-admin-rulepacks-page-tsx-3` | P2-2：规则包从代码注册表升级为数据库管理，支持创建、版本、发布、绑房、导入导出与审计。 | 管理规则包、版本、发布与房间绑定。 |
| `app-admin-rulepacks-page-tsx-4` | 同步内置规则包 |  |
| `app-admin-rulepacks-page-tsx-5` | 新建规则包 |  |
| `app-admin-rulepacks-page-tsx-6` | 从内置包复制，或粘贴完整 RulePack JSON。新包默认草稿，需发布版本后才能绑定房间。 | 从内置包复制，或粘贴规则包内容。新包为草稿，发布后可绑定房间。 |
| `app-admin-rulepacks-page-tsx-7` | 名称 |  |
| `app-admin-rulepacks-page-tsx-8` | slug（唯一） | 标识（唯一） |
| `app-admin-rulepacks-page-tsx-9` | 系统 |  |
| `app-admin-rulepacks-page-tsx-10` | 东方扩展 |  |
| `app-admin-rulepacks-page-tsx-11` | 复制内置包（可选） |  |
| `app-admin-rulepacks-page-tsx-12` | 不复制 / 使用下方 JSON | 不复制 / 手动填写 |
| `app-admin-rulepacks-page-tsx-13` | 描述 |  |
| `app-admin-rulepacks-page-tsx-14` | RulePack JSON（可选） | 规则包内容（可选） |
| `app-admin-rulepacks-page-tsx-15` | 创建规则包 |  |
| `app-admin-rulepacks-page-tsx-16` | 绑定房间 |  |
| `app-admin-rulepacks-page-tsx-17` | 把已发布版本绑定到房间，房间后续判定、战斗、成长都使用该版本；留空表示回退内置包。 | 将已发布版本绑定到房间；留空则使用内置包。 |
| `app-admin-rulepacks-page-tsx-18` | 房间 |  |
| `app-admin-rulepacks-page-tsx-19` | 选择房间 |  |
| `app-admin-rulepacks-page-tsx-20` | 已发布版本 |  |
| `app-admin-rulepacks-page-tsx-21` | 解绑 / 使用内置包 | 解绑并使用内置包 |
| `app-admin-rulepacks-page-tsx-22` | 保存绑定 |  |
| `app-admin-rulepacks-page-tsx-23` | 规则包 |  |
| `app-admin-rulepacks-page-tsx-24` | 版本 |  |
| `app-admin-rulepacks-page-tsx-25` | 绑定 |  |
| `app-admin-rulepacks-page-tsx-26` | 发布 |  |
| `app-admin-rulepacks-page-tsx-27` | 操作 |  |
| `app-admin-rulepacks-page-tsx-28` | 还没有数据库规则包，点击右上角“同步内置规则包”开始。 | 还没有规则包，点击右上角「同步内置规则包」开始。 |
| `app-admin-rulepacks-page-tsx-29` | 已发布 |  |
| `app-admin-rulepacks-page-tsx-30` | 未发布 |  |
| `app-admin-rulepacks-page-tsx-31` | 管理 |  |
| `app-admin-rulepacks-page-tsx-32` | 删除 |  |
| `app-admin-rulepacks-page-tsx-33` | · 内置 |  |

## `app/admin/system/page.tsx`

| ID | 原文 | 你的修改                     |
|---|---|--------------------------|
| `app-admin-system-page-tsx-1` | ← 管理后台 |                          |
| `app-admin-system-page-tsx-2` | 系统设置 |                          |
| `app-admin-system-page-tsx-3` | 平台级配置，保存在 SystemSetting 表，AI 团本导入会优先读取这里的值。 | 平台级配置，AI 团本导入时优先使用。      |
| `app-admin-system-page-tsx-4` | 设置已保存。 |                          |
| `app-admin-system-page-tsx-5` | n8n 团本解析工作流 | AI 团本解析服务                |
| `app-admin-system-page-tsx-6` | n8n 容器内部持有 DEEPSEEK_API_KEY，应用不再直接调用模型；n8n 端口默认只绑定 127.0.0.1。 | 删除                       |
| `app-admin-system-page-tsx-7` | DeepSeek 回退接入 | 备用模型接入                   |
| `app-admin-system-page-tsx-8` | 仅当 N8N_MODULE_PARSE_URL 为空时，应用才回退到 DeepSeek 直连。 | 删除                       |
| `app-admin-system-page-tsx-9` | 保存 |                          |
| `app-admin-system-page-tsx-10` | 暂无设置项。 |                          |
| `app-admin-system-page-tsx-11` | DeepSeek 默认模型 | 默认 AI 模型                 |
| `app-admin-system-page-tsx-12` | deepseek-flash 支持图片视觉输入，推荐作为默认模型；deepseek-v4-pro 为文本推理模型。 | 视觉模型支持图片，推荐默认；文本模型仅支持文本。 |
| `app-admin-system-page-tsx-13` | 单次 AI 导入最大文件数 | 单次导入文件上限                 |
| `app-admin-system-page-tsx-14` | JSON 数字，例如 30。 | 填写数字，例如 30。              |
| `app-admin-system-page-tsx-15` | DeepSeek 直连（旧回退路径） | 备用模型直连                   |
| `app-admin-system-page-tsx-16` | 已从环境变量 DEEPSEEK_API_KEY 读取 | 已配置                      |
| `app-admin-system-page-tsx-17` | 未配置（n8n 正常时可不配置） | 未配置（解析服务可用时无需配置）         |

## `app/admin/users/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-admin-users-page-tsx-1` | ← 管理后台 |  |
| `app-admin-users-page-tsx-2` | 用户管理 |  |
| `app-admin-users-page-tsx-3` | 搜索 |  |
| `app-admin-users-page-tsx-4` | 用户 |  |
| `app-admin-users-page-tsx-5` | 角色 |  |
| `app-admin-users-page-tsx-6` | 状态 |  |
| `app-admin-users-page-tsx-7` | 数据 |  |
| `app-admin-users-page-tsx-8` | 最近登录 |  |
| `app-admin-users-page-tsx-9` | 操作 |  |
| `app-admin-users-page-tsx-10` | 管理员 |  |
| `app-admin-users-page-tsx-11` | 普通用户 |  |
| `app-admin-users-page-tsx-12` | 已禁用 |  |
| `app-admin-users-page-tsx-13` | 正常 |  |
| `app-admin-users-page-tsx-14` | 用户名 / 昵称 / 邮箱 |  |
| `app-admin-users-page-tsx-15` | 从未 |  |
| `app-admin-users-page-tsx-16` | 降为用户 |  |
| `app-admin-users-page-tsx-17` | 设为管理员 |  |
| `app-admin-users-page-tsx-18` | 解除禁用 |  |
| `app-admin-users-page-tsx-19` | 禁用 |  |

## `app/api/modules/[moduleId]/assets/route.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-api-modules-moduleid-assets-route-ts-1` | 未登录 | 请先登录 |
| `app-api-modules-moduleid-assets-route-ts-2` | 请求格式不合法 | 提交内容有误 |
| `app-api-modules-moduleid-assets-route-ts-3` | 团本不存在 |  |
| `app-api-modules-moduleid-assets-route-ts-4` | 只有团本作者或本房 KP 可以上传资源 |  |
| `app-api-modules-moduleid-assets-route-ts-5` | 请选择上传文件 |  |
| `app-api-modules-moduleid-assets-route-ts-6` | 不支持的文件格式 |  |
| `app-api-modules-moduleid-assets-route-ts-7` | 资源超过 20MB 上限 | 文件不能超过 20MB |
| `app-api-modules-moduleid-assets-route-ts-8` | 资源不存在 |  |
| `app-api-modules-moduleid-assets-route-ts-9` | 只有团本作者或本房 KP 可以替换资源 |  |
| `app-api-modules-moduleid-assets-route-ts-10` | 资源上传失败 |  |
| `app-api-modules-moduleid-assets-route-ts-11` | 只有本房 KP 可以删除团本资源 |  |
| `app-api-modules-moduleid-assets-route-ts-12` | 只有团本作者可以删除资源 |  |

## `app/api/modules/ai-import/route.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-api-modules-ai-import-route-ts-1` | 未登录 | 请先登录 |
| `app-api-modules-ai-import-route-ts-2` | 未配置 n8n 团本解析工作流（N8N_MODULE_PARSE_URL），也没有配置 DEEPSEEK_API_KEY；管理员请在部署环境中配置后重启服务 | AI 导入服务暂不可用，请联系管理员。 |
| `app-api-modules-ai-import-route-ts-3` | 请求格式不合法 | 提交内容有误 |
| `app-api-modules-ai-import-route-ts-4` | 只有本房 KP 可以导入房间团本 |  |
| `app-api-modules-ai-import-route-ts-5` | 请至少上传一个素材文件 |  |
| `app-api-modules-ai-import-route-ts-6` | 单次最多上传 |  |
| `app-api-modules-ai-import-route-ts-7` | 个文件 |  |
| `app-api-modules-ai-import-route-ts-8` | 单次上传总大小不能超过 150MB |  |
| `app-api-modules-ai-import-route-ts-9` | 未知错误 | 操作失败，请稍后重试 |
| `app-api-modules-ai-import-route-ts-10` | 任务已创建，正在解析素材… |  |
| `app-api-modules-ai-import-route-ts-11` | 缺少 jobId | 任务信息不完整 |
| `app-api-modules-ai-import-route-ts-12` | 任务不存在或已过期，请重新发起 |  |
| `app-api-modules-ai-import-route-ts-13` | AI 整合失败 |  |

## `app/api/modules/import/route.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-api-modules-import-route-ts-1` | 未登录 | 请先登录 |
| `app-api-modules-import-route-ts-2` | 请求格式不合法 | 提交内容有误 |
| `app-api-modules-import-route-ts-3` | 只有本房 KP 可以导入房间团本 |  |
| `app-api-modules-import-route-ts-4` | 请选择 .md 或 .zip 文件 |  |
| `app-api-modules-import-route-ts-5` | 只支持 .md 或 .zip |  |
| `app-api-modules-import-route-ts-6` | zip 超过 50MB 上限 |  |
| `app-api-modules-import-route-ts-7` | 团本格式校验失败 |  |
| `app-api-modules-import-route-ts-8` | 资源超过 20MB： |  |
| `app-api-modules-import-route-ts-9` | 资源处理失败 |  |
| `app-api-modules-import-route-ts-10` | 模板解析失败 |  |
| `app-api-modules-import-route-ts-11` | 模板解析： |  |

## `app/api/register/route.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-api-register-route-ts-1` | 用户名至少 3 个字符 |  |
| `app-api-register-route-ts-2` | 用户名最多 32 个字符 |  |
| `app-api-register-route-ts-3` | 只能包含字母、数字、下划线和连字符 |  |
| `app-api-register-route-ts-4` | 密码至少 8 位 |  |
| `app-api-register-route-ts-5` | 密码最多 72 位 |  |
| `app-api-register-route-ts-6` | 参数不合法 | 提交内容有误 |
| `app-api-register-route-ts-7` | 用户名已被占用 |  |

## `app/api/upload/route.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-api-upload-route-ts-1` | 未登录 | 请先登录 |
| `app-api-upload-route-ts-2` | 请求格式不合法 | 提交内容有误 |
| `app-api-upload-route-ts-3` | 没有收到文件 |  |
| `app-api-upload-route-ts-4` | 不支持的上传用途 |  |
| `app-api-upload-route-ts-5` | 文件超过 |  |
| `app-api-upload-route-ts-6` | 处理失败 |  |

## `app/cards/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-cards-page-tsx-1` | ← 返回房间列表 |  |
| `app-cards-page-tsx-2` | 我的卡牌库 |  |
| `app-cards-page-tsx-3` | 卡属于你自己，可带进任意房间（需 KP 审核）；也可以共享为模板供其他用户复制 | 卡牌属于你自己，可带进任意房间（需 KP 审核），也可共享为模板。 |
| `app-cards-page-tsx-4` | 新建 COC7 卡 |  |
| `app-cards-page-tsx-5` | 新建东方卡 |  |
| `app-cards-page-tsx-6` | 还没有卡牌 |  |
| `app-cards-page-tsx-7` | 共享模板 |  |
| `app-cards-page-tsx-8` | 编辑 |  |
| `app-cards-page-tsx-9` | 删除 |  |
| `app-cards-page-tsx-10` | 其他用户共享的模板卡；复制后进入你的卡库 | 其他玩家共享的模板，复制后进入你的卡库。 |
| `app-cards-page-tsx-11` | 还没有可复制的共享模板 |  |
| `app-cards-page-tsx-12` | 已复制到我的卡库 |  |
| `app-cards-page-tsx-13` | 复制到我的卡库 |  |
| `app-cards-page-tsx-14` | 库中 |  |
| `app-cards-page-tsx-15` | 已装备给 |  |
| `app-cards-page-tsx-16` | · 已带入 |  |
| `app-cards-page-tsx-17` | 个房间 |  |
| `app-cards-page-tsx-18` | 上传卡面 |  |
| `app-cards-page-tsx-19` | 取消共享 |  |
| `app-cards-page-tsx-20` | 共享为模板 |  |
| `app-cards-page-tsx-21` | 转为道具 |  |
| `app-cards-page-tsx-22` | 转为武器 |  |
| `app-cards-page-tsx-23` | 未知 |  |

## `app/characters/[id]/edit/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-characters-id-edit-page-tsx-1` | ← 返回 |  |
| `app-characters-id-edit-page-tsx-2` | 第一页必填，第二页选填。 |  |

## `app/characters/[id]/growth/export/route.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-characters-id-growth-export-route-ts-1` | 属性 |  |
| `app-characters-id-growth-export-route-ts-2` | 技能 |  |
| `app-characters-id-growth-export-route-ts-3` | 物品 |  |
| `app-characters-id-growth-export-route-ts-4` | 关系 |  |
| `app-characters-id-growth-export-route-ts-5` | 其他 |  |
| `app-characters-id-growth-export-route-ts-6` | 力量 |  |
| `app-characters-id-growth-export-route-ts-7` | 体质 |  |
| `app-characters-id-growth-export-route-ts-8` | 体型 |  |
| `app-characters-id-growth-export-route-ts-9` | 敏捷 |  |
| `app-characters-id-growth-export-route-ts-10` | 外貌 |  |
| `app-characters-id-growth-export-route-ts-11` | 智力 |  |
| `app-characters-id-growth-export-route-ts-12` | 意志 |  |
| `app-characters-id-growth-export-route-ts-13` | 教育 |  |
| `app-characters-id-growth-export-route-ts-14` | 幸运 |  |

## `app/characters/[id]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-characters-id-page-tsx-1` | ← 返回角色库 |  |
| `app-characters-id-page-tsx-2` | 立绘与头像 |  |
| `app-characters-id-page-tsx-3` | 装备与物品 |  |
| `app-characters-id-page-tsx-4` | 这张卡没有武器或随身物品记录。 | 暂无武器或随身物品。 |
| `app-characters-id-page-tsx-5` | 武器 |  |
| `app-characters-id-page-tsx-6` | 随身物品 |  |
| `app-characters-id-page-tsx-7` | 资产 |  |
| `app-characters-id-page-tsx-8` | 属性 |  |
| `app-characters-id-page-tsx-9` | 未分配技能 |  |
| `app-characters-id-page-tsx-10` | 可按类型、来源与局筛选；属性 / 技能 / SAN 记录支持编辑或撤销，撤销后不再计入成长汇总。 | 记录支持编辑或撤销，撤销后不计入成长汇总。 |
| `app-characters-id-page-tsx-11` | 导出 CSV（当前筛选） |  |
| `app-characters-id-page-tsx-12` | 类型 |  |
| `app-characters-id-page-tsx-13` | 全部 |  |
| `app-characters-id-page-tsx-14` | 来源 |  |
| `app-characters-id-page-tsx-15` | 来源局 |  |
| `app-characters-id-page-tsx-16` | 手动 / 无来源局 |  |
| `app-characters-id-page-tsx-17` | 筛选 |  |
| `app-characters-id-page-tsx-18` | 重置 |  |
| `app-characters-id-page-tsx-19` | 还没有成长记录 |  |
| `app-characters-id-page-tsx-20` | 没有符合当前筛选条件的成长记录。 |  |
| `app-characters-id-page-tsx-21` | 筛选记录 |  |
| `app-characters-id-page-tsx-22` | 属性变化 |  |
| `app-characters-id-page-tsx-23` | 技能提升 |  |
| `app-characters-id-page-tsx-24` | SAN 累计 |  |
| `app-characters-id-page-tsx-25` | 展开 / 收起 |  |
| `app-characters-id-page-tsx-26` | 已编辑 |  |
| `app-characters-id-page-tsx-27` | 已撤销 |  |
| `app-characters-id-page-tsx-28` | 编辑记录 |  |
| `app-characters-id-page-tsx-29` | 目标 |  |
| `app-characters-id-page-tsx-30` | 数值变化 |  |
| `app-characters-id-page-tsx-31` | 备注 |  |
| `app-characters-id-page-tsx-32` | 保存修改 |  |
| `app-characters-id-page-tsx-33` | 撤销并回退数值 |  |
| `app-characters-id-page-tsx-34` | 还没有装备 |  |
| `app-characters-id-page-tsx-35` | 卸下 |  |
| `app-characters-id-page-tsx-36` | 卡库是空的，先去 |  |
| `app-characters-id-page-tsx-37` | 我的卡牌 |  |
| `app-characters-id-page-tsx-38` | 建几张 |  |
| `app-characters-id-page-tsx-39` | 装备 |  |
| `app-characters-id-page-tsx-40` | 力量 |  |
| `app-characters-id-page-tsx-41` | 体质 |  |
| `app-characters-id-page-tsx-42` | 体型 |  |
| `app-characters-id-page-tsx-43` | 敏捷 |  |
| `app-characters-id-page-tsx-44` | 外貌 |  |
| `app-characters-id-page-tsx-45` | 智力 |  |
| `app-characters-id-page-tsx-46` | 意志 |  |
| `app-characters-id-page-tsx-47` | 教育 |  |
| `app-characters-id-page-tsx-48` | 幸运 |  |
| `app-characters-id-page-tsx-49` | 技能 |  |
| `app-characters-id-page-tsx-50` | 物品 |  |
| `app-characters-id-page-tsx-51` | 关系 |  |
| `app-characters-id-page-tsx-52` | 其他 |  |
| `app-characters-id-page-tsx-53` | 未知局 |  |
| `app-characters-id-page-tsx-54` | 手动 / 其他成长 |  |
| `app-characters-id-page-tsx-55` | 1920 年代 |  |
| `app-characters-id-page-tsx-56` | 现代 |  |
| `app-characters-id-page-tsx-57` | 上传立绘 |  |
| `app-characters-id-page-tsx-58` | 上传头像 |  |
| `app-characters-id-page-tsx-59` | · 伤害 |  |
| `app-characters-id-page-tsx-60` | · 其他资产 |  |
| `app-characters-id-page-tsx-61` | · 现金 |  |
| `app-characters-id-page-tsx-62` | 伤害加值 DB |  |
| `app-characters-id-page-tsx-63` | 体格 Build |  |
| `app-characters-id-page-tsx-64` | 移动力 MOV |  |
| `app-characters-id-page-tsx-65` | 重伤值 |  |
| `app-characters-id-page-tsx-66` | 成长记录已更新。 |  |
| `app-characters-id-page-tsx-67` | 成长记录已撤销，角色卡数值已回退。 |  |
| `app-characters-id-page-tsx-68` | 该记录已撤销，不能再次操作。 |  |
| `app-characters-id-page-tsx-69` | 操作失败，请检查目标与数值。 |  |

## `app/characters/import/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-characters-import-page-tsx-1` | ← 返回角色库 |  |
| `app-characters-import-page-tsx-2` | 导入 xlsx 人物卡 |  |
| `app-characters-import-page-tsx-3` | 支持「COC7 空白卡」系列的「人物卡」工作表。导入后进入你的个人角色库； 带进房间仍然走 KP 审核流程。 | 支持导入 COC7 空白卡系列的人物卡；导入后进入角色库，带进房间仍需 KP 审核。 |
| `app-characters-import-page-tsx-4` | 选择 .xlsx 文件 |  |
| `app-characters-import-page-tsx-5` | 解析并导入 |  |
| `app-characters-import-page-tsx-6` | 目前导入范围：基础信息、九项属性、职业序号、技能（初始 / 成长 / 职业 / 兴趣）、信用评级、武器。 | 可导入基础信息、九项属性、职业、技能、信用评级与武器。 |
| `app-characters-import-page-tsx-7` | 导入后若发现技能缺失，通常是因为该技能不在当前规则包中，后续会在规则包补全时自动恢复显示。 | 缺失的技能会在规则包补全后恢复显示。 |

## `app/characters/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-characters-page-tsx-1` | ← 返回房间列表 |  |
| `app-characters-page-tsx-2` | 我的角色库 |  |
| `app-characters-page-tsx-3` | 角色属于你自己，可带进任意房间（需 KP 审核） | 属于你自己的角色，可带进房间（需 KP 审核）。 |
| `app-characters-page-tsx-4` | 导入 xlsx |  |
| `app-characters-page-tsx-5` | 新建 COC7 角色 |  |
| `app-characters-page-tsx-6` | 新建东方角色 |  |
| `app-characters-page-tsx-7` | 还没有角色卡 |  |
| `app-characters-page-tsx-8` | 编辑 |  |

## `app/history/[gameId]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-history-gameid-page-tsx-1` | ← 返回游戏历史 |  |
| `app-history-gameid-page-tsx-2` | 使用团本 |  |
| `app-history-gameid-page-tsx-3` | 背景 |  |
| `app-history-gameid-page-tsx-4` | 职业推荐 |  |
| `app-history-gameid-page-tsx-5` | 简介 |  |
| `app-history-gameid-page-tsx-6` | 最终局内状态 |  |
| `app-history-gameid-page-tsx-7` | 当前章节 |  |
| `app-history-gameid-page-tsx-8` | 当前场景 |  |
| `app-history-gameid-page-tsx-9` | 当前遭遇 |  |
| `app-history-gameid-page-tsx-10` | 团内时间 |  |
| `app-history-gameid-page-tsx-11` | 没有局内角色记录。 |  |
| `app-history-gameid-page-tsx-12` | 没有成长记录。 |  |
| `app-history-gameid-page-tsx-13` | 本局快照 | 本局存档 |
| `app-history-gameid-page-tsx-14` | 历史数据 | 历史记录 |
| `app-history-gameid-page-tsx-15` | 未署名 |  |
| `app-history-gameid-page-tsx-16` | 未指定系统 |  |
| `app-history-gameid-page-tsx-17` | 未指定年代 |  |
| `app-history-gameid-page-tsx-18` | 未填写 |  |
| `app-history-gameid-page-tsx-19` | 旗标 | 标记 |
| `app-history-gameid-page-tsx-20` | 计数器 | 计数 |
| `app-history-gameid-page-tsx-21` | 自定义 | 其他 |
| `app-history-gameid-page-tsx-22` | 无职业 |  |

## `app/history/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-history-page-tsx-1` | ← 返回房间列表 |  |
| `app-history-page-tsx-2` | 游戏历史 |  |
| `app-history-page-tsx-3` | 你参与过的已结束局。进入后为只读视图。 | 你参与过的已结束游戏。 |
| `app-history-page-tsx-4` | 还没有已结束的游戏记录。 |  |
| `app-history-page-tsx-5` | 已结束 |  |
| `app-history-page-tsx-6` | 无团本 |  |
| `app-history-page-tsx-7` | · 快照 v | · 存档 |

## `app/layout.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-layout-tsx-1` | 东方 TRPG 平台 |  |
| `app-layout-tsx-2` | COC7 兼容的东方 Project 线上跑团平台 | 东方 Project 线上跑团平台 |

## `app/modules/[moduleId]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-modules-moduleid-page-tsx-1` | 已发布 |  |
| `app-modules-moduleid-page-tsx-2` | 未发布 |  |
| `app-modules-moduleid-page-tsx-3` | 用这个团本建房 |  |
| `app-modules-moduleid-page-tsx-4` | 团本已保存。 |  |
| `app-modules-moduleid-page-tsx-5` | 发布状态已更新。 |  |
| `app-modules-moduleid-page-tsx-6` | 标题不能为空。 |  |
| `app-modules-moduleid-page-tsx-7` | 该团本仍被进行中的局使用，不能删除。 |  |
| `app-modules-moduleid-page-tsx-8` | 编辑团本 |  |
| `app-modules-moduleid-page-tsx-9` | 标题 |  |
| `app-modules-moduleid-page-tsx-10` | 版本 |  |
| `app-modules-moduleid-page-tsx-11` | 作者 |  |
| `app-modules-moduleid-page-tsx-12` | 规则系统 |  |
| `app-modules-moduleid-page-tsx-13` | 年代 |  |
| `app-modules-moduleid-page-tsx-14` | 现代 |  |
| `app-modules-moduleid-page-tsx-15` | 1920 年代 |  |
| `app-modules-moduleid-page-tsx-16` | 幻想乡 |  |
| `app-modules-moduleid-page-tsx-17` | 简介 |  |
| `app-modules-moduleid-page-tsx-18` | 背景（广场公开） |  |
| `app-modules-moduleid-page-tsx-19` | 职业推荐（广场公开） |  |
| `app-modules-moduleid-page-tsx-20` | Markdown 正文（仅 KP / 作者可见） | 正文（仅 KP / 作者可见） |
| `app-modules-moduleid-page-tsx-21` | 保存正文与元信息 |  |
| `app-modules-moduleid-page-tsx-22` | KP 可见正文 |  |
| `app-modules-moduleid-page-tsx-23` | 暂无资源。 |  |
| `app-modules-moduleid-page-tsx-24` | 打开资源 |  |
| `app-modules-moduleid-page-tsx-25` | 返回我的团本 |  |
| `app-modules-moduleid-page-tsx-26` | 返回团本广场 |  |
| `app-modules-moduleid-page-tsx-27` | 未署名 |  |
| `app-modules-moduleid-page-tsx-28` | 未指定系统 |  |
| `app-modules-moduleid-page-tsx-29` | 未指定年代 |  |
| `app-modules-moduleid-page-tsx-30` | 取消发布 |  |
| `app-modules-moduleid-page-tsx-31` | 发布到广场 |  |
| `app-modules-moduleid-page-tsx-32` | 删除团本 |  |

## `app/modules/mine/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-modules-mine-page-tsx-1` | ← 返回房间列表 |  |
| `app-modules-mine-page-tsx-2` | 我的团本 |  |
| `app-modules-mine-page-tsx-3` | 你创建或导入的团本。只有你可以编辑和发布它们。 | 你创建或导入的团本，只有你可以编辑和发布。 |
| `app-modules-mine-page-tsx-4` | 去团本广场 |  |
| `app-modules-mine-page-tsx-5` | 团本已删除。 |  |
| `app-modules-mine-page-tsx-6` | 团本已保存。 |  |
| `app-modules-mine-page-tsx-7` | 新建空白团本 |  |
| `app-modules-mine-page-tsx-8` | 生成标准 14 章节模板，创建后再编辑内容和发布。 | 生成标准 14 章节模板，可继续编辑后发布。 |
| `app-modules-mine-page-tsx-9` | 规则系统 |  |
| `app-modules-mine-page-tsx-10` | COC7 原版 |  |
| `app-modules-mine-page-tsx-11` | 东方扩展 |  |
| `app-modules-mine-page-tsx-12` | 年代 |  |
| `app-modules-mine-page-tsx-13` | 现代 |  |
| `app-modules-mine-page-tsx-14` | 1920 年代 |  |
| `app-modules-mine-page-tsx-15` | 幻想乡 |  |
| `app-modules-mine-page-tsx-16` | 导入标准团本 |  |
| `app-modules-mine-page-tsx-17` | 支持 `.md` 单文件或 `.zip` 标准包，导入后即可编辑和发布。 |  |
| `app-modules-mine-page-tsx-18` | 还没有团本。可以在上方新建或导入。 |  |
| `app-modules-mine-page-tsx-19` | 已发布 |  |
| `app-modules-mine-page-tsx-20` | 未发布 |  |
| `app-modules-mine-page-tsx-21` | 管理 |  |
| `app-modules-mine-page-tsx-22` | 未指定系统 |  |
| `app-modules-mine-page-tsx-23` | 未指定年代 |  |
| `app-modules-mine-page-tsx-24` | 独立团本 |  |
| `app-modules-mine-page-tsx-25` | 房间： |  |
| `app-modules-mine-page-tsx-26` | 取消发布 |  |
| `app-modules-mine-page-tsx-27` | 发布到广场 |  |

## `app/modules/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-modules-page-tsx-1` | ← 返回房间列表 |  |
| `app-modules-page-tsx-2` | 团本广场 |  |
| `app-modules-page-tsx-3` | 所有已发布的团本。这里只展示公开预览字段，完整内容由各房间 KP 在团本管理页查看。 | 所有已发布的团本。公开信息可供浏览，完整内容仅本房 KP 可见。 |
| `app-modules-page-tsx-4` | 我的团本 |  |
| `app-modules-page-tsx-5` | 还没有已发布的团本，去“我的团本”发布一个吧。 |  |
| `app-modules-page-tsx-6` | 用这个团本建房 |  |

## `app/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-page-tsx-1` | 东方 TRPG 跑团平台 |  |
| `app-page-tsx-2` | 房间已解散，相关数据已删除。 | 房间已解散。 |
| `app-page-tsx-3` | 只有房主可以解散房间。 |  |
| `app-page-tsx-4` | 房间已归档，仍保留历史数据。 | 房间已归档，历史记录保留。 |
| `app-page-tsx-5` | 只有房主可以归档房间。 |  |
| `app-page-tsx-6` | 创建房间 |  |
| `app-page-tsx-7` | 按配置新建 |  |
| `app-page-tsx-8` | 房间名 |  |
| `app-page-tsx-9` | 规则系统 |  |
| `app-page-tsx-10` | COC7 原版 |  |
| `app-page-tsx-11` | 东方扩展 |  |
| `app-page-tsx-12` | 背景年代 |  |
| `app-page-tsx-13` | 现代 |  |
| `app-page-tsx-14` | 1920 年代 |  |
| `app-page-tsx-15` | 车卡方式（房主决定） |  |
| `app-page-tsx-16` | 天命 5 · 掷 5 组选 1 组 |  |
| `app-page-tsx-17` | 总点数 480 · 单项 15~90 |  |
| `app-page-tsx-18` | 创建 |  |
| `app-page-tsx-19` | 加入房间 |  |
| `app-page-tsx-20` | 邀请码不存在或已失效 |  |
| `app-page-tsx-21` | 邀请码 |  |
| `app-page-tsx-22` | 加入 |  |
| `app-page-tsx-23` | 向 KP 索取房间邀请码，输入后即可进入准备页或跑团页。 | 向 KP 索取邀请码，输入后即可进入房间。 |
| `app-page-tsx-24` | 还没有房间，用上面的表单创建一个 |  |
| `app-page-tsx-25` | 例：红魔馆异变调查 |  |
| `app-page-tsx-26` | 例如 DEMO01 |  |

## `app/rooms/[id]/cards/new/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-cards-new-page-tsx-1` | ← 返回房间 |  |
| `app-rooms-id-cards-new-page-tsx-2` | 新建卡牌 |  |

## `app/rooms/[id]/characters/[characterId]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-characters-characterid-page-tsx-1` | ← 返回房间 |  |
| `app-rooms-id-characters-characterid-page-tsx-2` | 属性 |  |
| `app-rooms-id-characters-characterid-page-tsx-3` | 衍生属性 |  |
| `app-rooms-id-characters-characterid-page-tsx-4` | 未分配技能 |  |
| `app-rooms-id-characters-characterid-page-tsx-5` | 编辑角色（属性 / 技能 / 物品） |  |
| `app-rooms-id-characters-characterid-page-tsx-6` | 还没有卡牌，从下方卡池配发 |  |
| `app-rooms-id-characters-characterid-page-tsx-7` | 卸下 |  |
| `app-rooms-id-characters-characterid-page-tsx-8` | 力量 STR |  |
| `app-rooms-id-characters-characterid-page-tsx-9` | 体质 CON |  |
| `app-rooms-id-characters-characterid-page-tsx-10` | 体型 SIZ |  |
| `app-rooms-id-characters-characterid-page-tsx-11` | 敏捷 DEX |  |
| `app-rooms-id-characters-characterid-page-tsx-12` | 外貌 APP |  |
| `app-rooms-id-characters-characterid-page-tsx-13` | 智力 INT |  |
| `app-rooms-id-characters-characterid-page-tsx-14` | 意志 POW |  |
| `app-rooms-id-characters-characterid-page-tsx-15` | 教育 EDU |  |
| `app-rooms-id-characters-characterid-page-tsx-16` | 幸运 LUCK |  |
| `app-rooms-id-characters-characterid-page-tsx-17` | 生命 HP |  |
| `app-rooms-id-characters-characterid-page-tsx-18` | 灵力 MP |  |
| `app-rooms-id-characters-characterid-page-tsx-19` | 理智 SAN |  |
| `app-rooms-id-characters-characterid-page-tsx-20` | 骰池 DP |  |
| `app-rooms-id-characters-characterid-page-tsx-21` | 伤害加值 DB |  |
| `app-rooms-id-characters-characterid-page-tsx-22` | 体格 Build |  |
| `app-rooms-id-characters-characterid-page-tsx-23` | 移动力 MOV |  |
| `app-rooms-id-characters-characterid-page-tsx-24` | 重伤值 |  |

## `app/rooms/[id]/characters/new/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-characters-new-page-tsx-1` | ← 返回房间准备页 |  |
| `app-rooms-id-characters-new-page-tsx-2` | 新建角色卡 |  |
| `app-rooms-id-characters-new-page-tsx-3` | · 1920 年代 |  |
| `app-rooms-id-characters-new-page-tsx-4` | · 现代 |  |

## `app/rooms/[id]/combat/[combatId]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-combat-combatid-page-tsx-1` | ← 返回房间视角 |  |
| `app-rooms-id-combat-combatid-page-tsx-2` | 战斗逻辑与快照仍保存在原系统中 | 删除 |
| `app-rooms-id-combat-combatid-page-tsx-3` | 房间视角 |  |

## `app/rooms/[id]/combat/new/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-combat-new-page-tsx-1` | ← 返回房间 |  |
| `app-rooms-id-combat-new-page-tsx-2` | 发起战斗 |  |
| `app-rooms-id-combat-new-page-tsx-3` | 本房已关闭玩家发起战斗申请的开关。 | 本房间未开启玩家发起战斗申请。 |
| `app-rooms-id-combat-new-page-tsx-4` | 同一个角色只能选一边；已选我方的单位不会再允许选敌方。 | 同一角色只能加入一方。 |
| `app-rooms-id-combat-new-page-tsx-5` | 提交后 KP 会在审批页选择敌方单位。 | 提交后由 KP 选择敌方单位。 |
| `app-rooms-id-combat-new-page-tsx-6` | KP 可以直接开战，并指定双方单位。 |  |
| `app-rooms-id-combat-new-page-tsx-7` | 选择你能操控的角色提交申请，等 KP 审批。 |  |
| `app-rooms-id-combat-new-page-tsx-8` | 。请确认敌方单位后直接开战。 |  |
| `app-rooms-id-combat-new-page-tsx-9` | 。提交后 KP 会收到审批并选择敌方单位。 |  |
| `app-rooms-id-combat-new-page-tsx-10` | 先准备至少一张 NPC 卡，或等待玩家带入角色。 |  |
| `app-rooms-id-combat-new-page-tsx-11` | 你还没有通过审核的角色卡。 |  |
| `app-rooms-id-combat-new-page-tsx-12` | 直接开战 |  |
| `app-rooms-id-combat-new-page-tsx-13` | 提交战斗申请 |  |

## `app/rooms/[id]/combat/requests/[requestId]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-combat-requests-requestid-page-tsx-1` | ← 返回房间 |  |
| `app-rooms-id-combat-requests-requestid-page-tsx-2` | 战斗申请审批 |  |
| `app-rooms-id-combat-requests-requestid-page-tsx-3` | 申请中没有可识别单位，可能已被删除。 | 申请中的单位可能已被删除。 |
| `app-rooms-id-combat-requests-requestid-page-tsx-4` | 确认敌方单位 |  |
| `app-rooms-id-combat-requests-requestid-page-tsx-5` | 没有可选的敌方单位，请先在房间中准备 NPC/Boss。 |  |
| `app-rooms-id-combat-requests-requestid-page-tsx-6` | 通过并开战 |  |
| `app-rooms-id-combat-requests-requestid-page-tsx-7` | 驳回申请 |  |

## `app/rooms/[id]/end/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-end-page-tsx-1` | ← 返回跑团页 |  |
| `app-rooms-id-end-page-tsx-2` | 结束本局 · 成长确认 |  |
| `app-rooms-id-end-page-tsx-3` | 建议先确认本局成长与奖励，再结束。结束后房间回到准备页，角色、物品与成长记录都会保留。 | 可先确认本局成长与奖励。结束后房间回到准备页，角色与记录会保留。 |
| `app-rooms-id-end-page-tsx-4` | 当前没有进行中的局 |  |
| `app-rooms-id-end-page-tsx-5` | 房间状态可能卡在 PLAYING / COMBAT / PAUSED，但数据库里没有可结束的 Game。 点击下方按钮会把房间直接重置为 LOBBY，并关闭残留战斗。 | 没有进行中的游戏，但房间状态异常。可将房间重置回准备状态。 |
| `app-rooms-id-end-page-tsx-6` | 结束并重置房间 |  |
| `app-rooms-id-end-page-tsx-7` | 成长 / 奖励数据不合法，请检查目标、数值与角色。属性 / 技能 / SAN 的数值变化必须是非零整数。 | 请检查角色、目标与数值；数值变化必须是非零整数。 |
| `app-rooms-id-end-page-tsx-8` | 当前局状态或角色不匹配，无法写入成长。 | 当前状态无法记录成长。 |
| `app-rooms-id-end-page-tsx-9` | 房间 |  |
| `app-rooms-id-end-page-tsx-10` | 本局 |  |
| `app-rooms-id-end-page-tsx-11` | 团本快照 | 本局团本 |
| `app-rooms-id-end-page-tsx-12` | 角色 / 成长 |  |
| `app-rooms-id-end-page-tsx-13` | 成长点确认 |  |
| `app-rooms-id-end-page-tsx-14` | CoC 幕间成长检定：对每个待检定技能掷 1d100；结果大于当前技能值，或落在 96-100 时，技能 +1d10。 | 幕间成长：1d100 大于当前技能值或掷出 96–100 时，技能 +1d10。 |
| `app-rooms-id-end-page-tsx-15` | 没有待检定的成长点。 |  |
| `app-rooms-id-end-page-tsx-16` | 取消 |  |
| `app-rooms-id-end-page-tsx-17` | 角色卡预览 |  |
| `app-rooms-id-end-page-tsx-18` | 本局没有局内角色。 |  |
| `app-rooms-id-end-page-tsx-19` | 打开角色页 → |  |
| `app-rooms-id-end-page-tsx-20` | 撤销 |  |
| `app-rooms-id-end-page-tsx-21` | 已撤销 |  |
| `app-rooms-id-end-page-tsx-22` | ← 取消，返回跑团页 |  |
| `app-rooms-id-end-page-tsx-23` | 属性 |  |
| `app-rooms-id-end-page-tsx-24` | 技能 |  |
| `app-rooms-id-end-page-tsx-25` | 物品 |  |
| `app-rooms-id-end-page-tsx-26` | 关系 |  |
| `app-rooms-id-end-page-tsx-27` | 其他 |  |
| `app-rooms-id-end-page-tsx-28` | 力量 |  |
| `app-rooms-id-end-page-tsx-29` | 体质 |  |
| `app-rooms-id-end-page-tsx-30` | 体型 |  |
| `app-rooms-id-end-page-tsx-31` | 敏捷 |  |
| `app-rooms-id-end-page-tsx-32` | 外貌 |  |
| `app-rooms-id-end-page-tsx-33` | 智力 |  |
| `app-rooms-id-end-page-tsx-34` | 意志 |  |
| `app-rooms-id-end-page-tsx-35` | 教育 |  |
| `app-rooms-id-end-page-tsx-36` | 幸运 |  |
| `app-rooms-id-end-page-tsx-37` | 成长检定完成：有技能成功提升，已写入成长记录。 | 成长检定完成，有技能提升。 |
| `app-rooms-id-end-page-tsx-38` | 成长检定完成：本次没有技能提升。 |  |
| `app-rooms-id-end-page-tsx-39` | 已标记成长点。 |  |
| `app-rooms-id-end-page-tsx-40` | 已取消成长点。 |  |
| `app-rooms-id-end-page-tsx-41` | 该技能已经有待检定成长点。 |  |
| `app-rooms-id-end-page-tsx-42` | 该成长点已经结算，不能重复操作。 |  |
| `app-rooms-id-end-page-tsx-43` | 无进行中的局 |  |
| `app-rooms-id-end-page-tsx-44` | 无团本 |  |
| `app-rooms-id-end-page-tsx-45` | 已锁定开局快照 | 已保存开局存档 |
| `app-rooms-id-end-page-tsx-46` | 旧局：未生成快照 | 旧局：未创建开局存档 |

## `app/rooms/[id]/modules/[moduleId]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-modules-moduleid-page-tsx-1` | ← 返回团本列表 |  |
| `app-rooms-id-modules-moduleid-page-tsx-2` | 团本已保存。 |  |
| `app-rooms-id-modules-moduleid-page-tsx-3` | 团本已复制，可以继续编辑副本。 |  |
| `app-rooms-id-modules-moduleid-page-tsx-4` | 空白团本已创建，可以开始编辑标题、简介与正文。 | 空白团本已创建，可开始编辑。 |
| `app-rooms-id-modules-moduleid-page-tsx-5` | 该团本仍被进行中的局使用，不能删除。请先结束本局。 |  |
| `app-rooms-id-modules-moduleid-page-tsx-6` | 标题不能为空。 |  |
| `app-rooms-id-modules-moduleid-page-tsx-7` | 该团本已应用到某个房间的准备预设。请先在对应房间换预设或删除预设对象，再删除团本。 | 该团本已被房间使用。请先在对应房间更换或删除预设。 |
| `app-rooms-id-modules-moduleid-page-tsx-8` | 只有团本作者可以删除此团本。 |  |
| `app-rooms-id-modules-moduleid-page-tsx-9` | 编辑团本 |  |
| `app-rooms-id-modules-moduleid-page-tsx-10` | 标题 |  |
| `app-rooms-id-modules-moduleid-page-tsx-11` | 版本 |  |
| `app-rooms-id-modules-moduleid-page-tsx-12` | 作者 |  |
| `app-rooms-id-modules-moduleid-page-tsx-13` | 简介 |  |
| `app-rooms-id-modules-moduleid-page-tsx-14` | Markdown 正文 | 正文 |
| `app-rooms-id-modules-moduleid-page-tsx-15` | 保存 |  |
| `app-rooms-id-modules-moduleid-page-tsx-16` | 暂无资源。 |  |
| `app-rooms-id-modules-moduleid-page-tsx-17` | 打开资源 |  |
| `app-rooms-id-modules-moduleid-page-tsx-18` | 资源 |  |
| `app-rooms-id-modules-moduleid-page-tsx-19` | 地图、图片、手书与附件仅 KP / 团本作者可见。玩家只会看到公开元信息与 KP 主动分享的线索。 | 资源仅 KP 与团本作者可见；玩家只能看到公开信息与 KP 分享的线索。 |
| `app-rooms-id-modules-moduleid-page-tsx-20` | 公开信息 |  |
| `app-rooms-id-modules-moduleid-page-tsx-21` | 背景 |  |
| `app-rooms-id-modules-moduleid-page-tsx-22` | 职业推荐 |  |
| `app-rooms-id-modules-moduleid-page-tsx-23` | 正文预览 |  |
| `app-rooms-id-modules-moduleid-page-tsx-24` | 非公开正文仅 KP 与团本作者可见。 |  |
| `app-rooms-id-modules-moduleid-page-tsx-25` | 未署名 |  |
| `app-rooms-id-modules-moduleid-page-tsx-26` | 未指定系统 |  |
| `app-rooms-id-modules-moduleid-page-tsx-27` | 未指定年代 |  |
| `app-rooms-id-modules-moduleid-page-tsx-28` | 未填写 |  |

## `app/rooms/[id]/modules/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-modules-page-tsx-1` | ← 返回准备页 |  |
| `app-rooms-id-modules-page-tsx-2` | 团本管理 |  |
| `app-rooms-id-modules-page-tsx-3` | 新建团本 |  |
| `app-rooms-id-modules-page-tsx-4` | 可以新建带标准 14 章节的空白团本，也可以直接导入 `.md` / `.zip` 标准包。 | 可新建标准 14 章节空白团本，或导入 .md / .zip 标准包。 |
| `app-rooms-id-modules-page-tsx-5` | 新建空白团本 |  |
| `app-rooms-id-modules-page-tsx-6` | 只有 KP 可以创建、导入或编辑团本，你可以查看已绑定团本。 |  |
| `app-rooms-id-modules-page-tsx-7` | 团本已删除。 |  |
| `app-rooms-id-modules-page-tsx-8` | 还没有团本。KP 可以导入 .md 或 .zip 标准包。 |  |
| `app-rooms-id-modules-page-tsx-9` | 未署名 |  |

## `app/rooms/[id]/npcs/new/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-npcs-new-page-tsx-1` | ← 返回房间 |  |
| `app-rooms-id-npcs-new-page-tsx-2` | 准备 NPC / Boss |  |
| `app-rooms-id-npcs-new-page-tsx-3` | 从预设直接加入，或按本房规则自建。生成的是本场专属卡，不会进入个人卡库。 | 可从预设加入，也可按本房规则自建；仅在本场使用，不进入个人卡库。 |
| `app-rooms-id-npcs-new-page-tsx-4` | 从预设挑选 |  |
| `app-rooms-id-npcs-new-page-tsx-5` | 加入本场 |  |
| `app-rooms-id-npcs-new-page-tsx-6` | 自建 NPC / Boss |  |
| `app-rooms-id-npcs-new-page-tsx-7` | 名字 |  |
| `app-rooms-id-npcs-new-page-tsx-8` | 副标题（可空） |  |
| `app-rooms-id-npcs-new-page-tsx-9` | 描述（可空） |  |
| `app-rooms-id-npcs-new-page-tsx-10` | 强度 |  |
| `app-rooms-id-npcs-new-page-tsx-11` | 稀有度 |  |
| `app-rooms-id-npcs-new-page-tsx-12` | 种族（可空） |  |
| `app-rooms-id-npcs-new-page-tsx-13` | （无） |  |
| `app-rooms-id-npcs-new-page-tsx-14` | 标签（逗号分隔，可空） |  |
| `app-rooms-id-npcs-new-page-tsx-15` | 技能（每行一个，格式 技能ID:数值） | 技能（每行一个，格式：技能:数值） |
| `app-rooms-id-npcs-new-page-tsx-16` | 查看本包技能 ID | 查看可用技能 |
| `app-rooms-id-npcs-new-page-tsx-17` | 创建本场 NPC |  |
| `app-rooms-id-npcs-new-page-tsx-18` | 杂兵 |  |
| `app-rooms-id-npcs-new-page-tsx-19` | 标准 |  |
| `app-rooms-id-npcs-new-page-tsx-20` | 精英 |  |
| `app-rooms-id-npcs-new-page-tsx-21` | 力量 |  |
| `app-rooms-id-npcs-new-page-tsx-22` | 体质 |  |
| `app-rooms-id-npcs-new-page-tsx-23` | 体型 |  |
| `app-rooms-id-npcs-new-page-tsx-24` | 敏捷 |  |
| `app-rooms-id-npcs-new-page-tsx-25` | 外貌 |  |
| `app-rooms-id-npcs-new-page-tsx-26` | 智力 |  |
| `app-rooms-id-npcs-new-page-tsx-27` | 意志 |  |
| `app-rooms-id-npcs-new-page-tsx-28` | 教育 |  |
| `app-rooms-id-npcs-new-page-tsx-29` | 幸运 |  |
| `app-rooms-id-npcs-new-page-tsx-30` | · 种族 |  |

## `app/rooms/[id]/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-page-tsx-1` | 结束并重置房间 |  |
| `app-rooms-id-page-tsx-2` | 暂停本局 |  |
| `app-rooms-id-page-tsx-3` | 结束本局 |  |
| `app-rooms-id-page-tsx-4` | ← 返回房间列表 |  |
| `app-rooms-id-page-tsx-5` | 团本编辑与素材 | 团本与素材 |
| `app-rooms-id-page-tsx-6` | 房间已归档，仅保留历史数据与只读视图；发言、掷骰和战斗操作已停止。 | 房间已归档，仅可查看；发言、掷骰与战斗已停止。 |
| `app-rooms-id-page-tsx-7` | KP 分屏模式：左侧为准备区（场景切换、线索公布），右侧为玩家实际看到的房间视角。 | 左侧为 KP 准备区，右侧为玩家视角。 |
| `app-rooms-id-page-tsx-8` | 当前没有可用的局内状态，暂时无法进入 KP 准备区。 | 当前没有可进入的局。 |
| `app-rooms-id-page-tsx-9` | 房间视角（与普通玩家一致） |  |
| `app-rooms-id-page-tsx-10` | 此区域不包含 KP 专属控件 | 此区域为玩家视角 |
| `app-rooms-id-page-tsx-11` | 场景 |  |
| `app-rooms-id-page-tsx-12` | 当前激活 |  |
| `app-rooms-id-page-tsx-13` | 房间状态异常 |  |
| `app-rooms-id-page-tsx-14` | 本局： |  |
| `app-rooms-id-page-tsx-15` | 当前没有进行中的局，但房间状态不是 LOBBY。可以结束并重置房间。 | 没有进行中的游戏，但房间状态异常。可结束并重置房间。 |
| `app-rooms-id-page-tsx-16` | 暂停会保存当前状态并返回准备页；继续时全员需要重新准备。 | 暂停会保存进度并返回准备页；继续时全员需重新准备。 |

## `app/rooms/[id]/prepare/page.tsx`

| ID | 原文 | 你的修改                                       |
|---|---|--------------------------------------------|
| `app-rooms-id-prepare-page-tsx-1` | ← 返回房间列表 |                                            |
| `app-rooms-id-prepare-page-tsx-2` | 规则包 |                                            |
| `app-rooms-id-prepare-page-tsx-3` | 可选种族 |                                            |
| `app-rooms-id-prepare-page-tsx-4` | 技能表 |                                            |
| `app-rooms-id-prepare-page-tsx-5` | 准备状态 |                                            |
| `app-rooms-id-prepare-page-tsx-6` | 还有成员未准备，确认所有人准备好后再开始。 |                                            |
| `app-rooms-id-prepare-page-tsx-7` | 每名 PL 至少需要一张审核通过的角色卡才能开始。 | 每名玩家至少需要一张通过审核的角色卡。                        |
| `app-rooms-id-prepare-page-tsx-8` | 存在没有通过角色审核的 PL，暂时不能开始。 | 有玩家尚未通过角色审核。                               |
| `app-rooms-id-prepare-page-tsx-9` | 当前没有可继续的局。 |                                            |
| `app-rooms-id-prepare-page-tsx-10` | 当前有一个暂停中的局。全员准备后，KP 点击“继续跑团”读取上次进度。 | 当前有暂停中的游戏。全员准备后，KP 可继续跑团。                  |
| `app-rooms-id-prepare-page-tsx-11` | 剧本 / 模组 |                                            |
| `app-rooms-id-prepare-page-tsx-12` | 团本管理 / 新建 |                                            |
| `app-rooms-id-prepare-page-tsx-13` | 本房间还没有选择团本。 |                                            |
| `app-rooms-id-prepare-page-tsx-14` | 可以前往团本管理导入 / 创建房间团本，也可以从团本广场选择已发布团本。 | 可前往团本管理创建或导入，也可从团本广场选择。                    |
| `app-rooms-id-prepare-page-tsx-15` | 背景 |                                            |
| `app-rooms-id-prepare-page-tsx-16` | 职业推荐 | 技能推荐                                       |
| `app-rooms-id-prepare-page-tsx-17` | 简介 |                                            |
| `app-rooms-id-prepare-page-tsx-18` | 选择本局团本 |                                            |
| `app-rooms-id-prepare-page-tsx-19` | 不选择团本（使用房间名） |                                            |
| `app-rooms-id-prepare-page-tsx-20` | 保存团本选择 |                                            |
| `app-rooms-id-prepare-page-tsx-21` | 点击后会从只读模板克隆：章节、场景地图、NPC/Boss 卡、武器/物品/证物卡、线索、遭遇与魔法规则。 换预设时，上一次预设生成的房间对象会整批替换；玩家自己创建的内容不受影响。 | 应用后会生成本局所需的场景、NPC、物品、线索与魔法；重复应用会替换上次生成的内容。 |
| `app-rooms-id-prepare-page-tsx-22` | 本局还未应用所选团本预设，请先点击「应用团本预设到房间」。 |                                            |
| `app-rooms-id-prepare-page-tsx-23` | 团本选择已保存，全员可见。 |                                            |
| `app-rooms-id-prepare-page-tsx-24` | 由 n8n 工作流 / 团本结构化数据提前整理。开启后，本局规则包会纳入这些法术，战斗中可消耗 MP/SAN 施放。 | 开启后，本局可使用团本中的魔法。                           |
| `app-rooms-id-prepare-page-tsx-25` | 角色与物品 |                                            |
| `app-rooms-id-prepare-page-tsx-26` | 新建物品 |                                            |
| `app-rooms-id-prepare-page-tsx-27` | 新建角色 |                                            |
| `app-rooms-id-prepare-page-tsx-28` | 当前角色 |                                            |
| `app-rooms-id-prepare-page-tsx-29` | 未选择 |                                            |
| `app-rooms-id-prepare-page-tsx-30` | 还没有通过审核的角色。先新建角色并等待 KP 审核。 |                                            |
| `app-rooms-id-prepare-page-tsx-31` | 当前角色最近成长 |                                            |
| `app-rooms-id-prepare-page-tsx-32` | 从我的角色库选择已有角色 |                                            |
| `app-rooms-id-prepare-page-tsx-33` | 请选择角色 |                                            |
| `app-rooms-id-prepare-page-tsx-34` | 带入已有角色 |                                            |
| `app-rooms-id-prepare-page-tsx-35` | 角色库里没有可带入本房的角色；可以先去「我的角色」新建 / 导入，再回本页提交。 | 角色库暂无可带入的角色，可先去「我的角色」新建或导入。                |
| `app-rooms-id-prepare-page-tsx-36` | 还没有人带角色卡进来 |                                            |
| `app-rooms-id-prepare-page-tsx-37` | 通过 |                                            |
| `app-rooms-id-prepare-page-tsx-38` | 驳回 |                                            |
| `app-rooms-id-prepare-page-tsx-39` | 撤回 |                                            |
| `app-rooms-id-prepare-page-tsx-40` | 从我的卡牌库选择已有卡牌 |                                            |
| `app-rooms-id-prepare-page-tsx-41` | 请选择卡牌 |                                            |
| `app-rooms-id-prepare-page-tsx-42` | 带入已有卡牌 |                                            |
| `app-rooms-id-prepare-page-tsx-43` | 批量通过 |                                            |
| `app-rooms-id-prepare-page-tsx-44` | 批量驳回 |                                            |
| `app-rooms-id-prepare-page-tsx-45` | 还没有人带卡牌进来 |                                            |
| `app-rooms-id-prepare-page-tsx-46` | 勾选后批量处理 |                                            |
| `app-rooms-id-prepare-page-tsx-47` | 战术棋盘 |                                            |
| `app-rooms-id-prepare-page-tsx-48` | 还没有激活的场景。KP 可先到「场景 / 地图」创建并切换场景，再回来布置 Token、墙体与灯光。 | 还没有激活场景。KP 可先到「场景 / 地图」创建。                 |
| `app-rooms-id-prepare-page-tsx-49` | 开始跑团 |                                            |
| `app-rooms-id-prepare-page-tsx-50` | 属性 |                                            |
| `app-rooms-id-prepare-page-tsx-51` | 技能 |                                            |
| `app-rooms-id-prepare-page-tsx-52` | 物品 |                                            |
| `app-rooms-id-prepare-page-tsx-53` | 关系 |                                            |
| `app-rooms-id-prepare-page-tsx-54` | 其他 |                                            |
| `app-rooms-id-prepare-page-tsx-55` | 未指定车卡方式 |                                            |
| `app-rooms-id-prepare-page-tsx-56` | 无（纯 COC7） |                                            |
| `app-rooms-id-prepare-page-tsx-57` | 取消准备 |                                            |
| `app-rooms-id-prepare-page-tsx-58` | 我准备好了 |                                            |
| `app-rooms-id-prepare-page-tsx-59` | （我） |                                            |
| `app-rooms-id-prepare-page-tsx-60` | 已准备 |                                            |
| `app-rooms-id-prepare-page-tsx-61` | 未准备 |                                            |
| `app-rooms-id-prepare-page-tsx-62` | 未署名 |                                            |
| `app-rooms-id-prepare-page-tsx-63` | · 房间团本 |                                            |
| `app-rooms-id-prepare-page-tsx-64` | · 广场团本 |                                            |
| `app-rooms-id-prepare-page-tsx-65` | 未指定系统 |                                            |
| `app-rooms-id-prepare-page-tsx-66` | 未指定年代 |                                            |
| `app-rooms-id-prepare-page-tsx-67` | 未填写 |                                            |
| `app-rooms-id-prepare-page-tsx-68` | [广场] |                                            |
| `app-rooms-id-prepare-page-tsx-69` | （重新应用） |                                            |
| `app-rooms-id-prepare-page-tsx-70` | （切换预设） |                                            |
| `app-rooms-id-prepare-page-tsx-71` | 重新应用预设 |                                            |
| `app-rooms-id-prepare-page-tsx-72` | 应用团本预设 |                                            |
| `app-rooms-id-prepare-page-tsx-73` |  / 场景 searchParams.scenes ?? | 删除                                         |
| `app-rooms-id-prepare-page-tsx-74` |  / 武器物品 searchParams.items ?? | 删除                                         |
| `app-rooms-id-prepare-page-tsx-75` |  / 线索证物 searchParams.clues ?? | 删除                                         |
| `app-rooms-id-prepare-page-tsx-76` |  / 遭遇 searchParams.encounters ?? | 删除                                         |
| `app-rooms-id-prepare-page-tsx-77` | 停用魔法规则 |                                            |
| `app-rooms-id-prepare-page-tsx-78` | 启用魔法规则 |                                            |
| `app-rooms-id-prepare-page-tsx-79` | 已启用 |                                            |
| `app-rooms-id-prepare-page-tsx-80` | 未启用 |                                            |
| `app-rooms-id-prepare-page-tsx-81` | 理由 |                                            |
| `app-rooms-id-prepare-page-tsx-82` | 批量驳回理由（可选） |                                            |
| `app-rooms-id-prepare-page-tsx-83` | 未知 |                                            |
| `app-rooms-id-prepare-page-tsx-84` | 本局团本： |                                            |
| `app-rooms-id-prepare-page-tsx-85` | 未绑定 |                                            |
| `app-rooms-id-prepare-page-tsx-86` | 未选择（使用房间名） |                                            |
| `app-rooms-id-prepare-page-tsx-87` | 继续跑团 |                                            |
| `app-rooms-id-prepare-page-tsx-88` | 等待 KP 开始跑团 |                                            |
| `app-rooms-id-prepare-page-tsx-89` | 等待全员准备和角色审核 |                                            |

## `app/rooms/[id]/scenes/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-id-scenes-page-tsx-1` | ← 返回跑团页 |  |
| `app-rooms-id-scenes-page-tsx-2` | 场景 / 地图 |  |
| `app-rooms-id-scenes-page-tsx-3` | KP 可创建场景、上传地图、放置角色与 NPC Token；Token 图片自动取角色卡立绘 / 头像，未配置时显示默认占位，不再单独上传。 | KP 可创建场景并放置角色 Token；Token 图会自动使用角色立绘或头像。 |
| `app-rooms-id-scenes-page-tsx-4` | 从团本自动生成场景 |  |
| `app-rooms-id-scenes-page-tsx-5` | 同步团本场景与遭遇 |  |
| `app-rooms-id-scenes-page-tsx-6` | 新建场景 |  |
| `app-rooms-id-scenes-page-tsx-7` | 场景名 |  |
| `app-rooms-id-scenes-page-tsx-8` | 描述 |  |
| `app-rooms-id-scenes-page-tsx-9` | 创建场景 |  |
| `app-rooms-id-scenes-page-tsx-10` | 还没有场景。KP 创建场景后，跑团页会显示战术棋盘。 | 还没有场景。创建后，跑团页会显示战术棋盘。 |
| `app-rooms-id-scenes-page-tsx-11` | 当前场景 |  |
| `app-rooms-id-scenes-page-tsx-12` | 切换到本场景 |  |
| `app-rooms-id-scenes-page-tsx-13` | 删除场景 |  |
| `app-rooms-id-scenes-page-tsx-14` | 天气 |  |
| `app-rooms-id-scenes-page-tsx-15` | 时段 |  |
| `app-rooms-id-scenes-page-tsx-16` | KP 旁白 / 场景说明 |  |
| `app-rooms-id-scenes-page-tsx-17` | 地图宽 |  |
| `app-rooms-id-scenes-page-tsx-18` | 地图高 |  |
| `app-rooms-id-scenes-page-tsx-19` | 格子大小 |  |
| `app-rooms-id-scenes-page-tsx-20` | 格子类型 |  |
| `app-rooms-id-scenes-page-tsx-21` | 方格 |  |
| `app-rooms-id-scenes-page-tsx-22` | 六边形 |  |
| `app-rooms-id-scenes-page-tsx-23` | 无格子 |  |
| `app-rooms-id-scenes-page-tsx-24` | 背景色 |  |
| `app-rooms-id-scenes-page-tsx-25` | 初始 X |  |
| `app-rooms-id-scenes-page-tsx-26` | 初始 Y |  |
| `app-rooms-id-scenes-page-tsx-27` | 缩放 |  |
| `app-rooms-id-scenes-page-tsx-28` | 显示网格 |  |
| `app-rooms-id-scenes-page-tsx-29` | 启用战争迷雾 |  |
| `app-rooms-id-scenes-page-tsx-30` | 保存场景 / 地图 |  |
| `app-rooms-id-scenes-page-tsx-31` | 场景背景 |  |
| `app-rooms-id-scenes-page-tsx-32` | 地图背景 |  |
| `app-rooms-id-scenes-page-tsx-33` | 场景页可管理图层图片；墙体 / 灯光 / 战雾在跑团页战术棋盘上操作。 | 图层图片在此管理；墙体、灯光与战雾在战术棋盘上操作。 |
| `app-rooms-id-scenes-page-tsx-34` | 名称 |  |
| `app-rooms-id-scenes-page-tsx-35` | 类型 |  |
| `app-rooms-id-scenes-page-tsx-36` | 背景 |  |
| `app-rooms-id-scenes-page-tsx-37` | 地块 |  |
| `app-rooms-id-scenes-page-tsx-38` | 物件 |  |
| `app-rooms-id-scenes-page-tsx-39` | 特效 |  |
| `app-rooms-id-scenes-page-tsx-40` | 前景 |  |
| `app-rooms-id-scenes-page-tsx-41` | Z 序 |  |
| `app-rooms-id-scenes-page-tsx-42` | 透明度 |  |
| `app-rooms-id-scenes-page-tsx-43` | X / Y 偏移 |  |
| `app-rooms-id-scenes-page-tsx-44` | 可见 |  |
| `app-rooms-id-scenes-page-tsx-45` | 锁定 |  |
| `app-rooms-id-scenes-page-tsx-46` | 保存图层 |  |
| `app-rooms-id-scenes-page-tsx-47` | 删除 |  |
| `app-rooms-id-scenes-page-tsx-48` | 新图层名 |  |
| `app-rooms-id-scenes-page-tsx-49` | 新增图层 |  |
| `app-rooms-id-scenes-page-tsx-50` | 添加 Token |  |
| `app-rooms-id-scenes-page-tsx-51` | 默认占位 |  |
| `app-rooms-id-scenes-page-tsx-52` | 角色卡未配置图片 |  |
| `app-rooms-id-scenes-page-tsx-53` | 边框色 |  |
| `app-rooms-id-scenes-page-tsx-54` | 尺寸 |  |
| `app-rooms-id-scenes-page-tsx-55` | 旋转 |  |
| `app-rooms-id-scenes-page-tsx-56` | 显示名称 |  |
| `app-rooms-id-scenes-page-tsx-57` | 显示 HP 条 |  |
| `app-rooms-id-scenes-page-tsx-58` | 保存 Token |  |
| `app-rooms-id-scenes-page-tsx-59` | 暴风雨 |  |
| `app-rooms-id-scenes-page-tsx-60` | 樱吹雪 |  |
| `app-rooms-id-scenes-page-tsx-61` | 花瓣 |  |
| `app-rooms-id-scenes-page-tsx-62` | 黎明 |  |
| `app-rooms-id-scenes-page-tsx-63` | 白天 |  |
| `app-rooms-id-scenes-page-tsx-64` | 黄昏 |  |
| `app-rooms-id-scenes-page-tsx-65` | 夜晚 |  |
| `app-rooms-id-scenes-page-tsx-66` | 午夜 |  |
| `app-rooms-id-scenes-page-tsx-67` |  个场景 / searchParams.encounters ?? | 删除 |
| `app-rooms-id-scenes-page-tsx-68` | 例：红魔馆大厅 |  |
| `app-rooms-id-scenes-page-tsx-69` | 给玩家看的简短描述 |  |
| `app-rooms-id-scenes-page-tsx-70` | 未配置地图 |  |
| `app-rooms-id-scenes-page-tsx-71` | 个 Token |  |
| `app-rooms-id-scenes-page-tsx-72` | 上传场景背景 |  |
| `app-rooms-id-scenes-page-tsx-73` | 上传地图背景 |  |
| `app-rooms-id-scenes-page-tsx-74` | 图层图片 |  |
| `app-rooms-id-scenes-page-tsx-75` | 例：室内地板 |  |

## `app/rooms/new/page.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `app-rooms-new-page-tsx-1` | ← 返回房间列表 |  |
| `app-rooms-new-page-tsx-2` | 创建房间 |  |
| `app-rooms-new-page-tsx-3` | 开团前一次性锁定规则；KP 之后仍可覆盖，但会留下审计记录 | 开团前确认规则；之后仍可调整，并会留下记录。 |
| `app-rooms-new-page-tsx-4` | 请填写房间名后再创建。 |  |
| `app-rooms-new-page-tsx-5` | 车卡方式不合法，请重新选择。 |  |
| `app-rooms-new-page-tsx-6` | 创建房间失败，请重试；如果持续失败，请刷新页面或重启 dev server。 | 创建房间失败，请稍后重试。 |

## `components/admin/RulePackConfigEditor.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-admin-rulepackconfigeditor-tsx-1` | JSON 不合法 | 格式不正确 |
| `components-admin-rulepackconfigeditor-tsx-2` | 系统 |  |
| `components-admin-rulepackconfigeditor-tsx-3` | 属性下限 |  |
| `components-admin-rulepackconfigeditor-tsx-4` | 属性上限 |  |
| `components-admin-rulepackconfigeditor-tsx-5` | 启用魔法规则（magic.enabled） | 启用魔法规则 |
| `components-admin-rulepackconfigeditor-tsx-6` | 技能 / 种族 / 战斗 / 法术等复杂结构请切到「JSON 编辑」修改。表单只覆盖系统与常用开关，不会动其它字段。 | 技能、种族、战斗、法术等复杂配置请使用「高级编辑」。 |
| `components-admin-rulepackconfigeditor-tsx-7` | JSON 不合法，无法用表单编辑，请先在 JSON 模式修正。 | 当前内容格式有误，请先在高级编辑中修正。 |
| `components-admin-rulepackconfigeditor-tsx-8` | 表单编辑 |  |
| `components-admin-rulepackconfigeditor-tsx-9` | JSON 编辑 | 高级编辑 |

## `components/character/BackstoryPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-character-backstorypanel-tsx-1` | 背景故事与经历 |  |
| `components-character-backstorypanel-tsx-2` | 调查员经历 |  |
| `components-character-backstorypanel-tsx-3` | 神话相关（第三类接触） |  |
| `components-character-backstorypanel-tsx-4` | 法术一览 |  |
| `components-character-backstorypanel-tsx-5` | 调查员伙伴 |  |
| `components-character-backstorypanel-tsx-6` | 角色外貌 |  |
| `components-character-backstorypanel-tsx-7` | 思想与信念 |  |
| `components-character-backstorypanel-tsx-8` | 重要之人 |  |
| `components-character-backstorypanel-tsx-9` | 意义非凡之地 |  |
| `components-character-backstorypanel-tsx-10` | 宝贵之物 |  |
| `components-character-backstorypanel-tsx-11` | 特质 |  |
| `components-character-backstorypanel-tsx-12` | 难言之隐 |  |
| `components-character-backstorypanel-tsx-13` | 伤口和疤痕 |  |
| `components-character-backstorypanel-tsx-14` | 恐惧症和狂躁症 |  |

## `components/character/DeleteCharacterButton.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-character-deletecharacterbutton-tsx-1` | 删除角色 |  |
| `components-character-deletecharacterbutton-tsx-2` | 」？该操作不可恢复。 |  |

## `components/danmaku/DanmakuPatternEditor.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-danmaku-danmakupatterneditor-tsx-1` | 弹幕演出 |  |
| `components-danmaku-danmakupatterneditor-tsx-2` | 纯视觉。展开型符卡循环播放到被击破，消费型符卡播放一次；不参与战斗判定。 | 仅视觉效果，不影响战斗判定。展开型循环播放至击破，消费型播放一次。 |
| `components-danmaku-danmakupatterneditor-tsx-3` | 换一组随机种子 |  |
| `components-danmaku-danmakupatterneditor-tsx-4` | 预览 · 60fps | 预览 |
| `components-danmaku-danmakupatterneditor-tsx-5` | 添加图案（最多 3 层叠加） | 添加图层（最多 3 层） |
| `components-danmaku-danmakupatterneditor-tsx-6` | 当前图层 |  |
| `components-danmaku-danmakupatterneditor-tsx-7` | 删除 |  |
| `components-danmaku-danmakupatterneditor-tsx-8` | 图案类型 |  |
| `components-danmaku-danmakupatterneditor-tsx-9` | 弹数 |  |
| `components-danmaku-danmakupatterneditor-tsx-10` | 间隔（帧） |  |
| `components-danmaku-danmakupatterneditor-tsx-11` | 速度 |  |
| `components-danmaku-danmakupatterneditor-tsx-12` | 大小 |  |
| `components-danmaku-danmakupatterneditor-tsx-13` | 角度（-180~180） |  |
| `components-danmaku-danmakupatterneditor-tsx-14` | 张角（0~360） |  |
| `components-danmaku-danmakupatterneditor-tsx-15` | 旋转（每轮角度） |  |
| `components-danmaku-danmakupatterneditor-tsx-16` | 颜色 |  |
| `components-danmaku-danmakupatterneditor-tsx-17` | 弹形 |  |
| `components-danmaku-danmakupatterneditor-tsx-18` | 加色发光（更华丽，子弹多时略吃性能） | 加色发光（更华丽，弹幕多时可能不流畅） |
| `components-danmaku-danmakupatterneditor-tsx-19` | 高级参数 |  |
| `components-danmaku-danmakupatterneditor-tsx-20` | 加速度 |  |
| `components-danmaku-danmakupatterneditor-tsx-21` | 角速度（弯曲） |  |
| `components-danmaku-danmakupatterneditor-tsx-22` | 激光宽度 |  |
| `components-danmaku-danmakupatterneditor-tsx-23` | 预警帧 |  |
| `components-danmaku-danmakupatterneditor-tsx-24` | 存在帧 |  |

## `components/danmaku/DanmakuStage.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-danmaku-danmakustage-tsx-1` | 纯视觉演出 · 不参与判定 | 纯视觉演出 |
| `components-danmaku-danmakustage-tsx-2` | 消费型符卡 |  |
| `components-danmaku-danmakustage-tsx-3` | 战斗演出 · 待机 |  |
| `components-danmaku-danmakustage-tsx-4` | 符卡展开中 |  |
| `components-danmaku-danmakustage-tsx-5` | 符卡 · |  |
| `components-danmaku-danmakustage-tsx-6` | · 发动 |  |

## `components/layout/SiteHeader.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-layout-siteheader-tsx-1` | 房间 |  |
| `components-layout-siteheader-tsx-2` | 团本广场 |  |
| `components-layout-siteheader-tsx-3` | 我的团本 |  |
| `components-layout-siteheader-tsx-4` | 我的角色 |  |
| `components-layout-siteheader-tsx-5` | 我的卡牌 |  |
| `components-layout-siteheader-tsx-6` | 游戏历史 |  |

## `components/layout/UserMenu.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-layout-usermenu-tsx-1` | 返回 |  |
| `components-layout-usermenu-tsx-2` | 管理后台 |  |
| `components-layout-usermenu-tsx-3` | 修改昵称 |  |
| `components-layout-usermenu-tsx-4` | 修改头像 |  |
| `components-layout-usermenu-tsx-5` | 修改密码 |  |
| `components-layout-usermenu-tsx-6` | 界面主题 |  |
| `components-layout-usermenu-tsx-7` | 退出登录 |  |
| `components-layout-usermenu-tsx-8` | 新昵称 |  |
| `components-layout-usermenu-tsx-9` | 保存昵称 |  |
| `components-layout-usermenu-tsx-10` | 支持 PNG / JPEG / WebP，最大 8 MB；上传后自动裁剪为正方形。 | 支持常见图片格式，最大 8 MB；上传后会自动裁剪为正方形。 |
| `components-layout-usermenu-tsx-11` | 当前密码 |  |
| `components-layout-usermenu-tsx-12` | 新密码 |  |
| `components-layout-usermenu-tsx-13` | 确认新密码 |  |
| `components-layout-usermenu-tsx-14` | 更新密码 |  |
| `components-layout-usermenu-tsx-15` | 保存中… |  |
| `components-layout-usermenu-tsx-16` | 上传失败 |  |
| `components-layout-usermenu-tsx-17` | 网络错误，上传失败 | 上传失败，请重试。 |
| `components-layout-usermenu-tsx-18` | 🌙 夜间 |  |
| `components-layout-usermenu-tsx-19` | ☀️ 白天 |  |
| `components-layout-usermenu-tsx-20` | 上传中… |  |
| `components-layout-usermenu-tsx-21` | 选择图片上传 |  |

## `components/module/AiModuleImporter.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-aimoduleimporter-tsx-1` | 上传任意数量素材（文档 / 图片 / 表格，可多选） |  |
| `components-module-aimoduleimporter-tsx-2` | 目标系统 |  |
| `components-module-aimoduleimporter-tsx-3` | 自动判断 |  |
| `components-module-aimoduleimporter-tsx-4` | COC7 原版 |  |
| `components-module-aimoduleimporter-tsx-5` | 东方扩展 |  |
| `components-module-aimoduleimporter-tsx-6` | 年代 |  |
| `components-module-aimoduleimporter-tsx-7` | 模型（n8n 工作流会透传给 DeepSeek；涉及图片素材时推荐 deepseek-flash） | 模型（处理图片素材时建议选择视觉模型） |
| `components-module-aimoduleimporter-tsx-8` | 使用后台/环境默认（默认 deepseek-flash，支持 vision） | 使用默认模型（支持图片） |
| `components-module-aimoduleimporter-tsx-9` | deepseek-flash（推荐 · 支持图片视觉） | 视觉模型（推荐，支持图片） |
| `components-module-aimoduleimporter-tsx-10` | deepseek-v4-pro（文本推理） | 文本模型（仅支持文本） |
| `components-module-aimoduleimporter-tsx-11` | 给 n8n 工作流的额外要求（可选） | 额外要求（可选） |
| `components-module-aimoduleimporter-tsx-12` | 任务在后台运行，页面每 2-3 秒刷新进度；公网穿透断开或关闭页面也不会中断，生成完成后会出现在「我的团本」。 | 任务会在后台继续，完成后可在「我的团本」查看。 |
| `components-module-aimoduleimporter-tsx-13` | AI 整合失败 |  |
| `components-module-aimoduleimporter-tsx-14` | 任务已创建，正在解析素材… |  |
| `components-module-aimoduleimporter-tsx-15` | AI 整合完成，正在跳转到团本详情… |  |
| `components-module-aimoduleimporter-tsx-16` | 任务仍在进行，但等待时间过长；请稍后重新发起或到「我的团本」查看。 | 解析时间较长，请稍后在「我的团本」查看。 |
| `components-module-aimoduleimporter-tsx-17` | 请求失败：网络中断或服务已重启，请稍后用同样素材重试。 | 请求失败，请稍后重试。 |
| `components-module-aimoduleimporter-tsx-18` | 例：重点整合 NPC 关系图；把地图截图对应写成场景；偏向轻松搞笑风格…… |  |
| `components-module-aimoduleimporter-tsx-19` | n8n 工作流解析中… | 正在解析… |
| `components-module-aimoduleimporter-tsx-20` | n8n 工作流解析团本 | AI 解析团本 |
| `components-module-aimoduleimporter-tsx-21` | （模型 | 删除 |
| `components-module-aimoduleimporter-tsx-22` | ，文本段 | 删除 |
| `components-module-aimoduleimporter-tsx-23` | ，图片 | 删除 |
| `components-module-aimoduleimporter-tsx-24` | ，调用 | 删除 |
| `components-module-aimoduleimporter-tsx-25` | 次） | 删除 |

## `components/module/ConfirmModuleDeleteButton.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-confirmmoduledeletebutton-tsx-1` | 确定删除这个团本吗？正在进行的局不能删除。 |  |
| `components-module-confirmmoduledeletebutton-tsx-2` | 删除 |  |

## `components/module/MagicEffectComposer.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-magiceffectcomposer-tsx-1` | 魔法效果组合 |  |
| `components-module-magiceffectcomposer-tsx-2` | 选择任意基础效果，按顺序组合成一条法术。 |  |
| `components-module-magiceffectcomposer-tsx-3` | + 添加效果 |  |
| `components-module-magiceffectcomposer-tsx-4` | JSON 合法，已同步到表单。 | 格式正确，已同步到表单。 |
| `components-module-magiceffectcomposer-tsx-5` | 当前没有效果，点击「+ 添加效果」开始组合。 |  |
| `components-module-magiceffectcomposer-tsx-6` | 当前卡类型不允许该效果，请更换或删除 |  |
| `components-module-magiceffectcomposer-tsx-7` | 上移 |  |
| `components-module-magiceffectcomposer-tsx-8` | 下移 |  |
| `components-module-magiceffectcomposer-tsx-9` | 删除 |  |
| `components-module-magiceffectcomposer-tsx-10` | 查看当前组合 JSON | 查看当前组合 |
| `components-module-magiceffectcomposer-tsx-11` | JSON 必须是效果数组，例如 [ \"type\": \"DAMAGE\", \"amount\": \"1d6\" ] | 请填写效果列表，例如：伤害 1d6。 |
| `components-module-magiceffectcomposer-tsx-12` | 有无法识别的效果（type 不在 14 种基础效果里），已忽略这些项。 | 有无法识别的效果，已忽略。 |
| `components-module-magiceffectcomposer-tsx-13` | JSON 解析失败 | 格式解析失败 |
| `components-module-magiceffectcomposer-tsx-14` | 表单 | 表单编辑 |

## `components/module/ModuleActions.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-moduleactions-tsx-1` | 复制团本 |  |
| `components-module-moduleactions-tsx-2` | 删除团本 |  |

## `components/module/ModuleAssetActions.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-moduleassetactions-tsx-1` | 替换 |  |
| `components-module-moduleassetactions-tsx-2` | 删除 |  |
| `components-module-moduleassetactions-tsx-3` | 替换失败 |  |
| `components-module-moduleassetactions-tsx-4` | 替换请求失败 |  |
| `components-module-moduleassetactions-tsx-5` | 确定删除这个资源吗？引用它的正文可能需要手动修正。 | 确定删除这个资源吗？删除后引用可能失效。 |
| `components-module-moduleassetactions-tsx-6` | 删除失败 |  |
| `components-module-moduleassetactions-tsx-7` | 删除请求失败 |  |

## `components/module/ModuleAssetUpload.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-moduleassetupload-tsx-1` | 无图 |  |
| `components-module-moduleassetupload-tsx-2` | 清除 |  |
| `components-module-moduleassetupload-tsx-3` | 上传失败 |  |
| `components-module-moduleassetupload-tsx-4` | 网络错误，上传失败 | 上传失败，请重试。 |
| `components-module-moduleassetupload-tsx-5` | 资源相对路径，可直接上传 | 图片路径（也可直接上传） |
| `components-module-moduleassetupload-tsx-6` | 上传中… |  |
| `components-module-moduleassetupload-tsx-7` | 上传素材 |  |

## `components/module/ModuleEntityEditors.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-moduleentityeditors-tsx-1` | 名称 |  |
| `components-module-moduleentityeditors-tsx-2` | 副标题 |  |
| `components-module-moduleentityeditors-tsx-3` | 种族 |  |
| `components-module-moduleentityeditors-tsx-4` | 稀有度 |  |
| `components-module-moduleentityeditors-tsx-5` | 标签（逗号分隔） |  |
| `components-module-moduleentityeditors-tsx-6` | 描述 |  |
| `components-module-moduleentityeditors-tsx-7` | 技能（SKILL:值，逗号分隔） | 技能（技能:数值，逗号分隔） |
| `components-module-moduleentityeditors-tsx-8` | Token 图路径（留空则用默认占位） | Token 图（留空使用默认图） |
| `components-module-moduleentityeditors-tsx-9` | 默认对玩家公开属性 |  |
| `components-module-moduleentityeditors-tsx-10` | 类型 |  |
| `components-module-moduleentityeditors-tsx-11` | 数量 |  |
| `components-module-moduleentityeditors-tsx-12` | 伤害（近战可用 db） |  |
| `components-module-moduleentityeditors-tsx-13` | 射程 |  |
| `components-module-moduleentityeditors-tsx-14` | 技能 ID | 技能 |
| `components-module-moduleentityeditors-tsx-15` | 命中修正 |  |
| `components-module-moduleentityeditors-tsx-16` | MP 消耗 |  |
| `components-module-moduleentityeditors-tsx-17` | 效果说明 |  |
| `components-module-moduleentityeditors-tsx-18` | 标题 |  |
| `components-module-moduleentityeditors-tsx-19` | 关联证物 id（可选） | 关联证物（可选） |
| `components-module-moduleentityeditors-tsx-20` | 线索正文 |  |
| `components-module-moduleentityeditors-tsx-21` | 默认对所有玩家可见 |  |
| `components-module-moduleentityeditors-tsx-22` | 场景名 |  |
| `components-module-moduleentityeditors-tsx-23` | 宽度 |  |
| `components-module-moduleentityeditors-tsx-24` | 高度 |  |
| `components-module-moduleentityeditors-tsx-25` | 网格大小 |  |
| `components-module-moduleentityeditors-tsx-26` | 网格类型 |  |
| `components-module-moduleentityeditors-tsx-27` | 背景色 |  |
| `components-module-moduleentityeditors-tsx-28` | 显示网格 |  |
| `components-module-moduleentityeditors-tsx-29` | 启用迷雾 |  |
| `components-module-moduleentityeditors-tsx-30` | 场景描述 |  |
| `components-module-moduleentityeditors-tsx-31` | 旁白 |  |
| `components-module-moduleentityeditors-tsx-32` | 法术名 |  |
| `components-module-moduleentityeditors-tsx-33` | 检定技能 |  |
| `components-module-moduleentityeditors-tsx-34` | SAN 消耗 |  |
| `components-module-moduleentityeditors-tsx-35` | 目标数量 |  |
| `components-module-moduleentityeditors-tsx-36` | SELF 自己 | 自己 |
| `components-module-moduleentityeditors-tsx-37` | ONE 单体 | 单体 |
| `components-module-moduleentityeditors-tsx-38` | ALL 全体 | 全体 |
| `components-module-moduleentityeditors-tsx-39` | 目标阵营（留空自动推断） |  |
| `components-module-moduleentityeditors-tsx-40` | 自动 |  |
| `components-module-moduleentityeditors-tsx-41` | ALLY 友方 | 友方 |
| `components-module-moduleentityeditors-tsx-42` | ENEMY 敌方 | 敌方 |
| `components-module-moduleentityeditors-tsx-43` | ANY 任意 | 任意 |
| `components-module-moduleentityeditors-tsx-44` | 结构化内容编辑 | 内容编辑 |
| `components-module-moduleentityeditors-tsx-45` | 直接编辑角色 / 物品 / 线索 / 场景。保存后会同步写入标准 Markdown 的结构化块与只读模板，应用团本预设时生效。 | 编辑角色、物品、线索与场景；保存后会在应用团本预设时生效。 |
| `components-module-moduleentityeditors-tsx-46` | + 新增 NPC / 角色 |  |
| `components-module-moduleentityeditors-tsx-47` | + 新增物品 / 证物 |  |
| `components-module-moduleentityeditors-tsx-48` | + 新增线索 |  |
| `components-module-moduleentityeditors-tsx-49` | + 新增法术 |  |
| `components-module-moduleentityeditors-tsx-50` | + 新增场景 |  |
| `components-module-moduleentityeditors-tsx-51` | 新增 |  |
| `components-module-moduleentityeditors-tsx-52` | 保存 |  |
| `components-module-moduleentityeditors-tsx-53` | 力量 |  |
| `components-module-moduleentityeditors-tsx-54` | 体质 |  |
| `components-module-moduleentityeditors-tsx-55` | 体型 |  |
| `components-module-moduleentityeditors-tsx-56` | 敏捷 |  |
| `components-module-moduleentityeditors-tsx-57` | 外貌 |  |
| `components-module-moduleentityeditors-tsx-58` | 智力 |  |
| `components-module-moduleentityeditors-tsx-59` | 意志 |  |
| `components-module-moduleentityeditors-tsx-60` | 教育 |  |
| `components-module-moduleentityeditors-tsx-61` | 幸运 |  |
| `components-module-moduleentityeditors-tsx-62` | 角色立绘 / Token 图（可上传） |  |
| `components-module-moduleentityeditors-tsx-63` | 物品图片（可上传） |  |
| `components-module-moduleentityeditors-tsx-64` | 线索图片 / 手书（可上传） |  |
| `components-module-moduleentityeditors-tsx-65` | 场景地图 / 背景（可上传） |  |
| `components-module-moduleentityeditors-tsx-66` | 角色 |  |
| `components-module-moduleentityeditors-tsx-67` | 物品 |  |
| `components-module-moduleentityeditors-tsx-68` | 线索 |  |
| `components-module-moduleentityeditors-tsx-69` | 法术 |  |
| `components-module-moduleentityeditors-tsx-70` | 场景 |  |
| `components-module-moduleentityeditors-tsx-71` | NPC / 角色 |  |
| `components-module-moduleentityeditors-tsx-72` | 物品 / 武器 / 证物 |  |
| `components-module-moduleentityeditors-tsx-73` | 线索 / 手书 |  |
| `components-module-moduleentityeditors-tsx-74` | 场景 / 地图 |  |

## `components/module/ModuleImporter.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-moduleimporter-tsx-1` | 选择 .md 或 .zip 标准团本包 | 选择团本包（.md 或 .zip） |
| `components-module-moduleimporter-tsx-2` | 标准包导入 |  |
| `components-module-moduleimporter-tsx-3` | n8n 工作流解析 | AI 解析 |
| `components-module-moduleimporter-tsx-4` | 导入失败 |  |
| `components-module-moduleimporter-tsx-5` | 导入请求失败 |  |
| `components-module-moduleimporter-tsx-6` | 导入中… |  |
| `components-module-moduleimporter-tsx-7` | 导入标准团本 |  |

## `components/module/ModuleMarkdown.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-modulemarkdown-tsx-1` | 暂无正文 |  |

## `components/module/ModulePublicCard.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-modulepubliccard-tsx-1` | 背景 |  |
| `components-module-modulepubliccard-tsx-2` | 简介 |  |
| `components-module-modulepubliccard-tsx-3` | 职业推荐 |  |
| `components-module-modulepubliccard-tsx-4` | 公开预览 |  |
| `components-module-modulepubliccard-tsx-5` | 未填写 |  |
| `components-module-modulepubliccard-tsx-6` | 未署名 |  |
| `components-module-modulepubliccard-tsx-7` | 未指定系统 |  |
| `components-module-modulepubliccard-tsx-8` | 未指定年代 |  |

## `components/module/RoomPresetContentPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-module-roompresetcontentpanel-tsx-1` | 预设内容 |  |
| `components-module-roompresetcontentpanel-tsx-2` | 本团本还没有应用到当前房间。先回准备页点击「应用团本预设到房间」，NPC / 线索 / 场景才会生成并在这里编辑。 | 该团本尚未应用到房间，请先在准备页应用预设。 |
| `components-module-roompresetcontentpanel-tsx-3` | 预设内容编辑（KP） |  |
| `components-module-roompresetcontentpanel-tsx-4` | 这些对象来自当前房间已应用的团本预设。编辑只影响本房间，不会修改团本模板。 | 编辑仅影响本房间，不会修改团本模板。 |
| `components-module-roompresetcontentpanel-tsx-5` | 本预设没有 NPC / Boss。 |  |
| `components-module-roompresetcontentpanel-tsx-6` | 未公开 |  |
| `components-module-roompresetcontentpanel-tsx-7` | 本预设没有线索。 |  |
| `components-module-roompresetcontentpanel-tsx-8` | 本预设没有物品卡。 |  |
| `components-module-roompresetcontentpanel-tsx-9` | 本预设没有场景。 |  |
| `components-module-roompresetcontentpanel-tsx-10` | 当前 |  |
| `components-module-roompresetcontentpanel-tsx-11` | 场景背景与结构请在团本编辑器中维护 | 场景背景请在团本编辑器中维护 |
| `components-module-roompresetcontentpanel-tsx-12` | 本预设没有遭遇。 |  |
| `components-module-roompresetcontentpanel-tsx-13` | 公开 |  |
| `components-module-roompresetcontentpanel-tsx-14` | KP 可见 |  |

## `components/room/ArchiveRoomButton.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-archiveroombutton-tsx-1` | 归档房间 |  |
| `components-room-archiveroombutton-tsx-2` | 确定要归档「 |  |
| `components-room-archiveroombutton-tsx-3` | 」吗？归档后房间不再出现在进行中列表，但历史数据会保留。 | 」吗？归档后将从进行中列表移除，历史记录保留。 |

## `components/room/AutoSubmitCharacterSelect.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-autosubmitcharacterselect-tsx-1` | 选择角色（选择后自动保存） |  |
| `components-room-autosubmitcharacterselect-tsx-2` | （不选择） |  |
| `components-room-autosubmitcharacterselect-tsx-3` | 保存当前角色 |  |

## `components/room/CardBuilder.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-cardbuilder-tsx-1` | 卡牌类型 |  |
| `components-room-cardbuilder-tsx-2` | 基本信息 |  |
| `components-room-cardbuilder-tsx-3` | 卡名 |  |
| `components-room-cardbuilder-tsx-4` | 副标题（可留空） | 副标题 |
| `components-room-cardbuilder-tsx-5` | 说明（可留空） | 说明 |
| `components-room-cardbuilder-tsx-6` | 符卡 |  |
| `components-room-cardbuilder-tsx-7` | 符卡类型 |  |
| `components-room-cardbuilder-tsx-8` | 展开型 · 有独立 HP，可被击破 |  |
| `components-room-cardbuilder-tsx-9` | 消费型 · 瞬间发动，每场一次 |  |
| `components-room-cardbuilder-tsx-10` | 符卡说明（战斗日志展示用） | 符卡说明 |
| `components-room-cardbuilder-tsx-11` | 独立 HP 倍率（最大 HP × N） |  |
| `components-room-cardbuilder-tsx-12` | 被击破时清弹范围 |  |
| `components-room-cardbuilder-tsx-13` | 全场弹幕 |  |
| `components-room-cardbuilder-tsx-14` | 仅他人弹幕 |  |
| `components-room-cardbuilder-tsx-15` | 强化方向 |  |
| `components-room-cardbuilder-tsx-16` | 强化数值 |  |
| `components-room-cardbuilder-tsx-17` | 武器 |  |
| `components-room-cardbuilder-tsx-18` | 武器类型（伤害 / 射程 / 使用技能由系统自动带出） | 武器类型（自动带出伤害、射程与技能） |
| `components-room-cardbuilder-tsx-19` | 命中修正 |  |
| `components-room-cardbuilder-tsx-20` | 自动结果 |  |
| `components-room-cardbuilder-tsx-21` | 道具 |  |
| `components-room-cardbuilder-tsx-22` | 效果 |  |
| `components-room-cardbuilder-tsx-23` | 通用效果 / 消耗 |  |
| `components-room-cardbuilder-tsx-24` | 魔法、道具、符卡、武器共用同一套效果；数值各自填写。 | 删除 |
| `components-room-cardbuilder-tsx-25` | 目标阵营 |  |
| `components-room-cardbuilder-tsx-26` | 作用范围 |  |
| `components-room-cardbuilder-tsx-27` | 灵力 / MP 消耗 |  |
| `components-room-cardbuilder-tsx-28` | SAN 消耗（如 1d3） |  |
| `components-room-cardbuilder-tsx-29` | 使用次数（留空 = 无限） |  |
| `components-room-cardbuilder-tsx-30` | 冷却轮次 |  |
| `components-room-cardbuilder-tsx-31` | 可用场景 |  |
| `components-room-cardbuilder-tsx-32` | 保存后进入房间卡池，所有成员可见 | 保存后所有成员可见 |
| `components-room-cardbuilder-tsx-33` | 战斗内 |  |
| `components-room-cardbuilder-tsx-34` | 战斗外 |  |
| `components-room-cardbuilder-tsx-35` | 保存中… |  |
| `components-room-cardbuilder-tsx-36` | 保存卡牌 |  |
| `components-room-cardbuilder-tsx-37` | 例：梦想封印 |  |
| `components-room-cardbuilder-tsx-38` | 例：被诅咒的符札如暴雨般倾泻 |  |
| `components-room-cardbuilder-tsx-39` | 例：回复 1d4 点生命 |  |

## `components/room/CharacterBuilder.tsx`

| ID | 原文 | 你的修改                           |
|---|---|--------------------------------|
| `components-room-characterbuilder-tsx-1` | 第一页 · 角色属性与技能（必填） | 角色基本属性与技能                      |
| `components-room-characterbuilder-tsx-2` | 第二页 · 人物故事 / 财产 / 物品（选填） | 人物故事 / 财产 / 持有物                |
| `components-room-characterbuilder-tsx-3` | 基本信息 |                                |
| `components-room-characterbuilder-tsx-4` | 角色名 |                                |
| `components-room-characterbuilder-tsx-5` | 玩家名 |                                |
| `components-room-characterbuilder-tsx-6` | 性别 |                                |
| `components-room-characterbuilder-tsx-7` | 住地 |                                |
| `components-room-characterbuilder-tsx-8` | 种族 |                                |
| `components-room-characterbuilder-tsx-9` | （未选择） |                                |
| `components-room-characterbuilder-tsx-10` | 职业 |                                |
| `components-room-characterbuilder-tsx-11` | （未选择职业） |                                |
| `components-room-characterbuilder-tsx-12` | 选择职业后才能使用职业点。兴趣点不受职业限制。 |                                |
| `components-room-characterbuilder-tsx-13` | 含自选技能位，自选部分请按 KP 审核意见分配。 | 含自选技能位，请按 KP 要求分配。             |
| `components-room-characterbuilder-tsx-14` | 本职空位：先选择技能，选中后才会变为「本职」并可用职业点；不选则按兴趣技能处理。 | 先选择技能才能使用职业点；未选择则按兴趣点计算。       |
| `components-room-characterbuilder-tsx-15` | 先掷一次 5 组属性；鼠标点击下方结果里的「选用」后，9 维才会锁定为那一组。 | 掷出 5 组属性后，点击「选用」锁定一组。          |
| `components-room-characterbuilder-tsx-16` | 合计 |                                |
| `components-room-characterbuilder-tsx-17` | 年龄补正 |                                |
| `components-room-characterbuilder-tsx-18` | 按规则分配扣减；改年龄可重新分配。 |                                |
| `components-room-characterbuilder-tsx-19` | 年龄 |                                |
| `components-room-characterbuilder-tsx-20` | 玩家分配扣减 |                                |
| `components-room-characterbuilder-tsx-21` | 系统自动执行 |                                |
| `components-room-characterbuilder-tsx-22` | 年龄修正后预览 |                                |
| `components-room-characterbuilder-tsx-23` | 年龄补正已确认并锁定；最终属性按上方结果只读展示 | 年龄补正已确认并锁定。                    |
| `components-room-characterbuilder-tsx-24` | 重新分配 |                                |
| `components-room-characterbuilder-tsx-25` | 衍生属性（实时计算） | 衍生属性                           |
| `components-room-characterbuilder-tsx-26` | 技能分配 |                                |
| `components-room-characterbuilder-tsx-27` | 本职用职业点，其余用兴趣点，同一技能不能混用。 | 本职技能用职业点，其余用兴趣点；同一技能不能混用。      |
| `components-room-characterbuilder-tsx-28` | 职业点剩余 |                                |
| `components-room-characterbuilder-tsx-29` | 兴趣点剩余 |                                |
| `components-room-characterbuilder-tsx-30` | 还没选择职业。当前所有技能加点都按兴趣点计算，不能使用职业点。 | 尚未选择职业，当前只能使用兴趣点。              |
| `components-room-characterbuilder-tsx-31` | 全部类别 |                                |
| `components-room-characterbuilder-tsx-32` | 用途 |                                |
| `components-room-characterbuilder-tsx-33` | 类型 |                                |
| `components-room-characterbuilder-tsx-34` | 清空筛选 |                                |
| `components-room-characterbuilder-tsx-35` | 没有匹配的技能 |                                |
| `components-room-characterbuilder-tsx-36` | 基础 |                                |
| `components-room-characterbuilder-tsx-37` | 总计 |                                |
| `components-room-characterbuilder-tsx-38` | 本职加点 |                                |
| `components-room-characterbuilder-tsx-39` | 兴趣加点 |                                |
| `components-room-characterbuilder-tsx-40` | + 趣 |                                |
| `components-room-characterbuilder-tsx-41` | 清空 |                                |
| `components-room-characterbuilder-tsx-42` | 第一页必须填完整；完成后进入第二页（人物故事 / 财产 / 持有物品，均可留空）。 | 删除                             |
| `components-room-characterbuilder-tsx-43` | 下一步：人物故事 / 财产 / 物品 | 下一步                            |
| `components-room-characterbuilder-tsx-44` | 人物故事（选填） |                                |
| `components-room-characterbuilder-tsx-45` | 角色外貌 |                                |
| `components-room-characterbuilder-tsx-46` | 思想与信念 |                                |
| `components-room-characterbuilder-tsx-47` | 重要之人 |                                |
| `components-room-characterbuilder-tsx-48` | 意义非凡之地 |                                |
| `components-room-characterbuilder-tsx-49` | 宝贵之物 |                                |
| `components-room-characterbuilder-tsx-50` | 特质 |                                |
| `components-room-characterbuilder-tsx-51` | 难言之隐 |                                |
| `components-room-characterbuilder-tsx-52` | 伤口和疤痕 |                                |
| `components-room-characterbuilder-tsx-53` | 恐惧症和狂躁症 |                                |
| `components-room-characterbuilder-tsx-54` | 调查员经历（JSON 数组，选填） | 调查员经历                      |
| `components-room-characterbuilder-tsx-55` | 神话相关（JSON 数组，选填） | 神话相关                      |
| `components-room-characterbuilder-tsx-56` | 调查员伙伴（JSON 数组，选填） | 调查员伙伴                     |
| `components-room-characterbuilder-tsx-57` | 法术一览（JSON 数组，选填；name 会作为持有法术） | 法术一览                      |
| `components-room-characterbuilder-tsx-58` | 财产（选填） |                                |
| `components-room-characterbuilder-tsx-59` | 持有物品（选填） |                                |
| `components-room-characterbuilder-tsx-60` | 从卡库选择；卡牌属性统一在卡牌编辑页维护。 | 从卡库选择；卡牌属性请在卡牌编辑页修改。           |
| `components-room-characterbuilder-tsx-61` | 新建卡牌 |                                |
| `components-room-characterbuilder-tsx-62` | 刷新卡库 |                                |
| `components-room-characterbuilder-tsx-63` | 还没有持有物品。 |                                |
| `components-room-characterbuilder-tsx-64` | 编辑卡牌 |                                |
| `components-room-characterbuilder-tsx-65` | 卸下 |                                |
| `components-room-characterbuilder-tsx-66` | 卡库没有可加入的卡， |                                |
| `components-room-characterbuilder-tsx-67` | 去卡牌编辑页创建 |                                |
| `components-room-characterbuilder-tsx-68` | 加入 |                                |
| `components-room-characterbuilder-tsx-69` | 第二页都是选填，可以直接提交。 |                                |
| `components-room-characterbuilder-tsx-70` | 上一步 |                                |
| `components-room-characterbuilder-tsx-71` | 体质 CON |                                |
| `components-room-characterbuilder-tsx-72` | 体型 SIZ |                                |
| `components-room-characterbuilder-tsx-73` | 敏捷 DEX |                                |
| `components-room-characterbuilder-tsx-74` | 外貌 APP |                                |
| `components-room-characterbuilder-tsx-75` | 智力 INT |                                |
| `components-room-characterbuilder-tsx-76` | 意志 POW |                                |
| `components-room-characterbuilder-tsx-77` | 教育 EDU |                                |
| `components-room-characterbuilder-tsx-78` | 幸运 LUCK |                                |
| `components-room-characterbuilder-tsx-79` | 生命 HP |                                |
| `components-room-characterbuilder-tsx-80` | 灵力 MP |                                |
| `components-room-characterbuilder-tsx-81` | 理智 SAN |                                |
| `components-room-characterbuilder-tsx-82` | 骰池 DP |                                |
| `components-room-characterbuilder-tsx-83` | 战斗 |                                |
| `components-room-characterbuilder-tsx-84` | 身体 |                                |
| `components-room-characterbuilder-tsx-85` | 知识 |                                |
| `components-room-characterbuilder-tsx-86` | 社交 |                                |
| `components-room-characterbuilder-tsx-87` | 技术 |                                |
| `components-room-characterbuilder-tsx-88` | 法术 |                                |
| `components-room-characterbuilder-tsx-89` | 其他 |                                |
| `components-room-characterbuilder-tsx-90` | 信用评级必须在 |                                |
| `components-room-characterbuilder-tsx-91` | 之间（当前 |                                |
| `components-room-characterbuilder-tsx-92` | 请先完成并确认年龄补正。 |                                |
| `components-room-characterbuilder-tsx-93` | 角色名不能为空。 |                                |
| `components-room-characterbuilder-tsx-94` | 保存失败 |                                |
| `components-room-characterbuilder-tsx-95` | · 当前 |                                |
| `components-room-characterbuilder-tsx-96` | （未满足，保存前必须调整） |                                |
| `components-room-characterbuilder-tsx-97` | 任意特长 |                                |
| `components-room-characterbuilder-tsx-98` | 社交技能 |                                |
| `components-room-characterbuilder-tsx-99` | 多选 |                                |
| `components-room-characterbuilder-tsx-100` | 二选一 |                                |
| `components-room-characterbuilder-tsx-101` | 天命 5 只能掷一次；掷完后从 5 组结果中选择 1 组，不能手动修改属性。 | 每组只能掷一次；从 5 组结果中选择 1 组，不可手动修改。 |
| `components-room-characterbuilder-tsx-102` | 直接在九维输入框里填写数值，系统实时校验总和与单项范围。 | 直接填写九维属性，系统会校验总和与范围。           |
| `components-room-characterbuilder-tsx-103` | 直接填写九维属性；保存时由服务端校验范围。 | 直接填写九维属性。                      |
| `components-room-characterbuilder-tsx-104` | 已满 |                                |
| `components-room-characterbuilder-tsx-105` | 剩余 |                                |
| `components-room-characterbuilder-tsx-106` | 超出 |                                |
| `components-room-characterbuilder-tsx-107` | 已掷完（只能掷一次） |                                |
| `components-room-characterbuilder-tsx-108` | 掷 5 组 |                                |
| `components-room-characterbuilder-tsx-109` | 请从以下 5 组中选择 1 组： |                                |
| `components-room-characterbuilder-tsx-110` | 已选择第 |                                |
| `components-room-characterbuilder-tsx-111` | 组；只能掷一次，但可以重新选用其他组。 | 组；可重新选择其他组。                    |
| `components-room-characterbuilder-tsx-112` | 已选用 |                                |
| `components-room-characterbuilder-tsx-113` | 选用 |                                |
| `components-room-characterbuilder-tsx-114` | 本年龄段无属性扣减 |                                |
| `components-room-characterbuilder-tsx-115` | 可扣： |                                |
| `components-room-characterbuilder-tsx-116` | 不变 |                                |
| `components-room-characterbuilder-tsx-117` | 次成长判定 |                                |
| `components-room-characterbuilder-tsx-118` | · 幸运掷两次取高 |                                |
| `components-room-characterbuilder-tsx-119` | 确认年龄扣减分配 |                                |
| `components-room-characterbuilder-tsx-120` | 确认年龄补正（无属性扣减） |                                |
| `components-room-characterbuilder-tsx-121` | 伤害加值 DB |                                |
| `components-room-characterbuilder-tsx-122` | 体格 Build |                                |
| `components-room-characterbuilder-tsx-123` | 移动力 MOV |                                |
| `components-room-characterbuilder-tsx-124` | 重伤值 |                                |
| `components-room-characterbuilder-tsx-125` | 搜索技能名 / ID | 搜索技能                           |
| `components-room-characterbuilder-tsx-126` | 可选本职 |                                |
| `components-room-characterbuilder-tsx-127` | 已加点 |                                |
| `components-room-characterbuilder-tsx-128` | 本职 |                                |
| `components-room-characterbuilder-tsx-129` | 兴趣 |                                |
| `components-room-characterbuilder-tsx-130` | 信用评级 |                                |
| `components-room-characterbuilder-tsx-131` | 生活水平 |                                |
| `components-room-characterbuilder-tsx-132` | 消费水平 |                                |
| `components-room-characterbuilder-tsx-133` | 其他资产 |                                |
| `components-room-characterbuilder-tsx-134` | 现金 |                                |
| `components-room-characterbuilder-tsx-135` | 现金单位 |                                |
| `components-room-characterbuilder-tsx-136` | 交通工具 |                                |
| `components-room-characterbuilder-tsx-137` | 住所 |                                |
| `components-room-characterbuilder-tsx-138` | 奢侈品 |                                |
| `components-room-characterbuilder-tsx-139` | 股票 / 证券 |                                |
| `components-room-characterbuilder-tsx-140` | 武器 |                                |
| `components-room-characterbuilder-tsx-141` | 符卡 |                                |
| `components-room-characterbuilder-tsx-142` | 道具 |                                |
| `components-room-characterbuilder-tsx-143` | 提交中… |                                |
| `components-room-characterbuilder-tsx-144` | 保存修改 |                                |
| `components-room-characterbuilder-tsx-145` | 创建角色 |                                |
| `components-room-characterbuilder-tsx-146` | 提交给 KP 审核 |                                |

## `components/room/ClueAdminControls.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-clueadmincontrols-tsx-1` | 删除线索 |  |
| `components-room-clueadmincontrols-tsx-2` | 编辑线索 |  |
| `components-room-clueadmincontrols-tsx-3` | 对所有成员公开 |  |
| `components-room-clueadmincontrols-tsx-4` | 删除现有图片 |  |
| `components-room-clueadmincontrols-tsx-5` | 保存线索 |  |
| `components-room-clueadmincontrols-tsx-6` | 发给特定玩家 |  |
| `components-room-clueadmincontrols-tsx-7` | 房间里还没有其他成员。 |  |
| `components-room-clueadmincontrols-tsx-8` | 勾选后会替换当前分享名单；全部取消表示撤回转发。 | 全部取消表示撤回分享。 |
| `components-room-clueadmincontrols-tsx-9` | 保存分享名单 |  |
| `components-room-clueadmincontrols-tsx-10` | 取消公开 |  |
| `components-room-clueadmincontrols-tsx-11` | 公布给所有人 |  |
| `components-room-clueadmincontrols-tsx-12` | 线索内容（可只上传图片） |  |

## `components/room/CombatBoard.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-combatboard-tsx-1` | 攻击技能与实际伤害；伤害只读，由服务端装备数据生成。 */ readonly attackOptionsByParticipant: Readonly | 删除 |
| `components-room-combatboard-tsx-2` | 已装备的符卡（仅 TOUHOU）。 */ readonly spellCardsByParticipant: Readonly | 删除 |
| `components-room-combatboard-tsx-3` | 已装备、可在战斗中使用的道具卡。 */ readonly itemOptionsByParticipant: Readonly | 删除 |
| `components-room-combatboard-tsx-4` | 立绘 / 头像 URL。 */ readonly portraits: Readonly | 删除 |
| `components-room-combatboard-tsx-5` | 轮到你应对了，请在下方选择应对方式。 |  |
| `components-room-combatboard-tsx-6` | 后退 1 格 |  |
| `components-room-combatboard-tsx-7` | 前进 1 格 |  |
| `components-room-combatboard-tsx-8` | 结束回合 |  |
| `components-room-combatboard-tsx-9` | 等待该单位行动 |  |
| `components-room-combatboard-tsx-10` | 同地点冲突：追上不会自动掉血。攻击消耗 1 行动点，按普通攻击检定结算，目标可以闪避 / 反击。 | 同地点攻击消耗 1 行动点，目标可闪避或反击。 |
| `components-room-combatboard-tsx-11` | 攻击已发出，正在等待目标应对…（KP 可强制结算） |  |
| `components-room-combatboard-tsx-12` | 当前地点没有敌对目标；先移动到目标所在地点。 |  |
| `components-room-combatboard-tsx-13` | 当前无可用攻击技能 |  |
| `components-room-combatboard-tsx-14` | 攻击同地点目标（1 AP） |  |
| `components-room-combatboard-tsx-15` | 参战单位 |  |
| `components-room-combatboard-tsx-16` | 可行动 |  |
| `components-room-combatboard-tsx-17` | 当前行动 |  |
| `components-room-combatboard-tsx-18` | 等待应对 |  |
| `components-room-combatboard-tsx-19` | 已退场 |  |
| `components-room-combatboard-tsx-20` | 旁观 |  |
| `components-room-combatboard-tsx-21` | 死亡 |  |
| `components-room-combatboard-tsx-22` | 濒死 |  |
| `components-room-combatboard-tsx-23` | 重伤 |  |
| `components-room-combatboard-tsx-24` | 倒地 |  |
| `components-room-combatboard-tsx-25` | 昏迷 |  |
| `components-room-combatboard-tsx-26` | 的应对： |  |
| `components-room-combatboard-tsx-27` | 提交应对 |  |
| `components-room-combatboard-tsx-28` | 行动 |  |
| `components-room-combatboard-tsx-29` | 当前行动： |  |
| `components-room-combatboard-tsx-30` | 目标 |  |
| `components-room-combatboard-tsx-31` | 技能 |  |
| `components-room-combatboard-tsx-32` | 攻击 |  |
| `components-room-combatboard-tsx-33` | 防御姿态 |  |
| `components-room-combatboard-tsx-34` | 跳过 |  |
| `components-room-combatboard-tsx-35` | 逃跑 / 发起追逐 |  |
| `components-room-combatboard-tsx-36` | 释放符卡 |  |
| `components-room-combatboard-tsx-37` | 规则外施法 |  |
| `components-room-combatboard-tsx-38` | 施法 |  |
| `components-room-combatboard-tsx-39` | 使用道具 |  |
| `components-room-combatboard-tsx-40` | KP 强制结算（未行动按跳过） | KP 强制结算 |
| `components-room-combatboard-tsx-41` | 中止战斗 |  |
| `components-room-combatboard-tsx-42` | 战斗日志 |  |
| `components-room-combatboard-tsx-43` | 不应对 |  |
| `components-room-combatboard-tsx-44` | 防御 |  |
| `components-room-combatboard-tsx-45` | 闪避 |  |
| `components-room-combatboard-tsx-46` | 反击 |  |
| `components-room-combatboard-tsx-47` | 逃跑 |  |
| `components-room-combatboard-tsx-48` | 规则外法术 |  |
| `components-room-combatboard-tsx-49` | 无法获取连接票据，请刷新页面 | 连接失败，请刷新页面重试。 |
| `components-room-combatboard-tsx-50` | 加入战斗失败 |  |
| `components-room-combatboard-tsx-51` | 徒手 |  |
| `components-room-combatboard-tsx-52` | 默认攻击 |  |
| `components-room-combatboard-tsx-53` | 逃跑（进入追逐） |  |
| `components-room-combatboard-tsx-54` | 消弹对抗 |  |
| `components-room-combatboard-tsx-55` | 连接已断开，请刷新页面后重试 | 连接已断开，请刷新后重试。 |
| `components-room-combatboard-tsx-56` | 当前没有可操作单位 |  |
| `components-room-combatboard-tsx-57` | 请先选择攻击目标 |  |
| `components-room-combatboard-tsx-58` | 行动失败 |  |
| `components-room-combatboard-tsx-59` | 追逐移动失败 |  |
| `components-room-combatboard-tsx-60` | 结束追逐回合失败 |  |
| `components-room-combatboard-tsx-61` | 放弃追逐失败 |  |
| `components-room-combatboard-tsx-62` | 当前地点没有可攻击的敌对目标 |  |
| `components-room-combatboard-tsx-63` | 当前单位没有可用攻击技能 |  |
| `components-room-combatboard-tsx-64` | 追逐攻击失败 |  |
| `components-room-combatboard-tsx-65` | 没有可用反击技能 |  |
| `components-room-combatboard-tsx-66` | 反应提交失败 |  |
| `components-room-combatboard-tsx-67` | 确定中止当前战斗吗？ |  |
| `components-room-combatboard-tsx-68` | 中止失败 |  |
| `components-room-combatboard-tsx-69` | 强制结算失败 |  |
| `components-room-combatboard-tsx-70` | 攻击检定 |  |
| `components-room-combatboard-tsx-71` | 闪避检定 |  |
| `components-room-combatboard-tsx-72` | 擦弹检定 |  |
| `components-room-combatboard-tsx-73` | 反击对抗 |  |
| `components-room-combatboard-tsx-74` | 伤害骰 |  |
| `components-room-combatboard-tsx-75` | 伤害结算 |  |
| `components-room-combatboard-tsx-76` | 检定 |  |
| `components-room-combatboard-tsx-77` | 伤害 |  |
| `components-room-combatboard-tsx-78` | 状态 |  |
| `components-room-combatboard-tsx-79` | 法术 |  |
| `components-room-combatboard-tsx-80` | 退场 |  |
| `components-room-combatboard-tsx-81` | 系统 |  |
| `components-room-combatboard-tsx-82` | 已连接 |  |
| `components-room-combatboard-tsx-83` | 连接中 |  |
| `components-room-combatboard-tsx-84` | 已断开 |  |
| `components-room-combatboard-tsx-85` | 载入战斗... |  |
| `components-room-combatboard-tsx-86` | 战斗 · |  |
| `components-room-combatboard-tsx-87` | 轮 · tick | 轮 |
| `components-room-combatboard-tsx-88` | · 当前 |  |
| `components-room-combatboard-tsx-89` | 出口 |  |
| `components-room-combatboard-tsx-90` | 地点 |  |
| `components-room-combatboard-tsx-91` | 放弃逃跑 / 投降 |  |
| `components-room-combatboard-tsx-92` | 放弃追逐 |  |
| `components-room-combatboard-tsx-93` | 追逐已结束 |  |
| `components-room-combatboard-tsx-94` | HP ？？？ · 数值未公开 | HP ？？？ |
| `components-room-combatboard-tsx-95` | 情报未知 |  |
| `components-room-combatboard-tsx-96` | 速度 ？？？ |  |
| `components-room-combatboard-tsx-97` | 速度 |  |
| `components-room-combatboard-tsx-98` | · 阵营 |  |
| `components-room-combatboard-tsx-99` | · 符卡展开 |  |
| `components-room-combatboard-tsx-100` | 追逐进行中，请使用上方追逐面板移动、攻击或结束回合。 |  |
| `components-room-combatboard-tsx-101` | 请先完成上方的应对。 |  |
| `components-room-combatboard-tsx-102` | 当前没有可行动的参战单位。 |  |
| `components-room-combatboard-tsx-103` | 当前单位还没就绪，请等待结算。 |  |
| `components-room-combatboard-tsx-104` | 等待 |  |
| `components-room-combatboard-tsx-105` | 行动；你没有可操作单位，只能旁观。 | 你没有可操作单位，只能旁观。 |
| `components-room-combatboard-tsx-106` | （你的角色） |  |
| `components-room-combatboard-tsx-107` | （你操控的 NPC） |  |
| `components-room-combatboard-tsx-108` | 闪避姿态 |  |
| `components-room-combatboard-tsx-109` | 闪避 / 擦弹姿态 |  |
| `components-room-combatboard-tsx-110` | 反击姿态 |  |
| `components-room-combatboard-tsx-111` | 消弹姿态 |  |
| `components-room-combatboard-tsx-112` | 展开 |  |
| `components-room-combatboard-tsx-113` | 消费 |  |
| `components-room-combatboard-tsx-114` | 展开型：生成独立 HP，被击破时会清弹；弹幕演出循环到被击破。 | 展开型：独立 HP，击破时清弹；演出循环播放。 |
| `components-room-combatboard-tsx-115` | 消费型：发动一次并附带消弹；弹幕演出只播放一次。 | 消费型：发动一次并消弹，演出播放一次。 |
| `components-room-combatboard-tsx-116` | 独立 HP 约 |  |
| `components-room-combatboard-tsx-117` | （自己） |  |
| `components-room-combatboard-tsx-118` | 自己 |  |
| `components-room-combatboard-tsx-119` | 全体敌方（AOE，所有目标都要应对） | 全体敌方 |
| `components-room-combatboard-tsx-120` | 全体友方 |  |
| `components-room-combatboard-tsx-121` | 场上全体 |  |
| `components-room-combatboard-tsx-122` | 单体敌方 |  |
| `components-room-combatboard-tsx-123` | 单体友方 |  |
| `components-room-combatboard-tsx-124` | 任意单体 |  |
| `components-room-combatboard-tsx-125` | · 效果： |  |
| `components-room-combatboard-tsx-126` | · 剩 |  |
| `components-room-combatboard-tsx-127` | 全体敌方 |  |
| `components-room-combatboard-tsx-128` | 伤害由角色实际装备决定，不可修改 | 伤害由实际装备决定 |

## `components/room/CombatUnitPicker.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-combatunitpicker-tsx-1` | 我方 |  |
| `components-room-combatunitpicker-tsx-2` | 敌方 |  |
| `components-room-combatunitpicker-tsx-3` | 不可参战 |  |
| `components-room-combatunitpicker-tsx-4` | 所选单位不在同一场景，无法开战；请先把他们移动到同一场景。 |  |

## `components/room/DisbandRoomButton.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-disbandroombutton-tsx-1` | 解散房间 |  |
| `components-room-disbandroombutton-tsx-2` | 确定要解散「 |  |
| `components-room-disbandroombutton-tsx-3` | 」吗？房间成员、聊天、战斗、团本关联数据都会被删除，且不可恢复。 | 」吗？房间内所有数据将被删除，且不可恢复。 |

## `components/room/EndGamePanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-endgamepanel-tsx-1` | 批量成长 / 奖励 |  |
| `components-room-endgamepanel-tsx-2` | 可一次给多名角色录入结束奖励；留空则直接结束本局。属性 / 技能 / SAN 会同步到基础角色卡，并写入成长记录。 | 可一次为多名角色录入奖励；留空则直接结束本局。奖励会同步到角色卡并记录成长。 |
| `components-room-endgamepanel-tsx-3` | + 添加一条 |  |
| `components-room-endgamepanel-tsx-4` | 暂无批量成长。可以直接确认结束，或先添加奖励。 | 尚未添加奖励，可直接结束本局。 |
| `components-room-endgamepanel-tsx-5` | 角色 |  |
| `components-room-endgamepanel-tsx-6` | 类型 |  |
| `components-room-endgamepanel-tsx-7` | 目标 |  |
| `components-room-endgamepanel-tsx-8` | 数值变化 |  |
| `components-room-endgamepanel-tsx-9` | 备注 |  |
| `components-room-endgamepanel-tsx-10` | 移除 |  |
| `components-room-endgamepanel-tsx-11` | 确认后：Game 置为 ENDED，房间回到 LOBBY，全员取消准备。角色、物品、成长记录跨局保留。 | 确认后本局结束，房间回到准备状态。角色、物品与成长记录会保留。 |
| `components-room-endgamepanel-tsx-12` | 确认结束本局 |  |
| `components-room-endgamepanel-tsx-13` | 技能 |  |
| `components-room-endgamepanel-tsx-14` | 属性 |  |
| `components-room-endgamepanel-tsx-15` | 物品 |  |
| `components-room-endgamepanel-tsx-16` | 关系 |  |
| `components-room-endgamepanel-tsx-17` | 其他 |  |
| `components-room-endgamepanel-tsx-18` | 无需填写 |  |
| `components-room-endgamepanel-tsx-19` | 技能 id，例如 FIGHTING_BRAWL | 技能（例如 格斗） |
| `components-room-endgamepanel-tsx-20` | 属性键，例如 int / edu / luck | 属性（例如 智力 / 教育 / 幸运） |
| `components-room-endgamepanel-tsx-21` | 物品名 |  |
| `components-room-endgamepanel-tsx-22` | 关系名 |  |
| `components-room-endgamepanel-tsx-23` | 奖励 / 成长说明键 | 奖励 / 成长说明 |
| `components-room-endgamepanel-tsx-24` | 例：+1 / -3 |  |
| `components-room-endgamepanel-tsx-25` | 非零整数 |  |
| `components-room-endgamepanel-tsx-26` | 来源 / 说明 |  |

## `components/room/GrowthCheckForm.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-growthcheckform-tsx-1` | 标记本局使用成功、需要幕间成长检定的技能。结束本局时可一键掷骰结算。 | 标记本局成功使用且需要成长的技能；结束本局时可统一结算。 |
| `components-room-growthcheckform-tsx-2` | 角色 |  |
| `components-room-growthcheckform-tsx-3` | 技能 |  |
| `components-room-growthcheckform-tsx-4` | 备注 |  |
| `components-room-growthcheckform-tsx-5` | 使用场景 / 说明 | 说明 |
| `components-room-growthcheckform-tsx-6` | ：当前 |  |

## `components/room/KpBgmPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-kpbgmpanel-tsx-1` | BGM 播放 |  |
| `components-room-kpbgmpanel-tsx-2` | 粘贴网易云音乐或 QQ 音乐链接，房间内所有成员会加载同一个播放器。 | 粘贴网易云音乐或 QQ 音乐链接，房间内同步播放。 |
| `components-room-kpbgmpanel-tsx-3` | 全房间同步 |  |
| `components-room-kpbgmpanel-tsx-4` | 解析并播放 |  |
| `components-room-kpbgmpanel-tsx-5` | 受浏览器自动播放策略限制，玩家端可能需要在播放器上点一次播放；KP 也会在右侧房间视角里看到同一个播放器。 | 若未自动播放，请手动点击播放。 |
| `components-room-kpbgmpanel-tsx-6` | 当前 BGM |  |
| `components-room-kpbgmpanel-tsx-7` | 未播放 |  |
| `components-room-kpbgmpanel-tsx-8` | 打开原链接 |  |
| `components-room-kpbgmpanel-tsx-9` | 停止播放 |  |
| `components-room-kpbgmpanel-tsx-10` | BGM 已开始播放，并已同步给全房间。 | BGM 已开始播放。 |
| `components-room-kpbgmpanel-tsx-11` | BGM 已停止，玩家端也会同步停止。 | BGM 已停止。 |
| `components-room-kpbgmpanel-tsx-12` | 无法解析该链接。支持网易云音乐完整链接 / 短链，以及 QQ 音乐单曲完整链接 / App 分享短链；QQ 歌单暂不支持。 | 无法识别链接。支持网易云音乐与 QQ 音乐单曲，暂不支持 QQ 歌单。 |
| `components-room-kpbgmpanel-tsx-13` | 当前没有可操作的对局，无法设置 BGM。 | 当前没有进行中的游戏。 |
| `components-room-kpbgmpanel-tsx-14` | 专辑 |  |
| `components-room-kpbgmpanel-tsx-15` | 歌单 |  |

## `components/room/KpCombatRequestPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-kpcombatrequestpanel-tsx-1` | 处理 |  |

## `components/room/KpPrepPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-kppreppanel-tsx-1` | KP 准备区 |  |
| `components-room-kppreppanel-tsx-2` | 仅 KP 可见 |  |
| `components-room-kppreppanel-tsx-3` | 当前章节 |  |
| `components-room-kppreppanel-tsx-4` | 当前遭遇 |  |
| `components-room-kppreppanel-tsx-5` | 团内时间 |  |
| `components-room-kppreppanel-tsx-6` | 可用章节 / 遭遇（开局快照，只读） | 可用章节 / 遭遇（只读） |
| `components-room-kppreppanel-tsx-7` | 正文章节（快照 sections） | 正文章节 |
| `components-room-kppreppanel-tsx-8` | 章节 |  |
| `components-room-kppreppanel-tsx-9` | 遭遇 |  |
| `components-room-kppreppanel-tsx-10` | 切换场景 |  |
| `components-room-kppreppanel-tsx-11` | 团本没有结构化场景，可先去场景 / 地图页面创建。 | 团本暂无场景，可先在「场景 / 地图」中创建。 |
| `components-room-kppreppanel-tsx-12` | 未设置 |  |
| `components-room-kppreppanel-tsx-13` | 地图背景 |  |
| `components-room-kppreppanel-tsx-14` | 无背景 |  |
| `components-room-kppreppanel-tsx-15` | 还没有可选的团本 / 房间素材，可直接上传。 | 暂无可选素材，可直接上传。 |
| `components-room-kppreppanel-tsx-16` | 应用背景 |  |
| `components-room-kppreppanel-tsx-17` | 放置 PC / NPC Token 到当前场景 | 放置角色 Token 到当前场景 |
| `components-room-kppreppanel-tsx-18` | 当前没有可放置的单位。 |  |
| `components-room-kppreppanel-tsx-19` | 放置到本场景 |  |
| `components-room-kppreppanel-tsx-20` | 同一角色全局唯一；其他场景已有的 Token 会被移动到当前场景。 | 同一角色只会有一个 Token；放置后会移动到当前场景。 |
| `components-room-kppreppanel-tsx-21` | 团本编辑与素材 |  |
| `components-room-kppreppanel-tsx-22` | 新建 NPC |  |
| `components-room-kppreppanel-tsx-23` | 主动开战 |  |
| `components-room-kppreppanel-tsx-24` | KP 直接选择双方单位进入战斗，不需要玩家申请，也不需要审批。 | 选择双方单位后直接开战。 |
| `components-room-kppreppanel-tsx-25` | 直接发起战斗 |  |
| `components-room-kppreppanel-tsx-26` | 线索公布 |  |
| `components-room-kppreppanel-tsx-27` | 全部设为私密 |  |
| `components-room-kppreppanel-tsx-28` | 对所有成员公开（默认仅 KP 可见） | 对所有成员公开 |
| `components-room-kppreppanel-tsx-29` | 发布线索 |  |
| `components-room-kppreppanel-tsx-30` | 还没有线索。 |  |
| `components-room-kppreppanel-tsx-31` | ) : ( // 线索多时用可滚动 + 折叠行，避免整块面板被撑得很长。 | 删除 |
| `components-room-kppreppanel-tsx-32` | 上传新背景 |  |
| `components-room-kppreppanel-tsx-33` | 已关闭 |  |
| `components-room-kppreppanel-tsx-34` | 关闭 |  |
| `components-room-kppreppanel-tsx-35` | 开启 |  |
| `components-room-kppreppanel-tsx-36` | 线索标题 |  |
| `components-room-kppreppanel-tsx-37` | 线索内容（可只上传图片） |  |
| `components-room-kppreppanel-tsx-38` | 公开 |  |

## `components/room/KpValueEditor.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-kpvalueeditor-tsx-1` | KP 数值调整（玩家 / NPC） |  |
| `components-room-kpvalueeditor-tsx-2` | 任意阶段可用：HP / MP / SAN / DP、九项属性、技能。非战斗写入角色卡 / NPC 卡， 战斗中同时实时同步到战斗单位。留空表示不修改。 | 可调整 HP、MP、SAN、DP、属性与技能；留空表示不修改。 |
| `components-room-kpvalueeditor-tsx-3` | 目标单位 |  |
| `components-room-kpvalueeditor-tsx-4` | 属性（留空不改） |  |
| `components-room-kpvalueeditor-tsx-5` | 技能（ID:数值，每行一项） | 技能（每行一项，如 格斗:60） |
| `components-room-kpvalueeditor-tsx-6` | 应用数值 |  |
| `components-room-kpvalueeditor-tsx-7` | 重新读取实时值 | 刷新实时数值 |
| `components-room-kpvalueeditor-tsx-8` | 战斗中实时数值 |  |
| `components-room-kpvalueeditor-tsx-9` | 当前局数值 |  |
| `components-room-kpvalueeditor-tsx-10` | 角色卡 / NPC 卡数值 |  |
| `components-room-kpvalueeditor-tsx-11` | 最大 HP |  |
| `components-room-kpvalueeditor-tsx-12` | 最大 MP |  |
| `components-room-kpvalueeditor-tsx-13` | 最大 SAN |  |
| `components-room-kpvalueeditor-tsx-14` | 最大 DP |  |
| `components-room-kpvalueeditor-tsx-15` | 力量 |  |
| `components-room-kpvalueeditor-tsx-16` | 体质 |  |
| `components-room-kpvalueeditor-tsx-17` | 体型 |  |
| `components-room-kpvalueeditor-tsx-18` | 敏捷 |  |
| `components-room-kpvalueeditor-tsx-19` | 外貌 |  |
| `components-room-kpvalueeditor-tsx-20` | 智力 |  |
| `components-room-kpvalueeditor-tsx-21` | 意志 |  |
| `components-room-kpvalueeditor-tsx-22` | 教育 |  |
| `components-room-kpvalueeditor-tsx-23` | 幸运 |  |
| `components-room-kpvalueeditor-tsx-24` | 读取实时数值失败 |  |
| `components-room-kpvalueeditor-tsx-25` | 连接已断开，请刷新后重试 |  |
| `components-room-kpvalueeditor-tsx-26` | 请选择要修改的单位 |  |
| `components-room-kpvalueeditor-tsx-27` | 数值已应用。 |  |
| `components-room-kpvalueeditor-tsx-28` | 数值调整失败 |  |
| `components-room-kpvalueeditor-tsx-29` | 玩家 |  |
| `components-room-kpvalueeditor-tsx-30` | · 读取中… |  |

## `components/room/NpcEditForm.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-npceditform-tsx-1` | 这张 NPC 卡的属性数据不完整，暂时无法编辑。 | 该 NPC 卡属性不完整，暂时无法编辑。 |
| `components-room-npceditform-tsx-2` | 编辑 NPC / Boss |  |
| `components-room-npceditform-tsx-3` | 名字 |  |
| `components-room-npceditform-tsx-4` | 副标题 |  |
| `components-room-npceditform-tsx-5` | 稀有度 |  |
| `components-room-npceditform-tsx-6` | 种族 |  |
| `components-room-npceditform-tsx-7` | 标签（逗号分隔） |  |
| `components-room-npceditform-tsx-8` | 描述 |  |
| `components-room-npceditform-tsx-9` | 技能（示例：FIGHTING_BRAWL:60, DODGE:40） | 技能（每行一项，如 格斗:60、闪避:40） |
| `components-room-npceditform-tsx-10` | 保存 NPC |  |
| `components-room-npceditform-tsx-11` | 力量 |  |
| `components-room-npceditform-tsx-12` | 体质 |  |
| `components-room-npceditform-tsx-13` | 体型 |  |
| `components-room-npceditform-tsx-14` | 敏捷 |  |
| `components-room-npceditform-tsx-15` | 外貌 |  |
| `components-room-npceditform-tsx-16` | 智力 |  |
| `components-room-npceditform-tsx-17` | 意志 |  |
| `components-room-npceditform-tsx-18` | 教育 |  |
| `components-room-npceditform-tsx-19` | 幸运 |  |

## `components/room/PlayerDashboard.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-playerdashboard-tsx-1` | 属性 |  |
| `components-room-playerdashboard-tsx-2` | 装备与物品 |  |
| `components-room-playerdashboard-tsx-3` | 暂无武器 / 随身物品 |  |
| `components-room-playerdashboard-tsx-4` | 状态（buff / debuff） | 状态（增益 / 减益） |
| `components-room-playerdashboard-tsx-5` | 当前没有特殊状态 |  |
| `components-room-playerdashboard-tsx-6` | 力量 |  |
| `components-room-playerdashboard-tsx-7` | 体质 |  |
| `components-room-playerdashboard-tsx-8` | 体型 |  |
| `components-room-playerdashboard-tsx-9` | 敏捷 |  |
| `components-room-playerdashboard-tsx-10` | 外貌 |  |
| `components-room-playerdashboard-tsx-11` | 智力 |  |
| `components-room-playerdashboard-tsx-12` | 意志 |  |
| `components-room-playerdashboard-tsx-13` | 教育 |  |
| `components-room-playerdashboard-tsx-14` | 幸运 |  |
| `components-room-playerdashboard-tsx-15` | 重伤 |  |
| `components-room-playerdashboard-tsx-16` | 倒地 |  |
| `components-room-playerdashboard-tsx-17` | 昏迷 |  |
| `components-room-playerdashboard-tsx-18` | 濒死 |  |
| `components-room-playerdashboard-tsx-19` | 死亡 |  |
| `components-room-playerdashboard-tsx-20` | 疯狂 |  |
| `components-room-playerdashboard-tsx-21` | 夺舍 |  |
| `components-room-playerdashboard-tsx-22` | 护甲 |  |
| `components-room-playerdashboard-tsx-23` | 眩晕 |  |
| `components-room-playerdashboard-tsx-24` | 控制 |  |
| `components-room-playerdashboard-tsx-25` | 持续伤害 |  |
| `components-room-playerdashboard-tsx-26` | 中毒 |  |
| `components-room-playerdashboard-tsx-27` | 疾病 |  |
| `components-room-playerdashboard-tsx-28` | 诅咒 |  |
| `components-room-playerdashboard-tsx-29` | 束缚 |  |
| `components-room-playerdashboard-tsx-30` | 沉默 |  |
| `components-room-playerdashboard-tsx-31` | 召唤物 |  |
| `components-room-playerdashboard-tsx-32` | 状态 |  |
| `components-room-playerdashboard-tsx-33` | 我的角色 |  |
| `components-room-playerdashboard-tsx-34` | · 现金 |  |

## `components/room/RoomAdvancementPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomadvancementpanel-tsx-1` | 成长与奖励 |  |
| `components-room-roomadvancementpanel-tsx-2` | 成长记录会标注来源，并单独保存；属性 / 技能 / SAN 变动会同步到角色卡。 | 属性、技能与 SAN 变动会同步到角色卡。 |
| `components-room-roomadvancementpanel-tsx-3` | 待检定成长点（CoC 幕间：d100 大于技能值或 96-100 时 +1d10） | 待检定成长点（1d100 大于技能值或掷出 96–100 时 +1d10） |
| `components-room-roomadvancementpanel-tsx-4` | 取消标记 |  |
| `components-room-roomadvancementpanel-tsx-5` | 本局暂无成长记录。 |  |
| `components-room-roomadvancementpanel-tsx-6` | 已撤销 |  |
| `components-room-roomadvancementpanel-tsx-7` | KP：标记成长点 |  |
| `components-room-roomadvancementpanel-tsx-8` | KP 记录成长 / 奖励 |  |
| `components-room-roomadvancementpanel-tsx-9` | 角色 |  |
| `components-room-roomadvancementpanel-tsx-10` | 类型 |  |
| `components-room-roomadvancementpanel-tsx-11` | 属性 |  |
| `components-room-roomadvancementpanel-tsx-12` | 技能 |  |
| `components-room-roomadvancementpanel-tsx-13` | 物品 |  |
| `components-room-roomadvancementpanel-tsx-14` | 关系 |  |
| `components-room-roomadvancementpanel-tsx-15` | 其他 |  |
| `components-room-roomadvancementpanel-tsx-16` | 目标 / 说明键 | 目标 / 说明 |
| `components-room-roomadvancementpanel-tsx-17` | 数值变化 |  |
| `components-room-roomadvancementpanel-tsx-18` | 备注 |  |
| `components-room-roomadvancementpanel-tsx-19` | 记录成长 |  |
| `components-room-roomadvancementpanel-tsx-20` | 力量 |  |
| `components-room-roomadvancementpanel-tsx-21` | 体质 |  |
| `components-room-roomadvancementpanel-tsx-22` | 体型 |  |
| `components-room-roomadvancementpanel-tsx-23` | 敏捷 |  |
| `components-room-roomadvancementpanel-tsx-24` | 外貌 |  |
| `components-room-roomadvancementpanel-tsx-25` | 智力 |  |
| `components-room-roomadvancementpanel-tsx-26` | 意志 |  |
| `components-room-roomadvancementpanel-tsx-27` | 教育 |  |
| `components-room-roomadvancementpanel-tsx-28` | 幸运 |  |
| `components-room-roomadvancementpanel-tsx-29` | 已标记成长点。 |  |
| `components-room-roomadvancementpanel-tsx-30` | 已取消成长点。 |  |
| `components-room-roomadvancementpanel-tsx-31` | 该技能已经有待检定成长点。 |  |
| `components-room-roomadvancementpanel-tsx-32` | 成长检定完成：有技能成功提升。 |  |
| `components-room-roomadvancementpanel-tsx-33` | 成长检定完成：本次没有技能提升。 |  |
| `components-room-roomadvancementpanel-tsx-34` | 没有待检定的成长点。 |  |
| `components-room-roomadvancementpanel-tsx-35` | 该成长点已经结算，不能重复操作。 |  |
| `components-room-roomadvancementpanel-tsx-36` | 成长点数据不合法，或该技能不在当前规则包中。 | 成长点无效，或该技能不在当前规则包中。 |
| `components-room-roomadvancementpanel-tsx-37` | 当前局状态不允许进行成长检定。 |  |
| `components-room-roomadvancementpanel-tsx-38` | 操作失败，请稍后重试。 |  |
| `components-room-roomadvancementpanel-tsx-39` | attr / skill id / 物品名 | 属性 / 技能 / 物品名 |
| `components-room-roomadvancementpanel-tsx-40` | 例：+1 |  |
| `components-room-roomadvancementpanel-tsx-41` | 来源 / 奖励说明 |  |

## `components/room/RoomBgmPlayer.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roombgmplayer-tsx-1` | 打开原曲 |  |
| `components-room-roombgmplayer-tsx-2` | 若播放器没有自动开始，请点击播放按钮。 |  |
| `components-room-roombgmplayer-tsx-3` | 房间 BGM 播放器 |  |

## `components/room/RoomCardEditForm.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomcardeditform-tsx-1` | 名称 |  |
| `components-room-roomcardeditform-tsx-2` | 副标题 |  |
| `components-room-roomcardeditform-tsx-3` | 稀有度 |  |
| `components-room-roomcardeditform-tsx-4` | 数量 |  |
| `components-room-roomcardeditform-tsx-5` | 描述 |  |
| `components-room-roomcardeditform-tsx-6` | stats JSON（伤害、射程、技能等） | 卡牌数值（伤害、射程、技能等） |
| `components-room-roomcardeditform-tsx-7` | 保存卡片 |  |
| `components-room-roomcardeditform-tsx-8` | 证物 |  |
| `components-room-roomcardeditform-tsx-9` | 物品 |  |

## `components/room/RoomCombatPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomcombatpanel-tsx-1` | 战斗 |  |
| `components-room-roomcombatpanel-tsx-2` | 进入战斗页面 | 进入战斗 |
| `components-room-roomcombatpanel-tsx-3` | 审批 |  |
| `components-room-roomcombatpanel-tsx-4` | 你可以直接发起战斗 |  |
| `components-room-roomcombatpanel-tsx-5` | 你可以提交战斗申请，由 KP 审批 |  |
| `components-room-roomcombatpanel-tsx-6` | 本房当前不允许玩家发起战斗申请 |  |
| `components-room-roomcombatpanel-tsx-7` | 本房已有进行中的战斗 |  |
| `components-room-roomcombatpanel-tsx-8` | 发起战斗 |  |
| `components-room-roomcombatpanel-tsx-9` | 申请战斗 |  |

## `components/room/RoomCombatTabs.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomcombattabs-tsx-1` | 战斗 |  |
| `components-room-roomcombattabs-tsx-2` | ＋ 发起新战斗 |  |
| `components-room-roomcombattabs-tsx-3` | ＋ 申请新战斗 |  |

## `components/room/RoomConfigPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomconfigpanel-tsx-1` | 房间配置 |  |
| `components-room-roomconfigpanel-tsx-2` | 规则包 |  |
| `components-room-roomconfigpanel-tsx-3` | 模组 |  |
| `components-room-roomconfigpanel-tsx-4` | 背景年代 |  |
| `components-room-roomconfigpanel-tsx-5` | 车卡方式 |  |
| `components-room-roomconfigpanel-tsx-6` | 战斗模式 |  |
| `components-room-roomconfigpanel-tsx-7` | 邀请码 |  |
| `components-room-roomconfigpanel-tsx-8` | 玩家之间是否可见对方角色属性 |  |
| `components-room-roomconfigpanel-tsx-9` | 公开（默认） |  |
| `components-room-roomconfigpanel-tsx-10` | 仅自己可见 |  |
| `components-room-roomconfigpanel-tsx-11` | 保存可见性 |  |
| `components-room-roomconfigpanel-tsx-12` | 顺序制 |  |
| `components-room-roomconfigpanel-tsx-13` | ATB 进度条 |  |
| `components-room-roomconfigpanel-tsx-14` | 幻想乡年代 |  |
| `components-room-roomconfigpanel-tsx-15` | 1920 年代 |  |
| `components-room-roomconfigpanel-tsx-16` | 现代 |  |
| `components-room-roomconfigpanel-tsx-17` | 未指定 |  |
| `components-room-roomconfigpanel-tsx-18` | 禁止 |  |
| `components-room-roomconfigpanel-tsx-19` | 仅自己 |  |
| `components-room-roomconfigpanel-tsx-20` | 已启用 |  |
| `components-room-roomconfigpanel-tsx-21` | 检测到 |  |
| `components-room-roomconfigpanel-tsx-22` | 条，未启用 |  |
| `components-room-roomconfigpanel-tsx-23` | 停用魔法 |  |
| `components-room-roomconfigpanel-tsx-24` | 启用魔法 |  |

## `components/room/RoomGameStatePanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomgamestatepanel-tsx-1` | 局内状态 |  |
| `components-room-roomgamestatepanel-tsx-2` | 局内状态已保存，并已同步给在线成员。 | 局内状态已保存。 |
| `components-room-roomgamestatepanel-tsx-3` | 当前章节 |  |
| `components-room-roomgamestatepanel-tsx-4` | 当前场景 |  |
| `components-room-roomgamestatepanel-tsx-5` | 当前遭遇 |  |
| `components-room-roomgamestatepanel-tsx-6` | 团内时间 |  |
| `components-room-roomgamestatepanel-tsx-7` | KP 更新局内状态 |  |
| `components-room-roomgamestatepanel-tsx-8` | 当前章节（ModuleChapter 结构化绑定） | 当前章节 |
| `components-room-roomgamestatepanel-tsx-9` | 未设置 |  |
| `components-room-roomgamestatepanel-tsx-10` | 当前场景（房间 Scene 结构化绑定） | 当前场景 |
| `components-room-roomgamestatepanel-tsx-11` | 保存时将当前场景切换为激活场景（影响战术棋盘） | 保存后，当前场景会成为激活场景。 |
| `components-room-roomgamestatepanel-tsx-12` | 旗标 JSON | 标记 |
| `components-room-roomgamestatepanel-tsx-13` | 计数器 JSON | 计数器 |
| `components-room-roomgamestatepanel-tsx-14` | 自定义 JSON | 其他状态 |
| `components-room-roomgamestatepanel-tsx-15` | 保存局内状态 |  |
| `components-room-roomgamestatepanel-tsx-16` | 状态已被其他操作更新，请刷新后重试。 | 状态已更新，请刷新后重试。 |
| `components-room-roomgamestatepanel-tsx-17` | 旗标必须是合法的 JSON 对象。 | 标记格式不正确。 |
| `components-room-roomgamestatepanel-tsx-18` | 计数器必须是合法的 JSON 对象。 | 计数器格式不正确。 |
| `components-room-roomgamestatepanel-tsx-19` | 自定义状态必须是合法的 JSON 对象。 | 其他状态格式不正确。 |
| `components-room-roomgamestatepanel-tsx-20` | 当前没有可编辑的进行中局。 |  |
| `components-room-roomgamestatepanel-tsx-21` | 已暂停 |  |
| `components-room-roomgamestatepanel-tsx-22` | 进行中 |  |
| `components-room-roomgamestatepanel-tsx-23` | 操作失败： |  |
| `components-room-roomgamestatepanel-tsx-24` | KP 掌握 |  |
| `components-room-roomgamestatepanel-tsx-25` | 先到场景 / 地图页同步团本场景 |  |
| `components-room-roomgamestatepanel-tsx-26` | 团本里用 module-encounter 块定义遭遇 | 可在团本内容中定义遭遇。 |
| `components-room-roomgamestatepanel-tsx-27` | 例：第 3 天 20:14 |  |

## `components/room/RoomInfoPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roominfopanel-tsx-1` | 线索与笔记 |  |
| `components-room-roominfopanel-tsx-2` | 线索由 KP 发布；已发现线索会记录到你的账号。笔记只对本人可见，KP 可追加 KP 专属笔记。 | 线索由 KP 发布；笔记仅自己可见，KP 可添加专属笔记。 |
| `components-room-roominfopanel-tsx-3` | 线索已发布 |  |
| `components-room-roominfopanel-tsx-4` | 已标记发现 |  |
| `components-room-roominfopanel-tsx-5` | 图片上传失败（仅支持 PNG / JPEG / WebP，且不超过 8MB）。 | 图片上传失败；支持 PNG、JPEG、WebP，最大 8MB。 |
| `components-room-roominfopanel-tsx-6` | 发布失败：标题不能为空，且内容与图片至少要有一项。 |  |
| `components-room-roominfopanel-tsx-7` | 笔记已保存 |  |
| `components-room-roominfopanel-tsx-8` | 暂无可见线索。 |  |
| `components-room-roominfopanel-tsx-9` | 发给我 |  |
| `components-room-roominfopanel-tsx-10` | 我已发现 |  |
| `components-room-roominfopanel-tsx-11` | 标记为已发现 |  |
| `components-room-roominfopanel-tsx-12` | 对所有成员公开（默认仅 KP 可见） | 对所有成员公开 |
| `components-room-roominfopanel-tsx-13` | 发布线索 |  |
| `components-room-roominfopanel-tsx-14` | 还没有笔记。 |  |
| `components-room-roominfopanel-tsx-15` | KP 专属 |  |
| `components-room-roominfopanel-tsx-16` | 仅 KP 可见 |  |
| `components-room-roominfopanel-tsx-17` | 保存笔记 |  |
| `components-room-roominfopanel-tsx-18` | 本局团本没有 handout 资源。 | 本局团本没有可发放的线索。 |
| `components-room-roominfopanel-tsx-19` | 公开 |  |
| `components-room-roominfopanel-tsx-20` | KP 可见 |  |
| `components-room-roominfopanel-tsx-21` | 线索标题 |  |
| `components-room-roominfopanel-tsx-22` | 线索内容（可只上传图片） |  |
| `components-room-roominfopanel-tsx-23` | 笔记标题 |  |
| `components-room-roominfopanel-tsx-24` | 笔记内容 |  |

## `components/room/RoomMagicPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roommagicpanel-tsx-1` | 战斗外施法 |  |
| `components-room-roommagicpanel-tsx-2` | 施法者 |  |
| `components-room-roommagicpanel-tsx-3` | 法术 |  |
| `components-room-roommagicpanel-tsx-4` | 自身 |  |
| `components-room-roommagicpanel-tsx-5` | 友方 |  |
| `components-room-roommagicpanel-tsx-6` | 敌方 |  |
| `components-room-roommagicpanel-tsx-7` | 任意 |  |
| `components-room-roommagicpanel-tsx-8` | （召唤物） |  |
| `components-room-roommagicpanel-tsx-9` | （自己） |  |

## `components/room/RoomMemberRoster.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roommemberroster-tsx-1` | （我） |  |
| `components-room-roommemberroster-tsx-2` | 该成员还没有选择入场角色。 |  |
| `components-room-roommemberroster-tsx-3` | 暂无公开技能数值。 |  |
| `components-room-roommemberroster-tsx-4` | 私聊 |  |
| `components-room-roommemberroster-tsx-5` | 交换物品 |  |
| `components-room-roommemberroster-tsx-6` | 当前角色没有可交易的物品卡。 |  |
| `components-room-roommemberroster-tsx-7` | 发出交易 |  |
| `components-room-roommemberroster-tsx-8` | 分享情报 |  |
| `components-room-roommemberroster-tsx-9` | 你目前没有可分享的线索。 |  |
| `components-room-roommemberroster-tsx-10` | 发送情报 |  |
| `components-room-roommemberroster-tsx-11` | 物品交易 |  |
| `components-room-roommemberroster-tsx-12` | 接受 |  |
| `components-room-roommemberroster-tsx-13` | 拒绝 |  |
| `components-room-roommemberroster-tsx-14` | 已向 |  |
| `components-room-roommemberroster-tsx-15` | 取消 |  |
| `components-room-roommemberroster-tsx-16` | 力量 |  |
| `components-room-roommemberroster-tsx-17` | 体质 |  |
| `components-room-roommemberroster-tsx-18` | 体型 |  |
| `components-room-roommemberroster-tsx-19` | 敏捷 |  |
| `components-room-roommemberroster-tsx-20` | 外貌 |  |
| `components-room-roommemberroster-tsx-21` | 智力 |  |
| `components-room-roommemberroster-tsx-22` | 意志 |  |
| `components-room-roommemberroster-tsx-23` | 教育 |  |
| `components-room-roommemberroster-tsx-24` | 幸运 |  |
| `components-room-roommemberroster-tsx-25` | 闪避 |  |
| `components-room-roommemberroster-tsx-26` | 侦查 |  |
| `components-room-roommemberroster-tsx-27` | 聆听 |  |
| `components-room-roommemberroster-tsx-28` | 图书馆 |  |
| `components-room-roommemberroster-tsx-29` | 心理学 |  |
| `components-room-roommemberroster-tsx-30` | 神秘学 |  |
| `components-room-roommemberroster-tsx-31` | 格斗 |  |
| `components-room-roommemberroster-tsx-32` | 射击 |  |
| `components-room-roommemberroster-tsx-33` | 医学 |  |
| `components-room-roommemberroster-tsx-34` | 说服 |  |
| `components-room-roommemberroster-tsx-35` | 信用 |  |
| `components-room-roommemberroster-tsx-36` | 潜行 |  |
| `components-room-roommemberroster-tsx-37` | · 未提交角色 |  |
| `components-room-roommemberroster-tsx-38` | 职业未填写 |  |
| `components-room-roommemberroster-tsx-39` | 改为仅自己可见 |  |
| `components-room-roommemberroster-tsx-40` | 公开我的角色信息 |  |
| `components-room-roommemberroster-tsx-41` | 其他人可见精确数值 |  |
| `components-room-roommemberroster-tsx-42` | 其他人看到 ？？？ |  |
| `components-room-roommemberroster-tsx-43` | 交易留言（可选） |  |
| `components-room-roommemberroster-tsx-44` | 公开 |  |
| `components-room-roommemberroster-tsx-45` | 仅我可见 |  |

## `components/room/RoomNpcPanel.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomnpcpanel-tsx-1` | 准备 NPC / Boss |  |
| `components-room-roomnpcpanel-tsx-2` | 还没有准备任何 NPC / Boss 卡 |  |
| `components-room-roomnpcpanel-tsx-3` | 已公开 |  |
| `components-room-roomnpcpanel-tsx-4` | 隐藏 |  |
| `components-room-roomnpcpanel-tsx-5` | 删除 |  |
| `components-room-roomnpcpanel-tsx-6` | 杂兵 |  |
| `components-room-roomnpcpanel-tsx-7` | 标准 |  |
| `components-room-roomnpcpanel-tsx-8` | 精英 |  |
| `components-room-roomnpcpanel-tsx-9` | 力量 |  |
| `components-room-roomnpcpanel-tsx-10` | 体质 |  |
| `components-room-roomnpcpanel-tsx-11` | 体型 |  |
| `components-room-roomnpcpanel-tsx-12` | 敏捷 |  |
| `components-room-roomnpcpanel-tsx-13` | 外貌 |  |
| `components-room-roomnpcpanel-tsx-14` | 智力 |  |
| `components-room-roomnpcpanel-tsx-15` | 意志 |  |
| `components-room-roomnpcpanel-tsx-16` | 教育 |  |
| `components-room-roomnpcpanel-tsx-17` | 幸运 |  |
| `components-room-roomnpcpanel-tsx-18` | 本场 NPC / Boss（ |  |
| `components-room-roomnpcpanel-tsx-19` | 已公开的 NPC / Boss（ |  |
| `components-room-roomnpcpanel-tsx-20` | 默认对玩家隐藏；点击「公开属性」后玩家才能看到名字、属性与技能。 | 默认对玩家隐藏；公开后玩家可见。 |
| `components-room-roomnpcpanel-tsx-21` | KP 只公开了这些单位的情报。 |  |
| `components-room-roomnpcpanel-tsx-22` | 无种族 |  |
| `components-room-roomnpcpanel-tsx-23` | 取消公开 |  |
| `components-room-roomnpcpanel-tsx-24` | 公开属性 |  |

## `components/room/RoomPlay.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomplay-tsx-1` | 跑团日志 |  |
| `components-room-roomplay-tsx-2` | 还没有消息，说点什么吧 |  |
| `components-room-roomplay-tsx-3` | 悄悄话 |  |
| `components-room-roomplay-tsx-4` | 房间成员 |  |
| `components-room-roomplay-tsx-5` | 收起 |  |
| `components-room-roomplay-tsx-6` | 选择对象 | 选择悄悄话对象 |
| `components-room-roomplay-tsx-7` | 发送 |  |
| `components-room-roomplay-tsx-8` | 技能检定 |  |
| `components-room-roomplay-tsx-9` | 自由掷骰 |  |
| `components-room-roomplay-tsx-10` | 当前没有可进行技能检定的角色。 |  |
| `components-room-roomplay-tsx-11` | 没有匹配技能 |  |
| `components-room-roomplay-tsx-12` | 公开 |  |
| `components-room-roomplay-tsx-13` | 暗骰（发送者 + KP） |  |
| `components-room-roomplay-tsx-14` | 仅自己 |  |
| `components-room-roomplay-tsx-15` | 无法获取连接票据，请刷新页面 | 连接失败，请刷新页面重试。 |
| `components-room-roomplay-tsx-16` | 加入房间失败 |  |
| `components-room-roomplay-tsx-17` | 请先选择角色和技能 |  |
| `components-room-roomplay-tsx-18` | 技能检定失败 |  |
| `components-room-roomplay-tsx-19` | 请选择悄悄话对象 |  |
| `components-room-roomplay-tsx-20` | 发送失败 |  |
| `components-room-roomplay-tsx-21` | 连接已断开，请刷新页面后重试 | 连接已断开，请刷新后重试。 |
| `components-room-roomplay-tsx-22` | 请输入骰子表达式，例如 1d100 | 请输入骰子，例如 1d100 |
| `components-room-roomplay-tsx-23` | 掷骰失败 |  |
| `components-room-roomplay-tsx-24` | 已连接 |  |
| `components-room-roomplay-tsx-25` | 连接中 |  |
| `components-room-roomplay-tsx-26` | 已断开 |  |
| `components-room-roomplay-tsx-27` | 说点什么（回车发送） |  |
| `components-room-roomplay-tsx-28` | 选择技能 |  |
| `components-room-roomplay-tsx-29` | 本职 · |  |
| `components-room-roomplay-tsx-30` | 输入技能名 / ID 检索 | 搜索技能 |
| `components-room-roomplay-tsx-31` | 取消收藏 |  |
| `components-room-roomplay-tsx-32` | 收藏技能 |  |
| `components-room-roomplay-tsx-33` | 1d100 2d6+3（回车也可掷骰） | 例如 1d100、2d6+3 |
| `components-room-roomplay-tsx-34` | 检定 |  |
| `components-room-roomplay-tsx-35` | 掷骰 |  |

## `components/room/RoomSetupForm.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-roomsetupform-tsx-1` | 房间 |  |
| `components-room-roomsetupform-tsx-2` | 房间名 |  |
| `components-room-roomsetupform-tsx-3` | 房间名必填；不填会被服务端退回本页。 | 房间名必填。 |
| `components-room-roomsetupform-tsx-4` | 模组 |  |
| `components-room-roomsetupform-tsx-5` | 决定技能表、种族与可用卡池。角色卡和卡牌不能跨模组使用。 | 决定技能、种族与卡池；角色和卡牌不能跨模组使用。 |
| `components-room-roomsetupform-tsx-6` | 背景年代 |  |
| `components-room-roomsetupform-tsx-7` | 仅 COC7 生效。年代会过滤职业与本职业技能，并写入房间内创建的角色。 | 仅 COC7 生效；决定可用职业与技能。 |
| `components-room-roomsetupform-tsx-8` | 东方模组使用幻想乡年代规则，不设置现代 / 1920 年代。 | 东方模组使用幻想乡背景。 |
| `components-room-roomsetupform-tsx-9` | 车卡方式 |  |
| `components-room-roomsetupform-tsx-10` | 全房统一，进房后不能改 |  |
| `components-room-roomsetupform-tsx-11` | 战斗模式 |  |
| `components-room-roomsetupform-tsx-12` | 默认跟随模组，可以覆盖 |  |
| `components-room-roomsetupform-tsx-13` | 战斗中允许发生的事件 | 战斗事件 |
| `components-room-roomsetupform-tsx-14` | 默认全部开启，勾选「禁用」则本房不生效 | 默认开启；勾选「禁用」则关闭。 |
| `components-room-roomsetupform-tsx-15` | 禁用 |  |
| `components-room-roomsetupform-tsx-16` | 玩家角色可见性 |  |
| `components-room-roomsetupform-tsx-17` | 默认玩家之间可见彼此角色属性；选择“私密”后，玩家只能看到自己的角色卡，KP 始终可见全部。 | 默认所有玩家可见；选择「私密」后，玩家只能看到自己的角色卡，KP 可见全部。 |
| `components-room-roomsetupform-tsx-18` | 玩家互见（默认） |  |
| `components-room-roomsetupform-tsx-19` | 仅自己可见 |  |
| `components-room-roomsetupform-tsx-20` | 战斗申请 |  |
| `components-room-roomsetupform-tsx-21` | 开启后 PL 可发起战斗申请，由 KP 审批；KP 始终可直接发起 | 开启后玩家可申请战斗，由 KP 审批；KP 可直接开战。 |
| `components-room-roomsetupform-tsx-22` | 创建房间 |  |
| `components-room-roomsetupform-tsx-23` | 顺序制 |  |
| `components-room-roomsetupform-tsx-24` | KP 每轮排定出手顺序，全员依次行动 |  |
| `components-room-roomsetupform-tsx-25` | ATB 进度条 |  |
| `components-room-roomsetupform-tsx-26` | 全局计数器推进，谁进度先满谁行动 |  |
| `components-room-roomsetupform-tsx-27` | 例：红魔馆异变调查 |  |
| `components-room-roomsetupform-tsx-28` | COC7 原版 |  |
| `components-room-roomsetupform-tsx-29` | 东方模组 |  |
| `components-room-roomsetupform-tsx-30` | 现代 |  |
| `components-room-roomsetupform-tsx-31` | 默认规则书现代职业可用 |  |
| `components-room-roomsetupform-tsx-32` | 1920 年代 |  |
| `components-room-roomsetupform-tsx-33` | 古典职业可用，现代专用技能不提供 |  |
| `components-room-roomsetupform-tsx-34` | 允许 |  |
| `components-room-roomsetupform-tsx-35` | 禁止 |  |

## `components/room/SceneBoard.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-room-sceneboard-tsx-1` | 进入战斗 |  |
| `components-room-sceneboard-tsx-2` | 交换物品 |  |
| `components-room-sceneboard-tsx-3` | 没有可交易物品。 |  |
| `components-room-sceneboard-tsx-4` | 发出交易 |  |
| `components-room-sceneboard-tsx-5` | 分享情报 |  |
| `components-room-sceneboard-tsx-6` | 没有可分享线索。 |  |
| `components-room-sceneboard-tsx-7` | 发送情报 |  |
| `components-room-sceneboard-tsx-8` | 切换场景 |  |
| `components-room-sceneboard-tsx-9` | 放置到本场景 |  |
| `components-room-sceneboard-tsx-10` | 当前场景还没有配置地图；先放置 Token 会自动建立空白地图，KP 之后再补背景图。 | 当前场景没有地图；放置 Token 会自动创建空白地图。 |
| `components-room-sceneboard-tsx-11` | 当前地图背景 |  |
| `components-room-sceneboard-tsx-12` | 无背景 |  |
| `components-room-sceneboard-tsx-13` | 使用团本 / 房间素材作为背景 |  |
| `components-room-sceneboard-tsx-14` | 团本和房间还没有可用图片，先上传或到团本编辑器添加素材。 | 暂无可用图片，可先上传。 |
| `components-room-sceneboard-tsx-15` | 应用背景 |  |
| `components-room-sceneboard-tsx-16` | 共享战争视野（双向：对方也会看到你的视野） | 共享视野（对方也会看到你的视野） |
| `components-room-sceneboard-tsx-17` | 力量 |  |
| `components-room-sceneboard-tsx-18` | 体质 |  |
| `components-room-sceneboard-tsx-19` | 体型 |  |
| `components-room-sceneboard-tsx-20` | 敏捷 |  |
| `components-room-sceneboard-tsx-21` | 外貌 |  |
| `components-room-sceneboard-tsx-22` | 智力 |  |
| `components-room-sceneboard-tsx-23` | 意志 |  |
| `components-room-sceneboard-tsx-24` | 教育 |  |
| `components-room-sceneboard-tsx-25` | 幸运 |  |
| `components-room-sceneboard-tsx-26` | NPC / 未选择角色 |  |
| `components-room-sceneboard-tsx-27` | 地图单位 |  |
| `components-room-sceneboard-tsx-28` | · 你 |  |
| `components-room-sceneboard-tsx-29` | 直接开战 |  |
| `components-room-sceneboard-tsx-30` | 申请战斗 |  |
| `components-room-sceneboard-tsx-31` | 已共享视野 |  |
| `components-room-sceneboard-tsx-32` | 共享视野 |  |
| `components-room-sceneboard-tsx-33` | 留言（可选） |  |
| `components-room-sceneboard-tsx-34` | 公开 |  |
| `components-room-sceneboard-tsx-35` | 仅我可见 |  |
| `components-room-sceneboard-tsx-36` | 移动 Token 失败 |  |
| `components-room-sceneboard-tsx-37` | （当前） |  |
| `components-room-sceneboard-tsx-38` | 放置玩家 / NPC Token |  |
| `components-room-sceneboard-tsx-39` | 放置我的角色 Token |  |
| `components-room-sceneboard-tsx-40` | 上传新背景 |  |
| `components-room-sceneboard-tsx-41` | 已共享： |  |
| `components-room-sceneboard-tsx-42` | 共享视野： |  |

## `components/upload/ImageUpload.tsx`

| ID | 原文 | 你的修改 |
|---|---|---|
| `components-upload-imageupload-tsx-1` | 无图 |  |
| `components-upload-imageupload-tsx-2` | 网络错误，上传失败 | 上传失败，请重试。 |
| `components-upload-imageupload-tsx-3` | 上传失败 |  |
| `components-upload-imageupload-tsx-4` | 保存失败 |  |
| `components-upload-imageupload-tsx-5` | 上传中… |  |

## `shared/bgm.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `shared-bgm-ts-1` | 无法识别网易云音乐链接类型 | 无法识别该音乐链接 |
| `shared-bgm-ts-2` | 没有在链接里找到有效的网易云音乐 id | 链接中没有找到歌曲信息 |
| `shared-bgm-ts-3` | QQ 音乐歌曲 id 格式不正确 | QQ 音乐歌曲链接不正确 |
| `shared-bgm-ts-4` | 暂时无法识别这种 QQ 音乐链接 | 暂时无法识别该 QQ 音乐链接 |
| `shared-bgm-ts-5` | 链接格式不正确 |  |
| `shared-bgm-ts-6` | 只支持网易云音乐或 QQ 音乐链接 |  |
| `shared-bgm-ts-7` | 网易云音乐 |  |
| `shared-bgm-ts-8` | QQ 音乐 |  |
| `shared-bgm-ts-9` | 单曲 |  |
| `shared-bgm-ts-10` | 专辑 |  |
| `shared-bgm-ts-11` | 歌单 |  |

## `shared/card.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `shared-card-ts-1` | 自身 |  |
| `shared-card-ts-2` | 友方 |  |
| `shared-card-ts-3` | 敌方 |  |
| `shared-card-ts-4` | 任意 |  |
| `shared-card-ts-5` | 单体 |  |
| `shared-card-ts-6` | 全体 |  |
| `shared-card-ts-7` | 斗殴 / 徒手 |  |
| `shared-card-ts-8` | 斧 / 钝器 |  |
| `shared-card-ts-9` | 剑 / 刀 |  |
| `shared-card-ts-10` | 矛 / 长柄 |  |
| `shared-card-ts-11` | 鞭 / 链 |  |
| `shared-card-ts-12` | 手枪 |  |
| `shared-card-ts-13` | 步枪 / 霰弹枪 |  |
| `shared-card-ts-14` | 弓 / 弩 |  |
| `shared-card-ts-15` | 投掷 |  |
| `shared-card-ts-16` | 符卡 |  |
| `shared-card-ts-17` | 武器卡 |  |
| `shared-card-ts-18` | 道具卡 |  |
| `shared-card-ts-19` | 弹幕 · 伤害提升 |  |
| `shared-card-ts-20` | 近战 · 命中与伤害提升 |  |
| `shared-card-ts-21` | 法术 · 能力值提升，不消耗灵力 |  |
| `shared-card-ts-22` | 范围 · 可攻击多个目标 |  |
| `shared-card-ts-23` | 格式如 2d6+3 / 1d3+db |  |
| `shared-card-ts-24` | 近身 |  |
| `shared-card-ts-25` | 中距 |  |
| `shared-card-ts-26` | 远距 |  |
| `shared-card-ts-27` | 普通 |  |
| `shared-card-ts-28` | 罕见 |  |
| `shared-card-ts-29` | 稀有 |  |
| `shared-card-ts-30` | 史诗 |  |
| `shared-card-ts-31` | 传说 |  |

## `shared/danmaku/presets.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `shared-danmaku-presets-ts-1` | 圆环 |  |
| `shared-danmaku-presets-ts-2` | 螺旋 |  |
| `shared-danmaku-presets-ts-3` | 扇形 |  |
| `shared-danmaku-presets-ts-4` | 交叉 |  |
| `shared-danmaku-presets-ts-5` | 花形 |  |
| `shared-danmaku-presets-ts-6` | 随机散射 |  |
| `shared-danmaku-presets-ts-7` | 自机狙 |  |
| `shared-danmaku-presets-ts-8` | 鞭弹 |  |
| `shared-danmaku-presets-ts-9` | 激光阵 |  |
| `shared-danmaku-presets-ts-10` | 以发射点为中心向四周均匀撒弹。 |  |
| `shared-danmaku-presets-ts-11` | 每轮旋转一定角度，形成旋涡状弹幕。 |  |
| `shared-danmaku-presets-ts-12` | 朝一个方向扇形展开，适合正面压制。 |  |
| `shared-danmaku-presets-ts-13` | 四个方向同时发射，形成十字交叉。 |  |
| `shared-danmaku-presets-ts-14` | 环状弹幕的速度按花形调制。 |  |
| `shared-danmaku-presets-ts-15` | 在张角范围内随机散布，弹幕更混沌。 |  |
| `shared-danmaku-presets-ts-16` | 朝画面下方的自机方向发射，可带少量散射。 |  |
| `shared-danmaku-presets-ts-17` | 一列弹以不同速度甩出，形成鞭状。 |  |
| `shared-danmaku-presets-ts-18` | 生成预警线后实体化的激光。 |  |
| `shared-danmaku-presets-ts-19` | 光玉 |  |
| `shared-danmaku-presets-ts-20` | 小弹 |  |
| `shared-danmaku-presets-ts-21` | 圆环弹 |  |
| `shared-danmaku-presets-ts-22` | 星弹 |  |
| `shared-danmaku-presets-ts-23` | 米弹 |  |
| `shared-danmaku-presets-ts-24` | 符札 |  |
| `shared-danmaku-presets-ts-25` | 刀弹 |  |
| `shared-danmaku-presets-ts-26` | 鳞弹 |  |
| `shared-danmaku-presets-ts-27` | 蝶弹 |  |
| `shared-danmaku-presets-ts-28` | $DANMAKU_LAYER_LABELS[layer.type] · $layer.count 发 / $layer.interval 帧 | 删除 |

## `shared/danmaku/schema.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `shared-danmaku-schema-ts-1` | 颜色格式应为 #RRGGBB | 颜色格式不正确 |

## `shared/magic-effects.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `shared-magic-effects-ts-1` | 数值 / 骰式 |  |
| `shared-magic-effects-ts-2` | 例如 2d6+1 / 3 |  |
| `shared-magic-effects-ts-3` | 持续行动轮次 | 持续轮次 |
| `shared-magic-effects-ts-4` | 0 = 耗尽 / 战斗结束 | 0 表示持续到战斗结束 |
| `shared-magic-effects-ts-5` | 持续行动次数 |  |
| `shared-magic-effects-ts-6` | 例如 1 |  |
| `shared-magic-effects-ts-7` | 伤害 |  |
| `shared-magic-effects-ts-8` | 造成伤害，走伤害管线与护甲 | 造成伤害（结算护甲） |
| `shared-magic-effects-ts-9` | 治疗 |  |
| `shared-magic-effects-ts-10` | 恢复 HP |  |
| `shared-magic-effects-ts-11` | 回 MP |  |
| `shared-magic-effects-ts-12` | 恢复 MP |  |
| `shared-magic-effects-ts-13` | 吸 MP |  |
| `shared-magic-effects-ts-14` | 扣除目标 MP，同量转移给施法者 | 扣除目标 MP，并转移给施法者 |
| `shared-magic-effects-ts-15` | 扣 SAN |  |
| `shared-magic-effects-ts-16` | 扣除 SAN |  |
| `shared-magic-effects-ts-17` | 回 SAN |  |
| `shared-magic-effects-ts-18` | 恢复 SAN |  |
| `shared-magic-effects-ts-19` | 状态 |  |
| `shared-magic-effects-ts-20` | 施加规则包中定义的状态 | 施加状态 |
| `shared-magic-effects-ts-21` | 状态 key | 状态名称 |
| `shared-magic-effects-ts-22` | 例如 HASTE | 例如 加速 |
| `shared-magic-effects-ts-23` | 层数 |  |
| `shared-magic-effects-ts-24` | 护甲 |  |
| `shared-magic-effects-ts-25` | 获得护甲池，1:1 吸收伤害，按行动轮次到期 | 获得护甲，按行动轮次吸收伤害后消失 |
| `shared-magic-effects-ts-26` | 召唤 |  |
| `shared-magic-effects-ts-27` | 按独立 NPC 卡生成参战单位；无卡走通用兜底 | 生成参战单位；可指定 NPC 卡 |
| `shared-magic-effects-ts-28` | 召唤物名字 |  |
| `shared-magic-effects-ts-29` | 例如 次元蹒跚者 |  |
| `shared-magic-effects-ts-30` | 召唤物 |  |
| `shared-magic-effects-ts-31` | 稳定 key（可选） | 标识（可选） |
| `shared-magic-effects-ts-32` | 用于跨译名匹配 | 用于匹配同名单位 |
| `shared-magic-effects-ts-33` | 指定房间 NPC 卡 id（可选） | 指定 NPC 卡（可选） |
| `shared-magic-effects-ts-34` | 留空则按名字匹配 |  |
| `shared-magic-effects-ts-35` | 数量 |  |
| `shared-magic-effects-ts-36` | 夺舍 |  |
| `shared-magic-effects-ts-37` | 操纵目标；充能池按战斗轮次 + 被夺舍 Token 移动消耗，耗尽归还控制权 | 控制目标；控制期间按轮次与移动消耗，耗尽后归还控制权 |
| `shared-magic-effects-ts-38` | 操纵轮次 |  |
| `shared-magic-effects-ts-39` | 持续伤害 |  |
| `shared-magic-effects-ts-40` | 目标每次行动开始时结算持续伤害 |  |
| `shared-magic-effects-ts-41` | 持续目标行动次数 |  |
| `shared-magic-effects-ts-42` | 例如 3 |  |
| `shared-magic-effects-ts-43` | 可选分组 key | 分组（可选） |
| `shared-magic-effects-ts-44` | 留空则按法术 id | 留空则跟随法术 |
| `shared-magic-effects-ts-45` | 眩晕 |  |
| `shared-magic-effects-ts-46` | 强制跳过行动 |  |
| `shared-magic-effects-ts-47` | 控制 |  |
| `shared-magic-effects-ts-48` | 净化 |  |
| `shared-magic-effects-ts-49` | 清除状态 / 持续伤害 / 控制；keys 为空时清默认项 | 清除状态、持续伤害与控制；留空则清除默认项 |
| `shared-magic-effects-ts-50` | 要清除的 key（逗号分隔） | 要清除的状态（逗号分隔） |
| `shared-magic-effects-ts-51` | 留空 = DOT + STUN + CONTROL | 留空 = 持续伤害 + 眩晕 + 控制 |

## `shared/magic.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `shared-magic-ts-1` | 伤害 |  |
| `shared-magic-ts-2` | 治疗 |  |
| `shared-magic-ts-3` | 回 MP |  |
| `shared-magic-ts-4` | 吸 MP |  |
| `shared-magic-ts-5` | 状态 |  |
| `shared-magic-ts-6` | 护甲 |  |
| `shared-magic-ts-7` | 召唤 |  |
| `shared-magic-ts-8` | 夺舍 |  |
| `shared-magic-ts-9` | 持续伤害 |  |
| `shared-magic-ts-10` | 眩晕 |  |
| `shared-magic-ts-11` | 次行动 |  |
| `shared-magic-ts-12` | 控制 |  |
| `shared-magic-ts-13` | 净化 |  |

## `shared/occupation.ts`

| ID | 原文 | 你的修改 |
|---|---|---|
| `shared-occupation-ts-1` | 空位需要选择 | 空位还需选择 |
| `shared-occupation-ts-2` | 项，当前 | 项，当前已选 |
| `shared-occupation-ts-3` | 空位的候选不包含技能： | 该空位不能选择： |
| `shared-occupation-ts-4` | 同一个技能不能占用两个空位： | 同一技能不能重复选择： |
| `shared-occupation-ts-5` | 现代 |  |
| `shared-occupation-ts-6` | 1920 年代 |  |
| `shared-occupation-ts-7` | 通用 |  |
| `shared-occupation-ts-8` | 魅惑 |  |
| `shared-occupation-ts-9` | 取笑 |  |
| `shared-occupation-ts-10` | 取悦 |  |
| `shared-occupation-ts-11` | 话术 |  |
| `shared-occupation-ts-12` | 恐吓 |  |
| `shared-occupation-ts-13` | 说服 |  |
| `shared-occupation-ts-14` | 任意 |  |
| `shared-occupation-ts-15` | 自选 |  |
| `shared-occupation-ts-16` | 格斗 |  |
| `shared-occupation-ts-17` | 射击 |  |
| `shared-occupation-ts-18` | 科学 |  |
| `shared-occupation-ts-19` | 技艺 |  |
| `shared-occupation-ts-20` | 外语 |  |
| `shared-occupation-ts-21` | 语言 |  |
| `shared-occupation-ts-22` | 驾驶 |  |
| `shared-occupation-ts-23` | 学问 |  |
| `shared-occupation-ts-24` | 艺术 |  |
| `shared-occupation-ts-25` | 社交技能 |  |
| `shared-occupation-ts-26` | ([一二两三四五六七八九十0-9]+)\\s*项[^。；，,]*? | 删除 |
| `shared-occupation-ts-27` | 社交 |  |


## 清单外风险：仍会渲染技术细节的位置（需开发处理）

自动抽取没有覆盖以下直接显示在页面上的字符串或结构；只改中文文案无法彻底解决：

| 位置 | 问题 |
|---|---|
| `apps/web/src/app/admin/system/page.tsx` | `工作流地址：`、`当前导入解析器：`、`API Key：`、`Base URL：`、`N8N_MODULE_PARSE_URL`、`DEEPSEEK_API_KEY`、`127.0.0.1` 等技术信息直接渲染 |
| `apps/web/src/app/admin/magic/[roomId]/page.tsx`、`apps/web/src/app/admin/magic/page.tsx` | `Room.magicEnabled = ...`、`Room.ruleOverride`、`enabled = ... · spells = ...`、`3. Room.ruleOverride.magic`、`ID`、原始 JSON 代码块 |
| `apps/web/src/app/admin/rulepacks/[packId]/page.tsx` | `enabled = ... · system = ...`、`ID`、`MP`、`SAN` 等原始字段直接上屏 |
| `apps/web/src/app/admin/modules/page.tsx` | `资源 ... · 局 ... · 快照 ...` 等统计标签 |
| `apps/web/src/app/rooms/[id]/prepare/page.tsx`、`apps/web/src/app/rooms/[id]/scenes/page.tsx` | 成功提示里含 `searchParams` 的抽取残片，实际会渲染“团本预设已应用：章节 3 / 场景 2 …”“已从团本结构化数据生成场景：新增 3 个场景 / 1 个遭遇”。建议整句改为“团本预设已应用。”和“已生成 3 个场景、1 个遭遇。” |
| `apps/web/src/components/room/RoomGameStatePanel.tsx` | 标签改成「标记 / 计数器 / 其他状态」后，textarea 里仍是 JSON，必须一起改成键值表单 |
| `apps/web/src/components/room/CharacterBuilder.tsx` | 调查员经历 / 伙伴 / 法术字段直接编辑 JSON 数组 |
| `apps/web/src/components/room/EndGamePanel.tsx`、`RoomAdvancementPanel.tsx` | 奖励目标仍填写内部 ID（`FIGHTING_BRAWL`、`int` 等），建议改下拉选择 |
| `apps/web/src/app/rooms/[id]/npcs/new/page.tsx`、`apps/web/src/components/room/NpcEditForm.tsx` | 技能仍填写技能 ID |
| `apps/web/src/shared/occupation.ts` | 校验错误直接拼接技能 ID |
| `apps/web/src/components/module/MagicEffectComposer.tsx` | 文案里去掉 JSON 后，输入框与校验仍在编辑 JSON；建议保留「高级编辑」入口，主流程改成可视化组合 |
| `apps/web/src/components/admin/RulePackConfigEditor.tsx` | 「高级编辑」实际仍是 JSON 文本编辑；管理员页面可保留，但不应在主流程暴露 |
| `apps/web/src/shared/magic-effects.ts` | 字段文案已改，但实际仍填写 `HASTE`、`DOT` 等内部 key；建议改成下拉或中文别名解析 |
| `apps/web/src/server/**` | 大量错误与进度文案会通过 action / 页面参数上屏，含 `DeepSeek`、`n8n`、`JSON`、`DEEPSEEK_API_KEY`、`N8N_MODULE_PARSE_URL`、`structured` 等。重点检查 `server/ai/deepseek.ts`、`server/ai/n8n.ts`、`server/ai/module-import.ts`、`server/game/advancement.ts`。 |
