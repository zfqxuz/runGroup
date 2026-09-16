import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const corePath = join(here, "workflow-src", "npc-stats-core.js");
const preparePath = join(here, "workflow-src", "prepare-requests.node.js");
const vendorPath = join(here, "vendor", "jsonrepair.min.js");
const parseTemplatePath = join(here, "workflow-src", "parse-aggregate.template.js");
const outputDir = join(here, "workflows");
const outputPath = join(outputDir, "module-import.json");

const core = await readFile(corePath, "utf8");
const prepareCode = await readFile(preparePath, "utf8");
const parseTemplate = await readFile(parseTemplatePath, "utf8");
const vendor = await readFile(vendorPath, "utf8");
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
const parseCode = vendorWrapper + parseTemplate.replace("/*__NPC_STATS_CORE__*/", () => core);

if (parseCode.includes("/*__NPC_STATS_CORE__*/")) {
  throw new Error("npc-stats-core 占位符没有被替换");
}

const workflow = {
  id: "touhou-module-import",
  name: "团本解析工作流（n8n + DeepSeek + 确定性 NPC 数值）",
  active: false,
  nodes: [
    {
      parameters: {
        httpMethod: "POST",
        path: "module-parse",
        responseMode: "responseNode",
        options: {}
      },
      id: "10000000-0000-4000-8000-000000000001",
      name: "Webhook 团本解析",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 0],
      webhookId: "touhou-module-parse"
    },
    {
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: prepareCode
      },
      id: "10000000-0000-4000-8000-000000000002",
      name: "按场景分块",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [260, 0]
    },
    {
      parameters: {
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
          response: {
            response: {
              neverError: false
            }
          }
        }
      },
      id: "10000000-0000-4000-8000-000000000003",
      name: "调用 DeepSeek",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [520, 0]
    },
    {
      parameters: {
        mode: "runOnceForAllItems",
        jsCode: parseCode
      },
      id: "10000000-0000-4000-8000-000000000004",
      name: "解析并聚合",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [780, 0]
    },
    {
      parameters: {
        respondWith: "json",
        responseBody: "={{ $json }}",
        options: {}
      },
      id: "10000000-0000-4000-8000-000000000005",
      name: "返回解析结果",
      type: "n8n-nodes-base.respondToWebhook",
      typeVersion: 1,
      position: [1040, 0]
    }
  ],
  connections: {
    "Webhook 团本解析": {
      main: [[{ node: "按场景分块", type: "main", index: 0 }]]
    },
    "按场景分块": {
      main: [[{ node: "调用 DeepSeek", type: "main", index: 0 }]]
    },
    "调用 DeepSeek": {
      main: [[{ node: "解析并聚合", type: "main", index: 0 }]]
    },
    "解析并聚合": {
      main: [[{ node: "返回解析结果", type: "main", index: 0 }]]
    }
  },
  settings: { executionOrder: "v1" },
  staticData: null,
  pinData: {},
  versionId: "touhou-module-import-v1",
  meta: { templateCredsSetupCompleted: true },
  tags: []
};

await mkdir(outputDir, { recursive: true });
await writeFile(outputPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
console.log("生成 n8n 工作流：" + outputPath);
