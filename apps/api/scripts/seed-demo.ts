/**
 * Dữ liệu demo cho dev: nhân sự, chương trình, gói, lớp, lead, học viên, đăng ký, thu tiền,
 * xếp lớp, điểm danh, nhận xét, bài tập. Đi qua API thật (in-process, không mở cổng) nên
 * mọi quy tắc nghiệp vụ và sự kiện CRM ↔ LMS đều chạy như thật.
 *
 * Chạy: npm run db:seed-demo            (bỏ qua nếu đã có lead)
 *       npm run db:seed-demo -- --force (vẫn thêm)
 * Mật khẩu mọi tài khoản demo: DEMO_PASSWORD (mặc định Zero1@2026).
 */
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { and, eq, inArray } from 'drizzle-orm';
import { loadEnv } from '../src/platform/env.js';
import { createLogger } from '../src/platform/logger.js';
import { buildApplication } from '../src/application.js';
import { createAccessTokens } from '../src/contexts/core/modules/auth/tokens.js';
import { hashPassword } from '../src/contexts/core/modules/auth/password.js';
import { users } from '../src/contexts/core/db/schema.js';
import { leads } from '../src/contexts/crm/db/schema.js';
import { classLearners } from '../src/contexts/lms/db/schema.js';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Zero1@2026';
const force = process.argv.includes('--force');

const env = loadEnv();
const built = buildApplication(env, createLogger({ ...env, LOG_LEVEL: 'warn' }), { rateLimit: false });
const tokens = createAccessTokens(env.JWT_ACCESS_SECRET);
const http = request(built.app);

// ─────────── Tiện ích

let seed = 20261008;
/** Ngẫu nhiên có hạt giống — chạy lại ra cùng dữ liệu. */
const rand = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648);
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;
const chance = (p: number) => rand() < p;

const DAY = 86_400_000;
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3_600_000 + offset * DAY).toISOString().slice(0, 10);
const vnAt = (offsetDays: number, time: string) => `${vnDate(offsetDays)}T${time}:00+07:00`;
const log = (msg: string) => console.log(`✔ ${msg}`);

type Body = Record<string, unknown>;
interface Actor {
  id: string;
  token: string;
}

async function call(actor: Actor, method: 'get' | 'post' | 'patch', path: string, body?: Body, headers: Record<string, string> = {}) {
  let req = http[method](`/api/v1${path}`).set('Authorization', `Bearer ${actor.token}`);
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  const res = await (body ? req.send(body) : req);
  if (res.status >= 400) throw new Error(`${method.toUpperCase()} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as { data: any; meta?: any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
const get = (a: Actor, path: string) => call(a, 'get', path);
const post = (a: Actor, path: string, body: Body = {}, headers?: Record<string, string>) => call(a, 'post', path, body, headers);
const patch = (a: Actor, path: string, body: Body) => call(a, 'patch', path, body);
const idem = () => ({ 'Idempotency-Key': randomUUID() });
const drain = () => built.dispatcher.drain();

async function actorFor(userId: string, role: string): Promise<Actor> {
  return { id: userId, token: await tokens.sign({ userId, role }) };
}

// ─────────── Tên người Việt

const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Vũ', 'Đặng', 'Bùi', 'Đỗ', 'Ngô', 'Dương', 'Lý'];
const DEM_NAM = ['Minh', 'Gia', 'Đức', 'Quang', 'Bảo', 'Anh', 'Hoàng', 'Tuấn', 'Nhật'];
const DEM_NU = ['Ngọc', 'Bảo', 'Minh', 'Khánh', 'Thu', 'Hà', 'Phương', 'Gia'];
const TEN_NAM = ['Khôi', 'Huy', 'Phúc', 'Nam', 'Long', 'Khang', 'Duy', 'Bách', 'Lâm', 'Phong', 'Kiên', 'Sơn'];
const TEN_NU = ['An', 'Chi', 'Linh', 'Vy', 'Ngân', 'Trang', 'Hân', 'My', 'Thư', 'Nhi', 'Diệp', 'Như'];
const PH_NU = ['Thị Hồng', 'Thị Mai', 'Thu Hương', 'Thị Lan', 'Thanh Hà', 'Thị Nga', 'Minh Thu'];
const PH_NAM = ['Văn Hùng', 'Đức Thắng', 'Văn Long', 'Quốc Bảo', 'Minh Tuấn', 'Văn Nam'];
const SCHOOLS = ['TH Nghĩa Tân', 'TH Dịch Vọng', 'TH Cầu Giấy', 'TH Ái Mộ', 'TH Gia Thụy', 'TH Đoàn Thị Điểm', 'Vinschool'];
const usedPhones = new Set<string>();

function child() {
  const ho = pick(HO);
  const male = chance(0.55);
  const name = `${ho} ${pick(male ? DEM_NAM : DEM_NU)} ${pick(male ? TEN_NAM : TEN_NU)}`;
  const mother = chance(0.7);
  let phone: string;
  do phone = `09${String(Math.floor(rand() * 100_000_000)).padStart(8, '0')}`;
  while (usedPhones.has(phone));
  usedPhones.add(phone);
  const year = 2014 + Math.floor(rand() * 6);
  return {
    childName: name,
    gender: male ? 'MALE' : 'FEMALE',
    birthYear: year,
    birthDate: `${year}-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-${String(1 + Math.floor(rand() * 28)).padStart(2, '0')}`,
    parentName: `${mother ? ho : pick(HO)} ${pick(mother ? PH_NU : PH_NAM)}`,
    parentPhone: phone,
    school: pick(SCHOOLS),
  };
}

// ─────────── Bắt đầu

try {
  const crmDb = built.databases.dbs.crm;
  const coreDb = built.databases.dbs.core;

  const [adminRow] = await coreDb.select().from(users).where(eq(users.role, 'ADMIN')).limit(1);
  if (!adminRow) throw new Error('Chưa có tài khoản ADMIN — chạy npm run db:seed trước');
  const admin = await actorFor(adminRow.id, 'ADMIN');

  const existingLeads = await crmDb.select({ id: leads.id }).from(leads).limit(1);
  const staffOnly = existingLeads.length > 0 && !force;
  if (staffOnly) console.log('Đã có lead trong CRM — chỉ đồng bộ nhân sự và số liệu báo cáo. Thêm cả dữ liệu: npm run db:seed-demo -- --force');
  await seedAll(admin, staffOnly);
} finally {
  await built.close();
}

async function seedAll(admin: Actor, staffOnly: boolean) {
  const crmDb = built.databases.dbs.crm;
  const lmsDb = built.databases.dbs.lms;
  const coreDb = built.databases.dbs.core;

  // ── Chi nhánh
  const branchList = (await get(admin, '/core/branches?includeInactive=true')).data as Array<{ id: string; code: string; name: string }>;
  async function ensureBranch(code: string, name: string, address: string) {
    const found = branchList.find((b) => b.code === code);
    if (found) return found.id;
    return (await post(admin, '/core/branches', { code, name, address })).data.id as string;
  }
  const cg = branchList[0]?.id ?? (await ensureBranch('CG01', 'Zero1 Cầu Giấy', '120 Trần Thái Tông, Cầu Giấy, Hà Nội'));
  const lb = await ensureBranch('LB01', 'Zero1 Long Biên', '25 Nguyễn Văn Cừ, Long Biên, Hà Nội');
  log('chi nhánh');

  // ── Nhân sự
  const demoPasswordHash = await hashPassword(DEMO_PASSWORD);
  async function ensureUser(email: string, fullName: string, role: string, branchIds: string[], managerId?: string) {
    const found = ((await get(admin, `/core/users?q=${encodeURIComponent(email)}`)).data as Array<{ id: string; email: string }>).find((u) => u.email === email);
    const id = found?.id ?? ((await post(admin, '/core/users', { email, fullName, role, branchIds, managerId })).data.user.id as string);
    // Có sẵn → đưa về đúng cơ cấu (chi nhánh, quản lý trực tiếp).
    if (found) await patch(admin, `/core/users/${id}`, { role, branchIds, managerId: managerId ?? null });
    // Tài khoản demo: đặt sẵn mật khẩu, không bắt đổi lần đầu.
    await coreDb.update(users).set({ passwordHash: demoPasswordHash, mustChangePassword: false }).where(eq(users.id, id));
    return actorFor(id, role);
  }
  const am = await ensureUser('am.hung@zero1.local', 'Đỗ Mạnh Hùng', 'AM', [cg, lb]);
  const cmCg = await ensureUser('cm.thao@zero1.local', 'Nguyễn Phương Thảo', 'CM', [cg], am.id);
  const slCg = await ensureUser('sl.tuan@zero1.local', 'Trần Anh Tuấn', 'SL', [cg], cmCg.id);
  const saleLinh = await ensureUser('sale.linh@zero1.local', 'Phạm Thùy Linh', 'SALE', [cg], slCg.id);
  const saleNam = await ensureUser('sale.nam@zero1.local', 'Lê Hoàng Nam', 'SALE', [cg], slCg.id);
  const csCg = await ensureUser('cs.trang@zero1.local', 'Vũ Thu Trang', 'CS', [cg], cmCg.id);
  const tl = await ensureUser('tl.quang@zero1.local', 'Bùi Đức Quang', 'TL', [cg], cmCg.id);
  const gvLan = await ensureUser('gv.lan@zero1.local', 'Nguyễn Thị Lan', 'TEACHER', [cg], tl.id);
  const gvMinh = await ensureUser('gv.minh@zero1.local', 'Hoàng Văn Minh', 'TEACHER', [cg], tl.id);
  const taVy = await ensureUser('ta.vy@zero1.local', 'Đặng Khánh Vy', 'TA', [cg], tl.id);
  const cmLb = await ensureUser('cm.hoa@zero1.local', 'Ngô Thị Hoa', 'CM', [lb], am.id);
  const slLb = await ensureUser('sl.binh@zero1.local', 'Nguyễn Thanh Bình', 'SL', [lb], cmLb.id);
  const saleDuc = await ensureUser('sale.duc@zero1.local', 'Dương Minh Đức', 'SALE', [lb], slLb.id);
  const csLb = await ensureUser('cs.mai@zero1.local', 'Lý Thanh Mai', 'CS', [lb], cmLb.id);
  const tlLb = await ensureUser('tl.phuong@zero1.local', 'Lê Minh Phương', 'TL', [lb], cmLb.id);
  const gvKhoa = await ensureUser('gv.khoa@zero1.local', 'Trần Đăng Khoa', 'TEACHER', [lb], tlLb.id);
  const taAn = await ensureUser('ta.an@zero1.local', 'Phạm Bình An', 'TA', [lb], tlLb.id);

  /**
   * Số liệu cho báo cáo (GĐ5): CS chăm sóc mọi học viên của cơ sở, mục tiêu KPI tháng này,
   * vài ca tái phí do CS chốt. Chạy lại an toàn (mục tiêu ghi đè, tái phí chỉ tạo khi tháng này chưa có).
   */
  async function seedReports() {
    const month = vnDate().slice(0, 7);
    for (const [branch, cs] of [
      [cg, csCg],
      [lb, csLb],
    ] as const) {
      const list = (await get(admin, `/crm/students?branchId=${branch}&pageSize=100`)).data as Array<{ id: string; careId: string | null; status: string }>;
      for (const st of list) if (!st.careId && st.status !== 'STOPPED') await post(admin, `/crm/students/${st.id}/assign`, { careId: cs.id });
    }
    const targets: Array<[Actor, number]> = [
      [saleLinh, 30_000_000],
      [saleNam, 25_000_000],
      [slCg, 15_000_000],
      [saleDuc, 20_000_000],
      [slLb, 10_000_000],
      [csCg, 12_000_000],
      [csLb, 8_000_000],
    ];
    await http
      .put('/api/v1/crm/reports/kpi/targets')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ month, items: targets.map(([u, targetRevenue]) => ({ userId: u.id, targetRevenue })) })
      .expect(204);

    for (const cs of [csCg, csLb]) {
      const r = (await get(cs, `/crm/renewals?careId=${cs.id}`)).data as { due: Array<{ studentId: string; enrollmentId: string }>; renewed: unknown[] };
      if (r.renewed.length) continue;
      for (const [i, d] of r.due.slice(0, 2).entries()) {
        const prev = (await get(cs, `/crm/enrollments/${d.enrollmentId}`)).data as { packageId: string; startLevelId: string; amountDue: number };
        const created = (await post(cs, `/crm/students/${d.studentId}/enrollments`, { packageId: prev.packageId, startLevelId: prev.startLevelId }, idem())).data as { enrollmentId: string };
        const e = (await get(cs, `/crm/enrollments/${created.enrollmentId}`)).data as { amountDue: number };
        await post(cs, `/crm/enrollments/${created.enrollmentId}/payments`, { amount: i === 0 ? e.amountDue : Math.round(e.amountDue / 2 / 100_000) * 100_000, method: 'TRANSFER' }, idem());
      }
    }
    await drain();
    log('mục tiêu KPI tháng này, CS chăm sóc học viên, tái phí mẫu');
  }

  log(`17 nhân sự demo theo cơ cấu (mật khẩu ${DEMO_PASSWORD})`);
  if (staffOnly) return seedReports();

  // ── Chương trình học
  type Subject = { id: string; code: string; levels: Array<{ id: string; code: string; sessionsCount: number }> };
  const subjects = async () => (await get(admin, '/lms/subjects?includeInactive=true')).data as Subject[];
  async function ensureSubject(code: string, name: string, levels: Array<[string, string, number]>) {
    let s = (await subjects()).find((x) => x.code === code);
    if (!s) {
      await post(admin, '/lms/subjects', { code, name });
      s = (await subjects()).find((x) => x.code === code)!;
    }
    for (const [lc, ln, n] of levels) {
      if (!s.levels.some((l) => l.code === lc)) await post(admin, `/lms/subjects/${s.id}/levels`, { code: lc, name: ln, sessionsCount: n, sessionMinutes: 90 });
    }
    return (await subjects()).find((x) => x.code === code)!;
  }
  const rob = await ensureSubject('ROB', 'Robotics', [
    ['ROB1', 'Robotics 1', 14],
    ['ROB2', 'Robotics 2', 14],
    ['ROB3', 'Robotics 3', 14],
  ]);
  const scr = await ensureSubject('SCR', 'Lập trình Scratch', [
    ['SCR1', 'Scratch 1', 12],
    ['SCR2', 'Scratch 2', 12],
  ]);
  const level = (s: Subject, code: string) => s.levels.find((l) => l.code === code)!.id;
  await drain(); // CRM nhận bản sao cấp độ
  log('chương trình học');

  // ── Gói, khuyến mại, quà, tài khoản nhận tiền
  const pkgs = async () => (await get(admin, '/crm/packages?includeInactive=true')).data as Array<{ id: string; code: string }>;
  async function ensurePackage(body: Body) {
    const found = (await pkgs()).find((p) => p.code === body.code);
    return found?.id ?? ((await post(admin, '/crm/packages', body)).data.id as string);
  }
  const rob6 = await ensurePackage({ code: 'ROB-6T', name: 'Robotics 6 tháng', subjectId: rob.id, months: 6, sessionsCount: 48, sessionsPerWeek: 2, basePrice: 12_000_000, defaultScholarshipMonths: 1 });
  const rob3 = await ensurePackage({ code: 'ROB-3T', name: 'Robotics 3 tháng', subjectId: rob.id, months: 3, sessionsCount: 24, sessionsPerWeek: 2, basePrice: 6_500_000, defaultScholarshipMonths: 0 });
  const scr3 = await ensurePackage({ code: 'SCR-3T', name: 'Scratch 3 tháng', subjectId: scr.id, months: 3, sessionsCount: 24, sessionsPerWeek: 2, basePrice: 5_400_000, defaultScholarshipMonths: 0 });
  const scr1 = await ensurePackage({ code: 'SCR-1T', name: 'Scratch 1 tháng', subjectId: scr.id, months: 1, sessionsCount: 8, sessionsPerWeek: 2, basePrice: 1_900_000, defaultScholarshipMonths: 0 });
  await patch(admin, `/crm/packages/${rob6}/branch-prices`, { branchId: lb, price: 11_400_000 });

  const promos = (await get(admin, '/crm/promotions?includeInactive=true')).data as Array<{ id: string; code: string }>;
  const ensurePromo = async (body: Body) => promos.find((p) => p.code === body.code)?.id ?? ((await post(admin, '/crm/promotions', body)).data.id as string);
  const promoAutumn = await ensurePromo({ code: 'THU2026', name: 'Ưu đãi mùa thu 10%', discountType: 'PERCENT', discountValue: 10, maxDiscount: 1_500_000, startDate: vnDate(-60), endDate: vnDate(60) });
  const promoSibling = await ensurePromo({ code: 'ANHEM', name: 'Anh chị em học cùng giảm 500.000đ', discountType: 'AMOUNT', discountValue: 500_000 });

  const items = (await get(admin, '/crm/promotion-items?includeInactive=true')).data as Array<{ id: string; code: string; stock: Array<{ branchId: string; quantity: number }> }>;
  async function ensureItem(code: string, name: string, unit: string) {
    const found = items.find((i) => i.code === code);
    const id = found?.id ?? ((await post(admin, '/crm/promotion-items', { code, name, unit })).data.id as string);
    for (const b of [cg, lb]) {
      if ((found?.stock.find((s) => s.branchId === b)?.quantity ?? 0) < 10) await post(am, `/crm/promotion-items/${id}/stock-moves`, { branchId: b, kind: 'IN', quantity: 30, note: 'Nhập kho đầu kỳ' });
    }
    return id;
  }
  const balo = await ensureItem('BALO', 'Balo Zero1', 'cái');
  const aothun = await ensureItem('AOTHUN', 'Áo thun Zero1', 'cái');
  await patch(admin, `/crm/payment-accounts/${cg}`, { account: { bankBin: '970422', accountNo: '0866766189', accountName: 'Cong ty Zero1' } });
  await patch(admin, `/crm/payment-accounts/${lb}`, { account: { bankBin: '970436', accountNo: '1023456789', accountName: 'Cong ty Zero1' } });
  log('gói học phí, khuyến mại, quà tặng, tài khoản nhận tiền');

  // ── Phòng & lớp
  const roomList = (await get(admin, '/lms/rooms?includeInactive=true')).data as Array<{ id: string; branchId: string; name: string }>;
  async function ensureRoom(branchId: string, name: string, capacity: number) {
    return roomList.find((r) => r.branchId === branchId && r.name === name)?.id ?? ((await post(admin, '/lms/rooms', { branchId, name, capacity })).data.id as string);
  }
  const p101 = await ensureRoom(cg, 'P101', 12);
  const p102 = await ensureRoom(cg, 'P102', 10);
  await ensureRoom(cg, 'Lab 1', 16);
  const lbA = await ensureRoom(lb, 'Phòng A', 12);
  await ensureRoom(lb, 'Phòng B', 10);

  const classList = (await get(admin, '/lms/classes')).data as Array<{ id: string; code: string }>;
  async function ensureClass(body: Body) {
    const found = classList.find((c) => c.code === body.code);
    const id = found?.id ?? ((await post(admin, '/lms/classes', body)).data.id as string);
    await post(admin, `/lms/classes/${id}/generate-sessions`, {});
    return { id, startDate: body.startDate as string, branchId: body.branchId as string };
  }
  const slot = (weekday: number, startTime: string) => ({ weekday, startTime, minutes: 90 });
  const robCgA = await ensureClass({ code: 'ROB1-CG-A', name: 'Robotics 1 — Tối T3/T5', branchId: cg, levelId: level(rob, 'ROB1'), teacherId: gvLan.id, taId: taVy.id, roomId: p101, capacity: 12, startDate: vnDate(-29), schedule: [slot(2, '18:00'), slot(4, '18:00')] });
  const scrCgA = await ensureClass({ code: 'SCR1-CG-A', name: 'Scratch 1 — Cuối tuần sáng', branchId: cg, levelId: level(scr, 'SCR1'), teacherId: gvMinh.id, roomId: p102, capacity: 10, startDate: vnDate(-25), schedule: [slot(6, '09:00'), slot(7, '09:00')] });
  const robCgB = await ensureClass({ code: 'ROB2-CG-B', name: 'Robotics 2 — Tối T2/T4', branchId: cg, levelId: level(rob, 'ROB2'), teacherId: gvMinh.id, taId: taVy.id, roomId: p101, capacity: 12, startDate: vnDate(5), schedule: [slot(1, '18:00'), slot(3, '18:00')] });
  const robLbA = await ensureClass({ code: 'ROB1-LB-A', name: 'Robotics 1 — Cuối tuần chiều', branchId: lb, levelId: level(rob, 'ROB1'), teacherId: gvKhoa.id, taId: taAn.id, roomId: lbA, capacity: 12, startDate: vnDate(-18), schedule: [slot(6, '14:00'), slot(7, '14:00')] });
  await ensureClass({ code: 'SCR1-LB-A', name: 'Scratch 1 — Tối T3/T6', branchId: lb, levelId: level(scr, 'SCR1'), teacherId: gvKhoa.id, roomId: lbA, capacity: 10, startDate: vnDate(12), schedule: [slot(2, '18:30'), slot(5, '18:30')] });
  log('5 lớp + lịch học');

  // ── Lead & học viên
  const SOURCES = ['FACEBOOK', 'FACEBOOK', 'ZALO', 'WEBSITE', 'HOTLINE', 'REFERRAL', 'WALK_IN', 'EVENT'] as const;
  const createdLeads: Array<{ id: string; createdDaysAgo: number }> = [];

  async function newLead(sale: Actor, subjectId: string, createdDaysAgo: number) {
    const c = child();
    const lead = (
      await post(sale, '/crm/leads', {
        parentName: c.parentName,
        parentPhone: c.parentPhone,
        childName: c.childName,
        childBirthYear: c.birthYear,
        school: c.school,
        interestSubjectId: subjectId,
        source: pick(SOURCES),
      })
    ).data;
    createdLeads.push({ id: lead.id, createdDaysAgo });
    return { lead, c };
  }

  /** Lead → gọi điện → đăng ký → thu tiền. Trả về học viên + đăng ký. */
  async function enrol(opts: {
    sale: Actor;
    cs: Actor;
    cm: Actor;
    subjectId: string;
    packageId: string;
    levelId: string;
    startDate: string;
    pay: 'FULL' | 'PARTIAL' | 'PENDING' | 'NONE';
    promotionId?: string;
    extraDiscount?: number;
    gift?: string;
    daysAgo: number;
  }) {
    const { lead, c } = await newLead(opts.sale, opts.subjectId, opts.daysAgo + 5);
    await post(opts.sale, `/crm/leads/${lead.id}/calls`, {
      outcome: 'TALKED',
      note: pick(['Phụ huynh quan tâm, hẹn qua trung tâm', 'Đã tư vấn lộ trình, gửi học phí qua Zalo', 'Bé thích lắp ráp, phụ huynh muốn học cuối tuần']),
      status: 'S2A',
    });
    const conv = (
      await post(
        opts.sale,
        `/crm/leads/${lead.id}/convert`,
        {
          student: { fullName: c.childName, birthDate: c.birthDate, gender: c.gender, school: c.school },
          enrollment: {
            packageId: opts.packageId,
            startLevelId: opts.levelId,
            promotionId: opts.promotionId ?? null,
            extraDiscount: opts.extraDiscount ?? 0,
            extraDiscountReason: opts.extraDiscount ? 'Khách quen giới thiệu' : null,
            startDate: opts.startDate,
            gifts: opts.gift ? [{ itemId: opts.gift, quantity: 1, deliveryCondition: 'ON_PAID' }] : [],
          },
        },
        idem(),
      )
    ).data as { studentId: string; enrollmentId: string };
    const e = (await get(opts.cs, `/crm/enrollments/${conv.enrollmentId}`)).data;
    // 10:30 của ngày thu; chạy trước 10:30 hôm nay thì lấy giờ hiện tại (API không nhận ngày thu ở tương lai).
    const paidAt = new Date(Math.min(Date.parse(vnAt(-opts.daysAgo, '10:30')), Date.now() - 60_000)).toISOString();
    if (opts.pay === 'FULL' || opts.pay === 'PARTIAL') {
      const amount = opts.pay === 'FULL' ? e.amountDue : Math.round(e.amountDue / 2 / 100_000) * 100_000;
      await post(opts.cs, `/crm/enrollments/${conv.enrollmentId}/payments`, { amount, method: pick(['TRANSFER', 'TRANSFER', 'CASH', 'CARD']), paidAt }, idem());
      if (opts.gift && opts.pay === 'FULL' && chance(0.7)) {
        const giftId = (await get(opts.cs, `/crm/enrollments/${conv.enrollmentId}`)).data.gifts[0]?.id;
        if (giftId) await post(opts.cs, `/crm/enrollment-gifts/${giftId}/status`, { status: 'DELIVERED' });
      }
    } else if (opts.pay === 'PENDING') {
      // Sale ghi khoản thu → chờ CS xác nhận
      await post(opts.sale, `/crm/enrollments/${conv.enrollmentId}/payments`, { amount: 2_000_000, method: 'TRANSFER', reference: 'FT2610xxxx', paidAt }, idem());
    }
    return { ...conv, name: c.childName };
  }

  type Enrolled = Awaited<ReturnType<typeof enrol>>;
  const classMembers = new Map<string, Enrolled[]>();
  async function fill(cls: { id: string; startDate: string }, count: number, base: Omit<Parameters<typeof enrol>[0], 'pay' | 'daysAgo' | 'startDate' | 'sale'>, salesBy: Actor[]) {
    const list: Enrolled[] = [];
    for (let i = 0; i < count; i++) {
      const daysAgo = Math.max(1, Math.round((Date.now() - Date.parse(cls.startDate)) / DAY) + 3 + Math.floor(rand() * 10));
      list.push(
        await enrol({
          ...base,
          sale: salesBy[i % salesBy.length]!,
          startDate: cls.startDate < vnDate(0) ? cls.startDate : vnDate(0),
          pay: chance(0.7) ? 'FULL' : 'PARTIAL',
          promotionId: chance(0.5) ? promoAutumn : undefined,
          gift: chance(0.5) ? pick([balo, aothun]) : undefined,
          daysAgo: Math.min(daysAgo, 45),
        }),
      );
    }
    classMembers.set(cls.id, list);
    return list;
  }

  await fill(robCgA, 10, { cs: csCg, cm: cmCg, subjectId: rob.id, packageId: rob6, levelId: level(rob, 'ROB1') }, [saleLinh, saleNam, slCg]);
  const scrMembers = await fill(scrCgA, 7, { cs: csCg, cm: cmCg, subjectId: scr.id, packageId: scr3, levelId: level(scr, 'SCR1') }, [saleNam, saleLinh]);
  // Một bé mua gói 1 tháng → sắp hết buổi
  scrMembers.push(await enrol({ sale: saleLinh, cs: csCg, cm: cmCg, subjectId: scr.id, packageId: scr1, levelId: level(scr, 'SCR1'), startDate: scrCgA.startDate, pay: 'FULL', daysAgo: 27 }));
  await fill(robLbA, 8, { cs: csLb, cm: cmLb, subjectId: rob.id, packageId: rob6, levelId: level(rob, 'ROB1') }, [saleDuc]);
  // Lớp sắp khai giảng: vài bé đã đóng tiền
  await fill(robCgB, 4, { cs: csCg, cm: cmCg, subjectId: rob.id, packageId: rob3, levelId: level(rob, 'ROB2') }, [saleLinh, saleNam]);

  // Chờ xếp lớp (đã đóng tiền, chưa có lớp)
  for (const [sale, cs, cm, subj, pkg, lv] of [
    [saleNam, csCg, cmCg, scr.id, scr3, level(scr, 'SCR1')],
    [saleLinh, csCg, cmCg, rob.id, rob6, level(rob, 'ROB1')],
    [saleDuc, csLb, cmLb, scr.id, scr3, level(scr, 'SCR1')],
  ] as const) {
    await enrol({ sale, cs, cm, subjectId: subj, packageId: pkg, levelId: lv, startDate: vnDate(0), pay: 'FULL', daysAgo: 2 });
  }
  // Chờ thu tiền, chờ xác nhận, chờ duyệt ưu đãi
  await enrol({ sale: saleLinh, cs: csCg, cm: cmCg, subjectId: rob.id, packageId: rob6, levelId: level(rob, 'ROB1'), startDate: vnDate(3), pay: 'NONE', daysAgo: 1 });
  await enrol({ sale: saleNam, cs: csCg, cm: cmCg, subjectId: rob.id, packageId: rob3, levelId: level(rob, 'ROB1'), startDate: vnDate(3), pay: 'PENDING', daysAgo: 0 });
  await enrol({ sale: saleLinh, cs: csCg, cm: cmCg, subjectId: rob.id, packageId: rob6, levelId: level(rob, 'ROB1'), startDate: vnDate(5), pay: 'PARTIAL', extraDiscount: 800_000, promotionId: promoSibling, daysAgo: 1 });
  await enrol({ sale: saleDuc, cs: csLb, cm: cmLb, subjectId: rob.id, packageId: rob6, levelId: level(rob, 'ROB1'), startDate: vnDate(5), pay: 'NONE', extraDiscount: 3_000_000, daysAgo: 0 });
  // Đăng ký bị huỷ → lead về S5A, đánh dấu "đăng ký đã huỷ" chờ sale chọn lại trạng thái
  const cancelled = await enrol({ sale: saleNam, cs: csCg, cm: cmCg, subjectId: scr.id, packageId: scr3, levelId: level(scr, 'SCR1'), startDate: vnDate(4), pay: 'NONE', daysAgo: 2 });
  await post(cmCg, `/crm/enrollments/${cancelled.enrollmentId}/cancel`, { reason: 'Phụ huynh đổi lịch công tác, xin huỷ' });
  await drain();
  log('đăng ký + thu tiền (học viên đã sang LMS)');

  // ── Xếp lớp, lùi ngày vào lớp về ngày khai giảng (để điểm danh các buổi đã qua)
  for (const [cls, cs] of [
    [robCgA, csCg],
    [scrCgA, csCg],
    [robLbA, csLb],
    [robCgB, csCg],
  ] as const) {
    for (const m of classMembers.get(cls.id) ?? []) await post(cs, `/lms/classes/${cls.id}/learners`, { learnerId: m.studentId, enrollmentId: m.enrollmentId });
    await lmsDb
      .update(classLearners)
      .set({ joinedAt: new Date(Date.parse(`${cls.startDate}T00:00:00+07:00`)) })
      .where(and(eq(classLearners.classId, cls.id), eq(classLearners.status, 'ACTIVE')));
  }
  await drain();
  log('xếp lớp');

  // ── Điểm danh + nhận xét các buổi đã qua
  const COMMENTS = [
    'Bé tập trung tốt, hoàn thành mô hình đúng giờ.',
    'Hôm nay bé hơi mất tập trung cuối giờ, cần nhắc nhở thêm.',
    'Bé sáng tạo, tự thêm cảm biến cho robot.',
    'Bé làm việc nhóm tốt, chủ động giúp bạn.',
    'Bé hiểu bài nhanh, nên cho thêm thử thách.',
    'Bé còn rụt rè khi trình bày, cô sẽ khuyến khích thêm.',
  ];
  let finalized = 0;
  for (const [cls, teacher] of [
    [robCgA, gvLan],
    [scrCgA, gvMinh],
    [robLbA, gvKhoa],
  ] as const) {
    const detail = (await get(teacher, `/lms/classes/${cls.id}`)).data as { sessions: Array<{ id: string; status: string; endsAt: string; startsAt: string }> };
    const past = detail.sessions.filter((s) => s.status === 'SCHEDULED' && new Date(s.endsAt).getTime() < Date.now());
    const members = classMembers.get(cls.id)!;
    for (const [idx, s] of past.entries()) {
      const lastThree = idx >= past.length - 3;
      const records = members.map((m, i) => {
        // Bé thứ 4 lớp ROB1-CG-A vắng 3 buổi gần nhất → cảnh báo vắng liên tiếp
        if (cls === robCgA && i === 3 && lastThree) return { learnerId: m.studentId, status: 'ABSENT', note: 'Phụ huynh báo bé ốm' };
        const r = rand();
        const status = r < 0.84 ? 'PRESENT' : r < 0.92 ? 'LATE' : r < 0.96 ? 'ABSENT' : 'EXCUSED';
        return { learnerId: m.studentId, status, note: status === 'EXCUSED' ? 'Xin nghỉ có phép' : null };
      });
      await post(teacher, `/lms/sessions/${s.id}/attendance`, { records, finalize: true });
      await patch(teacher, `/lms/sessions/${s.id}`, { topic: `Bài ${idx + 1}: ${pick(['Làm quen bộ kit', 'Động cơ và bánh xe', 'Cảm biến chạm', 'Vòng lặp', 'Điều kiện rẽ nhánh', 'Dự án nhóm', 'Cảm biến màu', 'Trò chơi tương tác'])}` });
      if (idx >= past.length - 2) {
        const present = records.filter((r) => r.status === 'PRESENT' || r.status === 'LATE');
        await post(teacher, `/lms/sessions/${s.id}/feedback`, {
          items: present.map((r) => ({
            learnerId: r.learnerId,
            ratings: { focus: 3 + Math.floor(rand() * 3), creativity: 3 + Math.floor(rand() * 3), teamwork: 3 + Math.floor(rand() * 3), skill: 3 + Math.floor(rand() * 3) },
            comment: pick(COMMENTS),
          })),
        });
      }
      finalized++;
    }

    // Bài tập: 2 bài, bài cũ đã chấm, bài mới mới có vài bé nộp
    const a1 = (await post(teacher, `/lms/classes/${cls.id}/assignments`, { title: 'Thiết kế robot theo chủ đề tự chọn', description: 'Vẽ phác thảo và mô tả chức năng robot.', dueAt: vnAt(-7, '21:00'), maxScore: 10 })).data;
    await post(teacher, `/lms/assignments/${a1.id}/grades`, {
      items: members.map((m) => (chance(0.85) ? { learnerId: m.studentId, status: 'GRADED', score: 6 + Math.floor(rand() * 5), comment: pick(['Ý tưởng tốt', 'Trình bày rõ ràng', 'Cần chi tiết hơn']) } : { learnerId: m.studentId, status: 'MISSING' })),
    });
    const a2 = (await post(teacher, `/lms/classes/${cls.id}/assignments`, { title: 'Lập trình robot đi theo vạch', description: 'Quay video robot chạy hết đường đua.', dueAt: vnAt(3, '21:00'), maxScore: 10 })).data;
    const submitted = members.filter(() => chance(0.4)).map((m) => ({ learnerId: m.studentId, status: 'SUBMITTED' }));
    if (submitted.length) await post(teacher, `/lms/assignments/${a2.id}/grades`, { items: submitted });
  }
  await drain();
  log(`điểm danh ${finalized} buổi, nhận xét, bài tập`);

  // Bảo lưu một bé
  const paused = classMembers.get(robLbA.id)![7]!;
  await post(csLb, `/crm/students/${paused.studentId}/status`, { status: 'PAUSED', reason: 'Gia đình đi công tác 1 tháng', effectiveDate: vnDate(0) });

  // ── Phễu lead: đủ các trạng thái
  const robSessions = ((await get(admin, `/lms/classes/${robCgA.id}`)).data.sessions as Array<{ id: string; status: string; startsAt: string }>).filter(
    (s) => s.status === 'SCHEDULED' && new Date(s.startsAt).getTime() > Date.now(),
  );
  const pipeline: Array<[Actor, string]> = [
    [saleLinh, cg],
    [saleNam, cg],
    [slCg, cg],
    [saleDuc, lb],
  ];
  const LOST_REASONS = ['Chọn trung tâm gần nhà hơn', 'Học phí cao so với dự kiến', 'Lịch học không phù hợp'];
  /** Thời điểm hẹn ở tương lai — API không nhận lịch quá khứ. */
  const later = () => vnAt(1 + Math.floor(rand() * 5), '10:00');
  const book = async (sale: Actor, leadId: string, scheduledAt: string) =>
    (await post(sale, `/crm/leads/${leadId}/appointments`, { type: 'EXPERIENCE', scheduledAt, note: 'Trải nghiệm lắp robot 45 phút' })).data as { id: string };
  const attended = async (sale: Actor, leadId: string) => {
    const appt = await book(sale, leadId, vnAt(-2, '17:30'));
    await post(sale, `/crm/appointments/${appt.id}/status`, { status: 'ATTENDED', resultNote: 'Bé rất hào hứng, phụ huynh hỏi lịch lớp tối' });
  };
  // 14 kịch bản × 2 = đủ S1A … S4C (S5A / S5B đến từ các đăng ký ở trên)
  for (let i = 0; i < 28; i++) {
    const [sale] = pipeline[i % pipeline.length]!;
    const subject = chance(0.6) ? rob.id : scr.id;
    const { lead } = await newLead(sale, subject, Math.floor(rand() * 20));
    const id = lead.id as string;
    const talked = (status: string, extra: Body = {}) =>
      post(sale, `/crm/leads/${id}/calls`, { outcome: 'TALKED', note: pick(['Phụ huynh quan tâm, muốn cho bé học thử', 'Đã tư vấn lộ trình, gửi học phí qua Zalo']), status, nextFollowUpAt: later(), ...extra });
    switch (i % 14) {
      case 0: // S1A — chưa gọi
        break;
      case 1: // S1B
        await post(sale, `/crm/leads/${id}/calls`, { outcome: pick(['NO_ANSWER', 'BUSY']), note: 'Chưa nghe máy', status: 'S1B', nextFollowUpAt: later() });
        break;
      case 2: // S1B quá hạn khai thác (lần gọi đầu > 120 ngày) — lùi thẳng trong DB
        await post(sale, `/crm/leads/${id}/calls`, { outcome: 'CALL_BACK', note: 'Phụ huynh bận, hẹn gọi lại sau', status: 'S1B', nextFollowUpAt: later() });
        await crmDb
          .update(leads)
          .set({ firstCalledAt: new Date(Date.now() - (130 + Math.floor(rand() * 30)) * DAY) })
          .where(eq(leads.id, id));
        createdLeads[createdLeads.length - 1]!.createdDaysAgo = 160;
        break;
      case 3: // S1C — sai số
        await post(sale, `/crm/leads/${id}/calls`, { outcome: 'WRONG_NUMBER', note: 'Số không đúng người', status: 'S1C', lostReason: 'Sai số điện thoại' });
        break;
      case 4: // S2A
        await talked('S2A');
        break;
      case 5: // S2B
        await talked('S2B', { note: 'Đang cân nhắc học phí, hỏi ý bố' });
        break;
      case 6: // S2C
        await talked('S2C', { lostReason: pick(LOST_REASONS), nextFollowUpAt: null });
        break;
      case 7: // S3A
        await talked('S2A');
        await book(sale, id, vnAt(1 + (i % 5), '17:30'));
        break;
      case 8: // S3B — học thử trong buổi LMS (hoặc trải nghiệm), phụ huynh đã xác nhận
        if (robSessions.length && sale !== saleDuc) {
          const s = robSessions[i % Math.min(3, robSessions.length)]!;
          const appt = (await post(sale, `/crm/leads/${id}/appointments`, { type: 'TRIAL', scheduledAt: s.startsAt, lmsSessionId: s.id })).data;
          await post(sale, `/crm/appointments/${appt.id}/status`, { status: 'CONFIRMED' });
        } else {
          await post(sale, `/crm/appointments/${(await book(sale, id, vnAt(2, '17:30'))).id}/status`, { status: 'CONFIRMED' });
        }
        break;
      case 9: {
        // S3C — không đến
        const appt = await book(sale, id, vnAt(-3, '17:30'));
        await post(sale, `/crm/appointments/${appt.id}/status`, { status: 'NO_SHOW' });
        break;
      }
      case 10: // S4A
        await attended(sale, id);
        break;
      case 11: // S4B — hẹn ngày đóng phí
        await attended(sale, id);
        await post(sale, `/crm/leads/${id}/status`, { status: 'S4B', note: 'Phụ huynh hẹn đóng phí cuối tuần', nextFollowUpAt: vnAt(3, '09:00') });
        break;
      case 12: // S4C — từ chối sau trial
        await attended(sale, id);
        await post(sale, `/crm/leads/${id}/status`, { status: 'S4C', note: 'Phụ huynh báo không đăng ký', lostReason: pick(LOST_REASONS) });
        break;
      case 13: // S1 lên thẳng S3 (đặt lịch ngay trong cuộc gọi đầu)
        await book(sale, id, vnAt(2, '18:00'));
        break;
    }
    // Một số lead đang mở đến hạn gọi lại (đã quá / hôm nay). API không nhận lịch quá khứ nên lùi thẳng trong DB.
    if ([1, 4, 5].includes(i % 14) && chance(0.6)) await crmDb.update(leads).set({ nextFollowUpAt: new Date(vnAt(-Math.floor(rand() * 3), '09:00')) }).where(eq(leads.id, id));
  }
  await drain();
  log('28 lead ở các trạng thái + lịch hẹn');

  // Lùi ngày tạo lead cho thống kê trông thật
  for (const l of createdLeads) {
    const at = new Date(Date.now() - l.createdDaysAgo * DAY - Math.floor(rand() * 8) * 3_600_000);
    await crmDb.update(leads).set({ createdAt: at }).where(inArray(leads.id, [l.id]));
  }

  await seedReports();

  console.log(`\nXong. Đăng nhập bằng các tài khoản @zero1.local ở trên, mật khẩu: ${DEMO_PASSWORD}`);
  console.log('Ví dụ: sale.linh (SALE), cs.trang (CS), cm.thao (CM), am.hung (AM), tl.quang (TL), gv.lan (GV), ta.vy (TA)');
}
