import { and, inArray, or, eq, sql, type SQL } from 'drizzle-orm';
import type { Principal } from '../../platform/auth/principal.js';
import { scopeWhere } from '../../platform/auth/scope-sql.js';
import { classes, classLearners, learners, sessions } from './db/schema.js';

const NOTHING = sql`1 = 0`;

/** Lớp người gọi thấy: theo chi nhánh, hoặc lớp mình là GV / TA (TEACHING). */
export function classVisibility(actor: Principal): SQL | undefined {
  return scopeWhere(actor.scope, { branch: classes.branchId, teachers: [classes.teacherId, classes.taId] });
}

/** Buổi học người gọi thấy (cần JOIN classes): GV / TA của lớp hoặc của chính buổi đó (dạy thay). */
export function sessionVisibility(actor: Principal): SQL | undefined {
  return scopeWhere(actor.scope, { branch: sessions.branchId, teachers: [sessions.teacherId, sessions.taId, classes.teacherId, classes.taId] });
}

/** Học viên người gọi thấy: theo chi nhánh, hoặc học viên trong lớp mình dạy. */
export function learnerVisibility(actor: Principal): SQL | undefined {
  const s = actor.scope;
  switch (s.kind) {
    case 'ALL':
      return undefined;
    case 'BRANCHES':
      return s.branchIds.length ? inArray(learners.branchId, s.branchIds) : NOTHING;
    case 'TEACHING':
      return inArray(
        learners.id,
        sql`(SELECT ${classLearners.learnerId} FROM ${classLearners} INNER JOIN ${classes} ON ${classes.id} = ${classLearners.classId}
             WHERE ${and(or(eq(classes.teacherId, s.userId), eq(classes.taId, s.userId)), inArray(classLearners.status, ['ACTIVE', 'PAUSED']))})`,
      );
    default:
      return NOTHING;
  }
}
