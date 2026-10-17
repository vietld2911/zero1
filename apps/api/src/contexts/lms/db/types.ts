import type { MySql2Database } from 'drizzle-orm/mysql2';
import type * as schema from './schema.js';

export type LmsDb = MySql2Database<typeof schema>;
export type LmsTx = Parameters<Parameters<LmsDb['transaction']>[0]>[0];
export type LmsExecutor = LmsDb | LmsTx;
