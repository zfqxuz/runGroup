/**
 * 汇总所有分支解析结果，只把需要格式校验或截断重试的条目送去第二阶段。
 * 如果没有待处理条目，输出一个本地 noop 请求，保证下游聚合节点仍会执行。
 */

const pending = items.filter((item) => item && item.json && item.json.needsStage2 === true);
if (pending.length > 0) return pending;

return [{
  json: {
    originId: "noop",
    originLabel: "无需校验",
    stage2Id: "noop",
    stage2Kind: "noop",
    needsStage2: true,
    route: "noop",
    kind: "noop",
    label: "无需校验",
    url: "http://127.0.0.1:5678/healthz",
    body: { ping: true }
  }
}];
