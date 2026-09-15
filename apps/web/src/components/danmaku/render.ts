import type { DanmakuBullet, DanmakuLaser, DanmakuRunner } from "@/shared/danmaku/engine";
import type { DanmakuBulletShape } from "@/shared/danmaku/schema";

const DEG = Math.PI / 180;
const SPRITE_SIZE = 40;
const spriteCache = new Map<string, HTMLCanvasElement>();

export interface DanmakuTheme {
  readonly backgroundTop: string;
  readonly backgroundBottom: string;
  readonly accent: string;
}

export const DEFAULT_DANMAKU_THEME: DanmakuTheme = {
  backgroundTop: "#0b1026",
  backgroundBottom: "#1b1035",
  accent: "#a855f7"
};

function createSprite(shape: DanmakuBulletShape, color: string, glow: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE_SIZE;
  canvas.height = SPRITE_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx === null) return canvas;

  ctx.translate(SPRITE_SIZE / 2, SPRITE_SIZE / 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
  }

  switch (shape) {
    case "orb": {
      const gradient = ctx.createRadialGradient(0, -1, 1, 0, 0, 13);
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.35, color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ball": {
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.arc(-1.5, -1.5, 2.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ring": {
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.75)";
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case "star": {
      ctx.beginPath();
      for (let index = 0; index < 10; index += 1) {
        const radius = index % 2 === 0 ? 9 : 4;
        const angle = (index / 10) * Math.PI * 2 - Math.PI / 2;
        const x = Math.cos(angle) * radius;
        const y = Math.sin(angle) * radius;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "rice": {
      ctx.beginPath();
      ctx.ellipse(0, 0, 4, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.beginPath();
      ctx.ellipse(-1, -2, 1.5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "ofuda": {
      ctx.beginPath();
      ctx.rect(-4.5, -8, 9, 16);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(-1.5, -6, 3, 12);
      break;
    }
    case "knife": {
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(4, 3);
      ctx.lineTo(0, 7);
      ctx.lineTo(-4, 3);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "scale": {
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 8, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 5, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
      break;
    }
    case "butterfly": {
      ctx.beginPath();
      ctx.ellipse(-4, -3, 4.5, 2.8, -0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(4, -3, 4.5, 2.8, 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(-1, -1, 2, 6);
      break;
    }
  }

  return canvas;
}

function bulletSprite(bullet: DanmakuBullet): HTMLCanvasElement {
  const key = `${bullet.shape}|${bullet.color}|${bullet.glow ? "1" : "0"}`;
  const cached = spriteCache.get(key);
  if (cached !== undefined) return cached;
  const created = createSprite(bullet.shape, bullet.color, bullet.glow);
  spriteCache.set(key, created);
  return created;
}

function drawBackground(
  ctx: CanvasRenderingContext2D,
  runner: DanmakuRunner,
  width: number,
  height: number,
  theme: DanmakuTheme
): void {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.backgroundTop);
  gradient.addColorStop(1, theme.backgroundBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // 星尘
  ctx.globalCompositeOperation = "lighter";
  for (let index = 0; index < 42; index += 1) {
    const x = ((index * 97 + 31) % 101) / 101 * width;
    const y = ((index * 53 + 17) % 89) / 89 * height;
    const twinkle = 0.18 + 0.18 * Math.sin(runner.frame * 0.03 + index * 1.7);
    ctx.fillStyle = `rgba(255,255,255,${twinkle.toFixed(3)})`;
    ctx.fillRect(x, y, 1.4, 1.4);
  }
  ctx.globalCompositeOperation = "source-over";

  // 符卡法阵
  const originX = width * 0.5;
  const originY = height * 0.28;
  const radius = Math.min(width, height) * 0.2;
  ctx.save();
  ctx.translate(originX, originY);
  ctx.rotate(runner.frame * 0.004);
  ctx.strokeStyle = theme.accent;
  ctx.globalAlpha = 0.16;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawLasers(ctx: CanvasRenderingContext2D, runner: DanmakuRunner): void {
  for (const laser of runner.lasers) {
    const rad = laser.angle * DEG;
    const endX = laser.x + Math.cos(rad) * laser.length;
    const endY = laser.y + Math.sin(rad) * laser.length;
    if (laser.fired === false) {
      const blink = 0.16 + 0.16 * Math.sin(laser.age * 0.7);
      ctx.strokeStyle = laser.color;
      ctx.globalAlpha = blink;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 6]);
      ctx.beginPath();
      ctx.moveTo(laser.x, laser.y);
      ctx.lineTo(endX, endY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      continue;
    }

    const progress = laser.age / Math.max(1, laser.life);
    const overshoot = laser.age < 4 ? 1 + (4 - laser.age) * 0.45 : 1;
    const alpha = Math.min(1, (1 - progress) * 1.8);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    ctx.globalAlpha = alpha * 0.28;
    ctx.strokeStyle = laser.color;
    ctx.lineWidth = laser.width * 3 * overshoot;
    ctx.beginPath();
    ctx.moveTo(laser.x, laser.y);
    ctx.lineTo(endX, endY);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.85;
    ctx.lineWidth = laser.width * overshoot;
    ctx.stroke();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = Math.max(1, laser.width * 0.35);
    ctx.stroke();
    ctx.restore();
  }
}

function drawBullets(ctx: CanvasRenderingContext2D, runner: DanmakuRunner): void {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const bullet of runner.bullets) {
    const sprite = bulletSprite(bullet);
    const size = 34 * bullet.size;
    ctx.save();
    ctx.translate(bullet.x, bullet.y);
    ctx.rotate((bullet.angle + 90) * DEG);
    ctx.globalAlpha = bullet.glow ? 0.98 : 0.9;
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

/** 一帧的完整绘制入口；只读取 runner 状态，不修改模拟。 */
export function drawDanmakuFrame(
  ctx: CanvasRenderingContext2D,
  runner: DanmakuRunner,
  width: number,
  height: number,
  theme: DanmakuTheme = DEFAULT_DANMAKU_THEME
): void {
  drawBackground(ctx, runner, width, height, theme);
  drawLasers(ctx, runner);
  drawBullets(ctx, runner);
}

export function resetDanmakuSpriteCache(): void {
  spriteCache.clear();
}

export type { DanmakuBullet, DanmakuLaser };
