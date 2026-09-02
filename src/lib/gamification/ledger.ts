import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { SIGNUP_CREDIT_GRANT, SIGNUP_GRANT_REASON } from "./constants";

export async function grantSignupCredits(
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> {
  await tx.creditTransaction.create({
    data: {
      userId,
      amount: SIGNUP_CREDIT_GRANT,
      reason: SIGNUP_GRANT_REASON,
      idempotencyKey: `${SIGNUP_GRANT_REASON}:${userId}:signup`,
    },
  });
}

export async function appendCredit(input: {
  userId: string;
  amount: number;
  reason: string;
  idempotencyKey: string;
  projectId?: string | null;
}): Promise<{ applied: boolean; balance: number }> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.creditTransaction.create({
        data: {
          userId: input.userId,
          amount: input.amount,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          projectId: input.projectId ?? null,
        },
      });
      const user = await tx.user.update({
        where: { id: input.userId },
        data: { creditBalance: { increment: input.amount } },
        select: { creditBalance: true },
      });
      return { applied: true as const, balance: user.creditBalance };
    });
    return result;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: input.userId },
        select: { creditBalance: true },
      });
      return { applied: false, balance: user.creditBalance };
    }
    throw error;
  }
}
