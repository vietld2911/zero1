import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, GraduationCap, MoreHorizontal, Pencil, PhoneCall, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  BackLink,
  Badge,
  Button,
  buttonVariants,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  Dialog,
  DropdownMenu,
  Field,
  InfoList,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
  toast,
  type MenuAction,
} from '@zero1/ui';
import { formatDateTime, formatRelative, fromVnInput, toastError, useApi, usePermission } from '@zero1/web-core';
import { AppointmentActions, BookAppointmentDialog } from '../appointments/appointment-dialogs';
import { APPOINTMENT_STATUS, APPOINTMENT_TYPES, CALL_OUTCOMES, crmKeys, LEAD_SOURCES, LEAD_STATUS } from '../labels';
import { ConvertDialog } from './convert-dialog';
import { LeadFormDialog } from './lead-form';

type Lead = Schemas['LeadDetail'];

export default function LeadDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canWrite = usePermission('crm.leads.write');
  const canDelete = usePermission('crm.leads.delete');
  const canEnroll = usePermission('crm.enrollments.create');
  const [dialog, setDialog] = useState<'edit' | 'book' | 'convert' | 'lost' | 'delete' | null>(null);

  const { data: lead, error } = useQuery({
    queryKey: crmKeys.lead(id),
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/leads/{id}', { params: { path: { id } } }))).data,
  });
  const { data: subjects = [] } = useQuery({
    queryKey: ['crm', 'catalog', 'subjects'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/catalog/subjects'))).data,
    staleTime: 5 * 60_000,
  });

  const setStatus = useMutation({
    mutationFn: async (body: { status: 'NEW' | 'CONTACTING' | 'LOST'; lostReason?: string }) =>
      unwrap(api.PATCH('/api/v1/crm/leads/{id}', { params: { path: { id } }, body, headers: { 'If-Match': String(lead!.version) } })),
    onSuccess: () => {
      toast.success('Đã cập nhật trạng thái');
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      setDialog(null);
    },
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: async () => unwrap(api.DELETE('/api/v1/crm/leads/{id}', { params: { path: { id } } })),
    onSuccess: () => {
      toast.success('Đã xoá khách hàng');
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      navigate('/leads');
    },
    onError: toastError,
  });

  if (error) return <Alert tone="danger">Không tìm thấy khách hàng hoặc bạn không có quyền xem.</Alert>;
  if (!lead) return <Spinner label="Đang tải…" />;

  const closed = lead.status === 'CONVERTED' || lead.status === 'LOST';
  const status = LEAD_STATUS[lead.status];
  const menu: MenuAction[] = [
    ...(canWrite && !closed ? [{ label: 'Đánh dấu thất bại', icon: XCircle, onSelect: () => setDialog('lost') }] : []),
    ...(canWrite && lead.status === 'LOST' ? [{ label: 'Mở lại', icon: RotateCcw, onSelect: () => setStatus.mutate({ status: 'CONTACTING' }) }] : []),
    ...(canDelete && lead.status !== 'CONVERTED' ? [{ label: 'Xoá khách hàng', icon: Trash2, tone: 'danger' as const, separatorBefore: true, onSelect: () => setDialog('delete') }] : []),
  ];

  return (
    <>
      <BackLink to="/leads" label="Khách hàng tiềm năng" />
      <PageHeader
        title={lead.childName}
        description={`${lead.parentName} · ${lead.parentPhone}`}
        actions={
          <>
            {lead.status === 'CONVERTED' && lead.convertedStudentId && (
              <Link to={`/students/${lead.convertedStudentId}`} className={buttonVariants({ variant: 'outline' })}>
                <GraduationCap /> Hồ sơ học viên
              </Link>
            )}
            {canWrite && !closed && (
              <Button variant="outline" onClick={() => setDialog('edit')}>
                <Pencil /> Sửa
              </Button>
            )}
            {canEnroll && !closed && (
              <Button onClick={() => setDialog('convert')}>
                <GraduationCap /> Đăng ký học
              </Button>
            )}
            {menu.length > 0 && (
              <DropdownMenu
                trigger={
                  <Button variant="outline" size="icon" aria-label="Thao tác khác">
                    <MoreHorizontal />
                  </Button>
                }
                actions={menu}
              />
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Thông tin</CardTitle>
              <Badge tone={status.tone}>{status.label}</Badge>
            </CardHeader>
            <CardContent>
              {lead.status === 'LOST' && lead.lostReason && (
                <Alert tone="info" className="mb-4" title="Lý do thất bại">
                  {lead.lostReason}
                </Alert>
              )}
              <InfoList
                items={[
                  { label: 'Phụ huynh', value: lead.parentName },
                  { label: 'Số điện thoại', value: <a href={`tel:${lead.parentPhone}`} className="text-info hover:underline">{lead.parentPhone}</a> },
                  { label: 'Email', value: lead.parentEmail },
                  { label: 'Năm sinh học sinh', value: lead.childBirthYear },
                  { label: 'Trường', value: lead.school },
                  { label: 'Môn quan tâm', value: subjects.find((s) => s.id === lead.interestSubjectId)?.name },
                  { label: 'Nguồn', value: LEAD_SOURCES[lead.source] },
                  { label: 'Chi nhánh', value: lead.branchName },
                  { label: 'Phụ trách', value: lead.ownerName ?? <Badge tone="warning">Chưa phân công</Badge> },
                  { label: 'Ngày tạo', value: formatDateTime(lead.createdAt) },
                  { label: 'Ghi chú', value: lead.notes },
                ]}
              />
            </CardContent>
          </Card>
          <CallsCard lead={lead} canWrite={canWrite && !closed} />
        </div>

        <Card className="h-fit">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Lịch hẹn</CardTitle>
            {canWrite && !closed && (
              <Button size="sm" variant="outline" onClick={() => setDialog('book')}>
                <CalendarPlus /> Đặt lịch
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {!lead.appointments.length ? (
              <p className="text-sm text-muted-foreground">Chưa có lịch hẹn.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border">
                {lead.appointments.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-2 py-3 first:pt-0">
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{APPOINTMENT_TYPES[a.type]}</span>
                        <Badge tone={APPOINTMENT_STATUS[a.status].tone}>{APPOINTMENT_STATUS[a.status].label}</Badge>
                      </div>
                      <div className="text-muted-foreground">{formatDateTime(a.scheduledAt)}</div>
                      {a.note && <div className="mt-1">{a.note}</div>}
                      {a.resultNote && <div className="mt-1 text-muted-foreground italic">{a.resultNote}</div>}
                    </div>
                    {canWrite && <AppointmentActions appt={a} />}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {dialog === 'edit' && <LeadFormDialog lead={lead} onClose={() => setDialog(null)} />}
      {dialog === 'book' && <BookAppointmentDialog lead={lead} onClose={() => setDialog(null)} />}
      {dialog === 'convert' && <ConvertDialog lead={lead} onClose={() => setDialog(null)} />}
      {dialog === 'lost' && <LostDialog pending={setStatus.isPending} onClose={() => setDialog(null)} onConfirm={(lostReason) => setStatus.mutate({ status: 'LOST', lostReason })} />}
      <ConfirmDialog
        open={dialog === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title="Xoá khách hàng?"
        confirmLabel="Xoá"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        Xoá {lead.childName} cùng lịch sử gọi và lịch hẹn. Không hoàn tác được.
      </ConfirmDialog>
    </>
  );
}

function LostDialog({ pending, onClose, onConfirm }: { pending: boolean; onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Đánh dấu thất bại"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 3 || pending} onClick={() => onConfirm(reason.trim())}>
            Lưu
          </Button>
        </>
      }
    >
      <Field label="Lý do" required hint="Dùng để thống kê nguyên nhân mất khách">
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Chọn trung tâm khác, học phí cao…" />
      </Field>
    </Dialog>
  );
}

function CallsCard({ lead, canWrite }: { lead: Lead; canWrite: boolean }) {
  const api = useApi();
  const qc = useQueryClient();
  const [outcome, setOutcome] = useState<keyof typeof CALL_OUTCOMES>('TALKED');
  const [note, setNote] = useState('');
  const [next, setNext] = useState('');
  const [now] = useState(() => Date.now());
  const log = useMutation({
    mutationFn: async () =>
      unwrap(
        api.POST('/api/v1/crm/leads/{id}/calls', {
          params: { path: { id: lead.id } },
          body: { outcome, note: note.trim() || null, nextFollowUpAt: next ? fromVnInput(next) : undefined },
        }),
      ),
    onSuccess: () => {
      toast.success('Đã ghi cuộc gọi');
      setNote('');
      setNext('');
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
    },
    onError: toastError,
  });

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Chăm sóc</CardTitle>
        {lead.nextFollowUpAt && (
          <Badge tone={new Date(lead.nextFollowUpAt).getTime() <= now ? 'danger' : 'info'}>Gọi lại {formatRelative(lead.nextFollowUpAt)}</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {canWrite && (
          <form
            className="grid gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2"
            onSubmit={(e) => (e.preventDefault(), log.mutate())}
          >
            <Field label="Kết quả">
              <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                {Object.entries(CALL_OUTCOMES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Hẹn gọi lại">
              <Input type="datetime-local" value={next} onChange={(e) => setNext(e.target.value)} />
            </Field>
            <Field label="Nội dung" className="sm:col-span-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Phụ huynh quan tâm gì, hẹn gì…" />
            </Field>
            <Button type="submit" className="sm:col-span-2 sm:justify-self-end" disabled={log.isPending}>
              <PhoneCall /> Ghi cuộc gọi
            </Button>
          </form>
        )}
        {!lead.calls.length ? (
          <p className="text-sm text-muted-foreground">Chưa có cuộc gọi nào.</p>
        ) : (
          <ol className="relative flex flex-col gap-4 border-l border-border pl-4">
            {lead.calls.map((c) => (
              <li key={c.id} className="text-sm">
                <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-navy-300" aria-hidden />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{CALL_OUTCOMES[c.outcome]}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(c.calledAt)} · {c.userName ?? '—'}
                  </span>
                </div>
                {c.note && <p className="mt-0.5 whitespace-pre-line">{c.note}</p>}
                {c.nextFollowUpAt && <p className="mt-0.5 text-xs text-muted-foreground">Hẹn gọi lại {formatDateTime(c.nextFollowUpAt)}</p>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
