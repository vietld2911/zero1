import { and, asc, between, eq, inArray } from 'drizzle-orm';
import { newId } from '../../../../platform/ids.js';
import { Errors } from '../../../../platform/http/errors.js';
import { appendEvent } from '../../../../platform/events/outbox.js';
import { runOnce } from '../../../../platform/events/run-once.js';
import type { Principal } from '../../../../platform/auth/principal.js';
import type { EventEnvelope, Subscription } from '../../../../platform/events/types.js';
import { toApiInstant } from '../../../../platform/time.js';
import { CRM_EVENTS, type TrialBookedV1, type TrialCancelledV1 } from '../../../../contracts/events/crm.js';
import { LMS_EVENTS, type TrialCheckedV1, type TrialRejectedV1 } from '../../../../contracts/events/lms.js';
import type { CrmDb, CrmExecutor } from '../../db/types.js';
import type { APPOINTMENT_STATUSES } from '../../db/schema.js';
import { leadAppointments, leads, outboxEvents, processedEvents } from '../../db/schema.js';
import type { NotificationSender } from '../../../core/contract/index.js';
import { leadVisibility, transition, type LeadsService } from './leads.service.js';
import { isOpen, isStopped, stageOf, type LeadStage, type LeadStatus } from './stages.js';

const eventTables = { outboxEvents, processedEvents };
type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];
type AppointmentRow = typeof leadAppointments.$inferSelect;

const TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ['CONFIRMED', 'ATTENDED', 'NO_SHOW', 'CANCELLED'],
  CONFIRMED: ['ATTENDED', 'NO_SHOW', 'CANCELLED'],
  ATTENDED: [],
  NO_SHOW: [],
  CANCELLED: [],
};
const ACTIVE: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED'];

type AppointmentEvent = 'BOOKED' | 'RESCHEDULED' | 'CONFIRMED' | 'ATTENDED' | 'NO_SHOW';

/** Trạng thái lead theo lịch hẹn — không bao giờ tự lùi bước (docs/gd7-lead-stages.md §3). Huỷ lịch → giữ nguyên. */
const LEAD_RULES: Record<AppointmentEvent, { when: (stage: LeadStage) => boolean; to: LeadStatus; note: string }> = {
  BOOKED: { when: (s) => s <= 3, to: 'S3A', note: 'Đặt lịch' },
  RESCHEDULED: { when: (s) => s === 3, to: 'S3A', note: 'Đổi giờ lịch' },
  CONFIRMED: { when: (s) => s === 3, to: 'S3B', note: 'Phụ huynh xác nhận lịch' },
  NO_SHOW: { when: (s) => s === 3, to: 'S3C', note: 'Không đến' },
  ATTENDED: { when: (s) => s <= 3, to: 'S4A', note: 'Đã đến' },
};
const TYPE_LABEL = { EXPERIENCE: 'trải nghiệm', TRIAL: 'học thử' } as const;

async function syncLeadStatus(tx: CrmExecutor, appt: Pick<AppointmentRow, 'leadId' | 'type'>, event: AppointmentEvent, actorId: string | null, extraNote?: string | null) {
  const [lead] = await tx.select().from(leads).where(eq(leads.id, appt.leadId)).for('update');
  const rule = LEAD_RULES[event];
  if (!lead || isStopped(lead.status) || !rule.when(stageOf(lead.status))) return;
  const note = `${rule.note} ${TYPE_LABEL[appt.type]}${extraNote ? ` · ${extraNote}` : ''}`;
  await transition(tx, lead, rule.to, { source: 'APPOINTMENT', note: note.slice(0, 1000), actorId });
}

const EVENT_OF: Partial<Record<AppointmentStatus, AppointmentEvent>> = { CONFIRMED: 'CONFIRMED', ATTENDED: 'ATTENDED', NO_SHOW: 'NO_SHOW' };

export function createAppointmentsService(db: CrmDb, leadsService: LeadsService, notifications: NotificationSender) {
  async function getVisible(actor: Principal, id: string, exec: CrmExecutor = db) {
    const [row] = await exec
      .select({ appt: leadAppointments })
      .from(leadAppointments)
      .innerJoin(leads, eq(leads.id, leadAppointments.leadId))
      .where(and(eq(leadAppointments.id, id), leadVisibility(actor)))
      .for('update');
    if (!row) throw Errors.notFound('lịch hẹn');
    return row.appt;
  }

  async function cancelTrialEvent(tx: CrmExecutor, appt: AppointmentRow, actorId: string) {
    if (appt.type !== 'TRIAL' || !appt.lmsSessionId) return;
    const data: TrialCancelledV1 = { appointmentId: appt.id, lmsSessionId: appt.lmsSessionId };
    await appendEvent(tx, eventTables, { type: CRM_EVENTS.trialCancelled, aggregateId: appt.id, branchId: appt.branchId, actorId, data });
  }

  return {
    async create(actor: Principal, leadId: string, input: { type: 'EXPERIENCE' | 'TRIAL'; scheduledAt: Date; lmsSessionId?: string | null; note?: string | null }) {
      if (input.type === 'TRIAL' && !input.lmsSessionId) throw Errors.validation([{ path: 'body.lmsSessionId', message: 'Học thử cần chọn buổi học' }]);
      const id = newId();
      await db.transaction(async (tx) => {
        const lead = await leadsService.getVisible(actor, leadId, tx, true);
        if (!isOpen(lead.status)) throw Errors.conflict('LEAD_CLOSED', 'Lead đã dừng hoặc đã đăng ký');
        await tx.insert(leadAppointments).values({
          id,
          leadId,
          branchId: lead.branchId,
          type: input.type,
          scheduledAt: input.scheduledAt,
          lmsSessionId: input.type === 'TRIAL' ? input.lmsSessionId! : null,
          note: input.note ?? null,
          createdBy: actor.userId,
        });
        if (input.type === 'TRIAL') {
          const data: TrialBookedV1 = {
            appointmentId: id,
            leadId,
            lmsSessionId: input.lmsSessionId!,
            branchId: lead.branchId,
            guest: { childName: lead.childName, birthYear: lead.childBirthYear, parentName: lead.parentName, parentPhone: lead.parentPhone },
          };
          await appendEvent(tx, eventTables, { type: CRM_EVENTS.trialBooked, aggregateId: id, branchId: lead.branchId, actorId: actor.userId, data });
        }
        await syncLeadStatus(tx, { leadId, type: input.type }, 'BOOKED', actor.userId);
      });
      return id;
    },

    async setStatus(actor: Principal, id: string, status: AppointmentStatus, resultNote?: string | null) {
      await db.transaction(async (tx) => {
        const appt = await getVisible(actor, id, tx);
        if (!TRANSITIONS[appt.status].includes(status)) {
          throw Errors.conflict('INVALID_STATE_TRANSITION', 'Không đổi được trạng thái lịch hẹn', `${appt.status} → ${status}`);
        }
        await tx.update(leadAppointments).set({ status, resultNote: resultNote ?? appt.resultNote }).where(eq(leadAppointments.id, id));
        if (status === 'CANCELLED') await cancelTrialEvent(tx, appt, actor.userId);
        const event = EVENT_OF[status];
        if (event) await syncLeadStatus(tx, appt, event, actor.userId, resultNote);
      });
    },

    /** Đổi giờ lịch trải nghiệm. Học thử gắn với buổi học → huỷ và đặt lại. */
    async reschedule(actor: Principal, id: string, input: { scheduledAt: Date; note?: string | null }) {
      await db.transaction(async (tx) => {
        const appt = await getVisible(actor, id, tx);
        if (appt.type === 'TRIAL') throw Errors.conflict('TRIAL_RESCHEDULE', 'Học thử gắn với buổi học — huỷ rồi đặt buổi khác');
        if (!ACTIVE.includes(appt.status)) throw Errors.conflict('INVALID_STATE_TRANSITION', 'Lịch đã kết thúc');
        await tx
          .update(leadAppointments)
          .set({ scheduledAt: input.scheduledAt, status: 'SCHEDULED', ...(input.note !== undefined ? { note: input.note } : {}) })
          .where(eq(leadAppointments.id, id));
        await syncLeadStatus(tx, appt, 'RESCHEDULED', actor.userId);
      });
    },

    /** Lịch theo khoảng thời gian, kèm thông tin lead (chỉ lead người gọi được thấy). */
    async calendar(actor: Principal, q: { from: Date; to: Date; branchId?: string; type?: 'EXPERIENCE' | 'TRIAL'; statuses?: AppointmentStatus[] }) {
      const rows = await db
        .select({ appt: leadAppointments, lead: leads })
        .from(leadAppointments)
        .innerJoin(leads, eq(leads.id, leadAppointments.leadId))
        .where(
          and(
            between(leadAppointments.scheduledAt, q.from, q.to),
            leadVisibility(actor),
            q.branchId ? eq(leadAppointments.branchId, q.branchId) : undefined,
            q.type ? eq(leadAppointments.type, q.type) : undefined,
            q.statuses?.length ? inArray(leadAppointments.status, q.statuses) : undefined,
          ),
        )
        .orderBy(asc(leadAppointments.scheduledAt))
        .limit(1000);
      const leadDtos = new Map((await leadsService.toDtos(rows.map((r) => r.lead))).map((l) => [l.id, l]));
      return rows.map(({ appt }) => {
        const l = leadDtos.get(appt.leadId)!;
        return {
          id: appt.id,
          type: appt.type,
          status: appt.status,
          scheduledAt: toApiInstant(appt.scheduledAt),
          lmsSessionId: appt.lmsSessionId,
          note: appt.note,
          resultNote: appt.resultNote,
          branchId: appt.branchId,
          lead: { id: l.id, childName: l.childName, parentName: l.parentName, parentPhone: l.parentPhone, ownerName: l.ownerName, status: l.status },
        };
      });
    },

    /** Kết quả học thử từ LMS (giáo viên điểm danh khách) / LMS từ chối nhận khách. */
    subscriptions(): Subscription[] {
      const apply = (name: string, type: string, map: (e: EventEnvelope) => { appointmentId: string; status: AppointmentStatus; note: string | null }) => ({
        name,
        type,
        async handle(event: EventEnvelope) {
          const { appointmentId, status, note } = map(event);
          const owner: { current: { ownerId: string | null; childName: string; leadId: string } | null } = { current: null };
          await runOnce(db, eventTables, event, name, async (tx) => {
            const [appt] = await tx.select().from(leadAppointments).where(eq(leadAppointments.id, appointmentId)).for('update');
            if (!appt || !TRANSITIONS[appt.status].includes(status)) return; // đã xử lý tay / đã huỷ
            await tx.update(leadAppointments).set({ status, resultNote: note ?? appt.resultNote }).where(eq(leadAppointments.id, appointmentId));
            const change = EVENT_OF[status];
            if (change) await syncLeadStatus(tx, appt, change, event.actorId, note);
            const [lead] = await tx.select({ ownerId: leads.ownerId, childName: leads.childName }).from(leads).where(eq(leads.id, appt.leadId));
            if (lead) owner.current = { ...lead, leadId: appt.leadId };
          });
          // Báo sale phụ trách kết quả học thử (sau khi ghi xong).
          const o = owner.current;
          if (o?.ownerId) {
            const title = status === 'ATTENDED' ? 'Khách học thử đã đến' : status === 'NO_SHOW' ? 'Khách học thử không đến' : 'Lịch học thử bị huỷ';
            await notifications.send([
              { userId: o.ownerId, type: `crm.trial.${status.toLowerCase()}`, app: 'crm', title, body: note ? `${o.childName} · ${note}` : o.childName, link: `/leads/${o.leadId}` },
            ]);
          }
        },
      });
      return [
        apply('crm.appointments.onTrialChecked', LMS_EVENTS.trialChecked, (e) => {
          const d = e.data as TrialCheckedV1;
          return { appointmentId: d.appointmentId, status: d.result, note: d.note };
        }),
        apply('crm.appointments.onTrialRejected', LMS_EVENTS.trialRejected, (e) => {
          const d = e.data as TrialRejectedV1;
          return { appointmentId: d.appointmentId, status: 'CANCELLED', note: `LMS không nhận khách học thử: ${d.reason}` };
        }),
      ];
    },
  };
}

export type AppointmentsService = ReturnType<typeof createAppointmentsService>;
