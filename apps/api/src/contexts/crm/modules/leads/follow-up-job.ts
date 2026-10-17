import { and, count, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import type { Job } from '../../../../platform/jobs.js';
import { toApiInstant, vnDate } from '../../../../platform/time.js';
import type { NotificationSender } from '../../../core/contract/index.js';
import type { CrmDb } from '../../db/types.js';
import { leads } from '../../db/schema.js';
import { OPEN_STATUSES, type LeadsService } from './leads.service.js';

/** Chỉ nhắc trong giờ làm việc (giờ VN). */
const WORK_HOURS = { from: 7, to: 21 };
const inWorkHours = (now: Date) => {
  const hour = (now.getUTCHours() + 7) % 24;
  return hour >= WORK_HOURS.from && hour < WORK_HOURS.to;
};

/**
 * Nhắc sale gọi lại lead đến hạn. Mỗi lịch gọi lại nhắc đúng một lần (khoá theo thời điểm hẹn);
 * bỏ qua lịch hẹn quá 3 ngày (đã có danh sách "đến hạn gọi lại" trên trang).
 */
export function followUpReminderJob(db: CrmDb, notifications: NotificationSender): Job {
  return {
    name: 'crm.leads.followUpReminders',
    everyMinutes: 15,
    async run(now) {
      if (!inWorkHours(now)) return;
      const due = await db
        .select({ id: leads.id, ownerId: leads.ownerId, childName: leads.childName, parentPhone: leads.parentPhone, at: leads.nextFollowUpAt })
        .from(leads)
        .where(
          and(
            inArray(leads.status, OPEN_STATUSES),
            isNotNull(leads.ownerId),
            lte(leads.nextFollowUpAt, now),
            gte(leads.nextFollowUpAt, new Date(now.getTime() - 3 * 86_400_000)),
          ),
        )
        .limit(500);
      await notifications.send(
        due.map((l) => ({
          userId: l.ownerId!,
          type: 'crm.lead.follow_up_due',
          app: 'crm' as const,
          title: 'Đến hạn gọi lại',
          body: `${l.childName} · ${l.parentPhone}`,
          link: `/leads/${l.id}`,
          dedupeKey: `follow-up:${l.id}:${toApiInstant(l.at!)}`,
        })),
      );
    },
  };
}

/**
 * Mỗi ngày báo SL + CM từng chi nhánh số lead S1B quá hạn khai thác (một lần / chi nhánh / ngày).
 * Không tự đổi trạng thái — SL chia lại hoặc đóng (S1C).
 */
export function staleLeadsJob(db: CrmDb, leadsService: LeadsService, notifications: NotificationSender): Job {
  return {
    name: 'crm.leads.staleS1b',
    everyMinutes: 60,
    async run(now) {
      if (!inWorkHours(now)) return;
      const rows = await db
        .select({ branchId: leads.branchId, n: count() })
        .from(leads)
        .where(await leadsService.staleWhere(now))
        .groupBy(leads.branchId);
      const day = vnDate(now);
      for (const r of rows) {
        await notifications.sendToRoles(
          { branchId: r.branchId, roles: ['SL', 'CM'] },
          {
            type: 'crm.lead.s1b_stale',
            app: 'crm',
            title: `${r.n} lead S1B quá hạn khai thác`,
            body: 'Chia lại cho sale khác hoặc đóng lead (S1C)',
            link: '/leads?stale=true',
            dedupeKey: `s1b-stale:${r.branchId}:${day}`,
          },
        );
      }
    },
  };
}
