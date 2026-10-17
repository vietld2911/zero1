import { Link } from 'react-router';
import { ClipboardCheck, DoorOpen, UserRound, Users } from 'lucide-react';
import type { Schemas } from '@zero1/api-client';
import { Badge, cn } from '@zero1/ui';
import { formatTime } from '@zero1/web-core';
import { SESSION_STATUS } from '../labels';

type Session = Schemas['ClassSession'];

function state(s: Session, now: number) {
  const started = new Date(s.startsAt).getTime() <= now;
  const ended = new Date(s.endsAt).getTime() <= now;
  return { live: started && !ended && s.status === 'SCHEDULED', needsAttendance: ended && s.status === 'SCHEDULED' };
}

/**
 * Thẻ buổi học: giờ, lớp, GV, phòng, tiến độ điểm danh. Bấm → chi tiết buổi (điểm danh, nhận xét).
 * `compact` cho cột hẹp của lịch tuần.
 */
export function SessionCard({ s, now, compact }: { s: Session; now: number; compact?: boolean }) {
  const { live, needsAttendance } = state(s, now);
  const badge = needsAttendance ? <Badge tone="warning">Chưa chốt</Badge> : <Badge tone={SESSION_STATUS[s.status].tone}>{SESSION_STATUS[s.status].label}</Badge>;
  const frame = cn(
    'block rounded-lg border bg-surface shadow-card transition-colors hover:border-navy-300',
    live ? 'border-cyan-brand ring-1 ring-cyan-brand/40' : needsAttendance ? 'border-warning/50' : 'border-border',
    s.status === 'CANCELLED' && 'opacity-60',
  );

  if (compact) {
    return (
      <Link to={`/sessions/${s.id}`} className={cn(frame, 'p-2 text-xs')} title={`${s.classCode} · ${s.className}`}>
        <div className="text-sm font-semibold tabular-nums">
          {formatTime(s.startsAt)}–{formatTime(s.endsAt)}
        </div>
        <div className="truncate text-sm font-medium">{s.classCode}</div>
        <div className="truncate text-muted-foreground">
          {s.teacherName ?? '—'}
          {s.roomName && ` · ${s.roomName}`}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {badge}
          {s.substitute && <Badge tone="warning">Dạy thay</Badge>}
          {s.trialGuestCount > 0 && <Badge tone="brand">+{s.trialGuestCount} thử</Badge>}
        </div>
        <div className="mt-1 text-muted-foreground tabular-nums">
          Buổi {s.indexNo}/{s.totalSessions} · {s.status === 'CANCELLED' ? '—' : `${s.attendanceCount}/${s.learnerCount} HV`}
        </div>
      </Link>
    );
  }

  return (
    <Link to={`/sessions/${s.id}`} className={cn(frame, 'p-3')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold tabular-nums">
            {formatTime(s.startsAt)}–{formatTime(s.endsAt)}
            {live && <span className="ml-2 text-xs font-medium text-cyan-brand">● Đang học</span>}
          </div>
          <div className="truncate font-medium">{s.classCode}</div>
          <div className="truncate text-xs text-muted-foreground">{s.className}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {badge}
          <span className="text-xs text-muted-foreground tabular-nums">
            Buổi {s.indexNo}/{s.totalSessions}
          </span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <UserRound className="size-3.5" aria-hidden />
          {s.teacherName ?? '—'}
          {s.substitute && <Badge tone="warning">Dạy thay</Badge>}
        </span>
        {s.roomName && (
          <span className="inline-flex items-center gap-1">
            <DoorOpen className="size-3.5" aria-hidden />
            {s.roomName}
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <Users className="size-3.5" aria-hidden />
          {s.learnerCount} HV{s.trialGuestCount > 0 && ` + ${s.trialGuestCount} học thử`}
        </span>
        {s.status !== 'CANCELLED' && (
          <span className="inline-flex items-center gap-1">
            <ClipboardCheck className="size-3.5" aria-hidden />
            {s.attendanceCount}/{s.learnerCount}
          </span>
        )}
      </div>
    </Link>
  );
}
