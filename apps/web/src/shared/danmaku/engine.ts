import type { DanmakuLayer, DanmakuPattern } from "./schema";

export interface DanmakuBullet {
  x: number;
  y: number;
  /** 当前速度方向（度）。 */
  angle: number;
  speed: number;
  accel: number;
  curve: number;
  size: number;
  color: string;
  shape: DanmakuLayer["shape"];
  glow: boolean;
  age: number;
  life: number;
}

export interface DanmakuLaser {
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  color: string;
  age: number;
  telegraph: number;
  life: number;
  /** 预警状态结束后进入实体光束。 */
  fired: boolean;
}

export interface DanmakuRunnerOptions {
  readonly width: number;
  readonly height: number;
  readonly maxBullets?: number;
}

interface ActiveLayer {
  readonly def: DanmakuLayer;
  nextAt: number;
  shotIndex: number;
}

const DEG = Math.PI / 180;

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * 确定性弹幕模拟器。
 *
 * 输入只有 pattern + 视口，每帧 update；渲染层只读取 bullets / lasers。
 * 同样的 seed、同样的帧数，结果一定一样，便于编辑器预览和战斗演出复用。
 */
export class DanmakuRunner {
  readonly pattern: DanmakuPattern;

  frame = 0;
  bullets: DanmakuBullet[] = [];
  lasers: DanmakuLaser[] = [];
  spawning = true;

  private readonly random: () => number;
  private readonly maxBullets: number;
  private layers: ActiveLayer[];
  private width: number;
  private height: number;
  private originX = 0;
  private originY = 0;
  private focusX = 0;
  private focusY = 0;

  constructor(pattern: DanmakuPattern, options: DanmakuRunnerOptions) {
    this.pattern = pattern;
    this.random = mulberry32(pattern.seed);
    this.maxBullets = clamp(options.maxBullets ?? 360, 40, 720);
    this.width = Math.max(1, options.width);
    this.height = Math.max(1, options.height);
    this.updateViewport();
    this.layers = pattern.layers.map((def) => ({ def, nextAt: 0, shotIndex: 0 }));
  }

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.updateViewport();
  }

  stopSpawning(): void {
    this.spawning = false;
  }

  /** 没有弹、没有激光，且不再发射时视为播放结束（一次性符卡用）。 */
  isIdle(): boolean {
    return this.spawning === false && this.bullets.length === 0 && this.lasers.length === 0;
  }

  update(dtFrames = 1): void {
    const dt = clamp(dtFrames, 0, 3);
    if (dt <= 0) return;

    if (this.spawning) {
      for (const layer of this.layers) {
        while (layer.nextAt <= this.frame && this.bullets.length < this.maxBullets) {
          this.emit(layer.def, layer.shotIndex);
          layer.shotIndex += 1;
          layer.nextAt += layer.def.interval;
        }
      }
    }

    this.updateBullets(dt);
    this.updateLasers(dt);
    this.frame += dt;
  }

  private updateViewport(): void {
    this.originX = this.width * 0.5;
    this.originY = this.height * 0.28;
    this.focusX = this.width * 0.5;
    this.focusY = this.height * 0.86;
  }

  private updateBullets(dt: number): void {
    const margin = Math.max(this.width, this.height) * 0.2;
    const alive: DanmakuBullet[] = [];
    for (const bullet of this.bullets) {
      bullet.age += dt;
      bullet.speed = Math.max(0.05, bullet.speed + bullet.accel * dt);
      bullet.angle += bullet.curve * dt;
      const rad = bullet.angle * DEG;
      bullet.x += Math.cos(rad) * bullet.speed * dt;
      bullet.y += Math.sin(rad) * bullet.speed * dt;
      if (
        bullet.age < bullet.life &&
        bullet.x > -margin &&
        bullet.x < this.width + margin &&
        bullet.y > -margin &&
        bullet.y < this.height + margin
      ) {
        alive.push(bullet);
      }
    }
    this.bullets = alive;
  }

  private updateLasers(dt: number): void {
    const alive: DanmakuLaser[] = [];
    for (const laser of this.lasers) {
      laser.age += dt;
      if (laser.fired === false && laser.age >= laser.telegraph) {
        laser.fired = true;
        laser.age = 0;
      }
      if (laser.fired ? laser.age < laser.life : laser.age < laser.telegraph) {
        alive.push(laser);
      }
    }
    this.lasers = alive;
  }

  private emit(layer: DanmakuLayer, shotIndex: number): void {
    if (layer.type === "laser") {
      this.emitLasers(layer);
      return;
    }

    const angles = this.resolveAngles(layer, shotIndex);
    for (let index = 0; index < angles.length; index += 1) {
      if (this.bullets.length >= this.maxBullets) return;
      const angle = angles[index] ?? 0;
      const origin = this.resolveOrigin(layer, index, angle);
      const speedBoost = layer.type === "flower" ? this.flowerSpeedFactor(angle) : 1;
      const whipBoost =
        layer.type === "whip" && angles.length > 1
          ? 0.55 + (1.1 * index) / (angles.length - 1)
          : 1;
      this.bullets.push({
        x: origin.x,
        y: origin.y,
        angle,
        speed: Math.max(0.2, layer.speed * speedBoost * whipBoost),
        accel: layer.accel,
        curve: layer.curve,
        size: layer.size,
        color: layer.color,
        shape: layer.shape,
        glow: layer.glow,
        age: 0,
        life: 60 * 12
      });
    }
  }

  private resolveAngles(layer: DanmakuLayer, shotIndex: number): number[] {
    const count = Math.max(1, Math.round(layer.count));
    const base = layer.angle;
    const rotation = layer.rotation * shotIndex;
    switch (layer.type) {
      case "ring":
        return Array.from({ length: count }, (_, index) => base + rotation + (360 / count) * index);
      case "spiral":
        return Array.from({ length: count }, (_, index) => base + rotation + (360 / count) * index);
      case "flower":
        return Array.from({ length: count }, (_, index) => base + rotation + (360 / count) * index);
      case "fan": {
        if (count === 1) return [base + rotation];
        return Array.from(
          { length: count },
          (_, index) => base + rotation - layer.spread / 2 + (layer.spread / (count - 1)) * index
        );
      }
      case "cross": {
        const arms = 4;
        const perArm = Math.max(1, Math.ceil(count / arms));
        return Array.from({ length: count }, (_, index) => {
          const arm = index % arms;
          const step = Math.floor(index / arms);
          const offset = (step - (perArm - 1) / 2) * 12;
          return base + rotation + 90 * arm + offset;
        });
      }
      case "random":
        return Array.from(
          { length: count },
          () => base + rotation + (this.random() * 2 - 1) * (layer.spread / 2)
        );
      case "aim": {
        const aim = Math.atan2(this.focusY - this.originY, this.focusX - this.originX) / DEG;
        if (count === 1) return [aim + rotation];
        return Array.from(
          { length: count },
          (_, index) => aim + rotation - layer.spread / 2 + (layer.spread / (count - 1)) * index
        );
      }
      case "whip":
        return Array.from({ length: count }, () => base + rotation);
      case "laser":
        return [];
      default:
        return [];
    }
  }

  private resolveOrigin(
    layer: DanmakuLayer,
    index: number,
    angle: number
  ): { x: number; y: number } {
    if (layer.type !== "whip") return { x: this.originX, y: this.originY };
    const count = Math.max(1, Math.round(layer.count));
    const offset = (index - (count - 1) / 2) * 16;
    const perpendicular = (angle + 90) * DEG;
    return {
      x: this.originX + Math.cos(perpendicular) * offset,
      y: this.originY + Math.sin(perpendicular) * offset
    };
  }

  private flowerSpeedFactor(angle: number): number {
    const rad = angle * DEG;
    return 0.62 + 0.38 * Math.abs(Math.cos(rad * 3));
  }

  private emitLasers(layer: DanmakuLayer): void {
    if (this.lasers.length >= 24) return;
    const count = Math.max(1, Math.round(layer.count));
    const base = layer.angle;
    const length = Math.hypot(this.width, this.height) * 1.3;
    for (let index = 0; index < count; index += 1) {
      const offset = count === 1 ? 0 : -layer.spread / 2 + (layer.spread / (count - 1)) * index;
      this.lasers.push({
        x: this.originX,
        y: this.originY,
        angle: base + offset,
        length,
        width: layer.laserWidth ?? 8,
        color: layer.color,
        age: 0,
        telegraph: layer.laserTelegraph ?? 24,
        life: layer.laserLife ?? 32,
        fired: false
      });
    }
  }
}
