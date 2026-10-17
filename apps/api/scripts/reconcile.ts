/**
 * Đối soát số liệu CRM ↔ LMS (hai database, đồng bộ qua sự kiện).
 * Chạy: npm run db:reconcile        — in chênh lệch, thoát mã 1 nếu có.
 *
 * Kiểm tra:
 *  1. Đăng ký đã kích hoạt bên CRM có quyền học bên LMS, cùng số buổi đã mua.
 *  2. Số buổi đã học: CRM (enrollments.sessions_used) = LMS (learner_entitlements.sessions_used).
 *  3. CRM: sessions_used = số dòng session_usages được trừ.
 *  4. Trạng thái học viên CRM (đang học / bảo lưu / nghỉ) = LMS.
 * Sự kiện còn chờ gửi trong outbox có thể là nguyên nhân chênh lệch tạm thời — script báo kèm.
 */
import { and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { loadDbEnv } from '../src/platform/env.js';
import { createDb, createMysqlPool } from '../src/platform/db/connection.js';
import * as crmSchema from '../src/contexts/crm/db/schema.js';
import * as lmsSchema from '../src/contexts/lms/db/schema.js';

const env = loadDbEnv();
const crmPool = createMysqlPool(env, env.DB_NAME_CRM);
const lmsPool = createMysqlPool(env, env.DB_NAME_LMS);
const crm = createDb(crmPool, crmSchema);
const lms = createDb(lmsPool, lmsSchema);

type Issue = { check: string; ref: string; detail: string };
const issues: Issue[] = [];

try {
  const enrollments = await crm
    .select({
      id: crmSchema.enrollments.id,
      code: crmSchema.enrollments.code,
      studentId: crmSchema.enrollments.studentId,
      status: crmSchema.enrollments.status,
      purchased: crmSchema.enrollments.sessionsPurchased,
      used: crmSchema.enrollments.sessionsUsed,
    })
    .from(crmSchema.enrollments)
    .where(and(isNotNull(crmSchema.enrollments.activatedAt), inArray(crmSchema.enrollments.status, ['ACTIVE', 'COMPLETED'])));
  const ids = enrollments.map((e) => e.id);
  const [entitlements, usages] = await Promise.all([
    ids.length ? lms.select().from(lmsSchema.learnerEntitlements).where(inArray(lmsSchema.learnerEntitlements.enrollmentId, ids)) : [],
    ids.length
      ? crm
          .select({ enrollmentId: crmSchema.sessionUsages.enrollmentId, n: sql<number>`SUM(CASE WHEN ${crmSchema.sessionUsages.consumed} THEN 1 ELSE 0 END)`.mapWith(Number) })
          .from(crmSchema.sessionUsages)
          .where(inArray(crmSchema.sessionUsages.enrollmentId, ids))
          .groupBy(crmSchema.sessionUsages.enrollmentId)
      : [],
  ]);

  for (const e of enrollments) {
    const ent = entitlements.find((x) => x.enrollmentId === e.id);
    if (!ent) {
      issues.push({ check: 'Quyền học', ref: e.code, detail: 'Đăng ký đã kích hoạt nhưng LMS chưa có quyền học' });
      continue;
    }
    if (ent.sessionsPurchased !== e.purchased) issues.push({ check: 'Số buổi mua', ref: e.code, detail: `CRM ${e.purchased} ≠ LMS ${ent.sessionsPurchased}` });
    if (ent.sessionsUsed !== e.used) issues.push({ check: 'Số buổi đã học', ref: e.code, detail: `CRM ${e.used} ≠ LMS ${ent.sessionsUsed}` });
    const counted = usages.find((u) => u.enrollmentId === e.id)?.n ?? 0;
    if (counted !== e.used) issues.push({ check: 'Sổ trừ buổi CRM', ref: e.code, detail: `sessions_used ${e.used} ≠ ${counted} dòng session_usages` });
  }

  const students = await crm
    .select({ id: crmSchema.students.id, code: crmSchema.students.code, status: crmSchema.students.status })
    .from(crmSchema.students)
    .where(inArray(crmSchema.students.status, ['ACTIVE', 'PAUSED', 'STOPPED']));
  const learners = students.length ? await lms.select({ id: lmsSchema.learners.id, status: lmsSchema.learners.status }).from(lmsSchema.learners).where(inArray(lmsSchema.learners.id, students.map((s) => s.id))) : [];
  for (const s of students) {
    const l = learners.find((x) => x.id === s.id);
    if (l && l.status !== s.status) issues.push({ check: 'Trạng thái học viên', ref: s.code, detail: `CRM ${s.status} ≠ LMS ${l.status}` });
  }

  const [crmPending] = await crm.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(crmSchema.outboxEvents).where(isNull(crmSchema.outboxEvents.publishedAt));
  const [lmsPending] = await lms.select({ n: sql<number>`COUNT(*)`.mapWith(Number) }).from(lmsSchema.outboxEvents).where(isNull(lmsSchema.outboxEvents.publishedAt));

  console.log(`Đã đối soát ${enrollments.length} đăng ký, ${students.length} học viên.`);
  const pending = (crmPending?.n ?? 0) + (lmsPending?.n ?? 0);
  if (pending) console.log(`⚠ Còn ${pending} sự kiện chưa gửi (CRM ${crmPending?.n ?? 0}, LMS ${lmsPending?.n ?? 0}) — chạy API để gửi rồi đối soát lại.`);
  if (!issues.length) {
    console.log('✔ Số liệu CRM và LMS khớp.');
  } else {
    console.log(`✘ ${issues.length} chênh lệch:`);
    console.table(issues);
    process.exitCode = 1;
  }
} finally {
  await crmPool.end();
  await lmsPool.end();
}

