import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Button, Dialog, Field, Input, Select, toast } from '@zero1/ui';
import { errorMessage, useApi } from '@zero1/web-core';
import { EnrollmentFields, emptyEnrollment, enrollmentBody, enrollmentProblem, type EnrollmentDraft } from '../enrollments/enrollment-fields';
import { crmKeys, GENDERS } from '../labels';

type Lead = Schemas['LeadDetail'];

/** Chuyển lead thành học viên + đăng ký đầu tiên. Phụ huynh lấy từ lead. */
export function ConvertDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [fullName, setFullName] = useState(lead.childName);
  const [birthDate, setBirthDate] = useState(lead.childBirthYear ? `${lead.childBirthYear}-01-01` : '');
  const [gender, setGender] = useState<'' | 'MALE' | 'FEMALE'>('');
  const [school, setSchool] = useState(lead.school ?? '');
  const [enrollment, setEnrollment] = useState<EnrollmentDraft>(emptyEnrollment);
  const [error, setError] = useState<string | null>(null);
  // Một lần mở dialog = một thao tác: gửi lại (mạng chập chờn) không tạo trùng.
  const [idemKey] = useState(() => crypto.randomUUID());
  // isPending chỉ đổi ở lần render sau — bấm đúp vẫn lọt nếu không chặn bằng ref.
  const submitting = useRef(false);

  const convert = useMutation({
    mutationFn: async () =>
      (
        await unwrap(
          api.POST('/api/v1/crm/leads/{id}/convert', {
            params: { path: { id: lead.id } },
            headers: { 'Idempotency-Key': idemKey },
            body: {
              student: { fullName: fullName.trim(), birthDate: birthDate || null, gender: gender || null, school: school.trim() || null },
              enrollment: enrollmentBody(enrollment),
            },
          }),
        )
      ).data,
    onSuccess: (res) => {
      toast.success('Đã tạo học viên và đăng ký — ghi khoản thu để kích hoạt');
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      void qc.invalidateQueries({ queryKey: crmKeys.students });
      navigate(`/enrollments/${res.enrollmentId}`);
    },
    onError: (err) => setError(err instanceof ApiError ? errorMessage(err) : 'Không chuyển đổi được'),
  });
  const problem = fullName.trim().length < 2 ? 'Nhập họ tên học viên' : enrollmentProblem(enrollment);

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Đăng ký học — ${lead.childName}`}
      description={`Phụ huynh: ${lead.parentName} · ${lead.parentPhone}`}
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
              setError(null);
              convert.mutate(undefined, { onSettled: () => (submitting.current = false) });
            }}
            disabled={!!problem || convert.isPending}
          >
            Tạo đăng ký
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alert tone="danger">{error}</Alert>}
        <section>
          <h3 className="mb-3 text-sm font-semibold">Học viên</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Họ tên" required>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
            <Field label="Ngày sinh">
              <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </Field>
            <Field label="Giới tính">
              <Select value={gender} onChange={(e) => setGender(e.target.value as typeof gender)}>
                <option value="">—</option>
                {Object.entries(GENDERS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Trường">
              <Input value={school} onChange={(e) => setSchool(e.target.value)} />
            </Field>
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold">Đăng ký</h3>
          <EnrollmentFields branchId={lead.branchId} value={enrollment} onChange={setEnrollment} />
        </section>
      </div>
    </Dialog>
  );
}
