# 团本解析工作流 v2（副本）

这是 `n8n/workflow-src/` 的副本，用于在不影响线上原始工作流的前提下迭代确定性解析核心。
构建产物：`n8n/workflows/module-import-v2.json`。

## 主要改动（相对 `workflow-src/`）

全部集中在 `npc-stats-core.js`：

1. **无标签三行数值块**：支持官方模组常见的
   `STR CON SIZ DEX APP / INT POW EDU Luck HP / DB Build MOV MP`
   排版，用 `MP = floor(POW/5)` 做校验，容忍 `—` 与 OCR 噪声字符。
2. **表格解析**：支持 CSV / TSV / Markdown 表格 / HTML 表格 / xlsx 文本化后的
   表头 + 多行数值，多行会各自生成一条记录（不再是只读第一行）。
3. **文档顺序取值**：同一窗口内中英文标签混排时，按正文出现顺序取第一个值，
   不再让后出现的英文标签覆盖更早的中文值。
4. **派生 HP / MP**：没有显式 HP / MP 时按 COC7 规则从 CON/SIZ/POW 推导。
5. **窗口截断**：按 NPC 名回填数值时，遇到下一个 NPC 标题就截断，避免串读下一个
   NPC 的 SAN / 属性。
6. **同名碎片合并 + 签名去重**：把逐行属性合并成完整 NPC，再用数值签名去掉
   “章节标题被当成 NPC” 的假记录。
7. **护甲 / JSON / YAML / 单字名**：支持 `护甲 3`、`"armor": 4`、YAML `str: 60`、
   单字中文 NPC 名等写法。

原始 `workflow-src/` 与 `n8n/workflows/module-import.json` 未改动。

## 构建

```bash
node n8n/build-workflows-v2.mjs
# -> n8n/workflows/module-import-v2.json
```

## 验证

```bash
cd apps/web
npm run test:module-parse        # 27 个团本（24 合成 + 3 回归），要求每个 >= 90%
```

## 部署

确认评测通过后，用 v2 产物覆盖线上工作流：

```bash
# 需要管理员权限；会替换同 webhook path 的工作流
# 备份原工作流 JSON 后，将 module-import-v2.json 导入 n8n 即可
```
