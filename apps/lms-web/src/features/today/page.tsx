import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BatteryLow, CalendarClock, NotebookPen, UserX } from 'lucide-react';
import { unwrap } from '@zero1/api-client';
import { Card, CardContent, CardHeader, CardTitle, PageHeader, Spinner, Stat } from '@zero1/ui';
import { BranchSelect, formatDateTime, formatWeekday, formatDate, useApi, useMe } from '@zero1/web-core';
import { lmsKeys } from '../labels';
import { SessionCard } from '../sessions/session-card';

export default function TodayPage() {
  const api = useApi();
  const me = useMe();
  const [branchId, setBranchId] = useState('');
  const [now] = useState(() => Date.now());
  const { data, isPending } = useQuery({
    queryKey: [...lmsKeys.today, branchId],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/today', { params: { query: { branchId: branchId || undefined } } }))).data,
    refetchInterval: 60_000,
  });

  return (
    <>
      <PageHeader
        title="Hôm nay"
        description={data ? `${formatWeekday(data.date)}, ${formatDate(data.date)} · Xin chào ${me.fullName}` : `Xin chào ${me.fullName}`}
        actions={<BranchSelect value={branchId} onChange={setBranchId} allLabel="Mọi chi nhánh" />}
      />
      {isPending || !data ? (
        <Spinner label="Đang tải…" />
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Buổi hôm nay" value={data.sessions.filter((s) => s.status !== 'CANCELLED').length} icon={CalendarClock} />
            <Stat label="Chưa chốt điểm danh" value={data.overdueSessions.length} icon={AlertTriangle} tone={data.overdueSessions.length ? 'warning' : 'success'} />
            <Stat label="Vắng liên tiếp" value={data.absenceAlerts.length} icon={UserX} tone={data.absenceAlerts.length ? 'danger' : 'default'} />
            <Stat label="Bài chờ chấm" value={data.pendingGrading} icon={NotebookPen} tone={data.pendingGrading ? 'info' : 'default'} />
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <section>
              <h2 className="mb-3 font-semibold">Lịch hôm nay</h2>
              {!data.sessions.length ? (
                <Card className="p-6 text-sm text-muted-foreground">Hôm nay không có buổi học.</Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {data.sessions.map((s) => (
                    <SessionCard key={s.id} s={s} now={now} />
                  ))}
                </div>
              )}
            </section>

            <div className="flex flex-col gap-4">
              {data.overdueSessions.length > 0 && (
                <Card className="border-warning/40">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-warning">
                      <AlertTriangle className="size-4" /> Buổi chưa chốt điểm danh
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="flex flex-col gap-2 text-sm">
                      {data.overdueSessions.map((s) => (
                        <li key={s.id}>
                          <Link to={`/sessions/${s.id}`} className="flex justify-between gap-2 hover:underline">
                            <span className="font-medium">
                              {s.classCode} · buổi {s.indexNo}
                            </span>
                            <span className="text-muted-foreground">{formatDateTime(s.startsAt)}</span>
                          </Link>
                          {s.teacherName && <div className="text-xs text-muted-foreground">GV {s.teacherName}</div>}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserX className="size-4 text-danger" /> Vắng liên tiếp
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!data.absenceAlerts.length ? (
                    <p className="text-sm text-muted-foreground">Không có học viên vắng nhiều.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5 text-sm">
                      {data.absenceAlerts.map((a) => (
                        <li key={`${a.learnerId}-${a.classCode}`} className="flex justify-between gap-2">
                          <Link to={`/learners/${a.learnerId}`} className="hover:underline">
                            {a.fullName} <span className="text-muted-foreground">· {a.classCode}</span>
                          </Link>
                          <span className="font-medium text-danger tabular-nums">{a.streak} buổi</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BatteryLow className="size-4 text-warning" /> Sắp hết buổi
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {!data.lowRemaining.length ? (
                    <p className="text-sm text-muted-foreground">Không có học viên sắp hết buổi.</p>
                  ) : (
                    <ul className="flex flex-col gap-1.5 text-sm">
                      {data.lowRemaining.map((l) => (
                        <li key={`${l.learnerId}-${l.classCode}`} className="flex justify-between gap-2">
                          <Link to={`/learners/${l.learnerId}`} className="hover:underline">
                            {l.fullName} <span className="text-muted-foreground">· {l.classCode}</span>
                          </Link>
                          <span className="font-medium text-warning tabular-nums">còn {l.remaining}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {data.lowRemaining.length > 0 && <p className="mt-2 text-xs text-muted-foreground">CS liên hệ tái phí bên CRM.</p>}
                </CardContent>
              </Card>
              {data.pendingGrading > 0 && (
                <Link to="/assignments" className="text-sm text-info hover:underline">
                  {data.pendingGrading} bài đã nộp chờ chấm →
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
