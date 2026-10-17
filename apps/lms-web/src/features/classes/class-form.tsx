import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Button, Dialog, Field, Input, Select, Textarea, toast } from '@zero1/ui';
import { BranchSelect, errorMessage, todayVN, useApi, useBranches, useDefaultBranch, useStaffOptions, WEEKDAY_SHORT } from '@zero1/web-core';
import { lmsKeys, TA_ROLES, TEACHER_ROLES, teachingKeys } from '../labels';

type ClassDetail = Schemas['ClassDetail'];
type Slot = Schemas['ScheduleSlot'];

/** Tạo / sửa lớp. Sửa: đổi GV, TA, phòng áp dụng cho các buổi chưa diễn ra. */
export function ClassFormDialog({ cls, onClose, onSaved }: { cls: ClassDetail | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { data: branchList = [] } = useBranches();
  const defaultBranch = useDefaultBranch();
  const [branchId, setBranchId] = useState(cls?.branchId ?? '');
  const branch = branchId || defaultBranch;
  const [levelId, setLevelId] = useState(cls?.levelId ?? '');
  const [code, setCode] = useState(cls?.code ?? '');
  const [name, setName] = useState(cls?.name ?? '');
  const [teacherId, setTeacherId] = useState(cls?.teacherId ?? '');
  const [taId, setTaId] = useState(cls?.taId ?? '');
  const [roomId, setRoomId] = useState(cls?.roomId ?? '');
  const [capacity, setCapacity] = useState(cls?.capacity ?? 12);
  const [trialCapacity, setTrialCapacity] = useState(cls?.trialCapacity ?? 2);
  const [startDate, setStartDate] = useState(cls?.startDate ?? todayVN(7));
  const [totalSessions, setTotalSessions] = useState<number | ''>(cls?.totalSessions ?? '');
  const [schedule, setSchedule] = useState<Slot[]>(cls?.schedule ?? [{ weekday: 6, startTime: '09:00', minutes: 90 }]);
  const [note, setNote] = useState(cls?.note ?? '');
  const [error, setError] = useState<string | null>(null);

  const { data: subjects = [] } = useQuery({
    queryKey: [...lmsKeys.subjects, { includeInactive: false }],
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/subjects', { params: { query: { includeInactive: false } } }))).data,
  });
  const { data: teachers = [] } = useStaffOptions(TEACHER_ROLES, branch);
  const { data: tas = [] } = useStaffOptions(TA_ROLES, branch);
  const { data: rooms = [] } = useQuery({
    queryKey: [...lmsKeys.rooms, branch],
    enabled: !!branch,
    queryFn: async () => (await unwrap(api.GET('/api/v1/lms/rooms', { params: { query: { branchId: branch } } }))).data,
  });
  const level = subjects.flatMap((s) => s.levels).find((l) => l.id === levelId);

  const save = useMutation({
    mutationFn: async () => {
      const common = {
        code: code.trim(),
        name: name.trim(),
        teacherId,
        taId: taId || null,
        roomId: roomId || null,
        capacity,
        trialCapacity,
        startDate,
        schedule,
        totalSessions: totalSessions === '' ? undefined : totalSessions,
        note: note.trim() || null,
      };
      if (cls) {
        await unwrap(api.PATCH('/api/v1/lms/classes/{id}', { params: { path: { id: cls.id } }, body: common }));
        return cls.id;
      }
      return (await unwrap(api.POST('/api/v1/lms/classes', { body: { ...common, branchId: branch, levelId } }))).data.id;
    },
    onSuccess: (id) => {
      toast.success(cls ? 'Đã lưu lớp' : 'Đã tạo lớp — bấm “Sinh buổi học” để tạo lịch');
      teachingKeys.forEach((k) => void qc.invalidateQueries({ queryKey: k }));
      onSaved?.(id);
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? (err.errors?.[0] ? `${err.errors[0].path.replace('body.', '')}: ${err.errors[0].message}` : errorMessage(err)) : errorMessage(err)),
  });

  const problem = !cls && !levelId ? 'Chọn cấp độ' : code.trim().length < 2 ? 'Nhập mã lớp' : name.trim().length < 2 ? 'Nhập tên lớp' : !teacherId ? 'Chọn giáo viên' : !schedule.length ? 'Thêm lịch học' : null;
  const updateSlot = (i: number, patch: Partial<Slot>) => setSchedule((s) => s.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={cls ? `Sửa lớp ${cls.code}` : 'Tạo lớp học'}
      description={cls ? 'Đổi giáo viên / trợ giảng / phòng áp dụng cho các buổi chưa diễn ra.' : undefined}
      size="lg"
      footer={
        <>
          {problem && <span className="self-center text-sm text-muted-foreground sm:mr-auto">{problem}</span>}
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => (setError(null), save.mutate())} disabled={!!problem || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {error && (
          <Alert tone="danger" className="sm:col-span-2">
            {error}
          </Alert>
        )}
        {!cls && branchList.length > 1 && (
          <Field label="Chi nhánh" className="sm:col-span-2">
            <BranchSelect value={branch} onChange={(v) => (setBranchId(v), setTeacherId(''), setTaId(''), setRoomId(''))} className="w-full" />
          </Field>
        )}
        {!cls && (
          <Field label="Cấp độ" required className="sm:col-span-2" hint={level ? `${level.sessionsCount} buổi × ${level.sessionMinutes} phút` : undefined}>
            <Select
              value={levelId}
              onChange={(e) => {
                setLevelId(e.target.value);
                const lv = subjects.flatMap((s) => s.levels).find((l) => l.id === e.target.value);
                if (lv) setSchedule((s) => s.map((x) => ({ ...x, minutes: lv.sessionMinutes })));
              }}
            >
              <option value="">— Chọn cấp độ —</option>
              {subjects.map((s) => (
                <optgroup key={s.id} label={s.name}>
                  {s.levels
                    .filter((l) => l.isActive)
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Mã lớp" required hint="Ví dụ ROB1-2610A">
          <Input className="font-mono uppercase" value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        <Field label="Tên lớp" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Robotics 1 — Thứ 7 sáng" />
        </Field>
        <Field label="Giáo viên" required>
          <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">— Chọn giáo viên —</option>
            {cls && !teachers.some((t) => t.id === cls.teacherId) && <option value={cls.teacherId}>{cls.teacherName}</option>}
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Trợ giảng">
          <Select value={taId} onChange={(e) => setTaId(e.target.value)}>
            <option value="">— Không —</option>
            {tas
              .filter((t) => t.id !== teacherId)
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName} · {t.roleName}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Phòng">
          <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
            <option value="">— Chưa xếp —</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.capacity} chỗ)
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sĩ số tối đa">
            <Input type="number" min={1} max={50} value={capacity} onChange={(e) => setCapacity(Number(e.target.value) || 1)} />
          </Field>
          <Field label="Chỗ học thử / buổi">
            <Input type="number" min={0} max={10} value={trialCapacity} onChange={(e) => setTrialCapacity(Math.max(0, Number(e.target.value) || 0))} />
          </Field>
        </div>
        <Field label="Khai giảng" required>
          <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label="Tổng số buổi" hint={level ? `Để trống = ${level.sessionsCount} buổi của cấp độ` : 'Để trống = theo cấp độ'}>
          <Input type="number" min={1} max={200} value={totalSessions} onChange={(e) => setTotalSessions(e.target.value === '' ? '' : Number(e.target.value))} />
        </Field>

        <div className="sm:col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium">Lịch học hằng tuần</span>
            <Button size="sm" variant="ghost" onClick={() => setSchedule((s) => [...s, { weekday: 2, startTime: '18:00', minutes: level?.sessionMinutes ?? 90 }])} disabled={schedule.length >= 7}>
              <Plus /> Thêm buổi
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {schedule.map((slot, i) => (
              <li key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                <Select value={slot.weekday} onChange={(e) => updateSlot(i, { weekday: Number(e.target.value) })} aria-label="Thứ">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                    <option key={d} value={d}>
                      {d === 7 ? 'Chủ nhật' : `Thứ ${d + 1}`}
                    </option>
                  ))}
                </Select>
                <Input type="time" value={slot.startTime} onChange={(e) => updateSlot(i, { startTime: e.target.value })} aria-label="Giờ bắt đầu" />
                <div className="relative">
                  <Input type="number" min={30} max={300} step={15} value={slot.minutes} onChange={(e) => updateSlot(i, { minutes: Number(e.target.value) || 90 })} aria-label="Số phút" className="pr-10" />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">phút</span>
                </div>
                <Button variant="ghost" size="icon" aria-label="Xoá" onClick={() => setSchedule((s) => s.filter((_, j) => j !== i))} disabled={schedule.length <= 1}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-xs text-muted-foreground">
            {schedule
              .slice()
              .sort((a, b) => a.weekday - b.weekday)
              .map((s) => `${WEEKDAY_SHORT[s.weekday]} ${s.startTime}`)
              .join(' · ')}
            {cls && ' — đổi lịch tuần áp dụng khi sinh buổi mới; dời từng buổi ở lịch học.'}
          </p>
        </div>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
