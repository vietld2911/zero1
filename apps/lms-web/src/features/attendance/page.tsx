import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { unwrap } from '@zero1/api-client';
import { Alert, Card, PageHeader, Segmented, Spinner } from '@zero1/ui';
import { addDays, formatDateTime, fromVnInput, todayVN, useApi } from '@zero1/web-core';
import { lmsKeys } from '../labels';
import { SessionCard } from '../sessions/session-card';

type Range = 'today' | 'week';

/** Danh sách buổi cần điểm danh: hôm nay / 7 ngày gần đây, kèm buổi quá hạn chưa chốt. */
export default function AttendancePage() {
  const api = useApi();
  const [range, setRange] = useState<Range>('today');
  const [now] = useState(() => Date.now());
  const [today] = useState(() => todayVN());
  const from = range === 'today' ? today : addDays(today, -6);

  const { data: summary } = useQuery({
    queryKey: [...lmsKeys.today, ''],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/today', { params: { query: {} } }))).data,
  });
  const query = { from: fromVnInput(`${from}T00:00`), to: fromVnInput(`${addDays(today, 1)}T00:00`), includeCancelled: false };
  const { data, isPending } = useQuery({
    queryKey: [...lmsKeys.sessions, 'calendar', query],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/sessions', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });
  const sessions = [...(data ?? [])].sort((a, b) => (range === 'today' ? a.startsAt.localeCompare(b.startsAt) : b.startsAt.localeCompare(a.startsAt)));

  return (
    <>
      <PageHeader title="Điểm danh" description="Chọn buổi để điểm danh. Chốt buổi → trừ buổi học của học viên bên CRM." />
      {!!summary?.overdueSessions.length && (
        <Alert tone="warning" className="mb-4" title={`${summary.overdueSessions.length} buổi đã qua chưa chốt điểm danh`}>
          <ul className="mt-1 flex flex-col gap-0.5">
            {summary.overdueSessions.slice(0, 8).map((s) => (
              <li key={s.id}>
                <Link to={`/sessions/${s.id}`} className="underline">
                  {s.classCode} · buổi {s.indexNo}
                </Link>{' '}
                — {formatDateTime(s.startsAt)}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      <Segmented
        aria-label="Khoảng thời gian"
        className="mb-4"
        value={range}
        onChange={setRange}
        options={[
          { value: 'today', label: 'Hôm nay' },
          { value: 'week', label: '7 ngày gần đây' },
        ]}
      />
      {isPending ? (
        <Spinner label="Đang tải…" />
      ) : !sessions.length ? (
        <Card className="p-6 text-sm text-muted-foreground">{range === 'today' ? 'Hôm nay không có buổi học.' : 'Không có buổi học trong 7 ngày qua.'}</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} now={now} />
          ))}
        </div>
      )}
    </>
  );
}
