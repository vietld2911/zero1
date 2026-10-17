import type { RouteRegistrar } from '../../platform/http/route.js';
import type { Subscription } from '../../platform/events/types.js';
import type { FileStorage } from '../../integrations/storage.js';
import type { CoreContract } from '../core/contract/index.js';
import type { LmsDb } from './db/types.js';
import { createCurriculumService } from './modules/curriculum/curriculum.service.js';
import { registerCurriculumRoutes } from './modules/curriculum/curriculum.routes.js';
import { createLearnersService } from './modules/learners/learners.service.js';
import { createClassesService } from './modules/classes/classes.service.js';
import { registerClassRoutes } from './modules/classes/classes.routes.js';
import { createSessionsService } from './modules/sessions/sessions.service.js';
import { registerSessionRoutes } from './modules/sessions/sessions.routes.js';
import { createAssignmentsService } from './modules/assignments/assignments.service.js';
import { createLmsReportsService, overdueAttendanceJob } from './modules/reports/reports.service.js';
import { registerLmsReportRoutes } from './modules/reports/reports.routes.js';
import type { Job } from '../../platform/jobs.js';
import { createLmsParentPortal, registerLmsParentRoutes } from './modules/parents/parent-portal.js';

export function createLmsContext({ db, core, storage }: { db: LmsDb; core: CoreContract; storage: FileStorage }) {
  const curriculum = createCurriculumService(db);
  const learners = createLearnersService(db, core.notifications);
  const classes = createClassesService(db, core);
  const sessions = createSessionsService(db, core);
  const assignments = createAssignmentsService(db, core, storage);
  const reports = createLmsReportsService(db, core);
  const parentPortal = createLmsParentPortal(db, core);

  return {
    services: { curriculum, learners, classes, sessions, assignments, reports },
    /** Handler sự kiện CRM mà LMS nghe. */
    subscriptions: [...learners.subscriptions, ...sessions.subscriptions()] satisfies Subscription[],
    /** Việc định kỳ của LMS. */
    jobs: [overdueAttendanceJob(db, core)] satisfies Job[],
    registerRoutes(route: RouteRegistrar) {
      registerCurriculumRoutes(route, curriculum);
      registerClassRoutes(route, classes, learners);
      registerSessionRoutes(route, sessions, assignments);
      registerLmsReportRoutes(route, reports);
      registerLmsParentRoutes(route, parentPortal);
    },
  };
}

export type LmsContext = ReturnType<typeof createLmsContext>;
