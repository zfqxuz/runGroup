import { z } from "zod";

/** 弹幕演出的数据版本；后续格式变更时递增并做迁移。 */
export const DANMAKU_PATTERN_VERSION = 1;

export const DANMAKU_LAYER_TYPES = [
  "ring",
  "spiral",
  "fan",
  "cross",
  "flower",
  "random",
  "aim",
  "whip",
  "laser"
] as const;
export type DanmakuLayerType = (typeof DANMAKU_LAYER_TYPES)[number];

export const DANMAKU_BULLET_SHAPES = [
  "orb",
  "ball",
  "ring",
  "star",
  "rice",
  "ofuda",
  "knife",
  "scale",
  "butterfly"
] as const;
export type DanmakuBulletShape = (typeof DANMAKU_BULLET_SHAPES)[number];

export const DANMAKU_COLORS = [
  "#f43f5e",
  "#fb923c",
  "#facc15",
  "#4ade80",
  "#38bdf8",
  "#6366f1",
  "#a855f7",
  "#f472b6",
  "#e2e8f0"
] as const;

const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "颜色格式不正确");

/**
 * 一层图案 = 一个持续发射的弹幕发射器。
 * 编辑器不做完整时间轴，所有层从 0 帧开始、按 interval 循环发射；
 * 展开型符卡循环到被击破为止，消费型符卡只播放固定时长。
 */
export const DanmakuLayerSchema = z.object({
  id: z.string().min(1).max(32),
  type: z.enum(DANMAKU_LAYER_TYPES),
  /** 每轮发射的弹数。 */
  count: z.number().int().min(1).max(48),
  /** 两轮发射之间的间隔帧数（60fps）。 */
  interval: z.number().int().min(2).max(180),
  /** 基础速度，单位 px/帧。 */
  speed: z.number().min(0.2).max(14),
  /** 基础角度（度）；0 为向右，90 为向下。 */
  angle: z.number().min(-180).max(180),
  /** 扇形 / 随机角度的张角（度）。 */
  spread: z.number().min(0).max(360),
  /** 每轮增加的旋转角度（度）；螺旋、旋转类图案使用。 */
  rotation: z.number().min(-30).max(30),
  /** 加速度，单位 px/帧²，可为负。 */
  accel: z.number().min(-0.4).max(0.4),
  /** 角速度，单位 度/帧，用于弯曲弹道。 */
  curve: z.number().min(-10).max(10),
  /** 视觉大小倍率。 */
  size: z.number().min(0.4).max(3),
  color: HexColorSchema,
  shape: z.enum(DANMAKU_BULLET_SHAPES),
  /** 是否使用加色发光。 */
  glow: z.boolean(),
  /** 激光专用：光束宽度。 */
  laserWidth: z.number().min(1).max(60).optional(),
  /** 激光专用：预警帧数，0 表示立即实体化。 */
  laserTelegraph: z.number().int().min(0).max(120).optional(),
  /** 激光专用：光束存在帧数。 */
  laserLife: z.number().int().min(5).max(180).optional()
});
export type DanmakuLayer = z.infer<typeof DanmakuLayerSchema>;

export const DanmakuPatternSchema = z.object({
  version: z.literal(DANMAKU_PATTERN_VERSION),
  /** 只影响视觉随机，不影响战斗判定。 */
  seed: z.number().int().min(0).max(2_147_483_647),
  layers: z.array(DanmakuLayerSchema).min(1).max(3)
});
export type DanmakuPattern = z.infer<typeof DanmakuPatternSchema>;

export function isDanmakuPattern(value: unknown): value is DanmakuPattern {
  return DanmakuPatternSchema.safeParse(value).success;
}
