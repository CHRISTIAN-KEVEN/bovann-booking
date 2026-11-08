import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import type { Kysely } from 'kysely';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { createDb } from './connection';
import type { Database } from './schema';

export const DB = Symbol('DB');

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ENV],
      useFactory: (env: Env): Kysely<Database> =>
        createDb({ url: env.DATABASE_URL, poolSize: env.DATABASE_POOL_SIZE }),
    },
  ],
  exports: [DB],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /** Closes the connection pool so the process exits cleanly on SIGTERM (Docker stop). */
  async onApplicationShutdown(): Promise<void> {
    await this.db.destroy();
  }
}
