import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, GraduationCap, MoreHorizontal, Pencil, PhoneCall, RefreshCcw, RotateCcw, Trash2 } from 'lucide-react';
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
  DropdownMenu,
  InfoList,
  PageHeader,
  Spinner,
  toast,
  type MenuAction,
} from '@zero1/ui';
import { formatDateTime, formatRelative, toastError, useApi, usePermission } from '@zero1/web-core';
import { AppointmentActions, BookAppointmentDialog } from '../appointments/appointment-dialogs';
import { APPOINTMENT_STATUS, APPOINTMENT_TYPES, CALL_OUTCOMES, crmKeys, isStopped, LEAD_SOURCES, stageOf } from '../labels';
import { ConvertDialog } from './convert-dialog';
import { LeadFormDialog } from './lead-form';
import { LeadStatusAlerts, LeadStatusBadge, LeadStatusDialog, StatusTimeline, statusLocked } from './status';

type Lead = Schemas['LeadDetail'];

export default function LeadDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canWrite = usePermission('crm.leads.write');
  const canDelete = usePermission('crm.leads.delete');
  const canEnroll = usePermission('crm.enrollments.create');
  const canReopen = usePermission('crm.leads.reopen');
  const [dialog, setDialog] = useState<'edit' | 'book' | 'convert' | 'call' | 'status' | 'reopen' | 'delete' | null>(null);

  const { data: lead, error } = useQuery({
    queryKey: crmKeys.lead(id),
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/leads/{id}', { params: { path: { id } } }))).data,
  });
  const { data: subjects = [] } = useQuery({
    queryKey: ['crm', 'catalog', 'subjects'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/catalog/subjects'))).data,
    staleTime: 5 * 60_000,
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

  const stopped = isStopped(lead.status);
  const converted = !!lead.convertedStudentId;
  /** Còn chăm sóc: chưa dừng, chưa đăng ký — đặt lịch / đăng ký học được. */
  const open = !stopped && stageOf(lead.status) < 5;
  const canChangeStatus = canWrite && !stopped && !statusLocked(lead);
  const menu: MenuAction[] = [
    ...(canChangeStatus ? [{ label: 'Đổi trạng thái', icon: RefreshCcw, onSelect: () => setDialog('status') }] : []),
    ...(canReopen && stopped ? [{ label: 'Mở lại', icon: RotateCcw, onSelect: () => setDialog('reopen') }] : []),
    ...(canDelete && !converted ? [{ label: 'Xoá khách hàng', icon: Trash2, tone: 'danger' as const, separatorBefore: true, onSelect: () => setDialog('delete') }] : []),
  ];

  return (
    <>
      <BackLink to="/leads" label="Khách hàng tiềm năng" />
      <PageHeader
        title={lead.childName}
        description={`${lead.parentName} · ${lead.parentPhone}`}
        actions={
          <>
            {converted && (
              <Link to={`/students/${lead.convertedStudentId}`} className={buttonVariants({ variant: 'outline' })}>
                <GraduationCap /> Hồ sơ học viên
              </Link>
            )}
            {canReopen && stopped && (
              <Button variant="outline" onClick={() => setDialog('reopen')}>
                <RotateCcw /> Mở lại
              </Button>
            )}
            {canWrite && !converted && !stopped && (
              <Button variant="outline" onClick={() => setDialog('edit')}>
                <Pencil /> Sửa
              </Button>
            )}
            {canEnroll && open && (
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
              <LeadStatusBadge status={lead.status} />
            </CardHeader>
            <CardContent>
              <LeadStatusAlerts lead={lead} onPick={canWrite ? () => setDialog('status') : undefined} />
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
          <CallsCard lead={lead} canWrite={canWrite && !stopped} onCall={() => setDialog('call')} />
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card className="h-fit">
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Lịch hẹn</CardTitle>
              {canWrite && open && (
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
          <Card className="h-fit">
            <CardHeader>
              <CardTitle>Lịch sử trạng thái</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusTimeline logs={lead.statusLogs} />
            </CardContent>
          </Card>
        </div>
      </div>

      {dialog === 'edit' && <LeadFormDialog lead={lead} onClose={() => setDialog(null)} />}
      {dialog === 'book' && <BookAppointmentDialog lead={lead} onClose={() => setDialog(null)} />}
      {dialog === 'convert' && <ConvertDialog lead={lead} onClose={() => setDialog(null)} />}
      {(dialog === 'call' || dialog === 'status' || dialog === 'reopen') && <LeadStatusDialog lead={lead} mode={dialog} onClose={() => setDialog(null)} />}
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

function CallsCard({ lead, canWrite, onCall }: { lead: Lead; canWrite: boolean; onCall: () => void }) {
  const [now] = useState(() => Date.now());
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>Chăm sóc</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {lead.nextFollowUpAt && (
            <Badge tone={new Date(lead.nextFollowUpAt).getTime() <= now ? 'danger' : 'info'}>
              {lead.status === 'S4B' ? 'Hẹn đóng phí' : 'Gọi lại'} {formatRelative(lead.nextFollowUpAt)}
            </Badge>
          )}
          {canWrite && (
            <Button size="sm" onClick={onCall}>
              <PhoneCall /> Ghi cuộc gọi
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!lead.calls.length ? (
          <p className="text-sm text-muted-foreground">Chưa có cuộc gọi nào.</p>
        ) : (
          <ol className="relative flex flex-col gap-4 border-l border-border pl-4">
            {lead.calls.map((c) => (
              <li key={c.id} className="text-sm">
                <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-navy-300" aria-hidden />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{CALL_OUTCOMES[c.outcome]}</span>
                  {c.statusAfter && <LeadStatusBadge status={c.statusAfter} />}
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(c.calledAt)} · {c.userName ?? '—'}
                  </span>
                </div>
                {c.note && <p className="mt-0.5 whitespace-pre-line">{c.note}</p>}
                {c.nextFollowUpAt && <p className="mt-0.5 text-xs text-muted-foreground">Hẹn {formatDateTime(c.nextFollowUpAt)}</p>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
