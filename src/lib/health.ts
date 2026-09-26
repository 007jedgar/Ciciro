import { Prisma } from "@prisma/client";

type Reader = { findFirst: () => Promise<unknown> };

/** The `prisma.<model>` delegate name for a Prisma model name. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/**
 * Read one row from every model, selecting every scalar column. A missing table
 * or column (a `prisma/d1-*.sql` upgrade that never ran) fails here the same
 * way it fails real routes, which `SELECT 1` never would.
 *
 * Sequential on purpose: one probe should not fan out across the shared
 * Worker Prisma client.
 *
 * @returns the models whose read failed, empty when the schema is complete.
 */
export async function findSchemaFailures(
  client: object,
  models: readonly string[] = Object.values(Prisma.ModelName)
): Promise<string[]> {
  const failures: string[] = [];
  for (const model of models) {
    const reader = (client as Record<string, Reader | undefined>)[delegateName(model)];
    try {
      if (!reader) throw new Error(`no Prisma delegate for ${model}`);
      await reader.findFirst();
    } catch (error) {
      failures.push(model);
      console.error(`health: reading ${model} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return failures;
}
