CREATE TABLE `lead_status_logs` (
	`id` char(26) NOT NULL,
	`lead_id` char(26) NOT NULL,
	`from_status` varchar(20),
	`to_status` varchar(20) NOT NULL,
	`source` varchar(12) NOT NULL,
	`note` varchar(1000),
	`call_log_id` char(26),
	`actor_id` char(26),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `lead_status_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `leads` MODIFY COLUMN `status` varchar(20) NOT NULL DEFAULT 'S1A';--> statement-breakpoint
ALTER TABLE `leads` ADD `status_changed_at` datetime(3);--> statement-breakpoint
ALTER TABLE `leads` ADD `first_called_at` datetime(3);--> statement-breakpoint
ALTER TABLE `leads` ADD `reached_s2_at` datetime(3);--> statement-breakpoint
ALTER TABLE `leads` ADD `reached_s3_at` datetime(3);--> statement-breakpoint
ALTER TABLE `leads` ADD `reached_s4_at` datetime(3);--> statement-breakpoint
ALTER TABLE `leads` ADD `reached_s5_at` datetime(3);--> statement-breakpoint
ALTER TABLE `leads` ADD `enrollment_cancelled_at` datetime(3);--> statement-breakpoint
CREATE INDEX `lead_status_logs_lead_idx` ON `lead_status_logs` (`lead_id`,`created_at`);--> statement-breakpoint-- GĐ7: chuyển dữ liệu cũ sang trạng thái S1–S5 (docs/gd7-lead-stages.md §2).
-- Mốc thời gian trước (tính từ cuộc gọi / lịch hẹn / đăng ký), rồi mới đổi mã trạng thái.
UPDATE `leads` SET `status_changed_at` = `updated_at`;--> statement-breakpoint
UPDATE `leads` l SET l.`first_called_at` = (SELECT MIN(c.`called_at`) FROM `lead_call_logs` c WHERE c.`lead_id` = l.`id`);--> statement-breakpoint
UPDATE `leads` l SET l.`reached_s2_at` = (SELECT MIN(c.`called_at`) FROM `lead_call_logs` c WHERE c.`lead_id` = l.`id` AND c.`outcome` IN ('TALKED', 'CALL_BACK'));--> statement-breakpoint
UPDATE `leads` l SET l.`reached_s3_at` = (SELECT MIN(a.`created_at`) FROM `lead_appointments` a WHERE a.`lead_id` = l.`id`);--> statement-breakpoint
UPDATE `leads` l SET l.`reached_s4_at` = (SELECT MIN(a.`scheduled_at`) FROM `lead_appointments` a WHERE a.`lead_id` = l.`id` AND a.`status` = 'ATTENDED');--> statement-breakpoint
UPDATE `leads` l SET l.`reached_s5_at` = (SELECT MIN(e.`created_at`) FROM `enrollments` e WHERE e.`student_id` = l.`converted_student_id`) WHERE l.`converted_student_id` IS NOT NULL;--> statement-breakpoint
UPDATE `leads` SET `status` = 'S1A' WHERE `status` = 'NEW';--> statement-breakpoint
UPDATE `leads` l SET l.`status` = IF(EXISTS (SELECT 1 FROM `lead_call_logs` c WHERE c.`lead_id` = l.`id` AND c.`outcome` IN ('TALKED', 'CALL_BACK')), 'S2A', 'S1B') WHERE l.`status` = 'CONTACTING';--> statement-breakpoint
UPDATE `leads` SET `status` = 'S3A' WHERE `status` = 'SCHEDULED';--> statement-breakpoint
UPDATE `leads` SET `status` = 'S4A' WHERE `status` = 'ATTENDED';--> statement-breakpoint
UPDATE `leads` SET `status` = 'S3C' WHERE `status` = 'NO_SHOW';--> statement-breakpoint
UPDATE `leads` l
SET l.`status` = IF(EXISTS (SELECT 1 FROM `enrollments` e WHERE e.`student_id` = l.`converted_student_id` AND e.`activated_at` IS NOT NULL), 'S5B', 'S5A')
WHERE l.`status` = 'CONVERTED';--> statement-breakpoint
UPDATE `leads` l
SET l.`status` = CASE
  WHEN EXISTS (SELECT 1 FROM `lead_appointments` a WHERE a.`lead_id` = l.`id` AND a.`status` = 'ATTENDED') THEN 'S4C'
  WHEN EXISTS (SELECT 1 FROM `lead_appointments` a WHERE a.`lead_id` = l.`id`)
    OR EXISTS (SELECT 1 FROM `lead_call_logs` c WHERE c.`lead_id` = l.`id` AND c.`outcome` = 'TALKED') THEN 'S2C'
  ELSE 'S1C'
END
WHERE l.`status` = 'LOST';--> statement-breakpoint
-- Điền mốc còn trống ở bước hiện tại (lấy lần đổi trạng thái cuối), rồi các bước thấp hơn:
-- mốc bước thấp còn trống hoặc muộn hơn mốc bước cao → lấy mốc bước cao (phễu không hụt, không ngược thứ tự).
UPDATE `leads` SET `reached_s5_at` = COALESCE(`reached_s5_at`, `status_changed_at`) WHERE `status` IN ('S5A', 'S5B');--> statement-breakpoint
UPDATE `leads` SET `reached_s4_at` = COALESCE(`reached_s4_at`, `status_changed_at`) WHERE `status` IN ('S4A', 'S4B', 'S4C');--> statement-breakpoint
UPDATE `leads` SET `reached_s3_at` = COALESCE(`reached_s3_at`, `status_changed_at`) WHERE `status` IN ('S3A', 'S3B', 'S3C');--> statement-breakpoint
UPDATE `leads` SET `reached_s2_at` = COALESCE(`reached_s2_at`, `status_changed_at`) WHERE `status` IN ('S2A', 'S2B', 'S2C');--> statement-breakpoint
UPDATE `leads` SET `reached_s4_at` = `reached_s5_at` WHERE `reached_s5_at` IS NOT NULL AND (`reached_s4_at` IS NULL OR `reached_s4_at` > `reached_s5_at`);--> statement-breakpoint
UPDATE `leads` SET `reached_s3_at` = `reached_s4_at` WHERE `reached_s4_at` IS NOT NULL AND (`reached_s3_at` IS NULL OR `reached_s3_at` > `reached_s4_at`);--> statement-breakpoint
UPDATE `leads` SET `reached_s2_at` = `reached_s3_at` WHERE `reached_s3_at` IS NOT NULL AND (`reached_s2_at` IS NULL OR `reached_s2_at` > `reached_s3_at`);
