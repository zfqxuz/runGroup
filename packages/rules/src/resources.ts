export interface MagicPointRules {
  readonly overflowToHp: boolean;
  /** 每缺少 1 点 MP 需要扣除的 HP。 */
  readonly hpPerMp: number;
}

export interface MagicPointSpendResult {
  readonly allowed: boolean;
  readonly mpAfter: number;
  readonly hpLoss: number;
  readonly shortfall: number;
  readonly error?: string;
}

/**
 * COC7 魔法点消耗：
 * - MP 足够时正常扣除；
 * - MP 不足且允许透支时，不足部分按 hpPerMp 从 HP 扣除；
 * - 不允许透支时返回 allowed=false。
 */
export function spendMagicPoints(
  currentMp: number,
  currentHp: number,
  cost: number,
  rules: MagicPointRules
): MagicPointSpendResult {
  const mp = Math.max(0, Math.floor(currentMp));
  const hp = Math.max(0, Math.floor(currentHp));
  const amount = Math.max(0, Math.floor(cost));
  const affordableFromMp = Math.min(mp, amount);
  const shortfall = Math.max(0, amount - affordableFromMp);
  const hpLoss = rules.overflowToHp ? shortfall * Math.max(1, Math.floor(rules.hpPerMp)) : 0;

  if (rules.overflowToHp === false && shortfall > 0) {
    return {
      allowed: false,
      mpAfter: mp,
      hpLoss: 0,
      shortfall,
      error: "MP 不足"
    };
  }

  // 允许把 HP 扣到 0；是否死亡/昏迷由调用方的 0 HP 规则处理。
  const allowed = hpLoss <= hp;
  return {
    allowed,
    mpAfter: Math.max(0, mp - affordableFromMp),
    hpLoss: Math.min(hpLoss, hp),
    shortfall,
    ...(allowed ? {} : { error: "MP 与 HP 均不足以支付消耗" })
  };
}
