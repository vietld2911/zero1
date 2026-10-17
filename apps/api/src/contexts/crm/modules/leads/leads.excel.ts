import ExcelJS from 'exceljs';
import { normalizePhone } from '../../../../platform/text.js';
import { LEAD_SOURCES } from '../../db/schema.js';
import type { LeadInput, LeadSource } from './leads.service.js';

const MAX_ROWS = 2000;

/** Nhãn tiếng Việt ↔ mã nguồn. */
export const SOURCE_LABELS: Record<LeadSource, string> = {
  FACEBOOK: 'Facebook',
  ZALO: 'Zalo',
  WEBSITE: 'Website',
  HOTLINE: 'Hotline',
  REFERRAL: 'Giới thiệu',
  WALK_IN: 'Đến trực tiếp',
  EVENT: 'Sự kiện',
  OTHER: 'Khác',
};

const COLUMNS = [
  { header: 'Họ tên phụ huynh *', key: 'parentName', width: 26 },
  { header: 'Số điện thoại *', key: 'parentPhone', width: 16 },
  { header: 'Email', key: 'parentEmail', width: 24 },
  { header: 'Tên học sinh *', key: 'childName', width: 24 },
  { header: 'Năm sinh', key: 'childBirthYear', width: 10 },
  { header: 'Trường', key: 'school', width: 22 },
  { header: 'Nguồn', key: 'source', width: 16 },
  { header: 'Ghi chú', key: 'notes', width: 36 },
] as const;

export async function buildLeadTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Leads');
  ws.columns = COLUMNS.map((c) => ({ ...c }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF13233F' } };
  ws.addRow({ parentName: 'Nguyễn Văn An', parentPhone: '0912345678', childName: 'Nguyễn Minh Khôi', childBirthYear: 2017, school: 'TH Dịch Vọng', source: 'Facebook' });
  // Danh sách chọn nguồn cho cột G
  const sources = Object.values(SOURCE_LABELS);
  for (let r = 2; r <= MAX_ROWS + 1; r++) {
    ws.getCell(`G${r}`).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${sources.join(',')}"`] };
  }
  const guide = wb.addWorksheet('Hướng dẫn');
  guide.addRows([
    ['Cột có dấu * là bắt buộc.'],
    ['Số điện thoại: 10 số, bắt đầu bằng 0 (chấp nhận +84…).'],
    [`Nguồn: ${sources.join(', ')}. Bỏ trống = Khác.`],
    [`Tối đa ${MAX_ROWS} dòng mỗi lần. Dòng trùng (cùng SĐT + tên học sinh với lead đang chăm sóc) sẽ bị bỏ qua.`],
  ]);
  guide.getColumn(1).width = 100;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return '';
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text; // hyperlink
    if ('result' in v) return String(v.result ?? ''); // công thức
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
  }
  return String(v).trim();
}

export interface ParsedLeads {
  rows: Array<{ row: number; input: LeadInput }>;
  errors: Array<{ row: number; reason: string }>;
}

/** Đọc file theo đúng mẫu; trả dòng hợp lệ + lỗi từng dòng (không dừng ở lỗi đầu tiên). */
export async function parseLeadWorkbook(buffer: Buffer): Promise<ParsedLeads> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return { rows: [], errors: [{ row: 0, reason: 'File không đọc được — hãy dùng file .xlsx theo mẫu' }] };
  }
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ row: 0, reason: 'File không có trang tính' }] };

  const labelToSource = new Map(Object.entries(SOURCE_LABELS).map(([code, label]) => [label.toLowerCase(), code as LeadSource]));
  const result: ParsedLeads = { rows: [], errors: [] };
  const last = Math.min(ws.rowCount, MAX_ROWS + 1);
  if (ws.rowCount > MAX_ROWS + 1) result.errors.push({ row: 0, reason: `Chỉ đọc ${MAX_ROWS} dòng đầu` });

  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    const get = (i: number) => cellText(row.getCell(i).value);
    const values = { parentName: get(1), phone: get(2), email: get(3), childName: get(4), birth: get(5), school: get(6), source: get(7), notes: get(8) };
    if (Object.values(values).every((v) => !v)) continue; // dòng trống

    const problems: string[] = [];
    const phone = normalizePhone(values.phone);
    if (!values.parentName) problems.push('thiếu họ tên phụ huynh');
    if (!phone) problems.push('SĐT không hợp lệ');
    if (!values.childName) problems.push('thiếu tên học sinh');
    const birthYear = values.birth ? Number(values.birth) : null;
    if (birthYear !== null && (!Number.isInteger(birthYear) || birthYear < 2000 || birthYear > 2030)) problems.push('năm sinh không hợp lệ');
    const source = values.source ? (labelToSource.get(values.source.toLowerCase()) ?? (LEAD_SOURCES as readonly string[]).find((s) => s === values.source.toUpperCase())) : 'OTHER';
    if (!source) problems.push(`nguồn "${values.source}" không có trong danh sách`);
    if (values.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) problems.push('email không hợp lệ');

    if (problems.length) {
      result.errors.push({ row: r, reason: problems.join(', ') });
      continue;
    }
    result.rows.push({
      row: r,
      input: {
        parentName: values.parentName.slice(0, 150),
        parentPhone: phone!,
        parentEmail: values.email || null,
        childName: values.childName.slice(0, 150),
        childBirthYear: birthYear,
        school: values.school.slice(0, 200) || null,
        source: source as LeadSource,
        notes: values.notes.slice(0, 2000) || null,
      },
    });
  }
  return result;
}
