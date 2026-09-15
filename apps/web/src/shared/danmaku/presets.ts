import {
  DANMAKU_COLORS,
  DANMAKU_LAYER_TYPES,
  type DanmakuBulletShape,
  type DanmakuLayer,
  type DanmakuLayerType,
  type DanmakuPattern
} from "./schema";

export const DANMAKU_LAYER_LABELS: Record<DanmakuLayerType, string> = {
  ring: "圆环",
  spiral: "螺旋",
  fan: "扇形",
  cross: "交叉",
  flower: "花形",
  random: "随机散射",
  aim: "自机狙",
  whip: "鞭弹",
  laser: "激光阵"
};

export const DANMAKU_LAYER_DESCRIPTIONS: Record<DanmakuLayerType, string> = {
  ring: "以发射点为中心向四周均匀撒弹。",
  spiral: "每轮旋转一定角度，形成旋涡状弹幕。",
  fan: "朝一个方向扇形展开，适合正面压制。",
  cross: "四个方向同时发射，形成十字交叉。",
  flower: "环状弹幕的速度按花形调制。",
  random: "在张角范围内随机散布，弹幕更混沌。",
  aim: "朝画面下方的自机方向发射，可带少量散射。",
  whip: "一列弹以不同速度甩出，形成鞭状。",
  laser: "生成预警线后实体化的激光。"
};

export const DANMAKU_SHAPE_LABELS: Record<DanmakuBulletShape, string> = {
  orb: "光玉",
  ball: "小弹",
  ring: "圆环弹",
  star: "星弹",
  rice: "米弹",
  ofuda: "符札",
  knife: "刀弹",
  scale: "鳞弹",
  butterfly: "蝶弹"
};

const LAYER_DEFAULTS: Record<DanmakuLayerType, Omit<DanmakuLayer, "id" | "type">> = {
  ring: {
    count: 14,
    interval: 42,
    speed: 2.4,
    angle: 90,
    spread: 360,
    rotation: 0,
    accel: 0,
    curve: 0,
    size: 1,
    color: "#a855f7",
    shape: "orb",
    glow: true
  },
  spiral: {
    count: 8,
    interval: 12,
    speed: 2.6,
    angle: 0,
    spread: 360,
    rotation: 9,
    accel: 0,
    curve: 0,
    size: 1,
    color: "#38bdf8",
    shape: "ball",
    glow: true
  },
  fan: {
    count: 7,
    interval: 22,
    speed: 3,
    angle: 90,
    spread: 80,
    rotation: 0,
    accel: 0,
    curve: 0,
    size: 1.1,
    color: "#f472b6",
    shape: "rice",
    glow: true
  },
  cross: {
    count: 12,
    interval: 28,
    speed: 2.8,
    angle: 45,
    spread: 360,
    rotation: 3,
    accel: 0,
    curve: 0,
    size: 1,
    color: "#facc15",
    shape: "knife",
    glow: true
  },
  flower: {
    count: 18,
    interval: 48,
    speed: 2.2,
    angle: 0,
    spread: 360,
    rotation: 2,
    accel: 0,
    curve: 0,
    size: 1.15,
    color: "#fb923c",
    shape: "scale",
    glow: true
  },
  random: {
    count: 10,
    interval: 18,
    speed: 3.2,
    angle: 90,
    spread: 120,
    rotation: 0,
    accel: 0,
    curve: 0,
    size: 0.9,
    color: "#4ade80",
    shape: "ball",
    glow: true
  },
  aim: {
    count: 5,
    interval: 20,
    speed: 3.6,
    angle: 90,
    spread: 34,
    rotation: 0,
    accel: 0,
    curve: 0,
    size: 1,
    color: "#f43f5e",
    shape: "ofuda",
    glow: true
  },
  whip: {
    count: 12,
    interval: 30,
    speed: 2.4,
    angle: 90,
    spread: 0,
    rotation: 0,
    accel: 0,
    curve: 0,
    size: 1,
    color: "#6366f1",
    shape: "butterfly",
    glow: true
  },
  laser: {
    count: 3,
    interval: 80,
    // 激光不读取 speed，但 schema 下限是 0.2；留一个合法占位值。
    speed: 0.2,
    angle: 90,
    spread: 70,
    rotation: 0,
    accel: 0,
    curve: 0,
    size: 1,
    color: "#e2e8f0",
    shape: "ball",
    glow: true,
    laserWidth: 9,
    laserTelegraph: 26,
    laserLife: 34
  }
};

let layerIdCounter = 0;

function nextLayerId(type: DanmakuLayerType): string {
  layerIdCounter += 1;
  return `${type}-${layerIdCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

export function createDanmakuLayer(type: DanmakuLayerType): DanmakuLayer {
  const defaults = LAYER_DEFAULTS[type];
  return {
    id: nextLayerId(type),
    type,
    ...defaults,
    // 防止未来新增图案类型时再出现低于 schema 下限的默认值。
    speed: Math.max(0.2, defaults.speed),
    color: DANMAKU_COLORS[Math.floor(Math.random() * DANMAKU_COLORS.length)] ?? DANMAKU_COLORS[0]
  };
}

export const DANMAKU_PRESET_TYPES: readonly DanmakuLayerType[] = DANMAKU_LAYER_TYPES;

export function createDefaultDanmakuPattern(seed = 20260913): DanmakuPattern {
  return {
    version: 1,
    seed,
    layers: [{ ...LAYER_DEFAULTS.ring, id: "layer-ring", type: "ring", color: "#a855f7" }]
  };
}

export function reseedDanmakuPattern(pattern: DanmakuPattern, seed?: number): DanmakuPattern {
  return {
    ...pattern,
    seed: seed ?? Math.floor(Math.random() * 2_147_483_647)
  };
}

/** 给旧卡牌或没有图案数据的符卡兜底。 */
export function fallbackDanmakuPattern(seedSource = "spell"): DanmakuPattern {
  let seed = 17;
  for (let index = 0; index < seedSource.length; index += 1) {
    seed = (seed * 31 + seedSource.charCodeAt(index)) % 2_147_483_647;
  }
  const ring: DanmakuLayer = {
    ...LAYER_DEFAULTS.ring,
    id: "fallback-ring",
    type: "ring",
    color: "#a855f7"
  };
  const spiral: DanmakuLayer = {
    ...LAYER_DEFAULTS.spiral,
    id: "fallback-spiral",
    type: "spiral",
    color: "#38bdf8",
    interval: 16,
    count: 6
  };
  return { version: 1, seed, layers: [ring, spiral] };
}

export function patternLayerSummary(layer: DanmakuLayer): string {
  return `${DANMAKU_LAYER_LABELS[layer.type]} · ${layer.count} 发 / ${layer.interval} 帧`;
}
