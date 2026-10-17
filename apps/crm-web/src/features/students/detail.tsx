import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Copy, FileText, KeyRound, Pencil, Plus, RefreshCcw, Trash2, Upload, UserCog } from 'lucide-react';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import {
  Alert,
  BackLink,
  Badge,
  Button,
  Card,
  CardContent,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  DropdownMenu,
  Field,
  InfoList,
  Input,
  Select,
  Spinner,
  Stat,
  Tabs,
  Textarea,
  toast,
  type Column,
} from '@zero1/ui';
import { errorMessage, fileUrl, formatBytes, formatDate, formatDateTime, formatMoney, toastError, todayVN, useApi, usePermission, useStaffOptions } from '@zero1/web-core';
import { EnrollmentFields, emptyEnrollment, enrollmentBody, enrollmentProblem, type EnrollmentDraft } from '../enrollments/enrollment-fields';
import { crmKeys, ENROLLMENT_STATUS, GENDERS, OWNER_ROLES, PAYMENT_STATE, STUDENT_STATUS } from '../labels';
import { StudentAvatar } from './student-avatar';

type Student = Schemas['StudentDetail'];
type Enrollment = Schemas['Enrollment'];

export default function StudentDetailPage() {
  const { id = '' } = useParams();
  const api = useApi();
  const qc = useQueryClient();
  const canWrite = usePermission('crm.students.write');
  const canStatus = usePermission('crm.students.status');
  const canEnroll = usePermission('crm.enrollments.create');
  const [searchParams] = useSearchParams();
  // Từ trang Tái phí (?renew=1) → mở luôn form đăng ký.
  const [dialog, setDialog] = useState<'edit' | 'status' | 'assign' | 'enroll' | null>(() => (searchParams.get('renew') ? 'enroll' : null));
  const avatarInput = useRef<HTMLInputElement>(null);

  const { data: s, error } = useQuery({
    queryKey: crmKeys.student(id),
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/students/{id}', { params: { path: { id } } }))).data,
  });
  const { data: enrollments } = useQuery({
    queryKey: [...crmKeys.enrollments, 'student', id],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/enrollments', { params: { query: { studentId: id, pageSize: 100, page: 1 } } }))).data,
  });
  const avatar = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return unwrap(api.POST('/api/v1/crm/students/{id}/avatar', { params: { path: { id } }, body: fd as never }));
    },
    onSuccess: () => {
      toast.success('Đã đổi ảnh');
      void qc.invalidateQueries({ queryKey: crmKeys.students });
    },
    onError: toastError,
  });

  if (error) return <Alert tone="danger">Không tìm thấy học viên hoặc bạn không có quyền xem.</Alert>;
  if (!s) return <Spinner label="Đang tải…" />;

  const active = (enrollments ?? []).filter((e) => e.status === 'ACTIVE' || e.status === 'AWAITING_PAYMENT');
  const remaining = (enrollments ?? []).filter((e) => e.status === 'ACTIVE').reduce((n, e) => n + e.sessionsRemaining, 0);
  const debt = active.reduce((n, e) => n + Math.max(0, e.balance), 0);

  return (
    <>
      <BackLink to="/students" label="Học viên" />
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="relative">
            <StudentAvatar name={s.fullName} url={s.avatarUrl} size="lg" />
            {canWrite && (
              <>
                <button
                  type="button"
                  onClick={() => avatarInput.current?.click()}
                  className="absolute -right-1 -bottom-1 rounded-full border border-border bg-surface p-1.5 text-muted-foreground shadow-card hover:text-foreground"
                  aria-label="Đổi ảnh"
                >
                  <Camera className="size-3.5" />
                </button>
                <input
                  ref={avatarInput}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) avatar.mutate(f);
                    e.target.value = '';
                  }}
                />
              </>
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{s.fullName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono">{s.code}</span>
              <Badge tone={STUDENT_STATUS[s.status].tone}>{STUDENT_STATUS[s.status].label}</Badge>
              {s.branchName && <span>· {s.branchName}</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEnroll && s.status !== 'STOPPED' && (
            <Button onClick={() => setDialog('enroll')}>
              <RefreshCcw /> {enrollments?.length ? 'Tái phí / đăng ký thêm' : 'Đăng ký'}
            </Button>
          )}
          {(canStatus || canWrite) && (
            <DropdownMenu
              trigger={
                <Button variant="outline">
                  <UserCog /> Thao tác
                </Button>
              }
              actions={[
                ...(canWrite ? [{ label: 'Sửa hồ sơ', icon: Pencil, onSelect: () => setDialog('edit') }] : []),
                ...(canStatus && s.status !== 'PENDING' ? [{ label: 'Đổi trạng thái học', icon: RefreshCcw, onSelect: () => setDialog('status') }] : []),
                ...(canStatus ? [{ label: 'Đổi sale / CS phụ trách', icon: UserCog, onSelect: () => setDialog('assign') }] : []),
              ]}
            />
          )}
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Lớp hiện tại" value={<span className="text-base">{s.currentClassName ?? 'Chưa xếp lớp'}</span>} hint={s.currentLevelName ?? undefined} />
        <Stat label="Buổi còn lại" value={remaining} tone={remaining <= 4 && s.status === 'ACTIVE' ? 'warning' : 'default'} hint="Các đăng ký đang hiệu lực" />
        <Stat label="Còn phải thu" value={formatMoney(debt)} tone={debt > 0 ? 'danger' : 'success'} />
        <Stat label="Đăng ký" value={enrollments?.length ?? '—'} hint={`${active.length} đang hiệu lực / chờ thu`} />
      </div>

      <Tabs
        tabs={[
          { value: 'enrollments', label: 'Đăng ký & học phí', content: <EnrollmentsTab rows={enrollments} /> },
          { value: 'profile', label: 'Hồ sơ & phụ huynh', content: <ProfileTab s={s} canWrite={canWrite} /> },
          { value: 'documents', label: `Giấy tờ (${s.documents.length})`, content: <DocumentsTab s={s} canWrite={canWrite} /> },
          { value: 'history', label: 'Lịch sử trạng thái', content: <HistoryTab s={s} /> },
        ]}
      />

      {dialog === 'edit' && <ProfileDialog s={s} onClose={() => setDialog(null)} />}
      {dialog === 'status' && <StatusDialog s={s} onClose={() => setDialog(null)} />}
      {dialog === 'assign' && <AssignDialog s={s} onClose={() => setDialog(null)} />}
      {dialog === 'enroll' && <EnrollDialog s={s} onClose={() => setDialog(null)} />}
    </>
  );
}

function EnrollmentsTab({ rows }: { rows: Enrollment[] | undefined }) {
  const navigate = useNavigate();
  const columns: Column<Enrollment>[] = [
    {
      key: 'code',
      header: 'Đăng ký',
      cell: (e) => (
        <div>
          <div className="font-medium">{e.packageName}</div>
          <div className="font-mono text-xs text-muted-foreground">
            {e.code} · {e.type === 'RENEWAL' ? 'Tái phí' : 'Mới'}
          </div>
        </div>
      ),
    },
    { key: 'status', header: 'Trạng thái', cell: (e) => <Badge tone={ENROLLMENT_STATUS[e.status].tone}>{ENROLLMENT_STATUS[e.status].label}</Badge> },
    {
      key: 'sessions',
      header: 'Buổi',
      align: 'right',
      cell: (e) => (
        <span className="tabular-nums">
          {e.sessionsUsed}/{e.sessionsPurchased}
          <span className="block text-xs text-muted-foreground">còn {e.sessionsRemaining}</span>
        </span>
      ),
    },
    {
      key: 'money',
      header: 'Học phí',
      align: 'right',
      cell: (e) => (
        <div className="tabular-nums">
          <div>{formatMoney(e.amountDue)}</div>
          <Badge tone={PAYMENT_STATE[e.paymentState].tone}>{PAYMENT_STATE[e.paymentState].label}</Badge>
        </div>
      ),
    },
    { key: 'dates', header: 'Hiệu lực', className: 'hidden md:table-cell', cell: (e) => `${formatDate(e.startDate)} – ${formatDate(e.endDate)}` },
  ];
  return <DataTable columns={columns} rows={rows} rowKey={(e) => e.id} loading={!rows} onRowClick={(e) => navigate(`/enrollments/${e.id}`)} empty="Chưa có đăng ký" />;
}

const PARENT_STATUS = {
  PENDING: { label: 'Đã cấp mã, chưa kích hoạt', tone: 'warning' },
  ACTIVE: { label: 'Đang dùng tài khoản', tone: 'success' },
  LOCKED: { label: 'Tài khoản bị khoá', tone: 'danger' },
} as const;

function ProfileTab({ s, canWrite }: { s: Student; canWrite: boolean }) {
  const [editing, setEditing] = useState(false);
  const [granting, setGranting] = useState<Student['guardians'][number] | null>(null);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardContent className="pt-5">
          <InfoList
            items={[
              { label: 'Ngày sinh', value: formatDate(s.birthDate) },
              { label: 'Giới tính', value: s.gender ? GENDERS[s.gender] : null },
              { label: 'Trường', value: s.school },
              { label: 'Địa chỉ', value: s.address },
              { label: 'Sale phụ trách', value: s.ownerName },
              { label: 'CS chăm sóc', value: s.careName },
              { label: 'Ngày tạo', value: formatDateTime(s.createdAt) },
              { label: 'Ghi chú', value: s.notes },
            ]}
          />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Phụ huynh</h3>
            {canWrite && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil /> Sửa
              </Button>
            )}
          </div>
          <ul className="flex flex-col divide-y divide-border">
            {s.guardians.map((g) => (
              <li key={g.id} className="py-2.5 text-sm first:pt-0">
                <div className="flex items-center gap-2 font-medium">
                  {g.fullName}
                  <span className="font-normal text-muted-foreground">({g.relation})</span>
                  {g.isPrimary && <Badge tone="brand">Liên hệ chính</Badge>}
                </div>
                <div className="text-muted-foreground">
                  <a href={`tel:${g.phone}`} className="text-info hover:underline">
                    {g.phone}
                  </a>
                  {g.email && ` · ${g.email}`}
                  {g.job && ` · ${g.job}`}
                </div>
                {(() => {
                  const acc = s.parentAccounts.find((a) => a.phone === g.phone);
                  return (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {acc ? (
                        <Badge tone={PARENT_STATUS[acc.status].tone}>
                          {PARENT_STATUS[acc.status].label}
                          {acc.status === 'ACTIVE' && acc.lastLoginAt && ` · ${formatDateTime(acc.lastLoginAt)}`}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Chưa có tài khoản phụ huynh</span>
                      )}
                      {canWrite && acc?.status !== 'LOCKED' && (
                        <Button size="sm" variant="ghost" onClick={() => setGranting(g)}>
                          <KeyRound /> {acc ? (acc.status === 'ACTIVE' ? 'Cấp mã đặt lại mật khẩu' : 'Cấp lại mã') : 'Cấp tài khoản phụ huynh'}
                        </Button>
                      )}
                    </div>
                  );
                })()}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      {editing && <GuardiansDialog s={s} onClose={() => setEditing(false)} />}
      {granting && <ParentAccessDialog studentId={s.id} guardian={granting} onClose={() => setGranting(null)} />}
    </div>
  );
}

/** Cấp mã kích hoạt cho phụ huynh — CS gửi qua Zalo, phụ huynh đăng nhập bằng SĐT + mã. */
function ParentAccessDialog({ studentId, guardian, onClose }: { studentId: string; guardian: Student['guardians'][number]; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const issue = useMutation({
    mutationFn: async () => (await unwrap(api.POST('/api/v1/crm/students/{id}/parent-access', { params: { path: { id: studentId } }, body: { guardianId: guardian.id } }))).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: crmKeys.student(studentId) }),
    onError: toastError,
  });
  const r = issue.data;
  const message = r
    ? `Zero1 gửi anh/chị ${r.fullName} mã kích hoạt tài khoản phụ huynh: ${r.code} (hiệu lực đến ${formatDateTime(r.expiresAt)}). ` +
      `Anh/chị đăng nhập ứng dụng phụ huynh bằng số điện thoại ${r.phone} và mã này để đặt mật khẩu, xem lịch học, điểm danh, nhận xét và học phí của con.`
    : '';
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Tài khoản phụ huynh"
      description={`${guardian.fullName} · ${guardian.phone}`}
      footer={
        r ? (
          <Button onClick={onClose}>Xong</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Huỷ
            </Button>
            <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
              <KeyRound /> Cấp mã
            </Button>
          </>
        )
      }
    >
      {!r ? (
        <p className="text-sm">
          Hệ thống sinh mã 6 số (hiệu lực 7 ngày). Phụ huynh dùng số điện thoại {guardian.phone} và mã để kích hoạt, tự đặt mật khẩu. Mọi học viên có phụ huynh mang số này đều hiện
          trong tài khoản. Cấp mã mới làm mã cũ hết hiệu lực.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-center rounded-lg border border-border bg-muted py-4 font-mono text-3xl font-semibold tracking-[0.4em] select-all">{r.code}</div>
          <p className="text-sm text-muted-foreground">
            {r.children} học viên gắn với số này · hết hạn {formatDateTime(r.expiresAt)}
          </p>
          <Field label="Tin nhắn gửi phụ huynh (Zalo)">
            <Textarea rows={4} readOnly value={message} />
          </Field>
          <Button
            variant="outline"
            className="self-start"
            onClick={() =>
              navigator.clipboard.writeText(message).then(
                () => toast.success('Đã sao chép tin nhắn'),
                () => toast.error('Không sao chép được — hãy bôi đen và sao chép tay'),
              )
            }
          >
            <Copy /> Sao chép tin nhắn
          </Button>
        </div>
      )}
    </Dialog>
  );
}

function DocumentsTab({ s, canWrite }: { s: Student; canWrite: boolean }) {
  const api = useApi();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return unwrap(api.POST('/api/v1/crm/students/{id}/documents', { params: { path: { id: s.id } }, body: fd as never }));
    },
    onSuccess: () => {
      toast.success('Đã tải lên');
      void qc.invalidateQueries({ queryKey: crmKeys.student(s.id) });
    },
    onError: toastError,
  });
  const remove = useMutation({
    mutationFn: async (documentId: string) => unwrap(api.DELETE('/api/v1/crm/students/{id}/documents/{documentId}', { params: { path: { id: s.id, documentId } } })),
    onSuccess: () => {
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: crmKeys.student(s.id) });
    },
    onError: toastError,
  });
  return (
    <Card>
      <CardContent className="pt-5">
        {canWrite && (
          <div className="mb-4">
            <Button variant="outline" onClick={() => input.current?.click()} disabled={upload.isPending}>
              <Upload /> Tải giấy tờ lên
            </Button>
            <span className="ml-3 text-xs text-muted-foreground">Ảnh, PDF, Word — tối đa 10 MB</span>
            <input
              ref={input}
              type="file"
              hidden
              accept="image/*,.pdf,.doc,.docx"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) upload.mutate(f);
                e.target.value = '';
              }}
            />
          </div>
        )}
        {!s.documents.length ? (
          <p className="text-sm text-muted-foreground">Chưa có giấy tờ.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {s.documents.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <a href={fileUrl(d.url)} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-2 text-sm hover:underline">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{d.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatBytes(d.size)} · {formatDate(d.createdAt)}
                  </span>
                </a>
                {canWrite && (
                  <Button variant="ghost" size="icon" aria-label={`Xoá ${d.name}`} onClick={() => setRemoving(d.id)}>
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Xoá giấy tờ?"
        confirmLabel="Xoá"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </Card>
  );
}

function HistoryTab({ s }: { s: Student }) {
  if (!s.statusLogs.length) return <p className="text-sm text-muted-foreground">Chưa có thay đổi trạng thái.</p>;
  return (
    <Card>
      <CardContent className="pt-5">
        <ol className="flex flex-col gap-3">
          {s.statusLogs.map((l) => (
            <li key={l.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={STUDENT_STATUS[l.fromStatus as keyof typeof STUDENT_STATUS]?.tone}>{STUDENT_STATUS[l.fromStatus as keyof typeof STUDENT_STATUS]?.label ?? l.fromStatus}</Badge>→
                <Badge tone={STUDENT_STATUS[l.toStatus as keyof typeof STUDENT_STATUS]?.tone}>{STUDENT_STATUS[l.toStatus as keyof typeof STUDENT_STATUS]?.label ?? l.toStatus}</Badge>
                <span className="text-muted-foreground">
                  từ {formatDate(l.effectiveDate)} · {l.actorName ?? 'Hệ thống'} · {formatDateTime(l.createdAt)}
                </span>
              </div>
              {l.reason && <p className="mt-0.5">{l.reason}</p>}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ProfileDialog({ s, onClose }: { s: Student; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [v, setV] = useState({
    fullName: s.fullName,
    birthDate: s.birthDate ?? '',
    gender: (s.gender ?? '') as '' | 'MALE' | 'FEMALE',
    school: s.school ?? '',
    address: s.address ?? '',
    notes: s.notes ?? '',
  });
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        api.PATCH('/api/v1/crm/students/{id}', {
          params: { path: { id: s.id } },
          headers: { 'If-Match': String(s.version) },
          body: {
            fullName: v.fullName.trim(),
            birthDate: v.birthDate || null,
            gender: v.gender || null,
            school: v.school.trim() || null,
            address: v.address.trim() || null,
            notes: v.notes.trim() || null,
          },
        }),
      ),
    onSuccess: () => {
      toast.success('Đã lưu hồ sơ');
      void qc.invalidateQueries({ queryKey: crmKeys.students });
      onClose();
    },
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Sửa hồ sơ học viên"
      description="Tên, ngày sinh, ảnh được đồng bộ sang LMS."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={v.fullName.trim().length < 2 || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Họ tên" required className="sm:col-span-2">
          <Input value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
        </Field>
        <Field label="Ngày sinh">
          <Input type="date" value={v.birthDate} onChange={(e) => setV({ ...v, birthDate: e.target.value })} />
        </Field>
        <Field label="Giới tính">
          <Select value={v.gender} onChange={(e) => setV({ ...v, gender: e.target.value as typeof v.gender })}>
            <option value="">—</option>
            <option value="MALE">Nam</option>
            <option value="FEMALE">Nữ</option>
          </Select>
        </Field>
        <Field label="Trường">
          <Input value={v.school} onChange={(e) => setV({ ...v, school: e.target.value })} />
        </Field>
        <Field label="Địa chỉ">
          <Input value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
      </div>
    </Dialog>
  );
}

type GuardianDraft = { fullName: string; relation: string; phone: string; email: string; job: string; isPrimary: boolean };

function GuardiansDialog({ s, onClose }: { s: Student; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const [list, setList] = useState<GuardianDraft[]>(
    s.guardians.map((g) => ({ fullName: g.fullName, relation: g.relation, phone: g.phone, email: g.email ?? '', job: g.job ?? '', isPrimary: g.isPrimary })),
  );
  const [error, setError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async () =>
      unwrap(
        api.POST('/api/v1/crm/students/{id}/guardians', {
          params: { path: { id: s.id } },
          body: { guardians: list.map((g) => ({ ...g, email: g.email.trim() || null, job: g.job.trim() || null })) },
        }),
      ),
    onSuccess: () => {
      toast.success('Đã lưu phụ huynh');
      void qc.invalidateQueries({ queryKey: crmKeys.student(s.id) });
      onClose();
    },
    onError: (err) => setError(err instanceof ApiError ? (err.errors?.[0]?.message ?? errorMessage(err)) : errorMessage(err)),
  });
  const update = (i: number, patch: Partial<GuardianDraft>) =>
    setList((l) => l.map((g, j) => (j === i ? { ...g, ...patch } : patch.isPrimary ? { ...g, isPrimary: false } : g)));

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Phụ huynh"
      description="Liên hệ chính nhận thông báo (giai đoạn sau)."
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={!list.length || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger">{error}</Alert>}
        {list.map((g, i) => (
          <div key={i} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
            <Field label="Họ tên" required>
              <Input value={g.fullName} onChange={(e) => update(i, { fullName: e.target.value })} />
            </Field>
            <Field label="Quan hệ" required>
              <Input value={g.relation} onChange={(e) => update(i, { relation: e.target.value })} placeholder="Mẹ, Bố…" />
            </Field>
            <Field label="Số điện thoại" required>
              <Input inputMode="tel" value={g.phone} onChange={(e) => update(i, { phone: e.target.value })} />
            </Field>
            <Field label="Email">
              <Input type="email" value={g.email} onChange={(e) => update(i, { email: e.target.value })} />
            </Field>
            <Field label="Nghề nghiệp">
              <Input value={g.job} onChange={(e) => update(i, { job: e.target.value })} />
            </Field>
            <div className="flex items-end justify-between gap-2">
              <Checkbox label="Liên hệ chính" checked={g.isPrimary} onCheckedChange={(v) => v && update(i, { isPrimary: true })} />
              {list.length > 1 && (
                <Button variant="ghost" size="icon" aria-label="Xoá phụ huynh" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                  <Trash2 />
                </Button>
              )}
            </div>
          </div>
        ))}
        {list.length < 5 && (
          <Button
            variant="outline"
            className="self-start"
            onClick={() => setList((l) => [...l, { fullName: '', relation: '', phone: '', email: '', job: '', isPrimary: !l.length }])}
          >
            <Plus /> Thêm phụ huynh
          </Button>
        )}
      </div>
    </Dialog>
  );
}

function StatusDialog({ s, onClose }: { s: Student; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const options = (['ACTIVE', 'PAUSED', 'STOPPED'] as const).filter((x) => x !== s.status);
  const [status, setStatus] = useState<(typeof options)[number]>(options[0]!);
  const [reason, setReason] = useState('');
  const [date, setDate] = useState(() => todayVN());
  const save = useMutation({
    mutationFn: async () =>
      unwrap(api.POST('/api/v1/crm/students/{id}/status', { params: { path: { id: s.id } }, body: { status, reason: reason.trim() || null, effectiveDate: date } })),
    onSuccess: () => {
      toast.success('Đã đổi trạng thái — LMS cập nhật lớp học');
      void qc.invalidateQueries({ queryKey: crmKeys.students });
      onClose();
    },
    onError: toastError,
  });
  const needReason = status !== 'ACTIVE';
  const hints = { ACTIVE: 'Học viên trở lại lớp đang tạm dừng.', PAUSED: 'Tạm dừng trong lớp, giữ chỗ và số buổi.', STOPPED: 'Rời lớp. Số buổi còn lại giữ nguyên để xử lý hoàn phí.' };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Đổi trạng thái học"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={(needReason && reason.trim().length < 3) || save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Trạng thái mới" hint={hints[status]}>
          <Select value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {STUDENT_STATUS[o].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Từ ngày">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Lý do" required={needReason}>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}

function AssignDialog({ s, onClose }: { s: Student; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const { data: staff = [] } = useStaffOptions(OWNER_ROLES, s.branchId);
  const [ownerId, setOwnerId] = useState(s.ownerId ?? '');
  const [careId, setCareId] = useState(s.careId ?? '');
  const save = useMutation({
    mutationFn: async () => unwrap(api.POST('/api/v1/crm/students/{id}/assign', { params: { path: { id: s.id } }, body: { ownerId: ownerId || null, careId: careId || null } })),
    onSuccess: () => {
      toast.success('Đã đổi người phụ trách');
      void qc.invalidateQueries({ queryKey: crmKeys.students });
      onClose();
    },
    onError: toastError,
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Người phụ trách"
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Sale">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">— Không —</option>
            {staff.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} · {u.roleName}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="CS chăm sóc">
          <Select value={careId} onChange={(e) => setCareId(e.target.value)}>
            <option value="">— Không —</option>
            {staff
              .filter((u) => u.role === 'CS' || u.role === 'CM')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} · {u.roleName}
                </option>
              ))}
          </Select>
        </Field>
      </div>
    </Dialog>
  );
}

function EnrollDialog({ s, onClose }: { s: Student; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<EnrollmentDraft>(emptyEnrollment);
  const [idemKey] = useState(() => crypto.randomUUID());
  const submitting = useRef(false);
  const create = useMutation({
    mutationFn: async () =>
      (
        await unwrap(
          api.POST('/api/v1/crm/students/{id}/enrollments', { params: { path: { id: s.id } }, headers: { 'Idempotency-Key': idemKey }, body: enrollmentBody(draft) }),
        )
      ).data,
    onSuccess: (res) => {
      toast.success('Đã tạo đăng ký');
      void qc.invalidateQueries({ queryKey: crmKeys.enrollments });
      navigate(`/enrollments/${res.enrollmentId}`);
    },
    onError: toastError,
  });
  const problem = enrollmentProblem(draft);
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Đăng ký — ${s.fullName}`}
      size="lg"
      footer={
        <>
          {problem && <span className="self-center text-sm text-muted-foreground sm:mr-auto">{problem}</span>}
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button
            onClick={() => {
              if (submitting.current) return;
              submitting.current = true;
              create.mutate(undefined, { onSettled: () => (submitting.current = false) });
            }}
            disabled={!!problem || create.isPending}
          >
            Tạo đăng ký
          </Button>
        </>
      }
    >
      <EnrollmentFields branchId={s.branchId} value={draft} onChange={setDraft} />
      <p className="mt-4 text-xs text-muted-foreground">
        Xem các đăng ký cũ ở tab “Đăng ký & học phí” hoặc <Link to="/enrollments" className="underline">danh sách đăng ký</Link>.
      </p>
    </Dialog>
  );
}
