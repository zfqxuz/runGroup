/**
 * n8n 团本解析工作流离线验证。
 *
 * 不启动 n8n、不访问网络：直接读取生成的 workflow JSON，用同样的 Code 节点源码
 * 在 Node Function 里跑推进去的模型响应，重点确认场景级分块和 NPC 数值准确性。
 *
 * 运行：npm run verify:n8n-workflow --workspace @touhou/web
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface CoreModule {
  readonly parseNpcStatsText: (raw: string) => {
    readonly attributes: Record<string, number>;
    readonly maxHp: number | null;
    readonly maxMp: number | null;
    readonly maxSan: number | null;
    readonly matchedAttributes: number;
  };
  readonly harvestStatBlocks: (sources: readonly { filename?: string; text: string }[]) => readonly {
    readonly name: string;
    readonly attributes: Record<string, number>;
    readonly maxHp: number | null;
  }[];
  readonly buildNpcStats: (input: {
    readonly entries: readonly Record<string, unknown>[];
    readonly sources: readonly { filename?: string; text: string }[];
  }) => readonly {
    readonly name: string;
    readonly attributes: Record<string, number>;
    readonly maxHp: number | null;
  }[];
}

interface WorkflowNode {
  readonly name?: string;
  readonly type?: string;
  readonly parameters?: {
    readonly jsCode?: string;
    readonly [key: string]: unknown;
  };
}

interface WorkflowFile {
  readonly nodes?: readonly WorkflowNode[];
}

interface NodeAccessor {
  readonly first: () => { json: unknown };
  readonly all?: () => readonly { json: unknown }[];
}

interface PrepareRequestItem {
  readonly kind?: string;
  readonly label?: string;
  readonly chunk?: { readonly filename?: string; readonly fileIndex?: number; readonly fileTotal?: number; readonly text?: string };
  readonly imageBatch?: readonly { readonly filename?: string }[];
  readonly body: {
    readonly model: string;
    readonly messages: readonly unknown[];
  };
}

const require = createRequire(import.meta.url);
let failed = 0;

function check(condition: boolean, label: string): void {
  if (condition) {
    console.log("PASS " + label);
  } else {
    failed += 1;
    console.error("FAIL " + label);
  }
}

function findRepoRoot(start: string): string {
  let current = resolve(start);
  for (let index = 0; index < 8; index += 1) {
    if (existsSync(join(current, "n8n", "workflows", "module-import.json"))) return current;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(start);
}

async function runCode<T>(
  code: string,
  items: readonly unknown[],
  env: Record<string, string>,
  dollar?: (name: string) => NodeAccessor
): Promise<T> {
  const body = "return (async () => {\n" + code + "\n})();";
  const fn = new Function("items", "$env", "$", body) as (
    this: unknown,
    itemsToUse: readonly unknown[],
    envToUse: Record<string, string>,
    dollarToUse?: (name: string) => NodeAccessor
  ) => Promise<T>;
  return await fn(items, env, dollar);
}

async function main(): Promise<void> {
  const repoRoot = findRepoRoot(process.cwd());
  const core = require(join(repoRoot, "n8n", "workflow-src", "npc-stats-core.js")) as CoreModule;
  const workflow = JSON.parse(
    readFileSync(join(repoRoot, "n8n", "workflows", "module-import.json"), "utf8")
  ) as WorkflowFile;
  const nodes = workflow.nodes ?? [];
  const prepareNode = nodes.find((node) => node.name === "按场景分块");
  const httpNode = nodes.find((node) => node.name === "调用 DeepSeek");
  const parseNode = nodes.find((node) => node.name === "解析并聚合");

  check(prepareNode?.type === "n8n-nodes-base.code", "工作流包含按场景分块 Code 节点");
  check(httpNode?.type === "n8n-nodes-base.httpRequest", "工作流包含 HTTP Request 节点");
  check(parseNode?.type === "n8n-nodes-base.code", "工作流包含解析聚合 Code 节点");
  check(
    JSON.stringify(httpNode?.parameters ?? {}).includes("DEEPSEEK_API_KEY"),
    "HTTP 节点通过环境变量注入 DeepSeek API Key"
  );
  check(
    (prepareNode?.parameters?.jsCode ?? "").includes("fetch(") === false &&
      (parseNode?.parameters?.jsCode ?? "").includes("fetch(") === false,
    "Code 节点没有直接使用网络请求"
  );
  check(
    (prepareNode?.parameters?.jsCode ?? "").includes("chunkSourceByScene") &&
      (prepareNode?.parameters?.jsCode ?? "").includes("isSceneBoundary"),
    "工作流包含场景 / 章节边界分块逻辑"
  );
  check(
    (parseNode?.parameters?.jsCode ?? "").includes("repairJsonText"),
    "解析节点包含模型 JSON 修复逻辑"
  );

  const inline = core.parseNpcStatsText(
    "STR 60 CON 70 SIZ 65 DEX 50 APP 45 INT 80 POW 75 EDU 90 LUCK 55 HP 13 MP 15 SAN 80"
  );
  check(inline.matchedAttributes === 9 && inline.attributes.str === 60, "核心解析英文属性行");
  check(inline.maxHp === 13 && inline.maxMp === 15 && inline.maxSan === 80, "核心解析 HP / MP / SAN");

  const dice = core.parseNpcStatsText("STR 3d6 CON 70 SIZ 65 DEX 50");
  check(dice.attributes.str === undefined && dice.attributes.con === 70, "核心不会把 3d6 误读成属性 3");

  const sources = [
    {
      filename: "story.md",
      text: "## 哥布林守卫\nSTR 60 CON 70 SIZ 65 DEX 50 APP 45 INT 80 POW 75 EDU 90 LUCK 55\nHP 13 MP 15 SAN 80"
    }
  ];
  const harvested = core.harvestStatBlocks(sources);
  check(harvested.some((item) => item.name === "哥布林守卫" && item.attributes.str === 60), "核心可从原文直接收割带名字的数值块");

  const built = core.buildNpcStats({ entries: [{ id: "goblin", name: "哥布林守卫" }], sources });
  check(built.length === 1 && built[0]?.attributes.str === 60 && built[0]?.maxHp === 13, "核心按 NPC 名回填数值");

  const webhookBody = {
    requestId: "verify-n8n",
    title: "验证团本",
    system: "COC7",
    era: "MODERN",
    author: "tester",
    instructions: "",
    model: "deepseek-flash",
    visionModel: "deepseek-flash",
    chunks: [],
    sources,
    images: []
  };

  const prepareResult = await runCode<readonly { json: PrepareRequestItem }[]>(
    prepareNode?.parameters?.jsCode ?? "",
    [{ json: { body: webhookBody } }],
    { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_BASE_URL: "https://api.deepseek.com" }
  );
  check(prepareResult.length === 1, "按场景分块节点为每个场景生成一次模型调用");
  check(prepareResult[0]?.json.kind === "chunk", "按场景分块节点输出 chunk 请求");
  check(prepareResult[0]?.json.body.model === "deepseek-flash", "按场景分块节点透传模型");
  check(
    String(prepareResult[0]?.json.label ?? "").includes("场景段"),
    "按场景分块节点保留场景级标签"
  );

  const aiJson = JSON.stringify({
    meta: { title: "哥布林洞窟" },
    sections: { 关键NPC: "哥布林守卫守着入口。" },
    structured: { npcs: [{ id: "goblin-guard", name: "哥布林守卫", description: "入口守卫" }] }
  });
  const chunkRequest = prepareResult[0]?.json;
  if (chunkRequest === undefined) throw new Error("prepare request missing");
  const parseDollar = (name: string): NodeAccessor => name === "Webhook 团本解析"
    ? { first: () => ({ json: { body: webhookBody } }) }
    : {
        first: () => ({ json: chunkRequest }),
        all: () => [{ json: chunkRequest }]
      };
  const parseResult = await runCode<readonly { json: { ok: boolean; npcStats: readonly { name: string; attributes: Record<string, number>; maxHp: number | null }[] } }[]>(
    parseNode?.parameters?.jsCode ?? "",
    [{ json: { choices: [{ message: { content: aiJson }, finish_reason: "stop" }] } }],
    {},
    parseDollar
  );
  const output = parseResult[0]?.json;
  check(output?.ok === true, "解析节点返回 ok=true");
  check(output?.npcStats?.[0]?.name === "哥布林守卫", "解析节点保留 NPC 名称");
  check(output?.npcStats?.[0]?.attributes.str === 60 && output?.npcStats?.[0]?.maxHp === 13, "解析节点使用原文确定性数值覆盖模型结果");

  const brokenJson = '{"meta":{"title":"修复测试"},"sections":{"关键NPC":"第一行\n第二行"},"structured":{}}';
  const repairedResult = await runCode<readonly { json: { ok: boolean; warnings: readonly string[] } }[]>(
    parseNode?.parameters?.jsCode ?? "",
    [{ json: { choices: [{ message: { content: brokenJson }, finish_reason: "stop" }] } }],
    {},
    parseDollar
  );
  check(repairedResult[0]?.json.ok === true, "解析节点可修复模型返回的未转义换行 JSON");

  const mixedBody = {
    ...webhookBody,
    requestId: "verify-n8n-mixed",
    images: [
      {
        filename: "map.png",
        relativePath: "assets/images/map.png",
        mime: "image/png",
        dataUrl: "data:image/png;base64,AAAA"
      }
    ]
  };
  const mixedPrepare = await runCode<readonly { json: PrepareRequestItem }[]>(
    prepareNode?.parameters?.jsCode ?? "",
    [{ json: { body: mixedBody } }],
    { DEEPSEEK_API_KEY: "test-key", DEEPSEEK_BASE_URL: "https://api.deepseek.com" }
  );
  check(mixedPrepare.length === 2, "按场景分块节点同时生成文本和图片请求");
  check(mixedPrepare[1]?.json.kind === "image", "图片请求带 image 标记");

  const imageJson = JSON.stringify({
    images: [
      {
        filename: "map.png",
        kind: "MAP",
        transcription: "入口",
        description: "一张地图",
        section: "地点与场景",
        sectionText: "地图正文",
        scene: { id: "scene-map", name: "入口地图", width: 800, height: 600, gridType: "SQUARE" },
        clue: null,
        npc: null,
        item: null
      }
    ]
  });
  const mixedRequests = mixedPrepare.map((item) => item.json);
  const mixedDollar = (name: string): NodeAccessor => name === "Webhook 团本解析"
    ? { first: () => ({ json: { body: mixedBody } }) }
    : {
        first: () => ({ json: mixedRequests[0] ?? {} }),
        all: () => mixedRequests.map((json) => ({ json }))
      };
  const mixedResult = await runCode<readonly { json: { images: readonly { kind: string; scene: Record<string, unknown> | null; section: string }[] } }[]>(
    parseNode?.parameters?.jsCode ?? "",
    [
      { json: { choices: [{ message: { content: aiJson }, finish_reason: "stop" }] } },
      { json: { choices: [{ message: { content: imageJson }, finish_reason: "stop" }] } }
    ],
    {},
    mixedDollar
  );
  check(mixedResult[0]?.json.images?.[0]?.kind === "MAP", "解析节点正确对应图片响应");
  check(mixedResult[0]?.json.images?.[0]?.section === "地点与场景", "解析节点保留图片结构化章节");
  check(mixedResult[0]?.json.images?.[0]?.scene?.id === "scene-map", "解析节点保留图片场景对象");
}

void main().then(() => {
  if (failed > 0) {
    console.error("verify-n8n-workflow: " + String(failed) + " failure(s)");
    process.exitCode = 1;
  } else {
    console.log("verify-n8n-workflow: all checks passed");
  }
});
