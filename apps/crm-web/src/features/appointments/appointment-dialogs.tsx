import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2, MoreHorizontal, UserX, XCircle } from 'lucide-react';
import { unwrap } from '@zero1/api-client';
import { Alert, Button, Dialog, DropdownMenu, Field, Input, Segmented, Spinner, Textarea, toast, type MenuAction } from '@zero1/ui';
import { addDays, formatDateTime, formatTime, formatWorkDate, fromVnInput, toastError, todayVN, useApi, vnDay } from '@zero1/web-core';
import { crmKeys } from '../labels';

type ApptStatus = 'SCHEDULED' | 'CONFIRMED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED';

/** Menu đổi trạng thái lịch hẹn. Học thử: kết quả đến / không đến do giáo viên điểm danh bên LMS. */
export function AppointmentActions({ appt }: { appt: { id: string; type: 'EXPERIENCE' | 'TRIAL'; status: ApptStatus } }) {
  const api = useApi();
  const qc = useQueryClient();
  const [result, setResult] = useState<'ATTENDED' | 'NO_SHOW' | 'CANCELLED' | null>(null);
  const [note, setNote] = useState('');
  const change = useMutation({
    mutationFn: async (status: 'CONFIRMED' | 'ATTENDED' | 'NO_SHOW' | 'CANCELLED') =>
      unwrap(api.POST('/api/v1/crm/appointments/{id}/status', { params: { path: { id: appt.id } }, body: { status, resultNote: note.trim() || null } })),
    onSuccess: () => {
      toast.success('Đã cập nhật lịch hẹn');
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      void qc.invalidateQueries({ queryKey: crmKeys.appointments });
      setResult(null);
      setNote('');
    },
    onError: toastError,
  });
  if (appt.status !== 'SCHEDULED' && appt.status !== 'CONFIRMED') return null;

  const actions: MenuAction[] = [
    ...(appt.status === 'SCHEDULED' ? [{ label: 'Xác nhận', icon: CalendarCheck, onSelect: () => change.mutate('CONFIRMED') }] : []),
    ...(appt.type === 'EXPERIENCE'
      ? [
          { label: 'Đã đến', icon: CheckCircle2, onSelect: () => setResult('ATTENDED') },
          { label: 'Không đến', icon: UserX, onSelect: () => setResult('NO_SHOW') },
        ]
      : []),
    { label: 'Huỷ lịch', icon: XCircle, tone: 'danger', separatorBefore: true, onSelect: () => setResult('CANCELLED') },
  ];
  const titles = { ATTENDED: 'Khách đã đến', NO_SHOW: 'Khách không đến', CANCELLED: 'Huỷ lịch hẹn' };

  return (
    <>
      <DropdownMenu
        trigger={
          <Button variant="ghost" size="icon" aria-label="Thao tác lịch hẹn" onClick={(e) => e.stopPropagation()}>
            <MoreHorizontal />
          </Button>
        }
        actions={actions}
      />
      {result && (
        <Dialog
          open
          onOpenChange={(o) => !o && setResult(null)}
          title={titles[result]}
          size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => setResult(null)}>
                Đóng
              </Button>
              <Button variant={result === 'CANCELLED' ? 'danger' : 'primary'} onClick={() => change.mutate(result)} disabled={change.isPending}>
                Lưu
              </Button>
            </>
          }
        >
          <Field label={result === 'ATTENDED' ? 'Kết quả buổi trải nghiệm' : 'Ghi chú'}>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={result === 'ATTENDED' ? 'Bé thích lớp nào, phụ huynh quan tâm gì…' : ''} />
          </Field>
        </Dialog>
      )}
    </>
  );
}

/** Đặt lịch trải nghiệm (giờ tự chọn) hoặc học thử (chọn buổi học LMS còn chỗ). */
export function BookAppointmentDialog({
  lead,
  onClose,
}: {
  lead: { id: string; branchId: string; childName: string; interestSubjectId: string | null };
  onClose: () => void;
}) {
  const api = useApi();
  const qc = useQueryClient();
  const [type, setType] = useState<'EXPERIENCE' | 'TRIAL'>('EXPERIENCE');
  const [at, setAt] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [note, setNote] = useState('');
  const [from] = useState(() => todayVN());

  const slots = useQuery({
    queryKey: ['lms', 'trial-slots', lead.branchId, lead.interestSubjectId],
    enabled: type === 'TRIAL',
    queryFn: async () =>
      (
        await unwrap(
          api.GET('/api/v1/lms/trial-slots', {
            params: {
              query: {
                branchId: lead.branchId,
                subjectId: lead.interestSubjectId ?? undefined,
                from: fromVnInput(`${from}T00:00`),
                to: fromVnInput(`${addDays(from, 21)}T00:00`),
              },
            },
          }),
        )
      ).data,
  });
  const slot = slots.data?.find((s) => s.sessionId === sessionId);

  const book = useMutation({
    mutationFn: async () =>
      unwrap(
        api.POST('/api/v1/crm/leads/{id}/appointments', {
          params: { path: { id: lead.id } },
          body:
            type === 'TRIAL'
              ? { type, scheduledAt: slot!.startsAt, lmsSessionId: sessionId, note: note.trim() || null }
              : { type, scheduledAt: fromVnInput(at), note: note.trim() || null },
        }),
      ),
    onSuccess: () => {
      toast.success(type === 'TRIAL' ? 'Đã đặt học thử — giáo viên sẽ thấy khách trong buổi học' : 'Đã đặt lịch trải nghiệm');
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      void qc.invalidateQueries({ queryKey: crmKeys.appointments });
      onClose();
    },
    onError: toastError,
  });
  const valid = type === 'TRIAL' ? !!slot : !!at;

  // Nhóm buổi theo ngày
  const byDay = new Map<string, NonNullable<typeof slots.data>>();
  for (const s of slots.data ?? []) {
    const d = vnDay(s.startsAt);
    byDay.set(d, [...(byDay.get(d) ?? []), s]);
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Đặt lịch — ${lead.childName}`}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => book.mutate()} disabled={!valid || book.isPending}>
            Đặt lịch
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          aria-label="Loại lịch hẹn"
          value={type}
          onChange={setType}
          options={[
            { value: 'EXPERIENCE', label: 'Trải nghiệm' },
            { value: 'TRIAL', label: 'Học thử trong lớp' },
          ]}
        />
        {type === 'EXPERIENCE' ? (
          <Field label="Thời gian" required>
            <Input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} min={`${from}T00:00`} />
          </Field>
        ) : slots.isPending ? (
          <Spinner label="Đang tìm buổi còn chỗ…" />
        ) : !slots.data?.length ? (
          <Alert tone="warning">Không có buổi học còn chỗ học thử trong 3 tuần tới{lead.interestSubjectId ? ' cho môn khách quan tâm' : ''}.</Alert>
        ) : (
          <div className="flex max-h-80 flex-col gap-3 overflow-y-auto">
            {[...byDay.entries()].map(([day, list]) => (
              <div key={day}>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground uppercase">{formatWorkDate(day)}</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {list.map((s) => (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => setSessionId(s.sessionId)}
                      className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        s.sessionId === sessionId ? 'border-cyan-brand bg-cyan-brand-soft' : 'border-border hover:border-navy-300'
                      }`}
                    >
                      <div className="flex justify-between gap-2 font-medium">
                        <span>
                          {formatTime(s.startsAt)}–{formatTime(s.endsAt)}
                        </span>
                        <span className="text-xs font-normal text-muted-foreground">còn {s.remaining} chỗ</span>
                      </div>
                      <div className="text-muted-foreground">
                        {s.classCode} · {s.levelName}
                      </div>
                      {s.teacherName && <div className="text-xs text-muted-foreground">GV {s.teacherName}</div>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {slot && <p className="text-sm">Đã chọn: {formatDateTime(slot.startsAt)} — lớp {slot.className}</p>}
        <Field label="Ghi chú">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
