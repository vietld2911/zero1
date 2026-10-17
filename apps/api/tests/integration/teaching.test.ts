import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { classLearners, outboxEvents } from '../../src/contexts/lms/db/schema.js';
import { createTestApp, type TestApp } from './harness.js';

type U = Awaited<ReturnType<TestApp['makeUser']>>;

let t: TestApp;
let b1: string;
let cm: U, cs: U, sale: U, tl: U, teacher: U, teacher2: U, ta: U;
let subjectId: string, level1: string, level2: string, pkgId: string;

const admin = () => t.as(t.adminToken);
const idem = () => randomUUID();
const DAY = 86_400_000;
/** Ngày VN dạng YYYY-MM-DD, lệch `offset` ngày so với hôm nay. */
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3_600_000 + offset * DAY).toISOString().slice(0, 10);

async function lmsOutboxTypes(aggregateId: string) {
  return (await t.lmsDb.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, aggregateId))).map((e) => e.type);
}

/** Lead → học viên + đăng ký → CS thu tiền (kích hoạt) → LMS nhận học viên. */
async function enrolledStudent(childName: string, phone: string) {
  const leadId = (await t.as(sale.token).post('/api/v1/crm/leads', { parentName: 'Phụ huynh', parentPhone: phone, childName, source: 'REFERRAL' })).body.data.id;
  const conv = await t.as(sale.token)
    .post(`/api/v1/crm/leads/${leadId}/convert`, {
      student: { fullName: childName, birthDate: '2016-01-01', gender: 'FEMALE' },
      enrollment: { packageId: pkgId, startLevelId: level1, scholarshipMonths: 0 },
    })
    .set('Idempotency-Key', idem());
  if (conv.status !== 201) throw new Error(JSON.stringify(conv.body));
  const { studentId, enrollmentId } = conv.body.data as { studentId: string; enrollmentId: string };
  await t.as(cs.token).post(`/api/v1/crm/enrollments/${enrollmentId}/payments`, { amount: 2_000_000, method: 'CASH' }).set('Idempotency-Key', idem());
  await t.drainEvents();
  return { studentId, enrollmentId };
}

beforeAll(async () => {
  t = await createTestApp();
  b1 = await t.makeBranch('T1');
  cm = await t.makeUser({ email: 'cm@test.local', role: 'CM', branchIds: [b1] });
  cs = await t.makeUser({ email: 'cs@test.local', role: 'CS', branchIds: [b1], managerId: cm.id });
  const sl = await t.makeUser({ email: 'sl@test.local', role: 'SL', branchIds: [b1], managerId: cm.id });
  sale = await t.makeUser({ email: 'sale@test.local', role: 'SALE', branchIds: [b1], managerId: sl.id });
  tl = await t.makeUser({ email: 'tl@test.local', role: 'TL', branchIds: [b1] });
  teacher = await t.makeUser({ email: 'gv@test.local', fullName: 'Cô Lan', role: 'TEACHER', branchIds: [b1] });
  teacher2 = await t.makeUser({ email: 'gv2@test.local', fullName: 'Thầy Minh', role: 'TEACHER', branchIds: [b1] });
  ta = await t.makeUser({ email: 'ta@test.local', role: 'TA', branchIds: [b1] });

  subjectId = (await admin().post('/api/v1/lms/subjects', { code: 'ART', name: 'Mỹ thuật' })).body.data.id;
  level1 = (await admin().post(`/api/v1/lms/subjects/${subjectId}/levels`, { code: 'ART1', name: 'Mỹ thuật 1', sessionsCount: 10 })).body.data.id;
  level2 = (await admin().post(`/api/v1/lms/subjects/${subjectId}/levels`, { code: 'ART2', name: 'Mỹ thuật 2', sessionsCount: 10 })).body.data.id;
  await t.drainEvents();
  pkgId = (await admin().post('/api/v1/crm/packages', { code: 'A3', name: 'Mỹ thuật 3 tháng', subjectId, months: 3, sessionsCount: 24, basePrice: 6_000_000 })).body.data.id;
});
afterAll(() => t?.close());

describe('lớp học và buổi học', () => {
  let classId: string, roomId: string;
  let hv1: { studentId: string; enrollmentId: string }, hv2: { studentId: string; enrollmentId: string };
  let pastSession: string, futureSession: string;

  it('khoản thu đầu tiên bên CRM → học viên xuất hiện ở danh sách chờ xếp lớp', async () => {
    hv1 = await enrolledStudent('Nguyễn Bảo Anh', '0901000001');
    hv2 = await enrolledStudent('Lê Thu Hà', '0901000002');
    const waiting = (await t.as(cs.token).get('/api/v1/lms/placement')).body.data;
    expect(waiting.map((w: { learnerId: string }) => w.learnerId).sort()).toEqual([hv1.studentId, hv2.studentId].sort());
    expect(waiting[0]).toMatchObject({ subjectName: 'Mỹ thuật', startLevelName: 'Mỹ thuật 1', sessionsRemaining: 24 });
    expect((await t.as(teacher.token).get('/api/v1/lms/placement')).status).toBe(403);
  });

  it('phòng học: tên không trùng trong chi nhánh', async () => {
    const res = await t.as(tl.token).post('/api/v1/lms/rooms', { branchId: b1, name: 'P101', capacity: 12 });
    expect(res.status).toBe(201);
    roomId = res.body.data.id;
    expect((await t.as(cm.token).post('/api/v1/lms/rooms', { branchId: b1, name: 'P101', capacity: 8 })).body.code).toBe('ROOM_NAME_TAKEN');
  });

  it('tạo lớp: GV phải là giáo viên của chi nhánh; số buổi lấy theo cấp độ', async () => {
    const body = {
      code: 'art1-a',
      name: 'Mỹ thuật 1 — A',
      branchId: b1,
      levelId: level1,
      teacherId: sale.id,
      taId: ta.id,
      roomId,
      capacity: 2,
      startDate: vnDate(-3),
      // Học mỗi ngày để có cả buổi đã qua và buổi sắp tới
      schedule: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: '08:00', minutes: 90 })),
    };
    expect((await t.as(tl.token).post('/api/v1/lms/classes', body)).body.code).toBe('STAFF_INVALID');
    const res = await t.as(tl.token).post('/api/v1/lms/classes', { ...body, teacherId: teacher.id });
    expect(res.status).toBe(201);
    classId = res.body.data.id;
    const c = (await t.as(tl.token).get(`/api/v1/lms/classes/${classId}`)).body.data;
    expect(c).toMatchObject({ code: 'ART1-A', totalSessions: 10, status: 'PLANNED', teacherName: 'Cô Lan', learnerCount: 0, sessions: [] });
    expect((await t.as(teacher.token).post('/api/v1/lms/classes', { ...body, code: 'X1', teacherId: teacher.id })).status).toBe(403);
  });

  it('sinh buổi theo lịch tuần, không sinh thừa', async () => {
    const res = await t.as(tl.token).post(`/api/v1/lms/classes/${classId}/generate-sessions`, {});
    expect(res.body.data).toMatchObject({ created: 10, warnings: [] });
    expect((await t.as(tl.token).post(`/api/v1/lms/classes/${classId}/generate-sessions`, {})).body.data.created).toBe(0);
    const c = (await t.as(tl.token).get(`/api/v1/lms/classes/${classId}`)).body.data;
    expect(c.sessions.map((s: { indexNo: number }) => s.indexNo)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(c.sessions[0].startsAt).toBe(`${vnDate(-3)}T08:00:00.000+07:00`);
    // Buổi tới = buổi sớm nhất chưa kết thúc, đúng giờ (không lệch múi giờ)
    expect(c.nextSessionAt).toBe(c.sessions.find((s: { endsAt: string }) => new Date(s.endsAt) > new Date()).startsAt);
    pastSession = c.sessions[0].id;
    futureSession = c.sessions[5].id;
  });

  it('xếp lớp: đủ sĩ số thì chặn, xếp xong rời danh sách chờ, phát lms.learner.placed', async () => {
    const r1 = await t.as(cs.token).post(`/api/v1/lms/classes/${classId}/learners`, { learnerId: hv1.studentId, enrollmentId: hv1.enrollmentId });
    expect(r1.status).toBe(201);
    expect(r1.body.data.fromClassId).toBeNull();
    expect((await t.as(cs.token).post(`/api/v1/lms/classes/${classId}/learners`, { learnerId: hv1.studentId, enrollmentId: hv1.enrollmentId })).body.code).toBe('ALREADY_IN_CLASS');
    await t.as(cs.token).post(`/api/v1/lms/classes/${classId}/learners`, { learnerId: hv2.studentId, enrollmentId: hv2.enrollmentId });
    expect((await t.as(cs.token).get('/api/v1/lms/placement')).body.data).toHaveLength(0);
    expect(await lmsOutboxTypes(hv1.studentId)).toContain('lms.learner.placed');

    const hv3 = await enrolledStudent('Trần Gia Bảo', '0901000003');
    expect((await t.as(cs.token).post(`/api/v1/lms/classes/${classId}/learners`, { learnerId: hv3.studentId, enrollmentId: hv3.enrollmentId })).body.code).toBe('CLASS_FULL');

    // CRM nhận tên lớp hiện tại
    await t.drainEvents();
    expect((await t.as(cs.token).get(`/api/v1/crm/students/${hv1.studentId}`)).body.data.currentClassName).toBe('ART1-A · Mỹ thuật 1 — A');

    // Không giảm sĩ số tối đa xuống dưới số học viên đang học
    expect((await t.as(tl.token).patch(`/api/v1/lms/classes/${classId}`, { capacity: 1 })).body.code).toBe('CAPACITY_BELOW_ENROLLED');
    expect((await t.as(tl.token).patch(`/api/v1/lms/classes/${classId}`, { capacity: 2 })).status).toBe(200);

    // Giả lập đã xếp lớp từ trước khai giảng để điểm danh các buổi đã qua
    await t.lmsDb.update(classLearners).set({ joinedAt: new Date(Date.now() - 7 * DAY) }).where(eq(classLearners.classId, classId));
  });

  it('GV chỉ thấy lớp mình dạy', async () => {
    expect((await t.as(teacher.token).get('/api/v1/lms/classes')).body.data).toHaveLength(1);
    expect((await t.as(teacher2.token).get('/api/v1/lms/classes')).body.data).toHaveLength(0);
    expect((await t.as(teacher2.token).get(`/api/v1/lms/classes/${classId}`)).status).toBe(404);
    expect((await t.as(teacher2.token).get(`/api/v1/lms/sessions/${pastSession}`)).status).toBe(404);
  });

  it('điểm danh: chưa đến giờ → chặn; chốt cần đủ học viên', async () => {
    expect((await t.as(teacher.token).post(`/api/v1/lms/sessions/${futureSession}/attendance`, { records: [] })).body.code).toBe('SESSION_NOT_STARTED');
    const draft = await t.as(teacher.token).post(`/api/v1/lms/sessions/${pastSession}/attendance`, { records: [{ learnerId: hv1.studentId, status: 'PRESENT' }] });
    expect(draft.body, JSON.stringify(draft.body)).toMatchObject({ data: { finalized: false } });
    const incomplete = await t.as(teacher.token).post(`/api/v1/lms/sessions/${pastSession}/attendance`, { records: [], finalize: true });
    expect(incomplete.body.code).toBe('ATTENDANCE_INCOMPLETE');
  });

  it('chốt buổi → trừ buổi bên LMS và CRM; lớp chuyển ONGOING', async () => {
    const res = await t.as(ta.token).post(`/api/v1/lms/sessions/${pastSession}/attendance`, {
      records: [{ learnerId: hv2.studentId, status: 'EXCUSED', note: 'Ốm' }],
      finalize: true,
    });
    expect(res.body.data).toEqual({ finalized: true });
    const s = (await t.as(teacher.token).get(`/api/v1/lms/sessions/${pastSession}`)).body.data;
    expect(s.status).toBe('DONE');
    const byId = Object.fromEntries(s.learners.map((l: { learnerId: string }) => [l.learnerId, l]));
    expect(byId[hv1.studentId]).toMatchObject({ sessionsRemaining: 23, attendance: { status: 'PRESENT', consumesSession: true } });
    expect(byId[hv2.studentId]).toMatchObject({ sessionsRemaining: 24, attendance: { status: 'EXCUSED', consumesSession: false } });
    expect((await t.as(tl.token).get(`/api/v1/lms/classes/${classId}`)).body.data).toMatchObject({ status: 'ONGOING', sessionsDone: 1 });

    await t.drainEvents();
    expect((await t.as(cs.token).get(`/api/v1/crm/enrollments/${hv1.enrollmentId}`)).body.data).toMatchObject({ sessionsUsed: 1, sessionsRemaining: 23 });
  });

  it('buổi đã chốt: GV không sửa được; TL sửa → CRM trả lại buổi', async () => {
    const fix = { records: [{ learnerId: hv1.studentId, status: 'EXCUSED' }] };
    expect((await t.as(teacher.token).post(`/api/v1/lms/sessions/${pastSession}/attendance`, fix)).body.code).toBe('SESSION_FINALIZED');
    expect((await t.as(tl.token).post(`/api/v1/lms/sessions/${pastSession}/attendance`, fix)).status).toBe(200);
    expect(await lmsOutboxTypes(pastSession)).toContain('lms.attendance.corrected');
    await t.drainEvents();
    expect((await t.as(cs.token).get(`/api/v1/crm/enrollments/${hv1.enrollmentId}`)).body.data.sessionsUsed).toBe(0);
  });

  it('nhận xét học viên → phát lms.feedback.published, hiện trong hồ sơ học tập; học viên vắng → chặn', async () => {
    const body = { items: [{ learnerId: hv1.studentId, ratings: { focus: 5, creativity: 4 }, comment: 'Bé vẽ rất sáng tạo' }] };
    // hv1 đang "vắng có phép" (TL vừa sửa)
    expect((await t.as(teacher.token).post(`/api/v1/lms/sessions/${pastSession}/feedback`, body)).body.code).toBe('LEARNER_ABSENT');
    await t.as(tl.token).post(`/api/v1/lms/sessions/${pastSession}/attendance`, { records: [{ learnerId: hv1.studentId, status: 'PRESENT' }] });
    const res = await t.as(teacher.token).post(`/api/v1/lms/sessions/${pastSession}/feedback`, body);
    expect(res.status).toBe(204);
    expect(await lmsOutboxTypes(pastSession)).toContain('lms.feedback.published');
    const learner = (await t.as(teacher.token).get(`/api/v1/lms/learners/${hv1.studentId}`)).body.data;
    expect(learner.feedback[0]).toMatchObject({ comment: 'Bé vẽ rất sáng tạo', ratings: { focus: 5, creativity: 4 } });
    expect(learner.attendanceSummary).toMatchObject({ PRESENT: 1, total: 1 });
  });

  it('dời buổi: GV không có quyền; trùng lịch GV → 409, force thì lưu', async () => {
    const other = await t.as(tl.token).post('/api/v1/lms/classes', {
      code: 'ART1-B',
      name: 'Mỹ thuật 1 — B',
      branchId: b1,
      levelId: level1,
      teacherId: teacher2.id,
      capacity: 10,
      startDate: vnDate(10),
      schedule: [{ weekday: 1, startTime: '17:00', minutes: 90 }],
      totalSessions: 2,
    });
    await t.as(tl.token).post(`/api/v1/lms/classes/${other.body.data.id}/generate-sessions`, {});
    const otherSession = (await t.as(tl.token).get(`/api/v1/lms/classes/${other.body.data.id}`)).body.data.sessions[0];

    expect((await t.as(teacher.token).patch(`/api/v1/lms/sessions/${futureSession}`, { teacherId: teacher2.id })).status).toBe(403);
    const move = { startsAt: otherSession.startsAt, endsAt: otherSession.endsAt, teacherId: teacher2.id };
    expect((await t.as(cs.token).patch(`/api/v1/lms/sessions/${futureSession}`, move)).body.code).toBe('SCHEDULE_CONFLICT');
    const forced = await t.as(cs.token).patch(`/api/v1/lms/sessions/${futureSession}`, { ...move, force: true });
    expect(forced.body.data).toMatchObject({ teacherName: 'Thầy Minh', substitute: true });
    // GV dạy thay thấy buổi đó trên lịch
    const from = new Date(Date.now() - DAY).toISOString();
    const to = new Date(Date.now() + 30 * DAY).toISOString();
    const cal = (await t.as(teacher2.token).get(`/api/v1/lms/sessions?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).body.data;
    expect(cal.map((s: { id: string }) => s.id)).toContain(futureSession);
    // GV ghi chủ đề buổi được (không cần quyền dời)
    expect((await t.as(teacher.token).patch(`/api/v1/lms/sessions/${pastSession}`, { topic: 'Vẽ tranh phong cảnh' })).body.data.topic).toBe('Vẽ tranh phong cảnh');
  });

  it('học thử: CRM đặt buổi LMS → khách vào buổi; điểm danh khách → lịch hẹn CRM cập nhật', async () => {
    const slot = (await t.as(sale.token).get(`/api/v1/lms/trial-slots?branchId=${b1}&subjectId=${subjectId}`)).body.data.find(
      (s: { sessionId: string }) => s.sessionId !== futureSession,
    );
    expect(slot).toMatchObject({ classCode: 'ART1-A', remaining: 2 });
    const leadId = (await t.as(sale.token).post('/api/v1/crm/leads', { parentName: 'Mẹ Su', parentPhone: '0901000009', childName: 'Su', childBirthYear: 2018, source: 'WALK_IN' })).body.data.id;
    const appt = await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/appointments`, { type: 'TRIAL', scheduledAt: slot.startsAt, lmsSessionId: slot.sessionId });
    expect(appt.status).toBe(201);
    await t.drainEvents();

    const s = (await t.as(teacher.token).get(`/api/v1/lms/sessions/${slot.sessionId}`)).body.data;
    expect(s.trialGuests).toEqual([expect.objectContaining({ childName: 'Su', parentPhone: '0901000009', result: 'PENDING' })]);
    expect(await t.as(teacher.token).post(`/api/v1/lms/trial-guests/${s.trialGuests[0].id}/check`, { result: 'ATTENDED', note: 'Bé hào hứng' })).toHaveProperty('status', 204);
    await t.drainEvents();
    const lead = (await t.as(sale.token).get(`/api/v1/crm/leads/${leadId}`)).body.data;
    expect(lead.status).toBe('S4A'); // LMS điểm danh có mặt → lead lên S4A
    expect(lead.appointments[0]).toMatchObject({ status: 'ATTENDED' });
    expect(lead.statusLogs[0]).toMatchObject({ fromStatus: 'S3A', toStatus: 'S4A', source: 'APPOINTMENT', actorName: 'Cô Lan' });
  });

  it('học thử vào buổi đã diễn ra → LMS từ chối, CRM huỷ lịch hẹn', async () => {
    const leadId = (await t.as(sale.token).post('/api/v1/crm/leads', { parentName: 'Bố Tôm', parentPhone: '0901000010', childName: 'Tôm', source: 'WALK_IN' })).body.data.id;
    const appt = await t.as(sale.token).post(`/api/v1/crm/leads/${leadId}/appointments`, {
      type: 'TRIAL',
      scheduledAt: new Date(Date.now() + DAY).toISOString(),
      lmsSessionId: pastSession,
    });
    expect(appt.status).toBe(201);
    await t.drainEvents();
    const lead = (await t.as(sale.token).get(`/api/v1/crm/leads/${leadId}`)).body.data;
    expect(lead.appointments[0].status).toBe('CANCELLED');
  });

  it('huỷ buổi rồi sinh bù: tổng số buổi giữ nguyên', async () => {
    const c = (await t.as(tl.token).get(`/api/v1/lms/classes/${classId}`)).body.data;
    const target = c.sessions.find((s: { status: string; startsAt: string }) => s.status === 'SCHEDULED' && s.startsAt > new Date().toISOString());
    expect((await t.as(teacher.token).post(`/api/v1/lms/sessions/${target.id}/cancel`, { reason: 'Nghỉ lễ' })).status).toBe(403);
    expect((await t.as(cs.token).post(`/api/v1/lms/sessions/${target.id}/cancel`, { reason: 'Nghỉ lễ' })).status).toBe(204);
    expect((await t.as(tl.token).post(`/api/v1/lms/classes/${classId}/generate-sessions`, {})).body.data.created).toBe(1);
    const after = (await t.as(tl.token).get(`/api/v1/lms/classes/${classId}`)).body.data;
    expect(after.sessions.filter((s: { status: string }) => s.status !== 'CANCELLED')).toHaveLength(10);
  });

  it('bảo lưu bên CRM → tạm dừng trong lớp; xếp lớp bị chặn', async () => {
    await t.as(cs.token).post(`/api/v1/crm/students/${hv2.studentId}/status`, { status: 'PAUSED', reason: 'Về quê' });
    await t.drainEvents();
    const c = (await t.as(tl.token).get(`/api/v1/lms/classes/${classId}`)).body.data;
    expect(c.learners.find((l: { learnerId: string }) => l.learnerId === hv2.studentId).status).toBe('PAUSED');
    expect((await t.as(tl.token).get(`/api/v1/lms/learners/${hv2.studentId}`)).body.data.status).toBe('PAUSED');
  });

  it('bài tập: GV giao, TA chấm; điểm vượt thang → 400; điểm hiện trong hồ sơ', async () => {
    const a = await t.as(teacher.token).post(`/api/v1/lms/classes/${classId}/assignments`, { title: 'Vẽ con mèo', maxScore: 10 });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ learnerCount: 1, gradedCount: 0 });
    expect((await t.as(ta.token).post(`/api/v1/lms/classes/${classId}/assignments`, { title: 'X' })).status).toBe(403);

    const attach = await t.api
      .post(`/api/v1/lms/assignments/${a.body.data.id}/attachments`)
      .set('Authorization', `Bearer ${teacher.token}`)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'de-bai.pdf', contentType: 'application/pdf' });
    expect(attach.body.data.attachments[0]).toMatchObject({ name: 'de-bai.pdf' });

    expect((await t.as(ta.token).post(`/api/v1/lms/assignments/${a.body.data.id}/grades`, { items: [{ learnerId: hv1.studentId, status: 'GRADED', score: 11 }] })).status).toBe(400);
    const graded = await t.as(ta.token).post(`/api/v1/lms/assignments/${a.body.data.id}/grades`, {
      items: [{ learnerId: hv1.studentId, status: 'GRADED', score: 9, comment: 'Đẹp' }],
    });
    expect(graded.body.data).toMatchObject({ gradedCount: 1 });
    expect(await lmsOutboxTypes(a.body.data.id)).toContain('lms.assignment.graded');
    const learner = (await t.as(teacher.token).get(`/api/v1/lms/learners/${hv1.studentId}`)).body.data;
    expect(learner.grades[0]).toMatchObject({ title: 'Vẽ con mèo', score: 9, maxScore: 10 });
    expect((await t.as(teacher.token).delete(`/api/v1/lms/assignments/${a.body.data.id}`)).body.code).toBe('ASSIGNMENT_GRADED');
  });

  it('học liệu theo cấp độ hiện trong lớp của cấp độ đó', async () => {
    const res = await t.api
      .post('/api/v1/lms/materials')
      .set('Authorization', `Bearer ${tl.token}`)
      .field('title', 'Giáo trình Mỹ thuật 1')
      .field('levelId', level1)
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'giao-trinh.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(201);
    const list = (await t.as(teacher.token).get(`/api/v1/lms/materials?classId=${classId}`)).body.data;
    expect(list.map((m: { title: string }) => m.title)).toContain('Giáo trình Mỹ thuật 1');
  });

  it('lên cấp độ → phát lms.learner.promoted, CRM cập nhật cấp độ', async () => {
    expect((await t.as(teacher.token).post(`/api/v1/lms/learners/${hv1.studentId}/promote`, { toLevelId: level2 })).status).toBe(403);
    expect((await t.as(tl.token).post(`/api/v1/lms/learners/${hv1.studentId}/promote`, { toLevelId: level1 })).body.code).toBe('SAME_LEVEL');
    const res = await t.as(tl.token).post(`/api/v1/lms/learners/${hv1.studentId}/promote`, { toLevelId: level2, note: 'Hoàn thành tốt' });
    expect(res.body.data).toMatchObject({ currentLevelName: 'Mỹ thuật 2' });
    expect(res.body.data.levelHistory[0]).toMatchObject({ fromLevelName: 'Mỹ thuật 1', toLevelName: 'Mỹ thuật 2' });
    await t.drainEvents();
    expect((await t.as(cs.token).get(`/api/v1/crm/students/${hv1.studentId}`)).body.data.currentLevelName).toBe('Mỹ thuật 2');
  });

  it('hôm nay: buổi quá hạn chưa chốt điểm danh', async () => {
    const today = (await t.as(teacher.token).get('/api/v1/lms/today')).body.data;
    expect(today.date).toBe(vnDate(0));
    // Buổi -2 và -1 ngày đã qua nhưng chưa chốt
    expect(today.overdueSessions.length).toBeGreaterThanOrEqual(2);
    expect(today.sessions.every((s: { classCode: string }) => s.classCode === 'ART1-A')).toBe(true);
  });

  it('báo cáo học tập: khối lượng giảng dạy, tỉ lệ đi học; GV chỉ thấy lớp mình', async () => {
    const month = vnDate().slice(0, 7);
    const r = (await t.as(tl.token).get(`/api/v1/lms/reports/teaching?month=${month}`)).body.data;
    const art = r.classes.find((c: { code: string }) => c.code === 'ART1-A');
    expect(art.sessionsDone).toBeGreaterThanOrEqual(1);
    expect(r.teachers.find((x: { fullName: string }) => x.fullName === 'Cô Lan')?.sessions).toBeGreaterThanOrEqual(1);
    expect(r.summary.sessionsDone).toBeGreaterThanOrEqual(1);
    const asTeacher2 = (await t.as(teacher2.token).get(`/api/v1/lms/reports/teaching?month=${month}`)).body.data;
    expect(asTeacher2.classes.map((c: { code: string }) => c.code)).not.toContain('ART1-A');
  });

  it('nhắc chốt điểm danh: buổi đã qua chưa chốt → GV nhận một lần', async () => {
    await t.runJobs();
    await t.runJobs();
    const list = (await t.as(teacher.token).get('/api/v1/core/notifications?pageSize=100')).body.data as Array<{ type: string; link: string }>;
    const overdue = list.filter((n) => n.type === 'lms.attendance.overdue');
    expect(overdue.length).toBeGreaterThanOrEqual(1);
    expect(new Set(overdue.map((n) => n.link)).size).toBe(overdue.length);
  });

  it('kết thúc lớp → học viên hoàn thành, phát lms.class.completed', async () => {
    const res = await t.as(tl.token).patch(`/api/v1/lms/classes/${classId}`, { status: 'COMPLETED' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.learners.every((l: { status: string }) => l.status === 'COMPLETED')).toBe(true);
    expect(await lmsOutboxTypes(classId)).toContain('lms.class.completed');
    expect((await t.as(tl.token).post(`/api/v1/lms/classes/${classId}/generate-sessions`, {})).body.code).toBe('CLASS_CLOSED');
  });

  it('buổi đã qua không có học viên: không tính quá hạn, không nhắc; kết thúc lớp → đóng các buổi đó', async () => {
    const res = await t.as(tl.token).post('/api/v1/lms/classes', {
      code: 'art1-empty',
      name: 'Lớp trống',
      branchId: b1,
      levelId: level1,
      teacherId: teacher2.id,
      capacity: 10,
      startDate: vnDate(-3),
      schedule: [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, startTime: '06:00', minutes: 60 })),
    });
    const emptyClass = res.body.data.id;
    await t.as(tl.token).post(`/api/v1/lms/classes/${emptyClass}/generate-sessions`, {});
    expect((await t.as(teacher2.token).get('/api/v1/lms/today')).body.data.overdueSessions).toEqual([]);
    const month = vnDate().slice(0, 7);
    const report = (await t.as(tl.token).get(`/api/v1/lms/reports/teaching?month=${month}`)).body.data;
    expect(report.classes.find((c: { code: string }) => c.code === 'ART1-EMPTY')?.sessionsOverdue ?? 0).toBe(0);
    await t.runJobs();
    const notes = (await t.as(teacher2.token).get('/api/v1/core/notifications?pageSize=100')).body.data as Array<{ type: string }>;
    expect(notes.filter((n) => n.type === 'lms.attendance.overdue')).toEqual([]);

    await t.as(tl.token).patch(`/api/v1/lms/classes/${emptyClass}`, { status: 'ONGOING' });
    await t.as(tl.token).patch(`/api/v1/lms/classes/${emptyClass}`, { status: 'COMPLETED' });
    const sessions = (await t.as(tl.token).get(`/api/v1/lms/classes/${emptyClass}`)).body.data.sessions as Array<{ status: string; startsAt: string }>;
    expect(sessions.filter((x) => x.status === 'SCHEDULED')).toEqual([]);
  });
});
