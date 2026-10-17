import type { Pool } from 'mysql2/promise';
import type { DbEnv } from './platform/env.js';
import { createDb, createMysqlPool, pingPool } from './platform/db/connection.js';
import { createDrizzleOutboxSource } from './platform/events/outbox.js';
import * as coreSchema from './contexts/core/db/schema.js';
import * as crmSchema from './contexts/crm/db/schema.js';
import * as lmsSchema from './contexts/lms/db/schema.js';

/** Ghép nối hạ tầng: 3 pool, 3 handle Drizzle, 3 nguồn outbox (docs/architecture.md §3). */
export function createDatabases(env: DbEnv) {
  const pools = {
    core: createMysqlPool(env, env.DB_NAME_CORE),
    crm: createMysqlPool(env, env.DB_NAME_CRM),
    lms: createMysqlPool(env, env.DB_NAME_LMS),
  } satisfies Record<string, Pool>;

  const dbs = {
    core: createDb(pools.core, coreSchema),
    crm: createDb(pools.crm, crmSchema),
    lms: createDb(pools.lms, lmsSchema),
  };

  return {
    pools,
    dbs,
    outboxSources: [
      createDrizzleOutboxSource('core', dbs.core, coreSchema),
      createDrizzleOutboxSource('crm', dbs.crm, crmSchema),
      createDrizzleOutboxSource('lms', dbs.lms, lmsSchema),
    ],
    healthChecks: {
      'db.core': () => pingPool(pools.core),
      'db.crm': () => pingPool(pools.crm),
      'db.lms': () => pingPool(pools.lms),
    },
    async close() {
      await Promise.all(Object.values(pools).map((p) => p.end()));
    },
  };
}

export type Databases = ReturnType<typeof createDatabases>;
