import { createSeededRng, type Rng } from "@touhou/formula";

/**
 * 从战斗种子 + 事件序号派生随机源。
 *
 * 这是「可回放」的关键：只要 seq 序列一致，重放时每一步的骰子都一模一样，
 * 不需要把每次掷骰结果单独存起来。
 */
export function rngFor(seed: string, seq: number, salt = ""): Rng {
  return createSeededRng(salt.length > 0 ? `${seed}:${seq}:${salt}` : `${seed}:${seq}`);
}
