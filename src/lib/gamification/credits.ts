import {
  CREDIT_CHAIR,
  CREDIT_PROSE_FULL,
  CREDIT_PROSE_MIXED,
  CREDIT_RETURN,
  DAILY_EARN_CAP,
  HUMAN_RATIO_FULL,
  HUMAN_RATIO_MIXED,
  REASON_CHAIR,
  REASON_PROSE_FULL,
  REASON_PROSE_MIXED,
  REASON_RETURN,
} from "./constants";

export type BonusTier = "full" | "mixed" | "none";

export type DailyEarn = {
  reason: string;
  amount: number;
  idempotencyKey: string;
};

/**
 * Share of the day's new stock that is human-typed. Chat is never in these
 * buckets. Prose ring uses humanTyped vs target; this ratio only gates credits.
 */
export function humanStockRatio(
  humanTyped: number,
  aiInserted: number,
  pasted: number
): number {
  const stock = Math.max(humanTyped + aiInserted + pasted, 1);
  return humanTyped / stock;
}

export function proseBonusTier(
  humanTyped: number,
  aiInserted: number,
  pasted: number
): BonusTier {
  const ratio = humanStockRatio(humanTyped, aiInserted, pasted);
  if (ratio >= HUMAN_RATIO_FULL) return "full";
  if (ratio >= HUMAN_RATIO_MIXED) return "mixed";
  return "none";
}

export function dailyProseCredits(tier: BonusTier, proseClosed: boolean): number {
  if (!proseClosed) return 0;
  if (tier === "full") return CREDIT_PROSE_FULL;
  if (tier === "mixed") return CREDIT_PROSE_MIXED;
  return 0;
}

/**
 * Idempotent daily earn list. Chair stipend does not stack with a prose bonus.
 * Total daily events are capped (signup is separate).
 */
export function dailyEarns(input: {
  userId: string;
  localDate: string;
  returnClosed: boolean;
  proseClosed: boolean;
  chairClosed: boolean;
  humanTyped: number;
  aiInserted: number;
  pasted: number;
}): DailyEarn[] {
  const earns: DailyEarn[] = [];
  let remaining = DAILY_EARN_CAP;
  const key = (reason: string) => `${reason}:${input.userId}:${input.localDate}`;

  const push = (reason: string, amount: number) => {
    if (amount <= 0 || remaining <= 0) return;
    const granted = Math.min(amount, remaining);
    remaining -= granted;
    earns.push({ reason, amount: granted, idempotencyKey: key(reason) });
  };

  if (input.returnClosed) push(REASON_RETURN, CREDIT_RETURN);

  const tier = proseBonusTier(input.humanTyped, input.aiInserted, input.pasted);
  const proseAmount = dailyProseCredits(tier, input.proseClosed);
  if (proseAmount > 0) {
    push(tier === "full" ? REASON_PROSE_FULL : REASON_PROSE_MIXED, proseAmount);
  } else if (input.chairClosed && !input.proseClosed) {
    push(REASON_CHAIR, CREDIT_CHAIR);
  }

  return earns;
}
