import { sql } from 'drizzle-orm';
import { classLearners, sessions } from '../../db/schema.js';

/**
 * Buổi có học viên trong danh sách điểm danh (cùng quy tắc với `roster()` của sessions.service:
 * vào lớp trước hết ngày VN của buổi, chưa rời lớp trước giờ học). Buổi không có học viên
 * không tính là "quá hạn chưa chốt điểm danh". Dùng trong câu truy vấn có bảng `sessions`.
 */
export const sessionHasRoster = sql<boolean>`EXISTS (SELECT 1 FROM ${classLearners} WHERE ${classLearners.classId} = ${sessions.classId}
  AND ${classLearners.joinedAt} < TIMESTAMPADD(HOUR, -7, TIMESTAMPADD(DAY, 1, DATE(TIMESTAMPADD(HOUR, 7, ${sessions.startsAt}))))
  AND (${classLearners.leftAt} IS NULL OR ${classLearners.leftAt} > ${sessions.startsAt}))`;
