import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Badge, Button, cn, Dialog, Field, Input, Select, Textarea, toast } from '@zero1/ui';
import { formatDateTime, fromVnInput, toastError, useApi } from '@zero1/web-core';
import { CALL_OUTCOMES, crmKeys, isStopped, LEAD_STATUS, LEAD_STATUS_SOURCES, leadStatusText, MANUAL_STATUSES, stageOf, type LeadStatus } from '../labels';

type Lead = Schemas['LeadDetail'];
type Outcome = keyof typeof CALL_OUTCOMES;

/** "S2A · Quan tâm"; `compact`: màn hẹp chỉ hiện mã (nhãn đầy đủ ở tooltip). */
export function LeadStatusBadge({ status, compact, className }: { status: LeadStatus; compact?: boolean; className?: string }) {
  return (
    <Badge tone={LEAD_STATUS[status].tone} className={className} title={leadStatusText(status)}>
      {compact ? (
        <>
          {status}
          <span className="hidden sm:inline"> · {LEAD_STATUS[status].label}</span>
        </>
      ) : (
        leadStatusText(status)
      )}
    </Badge>
  );
}

/** Lead đã đăng ký mà đăng ký chưa bị huỷ → trạng thái đi theo đăng ký, không chọn lại được. */
export const statusLocked = (lead: Lead) => stageOf(lead.status) === 5 && !lead.enrollmentCancelled;
const hasPendingAppointment = (lead: Lead) => lead.appointments.some((a) => a.status === 'SCHEDULED' || a.status === 'CONFIRMED');

/** Trạng thái được chọn — cùng quy tắc với API (docs/gd7-lead-stages.md §3). */
function allowedStatuses(lead: Lead, reopen: boolean): LeadStatus[] {
  if (!reopen && statusLocked(lead)) return [lead.status];
  const pending = hasPendingAppointment(lead);
  const manual = MANUAL_STATUSES.filter(
    (s) => (!reopen || !isStopped(s)) && (s !== 'S4B' && s !== 'S4C' ? true : !!lead.reachedS4At) && !(pending && stageOf(s) < 3) && s !== lead.status,
  );
  return reopen ? manual : [lead.status, ...manual];
}

/** Gợi ý trạng thái theo kết quả gọi (API không ép): chỉ ở bước 1–2, bước 3–5 giữ nguyên. */
function suggest(lead: Lead, outcome: Outcome, allowed: LeadStatus[]): LeadStatus {
  if (stageOf(lead.status) > 2) return lead.status;
  const s: LeadStatus = outcome === 'TALKED' ? 'S2A' : outcome === 'WRONG_NUMBER' ? 'S1C' : 'S1B';
  return allowed.includes(s) ? s : lead.status;
}

/**
 * Ghi cuộc gọi (`call`), đổi trạng thái không qua cuộc gọi (`status`) hoặc mở lại lead đã dừng (`reopen`).
 * Ghi chú luôn bắt buộc; trạng thái dừng cần lý do; S4B cần ngày hẹn đóng phí.
 */
export function LeadStatusDialog({ lead, mode, onClose }: { lead: Lead; mode: 'call' | 'status' | 'reopen'; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const allowed = allowedStatuses(lead, mode === 'reopen');
  const [outcome, setOutcome] = useState<Outcome>('TALKED');
  const [status, setStatus] = useState<LeadStatus>(() => (mode === 'call' ? suggest(lead, 'TALKED', allowed) : mode === 'reopen' ? allowed[0]! : lead.status));
  const [note, setNote] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [at, setAt] = useState('');

  const changed = status !== lead.status;
  const needReason = changed && isStopped(status);
  const needDate = changed && status === 'S4B';
  const valid = note.trim().length >= 3 && (!needReason || lostReason.trim().length > 0) && (!needDate || !!at) && (mode === 'call' || changed);

  const save = useMutation({
    mutationFn: async () => {
      const path = { params: { path: { id: lead.id } } };
      const body = { status, note: note.trim(), nextFollowUpAt: at ? fromVnInput(at) : undefined };
      const reason = needReason ? lostReason.trim() : undefined;
      if (mode === 'call') return unwrap(api.POST('/api/v1/crm/leads/{id}/calls', { ...path, body: { ...body, outcome, lostReason: reason } }));
      if (mode === 'reopen') return unwrap(api.POST('/api/v1/crm/leads/{id}/reopen', { ...path, body }));
      return unwrap(api.POST('/api/v1/crm/leads/{id}/status', { ...path, body: { ...body, lostReason: reason } }));
    },
    onSuccess: () => {
      toast.success(mode === 'call' ? 'Đã ghi cuộc gọi' : mode === 'reopen' ? 'Đã mở lại khách hàng' : 'Đã đổi trạng thái');
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      onClose();
    },
    onError: toastError,
  });

  const title = mode === 'call' ? 'Ghi cuộc gọi' : mode === 'reopen' ? 'Mở lại khách hàng' : 'Đổi trạng thái';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={`${lead.childName} · hiện ở ${leadStatusText(lead.status)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={!valid || save.isPending}>
            {mode === 'call' ? 'Ghi cuộc gọi' : 'Lưu'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {mode === 'call' && (
          <Field label="Kết quả cuộc gọi" required>
            <Select
              value={outcome}
              onChange={(e) => {
                const o = e.target.value as Outcome;
                setOutcome(o);
                setStatus(suggest(lead, o, allowed));
              }}
            >
              {Object.entries(CALL_OUTCOMES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">
            {mode === 'call' ? 'Trạng thái sau cuộc gọi' : 'Trạng thái mới'}
            <span className="ml-0.5 text-danger">*</span>
          </legend>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {allowed.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={status === s}
                onClick={() => setStatus(s)}
                className={cn(
                  'rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors',
                  status === s ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface hover:bg-muted',
                )}
              >
                <span className="font-semibold tabular-nums">{s}</span> ·{' '}
                {s === lead.status && mode !== 'reopen' ? `Giữ nguyên (${LEAD_STATUS[s].label})` : LEAD_STATUS[s].label}
              </button>
            ))}
          </div>
          {statusLocked(lead) && mode !== 'reopen' && <p className="text-xs text-muted-foreground">Lead đã đăng ký — trạng thái đi theo đăng ký.</p>}
          {!statusLocked(lead) && hasPendingAppointment(lead) && (
            <p className="text-xs text-muted-foreground">Đang có lịch hẹn chờ: huỷ lịch trước nếu muốn chọn trạng thái dưới S3.</p>
          )}
          {!statusLocked(lead) && <p className="text-xs text-muted-foreground">S3, S4A, S5 tự cập nhật khi đặt lịch, điểm danh, đăng ký học.</p>}
        </fieldset>

        {needReason && (
          <Field label="Lý do dừng" required hint="Dùng để thống kê nguyên nhân mất khách">
            <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} maxLength={500} placeholder="Chọn trung tâm khác, học phí cao…" />
          </Field>
        )}

        {(mode === 'call' || needDate || status === 'S4B') && (
          <Field label={status === 'S4B' ? 'Ngày hẹn đóng phí' : 'Hẹn gọi lại'} required={needDate}>
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
          </Field>
        )}

        <Field label={mode === 'call' ? 'Nội dung cuộc gọi' : 'Ghi chú'} required hint="Ít nhất 3 ký tự">
          <Textarea
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            placeholder={mode === 'call' ? 'Phụ huynh quan tâm gì, hẹn gì…' : 'Vì sao đổi trạng thái…'}
          />
        </Field>
      </div>
    </Dialog>
  );
}

/** Dòng thời gian lịch sử trạng thái (mới nhất trước). */
export function StatusTimeline({ logs }: { logs: Lead['statusLogs'] }) {
  if (!logs.length) return <p className="text-sm text-muted-foreground">Chưa có lịch sử trạng thái.</p>;
  return (
    <ol className="relative flex flex-col gap-4 border-l border-border pl-4">
      {logs.map((l) => (
        <li key={l.id} className="text-sm">
          <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-navy-300" aria-hidden />
          <div className="flex flex-wrap items-center gap-1.5">
            {l.fromStatus && (
              <>
                <LeadStatusBadge status={l.fromStatus} />
                <span aria-hidden>→</span>
              </>
            )}
            <LeadStatusBadge status={l.toStatus} />
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {LEAD_STATUS_SOURCES[l.source]} · {l.actorName ?? 'Hệ thống'} · {formatDateTime(l.createdAt)}
          </div>
          {l.note && <p className="mt-0.5 whitespace-pre-line">{l.note}</p>}
        </li>
      ))}
    </ol>
  );
}

/** Cảnh báo theo trạng thái: đăng ký đã huỷ, S1B quá hạn, lý do dừng. */
export function LeadStatusAlerts({ lead, onPick }: { lead: Lead; onPick?: () => void }) {
  return (
    <>
      {lead.enrollmentCancelled && (
        <Alert
          tone="warning"
          className="mb-4"
          title="Đăng ký đã huỷ — chọn lại trạng thái"
          action={
            onPick && (
              <Button size="sm" variant="outline" onClick={onPick}>
                Chọn trạng thái
              </Button>
            )
          }
        >
          Lead vẫn ở S5A cho đến khi bạn chọn trạng thái mới (hoặc học viên đăng ký lại).
        </Alert>
      )}
      {lead.stale && (
        <Alert tone="warning" className="mb-4" title="S1B quá hạn khai thác">
          Gọi lần đầu từ {formatDateTime(lead.firstCalledAt)} mà chưa liên lạc được. SL chia lại cho sale khác hoặc đóng lead (S1C).
        </Alert>
      )}
      {isStopped(lead.status) && lead.lostReason && (
        <Alert tone="info" className="mb-4" title="Lý do dừng">
          {lead.lostReason}
        </Alert>
      )}
    </>
  );
}
