import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { unwrap, type ApiData } from '@zero1/api-client';
import { Badge, Button, Card, PageHeader, Segmented, Select, Spinner, Stat } from '@zero1/ui';
import { addDays, BranchSelect, formatDate, formatTime, formatWeekday, fromVnInput, todayVN, useApi, usePermission, vnDay, weekStart } from '@zero1/web-core';
import { APPOINTMENT_STATUS, APPOINTMENT_TYPES, crmKeys } from '../labels';
import { AppointmentActions } from './appointment-dialogs';

type Appointment = ApiData<'/api/v1/crm/appointments'>[number];

export default function AppointmentsPage() {
  const api = useApi();
  const canWrite = usePermission('crm.leads.write');
  const [today] = useState(() => todayVN());
  const [start, setStart] = useState(() => weekStart(todayVN()));
  const [type, setType] = useState<'' | 'EXPERIENCE' | 'TRIAL'>('');
  const [status, setStatus] = useState('SCHEDULED,CONFIRMED,ATTENDED,NO_SHOW');
  const [branchId, setBranchId] = useState('');
  const end = addDays(start, 7);

  const { data, isFetching } = useQuery({
    queryKey: [...crmKeys.appointments, { start, type, status, branchId }],
    queryFn: async () =>
      (
        await unwrap(
          api.GET('/api/v1/crm/appointments', {
            params: {
              query: {
                from: fromVnInput(`${start}T00:00`),
                to: fromVnInput(`${end}T00:00`),
                type: type || undefined,
                status: status || undefined,
                branchId: branchId || undefined,
              },
            },
          }),
        )
      ).data,
    placeholderData: keepPreviousData,
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, Appointment[]>(days.map((d) => [d, []]));
  for (const a of data ?? []) byDay.get(vnDay(a.scheduledAt))?.push(a);
  const count = (s: string) => (data ?? []).filter((a) => a.status === s).length;
  const decided = count('ATTENDED') + count('NO_SHOW');

  return (
    <>
      <PageHeader title="Lịch hẹn" description="Trải nghiệm và học thử trong tuần. Kết quả học thử đồng bộ từ điểm danh của giáo viên." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lịch trong tuần" value={data?.length ?? '—'} />
        <Stat label="Chờ diễn ra" value={count('SCHEDULED') + count('CONFIRMED')} tone="info" />
        <Stat label="Đã đến" value={count('ATTENDED')} tone="success" hint={decided ? `${Math.round((count('ATTENDED') / decided) * 100)}% số lịch đã diễn ra` : undefined} />
        <Stat label="Không đến" value={count('NO_SHOW')} tone="danger" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" aria-label="Tuần trước" onClick={() => setStart(addDays(start, -7))}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setStart(weekStart(today))}>
            Tuần này
          </Button>
          <Button variant="outline" size="icon" aria-label="Tuần sau" onClick={() => setStart(addDays(start, 7))}>
            <ChevronRight />
          </Button>
        </div>
        <span className="text-sm font-medium">
          {formatDate(start)} – {formatDate(addDays(start, 6))}
        </span>
        {isFetching && <Spinner />}
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <Segmented
            aria-label="Loại lịch"
            value={type}
            onChange={setType}
            options={[
              { value: '', label: 'Tất cả' },
              { value: 'EXPERIENCE', label: 'Trải nghiệm' },
              { value: 'TRIAL', label: 'Học thử' },
            ]}
          />
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-44" aria-label="Trạng thái">
            <option value="SCHEDULED,CONFIRMED,ATTENDED,NO_SHOW">Trừ lịch đã huỷ</option>
            <option value="SCHEDULED,CONFIRMED">Chờ diễn ra</option>
            <option value="ATTENDED">Đã đến</option>
            <option value="NO_SHOW">Không đến</option>
            <option value="CANCELLED">Đã huỷ</option>
            <option value="">Tất cả</option>
          </Select>
          <BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <Card key={d} className={`flex min-h-32 flex-col p-3 ${d === today ? 'border-cyan-brand ring-1 ring-cyan-brand/40' : ''}`}>
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-sm font-semibold capitalize">{formatWeekday(d)}</span>
                <span className="text-xs text-muted-foreground">{formatDate(d).slice(0, 5)}</span>
              </div>
              {!list.length ? (
                <p className="text-xs text-muted-foreground">Không có lịch</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {list.map((a) => (
                    <li key={a.id} className="rounded-md border border-border bg-muted/30 p-2 text-sm">
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          <div className="font-medium tabular-nums">{formatTime(a.scheduledAt)}</div>
                          <div className="text-xs text-muted-foreground">{APPOINTMENT_TYPES[a.type]}</div>
                          <Link to={`/leads/${a.lead.id}`} className="block truncate text-info hover:underline">
                            {a.lead.childName}
                          </Link>
                          <div className="truncate text-xs text-muted-foreground">
                            {a.lead.parentPhone}
                            {a.lead.ownerName && ` · ${a.lead.ownerName}`}
                          </div>
                        </div>
                        {canWrite && <AppointmentActions appt={a} />}
                      </div>
                      <Badge tone={APPOINTMENT_STATUS[a.status].tone} className="mt-1">
                        {APPOINTMENT_STATUS[a.status].label}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        })}
      </div>
    </>
  );
}
