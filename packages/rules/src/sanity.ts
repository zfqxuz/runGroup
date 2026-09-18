import { parseDice, rollDice, rollDie, type Rng } from "@touhou/formula";

/** 解析 SAN 损失表达式：支持固定值、1d6、2/1d10 中的一侧表达式。 */
export function rollSanityLoss(expression: string, rng: Rng): number {
  const text = expression.trim();
  if (text.length === 0) return 0;
  const fixed = Number(text);
  if (Number.isFinite(fixed)) return Math.max(0, Math.floor(fixed));
  try {
    return Math.max(0, rollDice(parseDice(text), rng).total);
  } catch {
    return 0;
  }
}

export interface SanityCheckResult {
  readonly roll: number;
  readonly success: boolean;
  readonly loss: number;
  readonly sanBefore: number;
  readonly sanAfter: number;
  readonly massive: boolean;
}

export function resolveSanityCheck(
  san: number,
  successLoss: string,
  failureLoss: string,
  rng: Rng
): SanityCheckResult {
  const roll = rollDie(rng, 100);
  const success = roll <= Math.max(0, Math.floor(san));
  const loss = rollSanityLoss(success ? successLoss : failureLoss, rng);
  const sanBefore = Math.max(0, Math.floor(san));
  return {
    roll,
    success,
    loss,
    sanBefore,
    sanAfter: Math.max(0, sanBefore - loss),
    massive: loss >= 5
  };
}

export interface MadnessBoutEntry {
  readonly id: number;
  readonly name: string;
  readonly description: string;
  readonly penaltyDice: boolean;
}

export const MADNESS_BOUT_TABLE: readonly MadnessBoutEntry[] = [
  { id: 1, name: "失忆", description: "对上一次抵达安全场所后发生的事一无所知。", penaltyDice: false },
  { id: 2, name: "心身残疾", description: "心理作用导致的失明、耳聋或肢体失能。", penaltyDice: false },
  { id: 3, name: "暴力倾向", description: "被狂怒攫住，对四周一切施加失控暴力，无论敌友。", penaltyDice: false },
  { id: 4, name: "偏执妄想", description: "严重偏执：所有人都在与他为敌，没人值得信任。", penaltyDice: false },
  { id: 5, name: "人际依赖", description: "把目前场景中的另一人误认为自己的重要之人。", penaltyDice: false },
  { id: 6, name: "昏厥", description: "立即昏倒。", penaltyDice: false },
  { id: 7, name: "惊慌逃窜", description: "无法自制地用一切方法远远逃开。", penaltyDice: false },
  { id: 8, name: "歇斯底里", description: "无法自制地狂笑、哭泣、尖叫。", penaltyDice: false },
  { id: 9, name: "恐惧症", description: "患上新的恐惧症；持续期间所有行动承受一枚惩罚骰。", penaltyDice: true },
  { id: 10, name: "躁狂症", description: "患上新的躁狂症；持续期间所有行动承受一枚惩罚骰。", penaltyDice: true }
];

export const PHOBIAS: readonly string[] = [
  "恐高症", "蜘蛛恐惧症", "恐书症", "镜子恐惧症", "恐血症", "尸体恐惧症",
  "恐牙症", "恐火症", "电话恐惧症", "异域恐惧症"
];

export const MANIAS: readonly string[] = [
  "亲切癖", "疼痛癖", "欣快癖", "窃书癖", "正义狂", "狂笑癖", "射击狂", "偷窃癖", "臆想症", "欺骗狂"
];

export interface MadnessBoutResult {
  readonly roll: number;
  readonly entry: MadnessBoutEntry;
  readonly rounds: number;
  readonly penaltyDice: number;
}

/** 掷 1D10 疯狂发作：发作条目 + 1D10 轮持续时间。 */
export function rollMadnessBout(rng: Rng): MadnessBoutResult {
  const roll = rollDie(rng, 10);
  const entry = MADNESS_BOUT_TABLE.find((item) => item.id === roll) ?? MADNESS_BOUT_TABLE[0]!;
  const rounds = rollDie(rng, 10);
  return { roll, entry, rounds, penaltyDice: entry.penaltyDice ? 1 : 0 };
}
