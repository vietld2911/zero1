import { readFileSync } from 'node:fs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

// Logo bản tối cho nền giấy trắng (640×181).
const LOGO = readFileSync(new URL('../../../../../assets/logo-dark.png', import.meta.url));
const NAVY = '13233F';

export interface EnrollmentFormData {
  branchName: string;
  enrollmentCode: string;
  createdDate: string;
  student: { code: string; fullName: string; birthDate: string | null; gender: string | null; school: string | null; address: string | null };
  guardians: Array<{ fullName: string; relation: string; phone: string; email: string | null; job: string | null }>;
  course: { packageName: string; startLevelName: string; sessions: number; scholarshipMonths: number; startDate: string; endDate: string };
  fees: { listPrice: number; promotionCode: string | null; promotionDiscount: number; extraDiscount: number; amountDue: number; amountPaid: number };
  gifts: Array<{ name: string; quantity: number; unit: string }>;
  saleName: string | null;
}

const money = (v: number) => `${new Intl.NumberFormat('vi-VN').format(v)} đ`;
const date = (d: string | null) => (d ? d.split('-').reverse().join('/') : '');

function label(text: string) {
  return new TextRun({ text, bold: true, color: NAVY });
}

/** Bảng 2 cột nhãn / giá trị, không viền. */
function infoTable(rows: Array<[string, string]>) {
  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: none, bottom: none, left: none, right: none, insideHorizontal: none, insideVertical: none },
    rows: rows.map(
      ([k, v]) =>
        new TableRow({
          children: [
            new TableCell({ width: { size: 32, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: k, color: '5B6B84' })] })] }),
            new TableCell({ width: { size: 68, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: v, bold: true })] })] }),
          ],
        }),
    ),
  });
}

/** Bảng có viền + dòng tiêu đề nền navy. */
function gridTable(header: string[], rows: string[][], widths: number[]) {
  const cell = (text: string, opts: { head?: boolean; width: number; right?: boolean }) =>
    new TableCell({
      width: { size: opts.width, type: WidthType.PERCENTAGE },
      shading: opts.head ? { fill: NAVY } : undefined,
      children: [
        new Paragraph({
          alignment: opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT,
          children: [new TextRun({ text, bold: opts.head, color: opts.head ? 'FFFFFF' : undefined })],
        }),
      ],
    });
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, { head: true, width: widths[i]! })) }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, { width: widths[i]!, right: i === r.length - 1 && /\d đ$/.test(c) })) })),
    ],
  });
}

function heading(text: string) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 }, children: [new TextRun({ text, bold: true, color: NAVY, size: 26 })] });
}

export async function buildEnrollmentForm(d: EnrollmentFormData): Promise<Buffer> {
  const remaining = Math.max(0, d.fees.amountDue - d.fees.amountPaid);
  const feeRows: string[][] = [
    ['Học phí niêm yết', money(d.fees.listPrice)],
    ...(d.fees.promotionDiscount ? [[`Khuyến mại${d.fees.promotionCode ? ` (${d.fees.promotionCode})` : ''}`, `−${money(d.fees.promotionDiscount)}`]] : []),
    ...(d.fees.extraDiscount ? [['Giảm thêm (đã duyệt)', `−${money(d.fees.extraDiscount)}`]] : []),
    ['Phải thu', money(d.fees.amountDue)],
    ['Đã thu', money(d.fees.amountPaid)],
    ['Còn lại', money(remaining)],
  ];

  const doc = new Document({
    creator: 'Zero1',
    title: `Phiếu đăng ký ${d.enrollmentCode}`,
    styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 800, bottom: 800, left: 900, right: 900 } } },
        children: [
          new Paragraph({ children: [new ImageRun({ type: 'png', data: LOGO, transformation: { width: 180, height: 51 } })] }),
          new Paragraph({ spacing: { before: 120 }, children: [new TextRun({ text: d.branchName, color: '5B6B84' })] }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 240, after: 80 },
            children: [new TextRun({ text: 'PHIẾU ĐĂNG KÝ HỌC', bold: true, size: 34, color: NAVY })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: `Số: ${d.enrollmentCode} · Ngày ${date(d.createdDate)}`, color: '5B6B84' })],
          }),

          heading('1. Thông tin học viên'),
          infoTable([
            ['Mã học viên', d.student.code],
            ['Họ và tên', d.student.fullName],
            ['Ngày sinh', date(d.student.birthDate)],
            ['Giới tính', d.student.gender === 'MALE' ? 'Nam' : d.student.gender === 'FEMALE' ? 'Nữ' : ''],
            ['Trường', d.student.school ?? ''],
            ['Địa chỉ', d.student.address ?? ''],
          ]),

          heading('2. Phụ huynh'),
          gridTable(
            ['Họ và tên', 'Quan hệ', 'Điện thoại', 'Email / Nghề nghiệp'],
            d.guardians.map((g) => [g.fullName, g.relation, g.phone, [g.email, g.job].filter(Boolean).join(' · ')]),
            [32, 16, 20, 32],
          ),

          heading('3. Khoá học'),
          infoTable([
            ['Gói học phí', d.course.packageName],
            ['Cấp độ bắt đầu', d.course.startLevelName],
            ['Số buổi', `${d.course.sessions} buổi${d.course.scholarshipMonths ? ` (gồm ${d.course.scholarshipMonths} tháng học bổng)` : ''}`],
            ['Thời gian hiệu lực', `${date(d.course.startDate)} – ${date(d.course.endDate)}`],
          ]),

          heading('4. Học phí'),
          gridTable(['Khoản', 'Số tiền'], feeRows, [65, 35]),

          ...(d.gifts.length ? [heading('5. Quà tặng'), gridTable(['Quà tặng', 'Số lượng'], d.gifts.map((g) => [g.name, `${g.quantity} ${g.unit}`]), [70, 30])] : []),

          new Paragraph({
            spacing: { before: 280 },
            children: [
              label('Cam kết: '),
              new TextRun('Phụ huynh đã được tư vấn về chương trình học, lịch học và chính sách học phí của trung tâm, đồng ý đăng ký cho học viên theo thông tin trên.'),
            ],
          }),

          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
              insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
            },
            rows: [
              new TableRow({
                children: ['PHỤ HUYNH', 'TƯ VẤN VIÊN', 'ĐẠI DIỆN TRUNG TÂM'].map(
                  (t, i) =>
                    new TableCell({
                      width: { size: 33, type: WidthType.PERCENTAGE },
                      children: [
                        new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, bold: true })] }),
                        new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '(Ký, ghi rõ họ tên)', italics: true, color: '5B6B84', size: 18 })] }),
                        new Paragraph({ spacing: { before: 1000 }, alignment: AlignmentType.CENTER, children: [new TextRun(i === 1 ? (d.saleName ?? '') : '')] }),
                      ],
                    }),
                ),
              }),
            ],
          }),
        ],
      },
    ],
  });
  return Packer.toBuffer(doc);
}
