import type { MySql2Database } from 'drizzle-orm/mysql2';
import type * as schema from './schema.js';

export type CoreDb = MySql2Database<typeof schema>;
export type CoreTx = Parameters<Parameters<CoreDb['transaction']>[0]>[0];
/** Dùng được cả với db lẫn transaction. */
export type CoreExecutor = CoreDb | CoreTx;
