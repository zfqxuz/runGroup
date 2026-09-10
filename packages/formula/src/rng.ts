export interface Rng {
  nextUint32(): number;
}

interface CryptoLike {
  getRandomValues<T extends ArrayBufferView>(array: T): T;
}

/** xmur3：把任意字符串散列成 uint32 种子序列。 */
function xmur3(str: string): () => number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

/** mulberry32：小而可复现的 PRNG。同种子必定同序列。 */
export function createSeededRng(seed: string | number): Rng {
  const nextSeed = xmur3(String(seed));
  let a = nextSeed();
  return {
    nextUint32(): number {
      a = (a + 0x6d2b79f5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return (t ^ (t >>> 14)) >>> 0;
    }
  };
}

/** 系统熵源。仅用于公开掷骰与随机初始种子。 */
export const cryptoRng: Rng = {
  nextUint32(): number {
    const buf = new Uint32Array(1);
    const webcrypto = (globalThis as unknown as { crypto: CryptoLike }).crypto;
    webcrypto.getRandomValues(buf);
    return buf[0] as number;
  }
};

/** 生成一个可记录的种子字符串，用于战斗回放。 */
export function randomSeed(): string {
  return cryptoRng.nextUint32().toString(36) + cryptoRng.nextUint32().toString(36);
}

/**
 * 单颗骰子。用拒绝采样消除取模偏置 —— 直接 x % sides 会让小面概率偏高。
 */
export function rollDie(rng: Rng, sides: number): number {
  if (!Number.isInteger(sides) || sides < 2) {
    throw new RangeError(`sides must be an integer >= 2, got ${sides}`);
  }
  const range = 4294967296;
  const limit = Math.floor(range / sides) * sides;
  let x = rng.nextUint32();
  while (x >= limit) {
    x = rng.nextUint32();
  }
  return (x % sides) + 1;
}
