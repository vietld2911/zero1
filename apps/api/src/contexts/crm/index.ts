import type { RouteRegistrar } from '../../platform/http/route.js';
import type { Subscription } from '../../platform/events/types.js';
import type { FileStorage } from '../../integrations/storage.js';
import type { CoreContract } from '../core/contract/index.js';
import type { CrmDb } from './db/types.js';
import { createLevelCatalog, levelProjection } from './modules/catalog/level-projection.js';
import { registerCatalogRoutes } from './modules/catalog/catalog.routes.js';
import { createPackagesService } from './modules/packages/packages.service.js';
import { registerPackageRoutes } from './modules/packages/packages.routes.js';
import { createPromotionsService } from './modules/promotions/promotions.service.js';
import { registerPromotionRoutes } from './modules/promotions/promotions.routes.js';
import { createPricingService } from './modules/pricing/pricing.service.js';
import { registerPricingRoutes } from './modules/pricing/pricing.routes.js';
import { createLeadsService } from './modules/leads/leads.service.js';
import { createAppointmentsService } from './modules/leads/appointments.service.js';
import { registerLeadRoutes } from './modules/leads/leads.routes.js';
import { createStudentsService } from './modules/students/students.service.js';
import { registerStudentRoutes } from './modules/students/students.routes.js';
import { createEnrollmentsService } from './modules/enrollments/enrollments.service.js';
import { createPaymentsService } from './modules/enrollments/payments.service.js';
import { createApprovalsService } from './modules/enrollments/approvals.service.js';
import { registerEnrollmentRoutes } from './modules/enrollments/enrollments.routes.js';
import { createReportsService } from './modules/reports/reports.service.js';
import { registerReportRoutes } from './modules/reports/reports.routes.js';
import { followUpReminderJob, staleLeadsJob } from './modules/leads/follow-up-job.js';
import { createParentPortal, registerParentPortalRoutes } from './modules/parents/parent-portal.js';
import type { Job } from '../../platform/jobs.js';

export function createCrmContext({ db, core, storage }: { db: CrmDb; core: CoreContract; storage: FileStorage }) {
  const levelCatalog = createLevelCatalog(db);
  const packages = createPackagesService(db, core.branches);
  const promotions = createPromotionsService(db, core.branches);
  const pricing = createPricingService({ packages, promotions, settings: core.settings });
  const leads = createLeadsService(db, core);
  const appointments = createAppointmentsService(db, leads, core.notifications);
  const students = createStudentsService(db, core, storage);
  const enrollments = createEnrollmentsService({ db, core, pricing, promotions, leads, students });
  const payments = createPaymentsService(db, core, enrollments);
  const approvals = createApprovalsService(db, core, enrollments);
  const reports = createReportsService(db, core);
  const parentPortal = createParentPortal(db, core, students);

  return {
    services: { levelCatalog, packages, promotions, pricing, leads, appointments, students, enrollments, payments, approvals, reports },
    /** Handler sự kiện CRM đăng ký với dispatcher. */
    subscriptions: [
      levelProjection(db),
      ...appointments.subscriptions(),
      ...students.subscriptions(),
      ...enrollments.subscriptions(),
    ] satisfies Subscription[],
    /** Việc định kỳ của CRM. */
    jobs: [followUpReminderJob(db, core.notifications), staleLeadsJob(db, leads, core.notifications)] satisfies Job[],
    registerRoutes(route: RouteRegistrar) {
      registerCatalogRoutes(route, levelCatalog);
      registerPackageRoutes(route, packages);
      registerPromotionRoutes(route, promotions);
      registerPricingRoutes(route, pricing);
      registerLeadRoutes(route, leads, appointments);
      registerStudentRoutes(route, students);
      registerEnrollmentRoutes(route, { enrollments, payments, approvals, students, branches: core.branches });
      registerReportRoutes(route, reports);
      registerParentPortalRoutes(route, parentPortal);
    },
  };
}

export type CrmContext = ReturnType<typeof createCrmContext>;
