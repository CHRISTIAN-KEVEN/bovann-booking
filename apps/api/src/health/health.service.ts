import { Inject, Injectable } from '@nestjs/common';
import { sql, type Kysely } from 'kysely';
import { DB } from '../database/database.module';
import type { Database } from '../database/schema';

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: 'up' | 'down' };
  uptimeSeconds: number;
}

@Injectable()
export class HealthService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /** Liveness: the process is running. Never touches dependencies. */
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: the API can serve requests (database reachable). */
  async ready(): Promise<HealthReport> {
    let database: 'up' | 'down';
    try {
      await sql`SELECT 1`.execute(this.db);
      database = 'up';
    } catch {
      database = 'down';
    }
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      checks: { database },
      uptimeSeconds: Math.round(process.uptime()),
    };
  }
}
