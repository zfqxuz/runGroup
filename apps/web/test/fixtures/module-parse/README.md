# 团本解析测试素材与离线评测

本目录是团本解析工作流的回归 / 准确率测试集，配合：

- 工作流副本：`n8n/workflow-src-v2/`（由 `n8n/build-workflows-v2.mjs` 生成 `n8n/workflows/module-import-v2.json`）
- 评测脚本：`apps/web/scripts/evaluate-module-parse.ts`
- 素材生成：`apps/web/scripts/module-parse-eval/generate-fixtures.mjs`、`generate-regression-fixtures.mjs`

## 目录结构

```
module-parse/
  synthetic/                 24 个合成团本，覆盖文件类型 / 排版 / 写法 / 数量
  regression/                3 个真实团本回归
    鬼屋/                    存储的 module-npc YAML 块（AI 已给出 statText 的真实路径）
    湖之仆从/                官方 PDF，三行无标签数值块
    一梦/                    存储的 module-npc YAML 块
```

每个团本目录：

- `files/`：素材文件（md / txt / csv / tsv / json / yaml / html / xlsx / docx / pdf）
- `expected.json`：期望结果

`expected.json` 支持：

```jsonc
{
  "entriesOnly": true,          // 只用 entry.statText 解析（真实工作流里 AI 会给出数值块）
  "npcs": [
    {
      "name": "NPC 名",
      "attributes": { "str": 60, "con": 70, "...": 0 },
      "hp": 13, "mp": 14, "san": 0, "dp": 0, "armor": "0",
      "statText": "可选的原文数值块"
    }
  ]
}
```

## 准确率口径

逐团本计算字段级准确率：

- 期望 NPC 的属性（str/con/siz/dex/app/int/pow/edu/luck）
- HP / MP / SAN / DP / 护甲
- 多抓的 NPC 记为一整组错误字段，避免“乱抓 NPC”刷高准确率
- 每个团本要求 **≥ 90%**，全部团本还要看平均值

## 运行

```bash
# 重新生成合成素材
npm run test:module-parse:generate --workspace @touhou/web

# 运行全部团本评测
npm run test:module-parse --workspace @touhou/web

# 只跑某个团本 / 看错在哪
npx tsx --env-file=.env scripts/evaluate-module-parse.ts --filter=湖之仆从 --verbose
```

## 覆盖情况（synthetic）

| 编号 | 覆盖点 |
| --- | --- |
| s01 | 中文标签同行 |
| s02 | 英文标签同行 |
| s03 | 冒号逐行 |
| s04 | 三行无标签数值块（湖之仆从格式） |
| s05 | 中文标签表头 + 数值行 |
| s06 | Markdown 表格 |
| s07 | CSV（英文表头） |
| s08 | JSON |
| s09 | YAML |
| s10 | HTML 表格 |
| s11 | XLSX |
| s12 | DOCX |
| s13 | PDF（文本层） |
| s14 | 骰点（3D6）不应误读 |
| s15 | 英文 NPC 名 |
| s16 | 20 个 NPC |
| s17 | 别名 |
| s18 | 显式 HP/MP/SAN/DP/护甲 |
| s19 | TSV |
| s20 | 正文夹数值 |
| s21 | 多文件 |
| s22 | 英文三行无标签 |
| s23 | OCR / 错位噪声字符 |
| s24 | 中英混合 + 缺失项 |

## 回归（regression）

| 团本 | 素材 | 口径 |
| --- | --- | --- |
| 湖之仆从 | 官方 PDF | 三行无标签数值块；expected 为人工核对后的 9 个 NPC 数值，`statText` 为原文数值块，验证 `parsePositionalBlock` |
| 鬼屋 | 存储的 `module.md`（`raw/` 保留原始 docx/txt） | `entriesOnly`：验证工作流对 AI 给出的 `statText` / YAML 数值块能稳定复现 |
| 一梦 | 存储的 `module.md` | 同上 |

回归脚本不会访问数据库，只需 `apps/web/.env` 里的 `DATABASE_URL` 让 Prisma 客户端可加载（评测过程不查询数据库）。
