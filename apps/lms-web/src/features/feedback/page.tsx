import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { unwrap } from '@zero1/api-client';
import { Card, PageHeader, Segmented, Spinner } from '@zero1/ui';
import { addDays, fromVnInput, todayVN, useApi } from '@zero1/web-core';
import { lmsKeys } from '../labels';
import { SessionCard } from '../sessions/session-card';

/** Buổi đã học gần đây — mở buổi để nhận xét từng học viên (tab “Nhận xét”). */
export default function FeedbackPage() {
  const api = useApi();
  const [days, setDays] = useState<'7' | '14' | '30'>('7');
  const [now] = useState(() => Date.now());
  const [today] = useState(() => todayVN());
  const query = { from: fromVnInput(`${addDays(today, -Number(days) + 1)}T00:00`), to: fromVnInput(`${addDays(today, 1)}T00:00`), includeCancelled: false };
  const { data, isPending } = useQuery({
    queryKey: [...lmsKeys.sessions, 'calendar', query],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/sessions', { params: { query } }))).data,
    placeholderData: keepPreviousData,
  });
  const past = (data ?? []).filter((s) => new Date(s.startsAt).getTime() <= now).sort((a, b) => b.startsAt.localeCompare(a.startsAt));

  return (
    <>
      <PageHeader title="Nhận xét buổi học" description="Chọn buổi đã học để nhận xét từng học viên theo tiêu chí. Nhận xét sẽ được gửi phụ huynh ở giai đoạn sau." />
      <Segmented
        aria-label="Khoảng thời gian"
        className="mb-4"
        value={days}
        onChange={setDays}
        options={[
          { value: '7', label: '7 ngày' },
          { value: '14', label: '14 ngày' },
          { value: '30', label: '30 ngày' },
        ]}
      />
      {isPending ? (
        <Spinner label="Đang tải…" />
      ) : !past.length ? (
        <Card className="p-6 text-sm text-muted-foreground">Không có buổi đã học trong khoảng này.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {past.map((s) => (
            <SessionCard key={s.id} s={s} now={now} />
          ))}
        </div>
      )}
    </>
  );
}
