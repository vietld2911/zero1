import type { Env } from '../../platform/env.js';
import type { Logger } from '../../platform/logger.js';
import type { RouteRegistrar } from '../../platform/http/route.js';
import type { Job } from '../../platform/jobs.js';
import type { Mailer } from '../../integrations/mailer.js';
import type { CoreDb } from './db/types.js';
import type { CoreContract, SettingDefinition } from './contract/index.js';
import { coreSettings } from './settings.js';
import { createAccessService } from './modules/access/access.service.js';
import { registerAccessRoutes } from './modules/access/access.routes.js';
import { createAuthService } from './modules/auth/auth.service.js';
import { registerAuthRoutes } from './modules/auth/auth.routes.js';
import { createGuards, createPrincipalLoader } from './modules/auth/guards.js';
import { createAccessTokens } from './modules/auth/tokens.js';
import { createBranchesService, registerBranchRoutes } from './modules/branches/branches.module.js';
import { createSettingsService, registerSettingsRoutes } from './modules/settings/settings.module.js';
import { createTimekeepingService } from './modules/timekeeping/timekeeping.service.js';
import { registerTimekeepingRoutes } from './modules/timekeeping/timekeeping.routes.js';
import { createUsersService } from './modules/users/users.service.js';
import { registerUserRoutes } from './modules/users/users.routes.js';
import { createNotificationsService, registerNotificationRoutes } from './modules/notifications/notifications.module.js';
import { createApiKeysService, registerApiKeyRoutes } from './modules/api-keys/api-keys.module.js';
import { createParentsService, registerParentAuthRoutes } from './modules/parents/parents.module.js';
import { createIntegrationsService, type HttpSender } from './modules/integrations/integrations.service.js';
import { registerIntegrationRoutes } from './modules/integrations/integrations.routes.js';
import type { Subscription } from '../../platform/events/types.js';

export interface CoreContextDeps {
  db: CoreDb;
  env: Env;
  logger: Logger;
  mailer: Mailer;
  /** Cấu hình do CRM / LMS khai báo. */
  settingDefinitions: SettingDefinition[];
  /** Tắt giới hạn tần suất (test). */
  rateLimit?: boolean;
  /** Gửi HTTP ra ngoài (webhook, Telegram) — test thay bằng bản giả. */
  http?: HttpSender;
}

export function createCoreContext({ db, env, logger, mailer, settingDefinitions, rateLimit = true, http }: CoreContextDeps) {
  const access = createAccessService(db);
  const tokens = createAccessTokens(env.JWT_ACCESS_SECRET);
  const loadPrincipal = createPrincipalLoader(db, access);
  const apiKeys = createApiKeysService(db);
  const parents = createParentsService(db, tokens);
  const guards = createGuards(tokens, loadPrincipal, { apiKeys, parents });
  const integrations = createIntegrationsService({
    db,
    logger,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    allowPrivate: env.WEBHOOK_ALLOW_PRIVATE ?? env.NODE_ENV !== 'production',
    http,
  });

  const auth = createAuthService({ db, tokens, loadPrincipal, mailer, env, logger });
  const users = createUsersService({ db, mailer, logger, revokeSessions: (id) => auth.revokeAll(id) });
  const branches = createBranchesService(db);
  const settings = createSettingsService(db, [...coreSettings, ...settingDefinitions]);
  const timekeeping = createTimekeepingService(db, settings.reader);
  const notifications = createNotificationsService(db, logger);

  return {
    guards,
    services: { access, auth, users, branches, settings, timekeeping, notifications, apiKeys, parents, integrations },
    /** Dành cho CRM / LMS (qua core/contract). */
    contract: {
      settings: settings.reader,
      branches: { getMany: (ids: string[]) => branches.getMany(ids), listActive: () => branches.listActive() },
      users: users.directory,
      notifications: notifications.sender,
      parents: { issueActivation: (i) => parents.issueActivation(i), syncLinks: (p, s) => parents.syncLinks(p, s), statusOf: (p) => parents.statusOf(p) },
    } satisfies CoreContract,
    /** Webhook / Telegram nhận mọi sự kiện. */
    subscriptions: [integrations.subscription()] satisfies Subscription[],
    /** Việc định kỳ của Core. */
    jobs: [{ name: 'core.notifications.purge', everyMinutes: 24 * 60, run: () => notifications.purge() }, integrations.job()] satisfies Job[],
    registerRoutes(route: RouteRegistrar) {
      registerAuthRoutes(route, auth, { env, rateLimit });
      registerUserRoutes(route, users);
      registerBranchRoutes(route, branches);
      registerAccessRoutes(route, access);
      registerSettingsRoutes(route, settings, mailer, env);
      registerTimekeepingRoutes(route, timekeeping);
      registerNotificationRoutes(route, notifications);
      registerApiKeyRoutes(route, apiKeys);
      registerIntegrationRoutes(route, integrations);
      registerParentAuthRoutes(route, parents, { rateLimit });
    },
  };
}

export type CoreContext = ReturnType<typeof createCoreContext>;
