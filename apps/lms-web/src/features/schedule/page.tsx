import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { unwrap, type Schemas } from '@zero1/api-client';
import { Button, Card, Checkbox, PageHeader, Select, Spinner } from '@zero1/ui';
import { addDays, BranchSelect, formatDate, formatWeekday, fromVnInput, todayVN, useApi, usePermission, useStaffOptions, vnDay, weekStart } from '@zero1/web-core';
import { lmsKeys, TEACHER_ROLES } from '../labels';
import { SessionCard } from '../sessions/session-card';

type Session = Schemas['ClassSession'];

export default function SchedulePage() {
  const api = useApi();
  const canSeeStaff = usePermission('core.users.read');
  const [today] = useState(() => todayVN());
  const [now] = useState(() => Date.now());
  const [start, setStart] = useState(() => weekStart(todayVN()));
  const [branchId, setBranchId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [includeCancelled, setIncludeCancelled] = useState(false);
  const { data: teachers = [] } = useStaffOptions(TEACHER_ROLES, branchId || undefined, canSeeStaff);
  const { data: rooms = [] } = useQuery({
    queryKey: [...lmsKeys.rooms, branchId],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/rooms', { params: { query: { branchId: branchId || undefined } } }))).data,
  });

  const query = {
    from: fromVnInput(`${start}T00:00`),
    to: fromVnInput(`${addDays(start, 7)}T00:00`),
    branchId: branchId || undefined,
    teacherId: teacherId || undefined,
    roomId: roomId || undefined,
    includeCancelled,
  };
  const { data, isFetching } = useQuery({
    queryKey: [...lmsKeys.sessions, 'calendar', query],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/sessions', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });

  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const byDay = new Map<string, Session[]>(days.map((d) => [d, []]));
  for (const s of data ?? []) byDay.get(vnDay(s.startsAt))?.push(s);

  return (
    <>
      <PageHeader title="Lịch học" description="Lịch tuần theo giáo viên và phòng. Bấm vào buổi để điểm danh, dời buổi hoặc đổi giáo viên dạy thay." />
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
        <span className="text-sm text-muted-foreground">· {data?.filter((s) => s.status !== 'CANCELLED').length ?? 0} buổi</span>
        {isFetching && <Spinner />}
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <BranchSelect value={branchId} onChange={(v) => (setBranchId(v), setRoomId(''), setTeacherId(''))} allLabel="Mọi chi nhánh" />
          {canSeeStaff && (
            <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-44" aria-label="Giáo viên">
              <option value="">Mọi giáo viên</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
            </Select>
          )}
          <Select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="w-36" aria-label="Phòng">
            <option value="">Mọi phòng</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Checkbox label="Hiện buổi đã huỷ" checked={includeCancelled} onCheckedChange={setIncludeCancelled} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
        {days.map((d) => {
          const list = byDay.get(d) ?? [];
          return (
            <Card key={d} className={`flex min-h-32 flex-col gap-2 p-2.5 ${d === today ? 'border-cyan-brand ring-1 ring-cyan-brand/40' : 'bg-muted/30'}`}>
              <div className="flex items-baseline justify-between px-0.5">
                <span className="text-sm font-semibold capitalize">{formatWeekday(d)}</span>
                <span className="text-xs text-muted-foreground">{formatDate(d).slice(0, 5)}</span>
              </div>
              {!list.length ? <p className="px-0.5 text-xs text-muted-foreground">Không có buổi</p> : list.map((s) => <SessionCard key={s.id} s={s} now={now} compact />)}
            </Card>
          );
        })}
      </div>
    </>
  );
}
