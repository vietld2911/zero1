import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { catalogLevels, processedEvents } from '../../src/contexts/crm/db/schema.js';
import { outboxEvents } from '../../src/contexts/lms/db/schema.js';
import { createTestApp, type TestApp } from './harness.js';

let t: TestApp;
let teacherToken: string;
let saleToken: string;

beforeAll(async () => {
  t = await createTestApp();
  const b = await t.makeBranch('CUR');
  teacherToken = (await t.makeUser({ email: 'gv@test.local', role: 'TEACHER', branchIds: [b] })).token;
  saleToken = (await t.makeUser({ email: 'sale@test.local', role: 'SALE', branchIds: [b] })).token;
});
afterAll(() => t?.close());

const admin = () => t.as(t.adminToken);

async function createSubject(code: string, name: string) {
  const res = await admin().post('/api/v1/lms/subjects', { code, name });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

async function createLevel(subjectId: string, body: object) {
  const res = await admin().post(`/api/v1/lms/subjects/${subjectId}/levels`, body);
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe('chương trình học (LMS)', () => {
  let robotics: string;
  let rob1: string;
  let rob2: string;

  it('ADMIN tạo môn và cấp độ; cấp độ xếp theo thứ tự tạo', async () => {
    robotics = await createSubject('rob', 'Robotics');
    rob1 = await createLevel(robotics, { code: 'rob1', name: 'Robotics 1', sessionsCount: 14 });
    rob2 = await createLevel(robotics, { code: 'ROB2', name: 'Robotics 2', sessionsCount: 14, sessionMinutes: 120 });

    const res = await t.as(teacherToken).get('/api/v1/lms/subjects');
    expect(res.status).toBe(200);
    const subject = res.body.data.find((s: { id: string }) => s.id === robotics);
    expect(subject).toMatchObject({ code: 'ROB', name: 'Robotics' });
    expect(subject.levels.map((l: { code: string; sortOrder: number; sessionMinutes: number }) => [l.code, l.sortOrder, l.sessionMinutes])).toEqual([
      ['ROB1', 1, 90],
      ['ROB2', 2, 120],
    ]);
  });

  it('chỉ người có quyền lms.curriculum.manage được sửa', async () => {
    expect((await t.as(teacherToken).post('/api/v1/lms/subjects', { code: 'X', name: 'Thử' })).status).toBe(403);
    expect((await t.as(teacherToken).patch(`/api/v1/lms/levels/${rob1}`, { name: 'Đổi' })).status).toBe(403);
  });

  it('mã trùng → 409', async () => {
    expect((await admin().post('/api/v1/lms/subjects', { code: 'ROB', name: 'Trùng' })).body.code).toBe('SUBJECT_CODE_TAKEN');
    expect((await admin().post(`/api/v1/lms/subjects/${robotics}/levels`, { code: 'rob2', name: 'Trùng', sessionsCount: 10 })).body.code).toBe(
      'LEVEL_CODE_TAKEN',
    );
  });

  it('sửa một phần không ghi đè thời lượng buổi về mặc định', async () => {
    expect((await admin().patch(`/api/v1/lms/levels/${rob2}`, { name: 'Robotics 2 nâng cao' })).status).toBe(204);
    const level = (await admin().get(`/api/v1/lms/levels/${rob2}`)).body.data;
    expect(level).toMatchObject({ name: 'Robotics 2 nâng cao', sessionMinutes: 120 });
  });

  it('sắp lại thứ tự lên lớp; gửi thiếu cấp độ → 400', async () => {
    expect((await admin().patch(`/api/v1/lms/subjects/${robotics}/level-order`, { levelIds: [rob2] })).status).toBe(400);
    expect((await admin().patch(`/api/v1/lms/subjects/${robotics}/level-order`, { levelIds: [rob2, rob1] })).status).toBe(204);
    const subject = (await admin().get('/api/v1/lms/subjects')).body.data.find((s: { id: string }) => s.id === robotics);
    expect(subject.levels.map((l: { id: string }) => l.id)).toEqual([rob2, rob1]);
  });

  it('cấp độ ngừng hoạt động ẩn khỏi danh sách mặc định', async () => {
    const tmp = await createLevel(robotics, { code: 'TMP', name: 'Tạm', sessionsCount: 4 });
    await admin().patch(`/api/v1/lms/levels/${tmp}`, { isActive: false });
    const active = (await admin().get('/api/v1/lms/subjects')).body.data.find((s: { id: string }) => s.id === robotics);
    expect(active.levels.map((l: { id: string }) => l.id)).not.toContain(tmp);
    const all = (await admin().get('/api/v1/lms/subjects?includeInactive=true')).body.data.find((s: { id: string }) => s.id === robotics);
    expect(all.levels.map((l: { id: string }) => l.id)).toContain(tmp);
  });
});

describe('đồng bộ sang CRM qua sự kiện', () => {
  it('CRM nhận bản sao cấp độ sau khi sự kiện được phát', async () => {
    const scratch = await createSubject('SCR', 'Lập trình Scratch');
    const s1 = await createLevel(scratch, { code: 'S1', name: 'Scratch 1', sessionsCount: 12 });

    expect(await t.crmDb.select().from(catalogLevels).where(eq(catalogLevels.levelId, s1))).toHaveLength(0);
    await t.drainEvents();

    const res = await t.as(saleToken).get('/api/v1/crm/catalog/levels');
    expect(res.body.data.find((l: { levelId: string }) => l.levelId === s1)).toMatchObject({
      subjectName: 'Lập trình Scratch',
      code: 'S1',
      sessionsCount: 12,
      isActive: true,
    });
  });

  it('đổi tên / ngừng môn → mọi cấp độ trong môn cập nhật ở CRM', async () => {
    const coding = await createSubject('PY', 'Python');
    const p1 = await createLevel(coding, { code: 'P1', name: 'Python 1', sessionsCount: 16 });
    const p2 = await createLevel(coding, { code: 'P2', name: 'Python 2', sessionsCount: 16 });
    await t.drainEvents();

    await admin().patch(`/api/v1/lms/subjects/${coding}`, { name: 'Lập trình Python', isActive: false });
    await t.drainEvents();

    const rows = await t.crmDb.select().from(catalogLevels).where(eq(catalogLevels.subjectId, coding));
    expect(rows.map((r) => [r.levelId, r.subjectName, r.isActive]).sort()).toEqual(
      [
        [p1, 'Lập trình Python', false],
        [p2, 'Lập trình Python', false],
      ].sort(),
    );
    const visible = (await t.as(saleToken).get('/api/v1/crm/catalog/levels')).body.data.map((l: { levelId: string }) => l.levelId);
    expect(visible).not.toContain(p1);
  });

  it('nhận lại cùng sự kiện không áp dụng hai lần; sự kiện cũ đến muộn không ghi đè bản mới', async () => {
    const subject = await createSubject('LEGO', 'Lego');
    const level = await createLevel(subject, { code: 'L1', name: 'Lego 1', sessionsCount: 8 });
    await admin().patch(`/api/v1/lms/levels/${level}`, { sessionsCount: 10 });
    await t.drainEvents();

    const events = await t.lmsDb.select().from(outboxEvents).where(eq(outboxEvents.aggregateId, level));
    expect(events).toHaveLength(2);
    const [older, newer] = events.sort((a, b) => a.id.localeCompare(b.id));

    // Phát lại cả hai (mô phỏng giao lại sau sự cố): bị bỏ qua nhờ processed_events.
    const handler = t.crmSubscriptions.find((s) => s.name === 'crm.catalog.levelProjection')!;
    const envelope = (e: typeof older) => ({ ...e!, occurredAt: '', source: 'lms' as const, data: e!.data });
    await handler.handle(envelope(newer));
    await handler.handle(envelope(older));
    const processed = await t.crmDb.select().from(processedEvents).where(eq(processedEvents.eventId, older!.id));
    expect(processed).toHaveLength(1);

    // Sự kiện cũ chưa từng xử lý (id mới → khác khoá idempotency) vẫn không ghi đè dữ liệu mới hơn.
    await handler.handle({ ...envelope(older), id: '00000000000000000000000000' });
    const [row] = await t.crmDb.select().from(catalogLevels).where(eq(catalogLevels.levelId, level));
    expect(row?.sessionsCount).toBe(10);
  });
});
