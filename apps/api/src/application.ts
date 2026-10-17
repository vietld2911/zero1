import { readFileSync } from 'node:fs';
import { createApp } from './app.js';
import type { Env } from './platform/env.js';
import type { Logger } from './platform/logger.js';
import { createDispatcher } from './platform/events/dispatcher.js';
import { createScheduler } from './platform/jobs.js';
import { createMailer, type Mailer } from './integrations/mailer.js';
import { createCloudinaryStorage, createLocalStorage, type FileStorage } from './integrations/storage.js';
import { createDatabases } from './infrastructure.js';
import { createCoreContext } from './contexts/core/index.js';
import type { HttpSender } from './contexts/core/modules/integrations/integrations.service.js';
import { createCrmContext } from './contexts/crm/index.js';
import { createLmsContext } from './contexts/lms/index.js';
import { crmSettings } from './contexts/crm/settings.js';
import { lmsSettings } from './contexts/lms/settings.js';

// Đọc lúc chạy (src/ và dist/ cùng cách package.json một cấp) để không kéo file ra ngoài rootDir khi build.
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

export interface ApplicationOverrides {
  mailer?: Mailer;
  /** Gửi HTTP ra ngoài (webhook, Telegram). */
  http?: HttpSender;
  storage?: FileStorage;
  rateLimit?: boolean;
}

/**
 * Dựng toàn bộ ứng dụng nhưng chưa listen / chưa chạy dispatcher.
 * Dùng chung cho main.ts, script xuất OpenAPI và integration test.
 */
export function buildApplication(env: Env, logger: Logger, overrides: ApplicationOverrides = {}) {
  const databases = createDatabases(env);
  const dispatcher = createDispatcher({ sources: databases.outboxSources, logger });
  const mailer = overrides.mailer ?? createMailer(env, logger);
  const storage = overrides.storage ?? (env.CLOUDINARY_URL ? createCloudinaryStorage(env.CLOUDINARY_URL, logger) : createLocalStorage(env.UPLOAD_DIR));

  const core = createCoreContext({
    db: databases.dbs.core,
    env,
    logger,
    mailer,
    settingDefinitions: [...crmSettings, ...lmsSettings],
    rateLimit: overrides.rateLimit,
    http: overrides.http,
  });

  const crm = createCrmContext({ db: databases.dbs.crm, core: core.contract, storage });
  const lms = createLmsContext({ db: databases.dbs.lms, core: core.contract, storage });
  for (const sub of [...core.subscriptions, ...crm.subscriptions, ...lms.subscriptions]) dispatcher.subscribe(sub);

  const app = createApp({
    env,
    logger,
    version: pkg.version,
    healthChecks: databases.healthChecks,
    guards: core.guards,
    uploadDir: storage.driver === 'local' ? env.UPLOAD_DIR : undefined,
    registerRoutes(route) {
      core.registerRoutes(route);
      crm.registerRoutes(route);
      lms.registerRoutes(route);
    },
  });

  const scheduler = createScheduler({ jobs: [...core.jobs, ...crm.jobs, ...lms.jobs], logger });

  return {
    app,
    dispatcher,
    scheduler,
    databases,
    core,
    crm,
    lms,
    async close() {
      scheduler.stop();
      await dispatcher.stop();
      await databases.close();
    },
  };
}
