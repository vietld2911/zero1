CREATE TABLE `kpi_targets` (
	`user_id` char(26) NOT NULL,
	`month` varchar(7) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`target_revenue` bigint NOT NULL,
	`updated_by` char(26) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `kpi_targets_user_id_month_pk` PRIMARY KEY(`user_id`,`month`)
);
--> statement-breakpoint
ALTER TABLE `enrollments` ADD `credit_user_id` char(26);--> statement-breakpoint
CREATE INDEX `kpi_targets_branch_month_idx` ON `kpi_targets` (`branch_id`,`month`);--> statement-breakpoint
CREATE INDEX `enrollments_credit_idx` ON `enrollments` (`credit_user_id`);--> statement-breakpoint
CREATE INDEX `payments_paid_idx` ON `payments` (`status`,`paid_at`);--> statement-breakpoint
-- Gán người được tính doanh thu cho đăng ký đã có: mới → sale, tái phí → CS chăm sóc (không có thì sale).
UPDATE `enrollments` SET `credit_user_id` = `sale_id` WHERE `type` = 'NEW';--> statement-breakpoint
UPDATE `enrollments` e JOIN `students` s ON s.`id` = e.`student_id` SET e.`credit_user_id` = COALESCE(s.`care_id`, e.`sale_id`) WHERE e.`type` = 'RENEWAL';
