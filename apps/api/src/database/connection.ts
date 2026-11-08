import { Kysely, MysqlDialect } from 'kysely';
import { createPool, type PoolOptions } from 'mysql2';
import type { Database } from './schema';

export interface DbOptions {
  url: string;
  poolSize?: number;
}

/**
 * Creates the Kysely instance used by the whole API.
 *
 * Conventions enforced here so no query has to think about them:
 * - Every session runs in UTC: `CURRENT_TIMESTAMP` defaults and JS `Date`
 *   conversions agree, whatever the server's own time zone is.
 * - `TINYINT(1)` columns (MySQL BOOLEAN) come back as real booleans.
 * - BIGINT ids come back as numbers (safe: ids stay far below 2^53).
 */
export function createDb({ url, poolSize = 10 }: DbOptions): Kysely<Database> {
  const options: PoolOptions = {
    uri: url,
    connectionLimit: poolSize,
    timezone: 'Z',
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    typeCast(field, next) {
      if (field.type === 'TINY' && field.length === 1) {
        const value = field.string();
        return value === null ? null : value === '1';
      }
      return next();
    },
  };

  const pool = createPool(options);
  pool.on('connection', (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });

  return new Kysely<Database>({ dialect: new MysqlDialect({ pool }) });
}

/** MySQL error number for a UNIQUE / PRIMARY KEY violation. */
export const ER_DUP_ENTRY = 1062;

export function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errno' in error &&
    (error as { errno: unknown }).errno === ER_DUP_ENTRY
  );
}
