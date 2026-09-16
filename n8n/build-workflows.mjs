import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, "workflow-src");
const vendorPath = join(here, "vendor", "jsonrepair.min.js");
const outputDir = join(here, "workflows");
const outputPath = join(outputDir, "module-import.json");

const read = (name) => readFile(join(srcDir, name), "utf8");

const [
  vendor,
  core,
  jsonExtract,
  agentPrompts,
  classifyTemplate,
  buildTemplate,
  parseTemplate,
  filterCode,
  aggregateTemplate
] = await Promise.all([
  readFile(vendorPath, "utf8"),
  read("npc-stats-core.js"),
  read("json-extract.js"),
  read("agent-prompts.js"),
  read("classify-routes.node.js"),
  read("build-route-request.template.js"),
  read("parse-route-result.template.js"),
  read("filter-pending.node.js"),
  read("aggregate-branches.template.js")
]);

const vendorWrapper = [
  "// ---- jsonrepair (MIT) ----",
  "const __jsonrepairPackage = (() => {",
  "  const exports = {};",
  "  const module = { exports };",
  vendor,
  "  return module.exports;",
  "})();",
  "const jsonrepairLib = typeof __jsonrepairPackage.jsonrepair === \"function\" ? __jsonrepairPackage.jsonrepair : null;",
  "// ---- end jsonrepair ----",
  ""
].join("\n");

const routes = [
  {
    key: "narrative",
    label: "剧情与场景",
    buildNode: "构建剧情请求",
    agentNode: "调用剧情 Agent",
    parseNode: "解析剧情结果",
    position: [520, 0]
  },
  {
    key: "npc",
    label: "NPC 数值",
    buildNode: "构建NPC请求",
    agentNode: "调用NPC Agent",
    parseNode: "解析NPC结果",
    position: [520, 180]
  },
  {
    key: "handout",
    label: "线索与手书",
    buildNode: "构建线索请求",
    agentNode: "调用线索 Agent",
    parseNode: "解析线索结果",
    position: [520, 360]
  },
  {
    key: "setting",
    label: "设定与规则",
    buildNode: "构建设定请求",
    agentNode: "调用设定 Agent",
    parseNode: "解析设定结果",
    position: [520, 540]
  },
  {
    key: "notes",
    label: "设定笔记",
    buildNode: "构建笔记请求",
    agentNode: "调用笔记 Agent",
    parseNode: "解析笔记结果",
    position: [520, 720]
  },
  {
    key: "image",
    label: "图片与地图",
    buildNode: "构建图片请求",
    agentNode: "调用图片 Agent",
    parseNode: "解析图片结果",
    position: [520, 900]
  },
  {
    key: "general",
    label: "综合提取",
    buildNode: "构建综合请求",
    agentNode: "调用综合 Agent",
    parseNode: "解析综合结果",
    position: [520, 1080]
  }
];

const classifyCode = [agentPrompts, classifyTemplate].join("\n");

const baseHttpParameters = {
  method: "POST",
  url: "={{ $json.url }}",
  sendHeaders: true,
  headerParameters: {
    parameters: [
      { name: "Authorization", value: "=Bearer {{ $env.DEEPSEEK_API_KEY }}" },
      { name: "Content-Type", value: "application/json" }
    ]
  },
  sendBody: true,
  specifyBody: "json",
  jsonBody: "={{ JSON.stringify($json.body) }}",
  options: {
    timeout: 600000,
    batching: { batch: { batchSize: 4, batchInterval: 500 } },
    response: { response: { neverError: false } }
  }
};

const validationHttpParameters = {
  ...baseHttpParameters,
  options: {
    ...baseHttpParameters.options,
    batching: { batch: { batchSize: 3, batchInterval: 500 } }
  }
};

let nodeCounter = 10;
function nextNodeId() {
  nodeCounter += 1;
  return "10000000-0000-4000-8000-" + String(nodeCounter).padStart(12, "0");
}

const nodes = [];
const connections = {};

function addNode(node) {
  nodes.push(node);
  return node;
}

addNode({
  parameters: {
    httpMethod: "POST",
    path: "module-parse",
    responseMode: "responseNode",
    options: {}
  },
  id: nextNodeId(),
  name: "Webhook 团本解析",
  type: "n8n-nodes-base.webhook",
  typeVersion: 2,
  position: [0, 360],
  webhookId: "touhou-module-parse"
});

addNode({
  parameters: {
    mode: "runOnceForAllItems",
    jsCode: classifyCode
  },
  id: nextNodeId(),
  name: "分类与分块",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [260, 360]
});

const switchRules = routes.map((route) => ({
  outputKey: route.key,
  conditions: {
    options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
    conditions: [
      {
        leftValue: "={{ $json.route }}",
        rightValue: route.key,
        operator: { type: "string", operation: "equals" }
      }
    ],
    combinator: "and"
  }
}));

addNode({
  parameters: {
    rules: { values: switchRules },
    options: {}
  },
  id: nextNodeId(),
  name: "按内容类型路由",
  type: "n8n-nodes-base.switch",
  typeVersion: 3.2,
  position: [260, 360]
});

const switchTargets = [];
for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
  const route = routes[routeIndex];
  const [x, y] = route.position;
  const buildCode = [
    agentPrompts,
    "const ROUTE_KEY = " + JSON.stringify(route.key) + ";",
    "const ROUTE_LABEL = " + JSON.stringify(route.label) + ";",
    buildTemplate
  ].join("\n");
  const parseCode = [
    vendorWrapper,
    jsonExtract,
    agentPrompts,
    "const ROUTE_KEY = " + JSON.stringify(route.key) + ";",
    "const ROUTE_LABEL = " + JSON.stringify(route.label) + ";",
    parseTemplate.replaceAll("__BUILD_NODE_NAME__", route.buildNode)
  ].join("\n");

  addNode({
    parameters: { mode: "runOnceForAllItems", jsCode: buildCode },
    id: nextNodeId(),
    name: route.buildNode,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [x, y]
  });
  addNode({
    parameters: baseHttpParameters,
    id: nextNodeId(),
    name: route.agentNode,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [x + 260, y],
    onError: "continueRegularOutput"
  });
  addNode({
    parameters: { mode: "runOnceForAllItems", jsCode: parseCode },
    id: nextNodeId(),
    name: route.parseNode,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: [x + 520, y]
  });

  switchTargets.push({ node: route.buildNode, type: "main", index: 0 });
  connections[route.buildNode] = { main: [[{ node: route.agentNode, type: "main", index: 0 }]] };
  connections[route.agentNode] = { main: [[{ node: route.parseNode, type: "main", index: 0 }]] };
  connections[route.parseNode] = { main: [[{ node: "合并分支结果", type: "main", index: routeIndex }]] };
}

connections["Webhook 团本解析"] = { main: [[{ node: "分类与分块", type: "main", index: 0 }]] };
connections["分类与分块"] = { main: [[{ node: "按内容类型路由", type: "main", index: 0 }]] };
connections["按内容类型路由"] = { main: switchTargets.map((target) => [target]) };

addNode({
  parameters: { mode: "append", numberInputs: routes.length },
  id: nextNodeId(),
  name: "合并分支结果",
  type: "n8n-nodes-base.merge",
  typeVersion: 3.2,
  position: [1040, 360]
});

addNode({
  parameters: { mode: "runOnceForAllItems", jsCode: filterCode },
  id: nextNodeId(),
  name: "汇总待校验",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1300, 360]
});

addNode({
  parameters: validationHttpParameters,
  id: nextNodeId(),
  name: "调用校验与重试 Agent",
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position: [1560, 360],
  onError: "continueRegularOutput"
});

let aggregateCode = [vendorWrapper, core, jsonExtract, aggregateTemplate].join("\n");
const branchReads = [];
for (const route of routes) {
  branchReads.push(
    "try {",
    "  for (const __item of $(" + JSON.stringify(route.parseNode) + ").all()) {",
    "    if (__item && __item.json) stage1Items.push(__item.json);",
    "  }",
    "} catch (error) { /* branch not executed */ }"
  );
}
aggregateCode = aggregateCode.replace("/*__BRANCH_READS__*/", branchReads.join("\n"));

addNode({
  parameters: { mode: "runOnceForAllItems", jsCode: aggregateCode },
  id: nextNodeId(),
  name: "聚合结果",
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position: [1820, 360]
});

addNode({
  parameters: {
    respondWith: "json",
    responseBody: "={{ $json }}",
    options: {}
  },
  id: nextNodeId(),
  name: "返回解析结果",
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1,
  position: [2080, 360]
});

connections["合并分支结果"] = { main: [[{ node: "汇总待校验", type: "main", index: 0 }]] };
connections["汇总待校验"] = { main: [[{ node: "调用校验与重试 Agent", type: "main", index: 0 }]] };
connections["调用校验与重试 Agent"] = { main: [[{ node: "聚合结果", type: "main", index: 0 }]] };
connections["聚合结果"] = { main: [[{ node: "返回解析结果", type: "main", index: 0 }]] };

const workflow = {
  id: "touhou-module-import",
  name: "团本解析工作流（选择器 + 多 Agent + 格式校验 + 确定性 NPC 数值）",
  active: false,
  nodes,
  connections,
  settings: { executionOrder: "v1" },
  staticData: null,
  pinData: {},
  versionId: "touhou-module-import-v4",
  meta: { templateCredsSetupCompleted: true },
  tags: []
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log("生成 n8n 工作流：" + outputPath);
console.log("节点数：" + String(nodes.length));
for (const route of routes) {
  console.log("分支：" + route.key + " -> " + route.buildNode + " -> " + route.agentNode + " -> " + route.parseNode);
}
