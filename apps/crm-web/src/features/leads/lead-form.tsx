import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap, type Schemas } from '@zero1/api-client';
import { Alert, Badge, Button, Checkbox, Dialog, Field, Input, Select, Textarea, toast } from '@zero1/ui';
import { applyFieldErrors, BranchSelect, errorMessage, useApi, useBranches, useDefaultBranch, usePermission } from '@zero1/web-core';
import { crmKeys, LEAD_SOURCES, type LeadSource } from '../labels';
import { LeadStatusBadge } from './status';

type Lead = Schemas['Lead'];

const schema = z.object({
  parentName: z.string().trim().min(2, 'Tối thiểu 2 ký tự').max(150),
  parentPhone: z.string().trim().min(9, 'Số điện thoại không hợp lệ').max(20),
  parentEmail: z.union([z.literal(''), z.email('Email không hợp lệ')]),
  childName: z.string().trim().min(1, 'Nhập tên học sinh').max(150),
  childBirthYear: z.union([z.literal(''), z.coerce.number().int().min(2000, 'Từ 2000').max(2030)]),
  school: z.string().trim().max(200),
  interestSubjectId: z.string(),
  source: z.enum(Object.keys(LEAD_SOURCES) as [LeadSource, ...LeadSource[]]),
  notes: z.string().trim().max(2000),
});
type Form = z.output<typeof schema>;
const FIELDS = ['parentName', 'parentPhone', 'parentEmail', 'childName', 'childBirthYear', 'school', 'interestSubjectId', 'source', 'notes'] as const;

/** Thêm / sửa lead. Kiểm tra trùng số điện thoại ngay khi nhập xong. */
export function LeadFormDialog({ lead, onClose, onSaved }: { lead: Lead | null; onClose: () => void; onSaved?: (id: string) => void }) {
  const api = useApi();
  const qc = useQueryClient();
  const canAssign = usePermission('crm.leads.assign');
  const { data: branches = [] } = useBranches();
  const defaultBranch = useDefaultBranch();
  const [branchId, setBranchId] = useState('');
  const [force, setForce] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [phone, setPhone] = useState(lead?.parentPhone ?? '');

  const { data: subjects = [] } = useQuery({
    queryKey: ['crm', 'catalog', 'subjects'],
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/catalog/subjects'))).data,
    staleTime: 5 * 60_000,
  });
  const dup = useQuery({
    queryKey: ['crm', 'leads', 'check-phone', phone],
    enabled: !lead && phone.replace(/\D/g, '').length >= 9,
    queryFn: async () => (await unwrap(api.GET('/api/v1/crm/leads/check-phone', { params: { query: { phone } } }))).data,
    retry: false,
  });
  const duplicates = dup.data ? [...dup.data.leads.filter((l) => l.open), ...dup.data.students.map((s) => ({ ...s, student: true as const }))] : [];

  const form = useForm<z.input<typeof schema>, unknown, Form>({
    resolver: zodResolver(schema),
    defaultValues: {
      parentName: lead?.parentName ?? '',
      parentPhone: lead?.parentPhone ?? '',
      parentEmail: lead?.parentEmail ?? '',
      childName: lead?.childName ?? '',
      childBirthYear: lead?.childBirthYear ?? '',
      school: lead?.school ?? '',
      interestSubjectId: lead?.interestSubjectId ?? '',
      source: lead?.source ?? 'FACEBOOK',
      notes: lead?.notes ?? '',
    },
  });

  const save = useMutation({
    mutationFn: async (v: Form) => {
      const body = {
        ...v,
        parentEmail: v.parentEmail || null,
        childBirthYear: v.childBirthYear === '' ? null : v.childBirthYear,
        school: v.school || null,
        interestSubjectId: v.interestSubjectId || null,
        notes: v.notes || null,
      };
      if (lead) {
        await unwrap(api.PATCH('/api/v1/crm/leads/{id}', { params: { path: { id: lead.id } }, body, headers: { 'If-Match': String(lead.version) } }));
        return lead.id;
      }
      const created = await unwrap(api.POST('/api/v1/crm/leads', { body: { ...body, branchId: branchId || defaultBranch || undefined, force } }));
      return created.data.id;
    },
    onSuccess: (id) => {
      toast.success(lead ? 'Đã lưu' : 'Đã thêm khách hàng');
      void qc.invalidateQueries({ queryKey: crmKeys.leads });
      onSaved?.(id);
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'LEAD_DUPLICATE') setFormError(errorMessage(err));
      else if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') setFormError('Lead vừa được người khác sửa — đóng lại và mở lại để xem bản mới.');
      else if (!applyFieldErrors(err, form.setError, FIELDS)) setFormError(errorMessage(err));
    },
  });
  const submit = form.handleSubmit((v) => save.mutate(v));
  const e = form.formState.errors;
  const phoneField = form.register('parentPhone');

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={lead ? `Sửa — ${lead.childName}` : 'Thêm khách hàng tiềm năng'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            Lưu
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {formError && (
          <Alert tone="danger" className="sm:col-span-2">
            {formError}
          </Alert>
        )}
        <Field label="Số điện thoại phụ huynh" required error={e.parentPhone?.message}>
          <Input inputMode="tel" placeholder="0912 345 678" {...phoneField} onBlur={(ev) => (void phoneField.onBlur(ev), setPhone(ev.target.value))} />
        </Field>
        <Field label="Tên phụ huynh" required error={e.parentName?.message}>
          <Input {...form.register('parentName')} />
        </Field>
        {duplicates.length > 0 && (
          <Alert tone="warning" className="sm:col-span-2" title="Số điện thoại đã có trong hệ thống">
            <ul className="mt-1 flex flex-col gap-1">
              {duplicates.map((d, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  {'student' in d ? (
                    <>
                      <Badge tone="success">Học viên</Badge> {d.fullName} ({d.code})
                    </>
                  ) : (
                    <>
                      <LeadStatusBadge status={d.status} /> {d.childName}
                      {d.ownerName && <span className="text-muted-foreground">· {d.ownerName}</span>}
                    </>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-1.5">Cùng một bé thì không tạo lại. Anh / chị em của bé: {canAssign ? 'tích “Vẫn tạo” bên dưới.' : 'nhờ trưởng nhóm / CM tạo.'}</p>
          </Alert>
        )}
        <Field label="Tên học sinh" required error={e.childName?.message}>
          <Input {...form.register('childName')} />
        </Field>
        <Field label="Năm sinh" error={e.childBirthYear?.message}>
          <Input type="number" inputMode="numeric" placeholder="2017" {...form.register('childBirthYear')} />
        </Field>
        <Field label="Nguồn" required error={e.source?.message}>
          <Select {...form.register('source')}>
            {Object.entries(LEAD_SOURCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Môn quan tâm">
          <Select {...form.register('interestSubjectId')}>
            <option value="">— Chưa rõ —</option>
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Email phụ huynh" error={e.parentEmail?.message}>
          <Input type="email" {...form.register('parentEmail')} />
        </Field>
        <Field label="Trường" error={e.school?.message}>
          <Input {...form.register('school')} />
        </Field>
        {!lead && branches.length > 1 && (
          <Field label="Chi nhánh" className="sm:col-span-2">
            <BranchSelect value={branchId || defaultBranch} onChange={setBranchId} className="w-full" />
          </Field>
        )}
        <Field label="Ghi chú" className="sm:col-span-2" error={e.notes?.message}>
          <Textarea rows={2} {...form.register('notes')} />
        </Field>
        {!lead && canAssign && duplicates.length > 0 && (
          <Checkbox className="sm:col-span-2" label="Vẫn tạo (anh / chị em của học sinh đã có)" checked={force} onCheckedChange={setForce} />
        )}
      </form>
    </Dialog>
  );
}
