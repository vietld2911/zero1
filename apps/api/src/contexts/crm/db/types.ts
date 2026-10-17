import type { MySql2Database } from 'drizzle-orm/mysql2';
import type * as schema from './schema.js';

export type CrmDb = MySql2Database<typeof schema>;
export type CrmTx = Parameters<Parameters<CrmDb['transaction']>[0]>[0];
export type CrmExecutor = CrmDb | CrmTx;
