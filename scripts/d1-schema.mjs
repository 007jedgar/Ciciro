import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Compare the schema Prisma expects with the one a D1 database actually has.
 *
 * Both sides arrive as SQL (Prisma's `migrate diff --script` for the expected
 * side, the live `sqlite_master` rows for D1), get loaded into throwaway
 * in-memory SQLite databases, and are compared through PRAGMA introspection.
 * That way SQLite itself parses the DDL and nothing here has to.
 */

// Internal tables that D1, SQLite or Prisma manage on their own.
const IGNORED_TABLE = /^(sqlite_|_cf_|_prisma_|d1_)/;

/** @param {string} sql */
function introspect(sql) {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(sql);
    /** @type {Map<string, { columns: Map<string, { notnull: boolean, hasDefault: boolean }>, uniques: Set<string>, indexes: Set<string> }>} */
    const tables = new Map();
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String(row.name))
      .filter((name) => !IGNORED_TABLE.test(name));
    for (const name of names) {
      const columns = new Map();
      for (const col of db.prepare(`PRAGMA table_info("${name}")`).all()) {
        columns.set(String(col.name), {
          notnull: Boolean(col.notnull),
          hasDefault: col.dflt_value !== null || Boolean(col.pk),
        });
      }
      // Indexes are compared by their column list, not their name, so a unique
      // constraint created under a different name still counts.
      const uniques = new Set();
      const indexes = new Set();
      for (const idx of db.prepare(`PRAGMA index_list("${name}")`).all()) {
        const cols = db
          .prepare(`PRAGMA index_info("${String(idx.name)}")`)
          .all()
          .map((c) => String(c.name))
          .join(",");
        if (idx.unique) uniques.add(cols);
        else indexes.add(cols);
      }
      tables.set(name, { columns, uniques, indexes });
    }
    return tables;
  } finally {
    db.close();
  }
}

/**
 * Turn live `sqlite_master` rows into a script that recreates the schema.
 * Tables go first so their indexes have something to attach to.
 * @param {Array<{ type: string, name: string, sql: string | null }>} rows
 */
export function liveSchemaSql(rows) {
  const usable = rows.filter(
    (row) => row.sql && (row.type === "table" || row.type === "index") && !IGNORED_TABLE.test(row.name)
  );
  const order = (row) => (row.type === "table" ? 0 : 1);
  return usable
    .sort((a, b) => order(a) - order(b))
    .map((row) => `${row.sql};`)
    .join("\n");
}

/**
 * @param {string} expectedSql Prisma's schema as SQL.
 * @param {string} liveSql The live database's schema as SQL.
 * @returns {{ errors: string[], warnings: string[], missing: string[] }}
 *   `errors` break queries, `warnings` only cost performance, and `missing`
 *   lists the table and column names to look for in the upgrade scripts.
 */
export function diffSchemas(expectedSql, liveSql) {
  const expected = introspect(expectedSql);
  const live = introspect(liveSql);
  const errors = [];
  const warnings = [];
  const missing = [];

  for (const [table, want] of expected) {
    const have = live.get(table);
    if (!have) {
      errors.push(`missing table ${table}`);
      missing.push(table);
      continue;
    }
    for (const [column, info] of want.columns) {
      const live = have.columns.get(column);
      if (!live) {
        errors.push(`missing column ${table}.${column}`);
        missing.push(`${table}.${column}`);
      } else if (live.notnull && !info.notnull) {
        // Prisma writes NULL there and D1 refuses it. SQLite can only drop
        // NOT NULL by rebuilding the table, and on D1 (foreign keys always on)
        // dropping a parent table cascade-deletes its children.
        errors.push(`${table}.${column} is NOT NULL in D1 but optional in Prisma`);
      }
    }
    // A required column Prisma no longer knows about makes every insert fail.
    for (const [column, info] of have.columns) {
      if (!want.columns.has(column) && info.notnull && !info.hasDefault) {
        errors.push(`${table}.${column} is NOT NULL with no default, but Prisma never writes it`);
      }
    }
    // Upserts and the op log's seq claim depend on unique indexes.
    for (const cols of want.uniques) {
      if (!have.uniques.has(cols)) errors.push(`missing unique index on ${table}(${cols})`);
    }
    for (const cols of want.indexes) {
      if (!have.indexes.has(cols) && !have.uniques.has(cols)) {
        warnings.push(`missing index on ${table}(${cols})`);
      }
    }
  }
  return { errors, warnings, missing };
}

/**
 * Name the `prisma/d1-*.sql` upgrade scripts that mention a missing table or
 * column, so the failure says what to run.
 * @param {string} prismaDir
 * @param {string[]} missing Entries like `Project` or `Project.kind`.
 */
export function upgradeScriptsFor(prismaDir, missing) {
  const files = readdirSync(prismaDir)
    .filter((file) => /^d1-.*\.sql$/.test(file))
    .sort();
  const hits = new Set();
  for (const item of missing) {
    const [table, column] = item.split(".");
    for (const file of files) {
      const sql = readFileSync(join(prismaDir, file), "utf8");
      // `CREATE TABLE IF NOT EXISTS` never adds a column to an existing table,
      // so only an ALTER fixes a missing column.
      const found = column
        ? new RegExp(`ALTER TABLE\\s+"${table}"\\s+ADD COLUMN\\s+"${column}"`, "i").test(sql)
        : new RegExp(`CREATE TABLE[^(]*"${table}"\\s*\\(`, "i").test(sql);
      if (found) hits.add(`prisma/${file}`);
    }
  }
  return [...hits];
}
