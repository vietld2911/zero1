CREATE TABLE `branch_payment_accounts` (
	`branch_id` char(26) NOT NULL,
	`bank_bin` varchar(10) NOT NULL,
	`bank_name` varchar(100) NOT NULL,
	`account_no` varchar(30) NOT NULL,
	`account_name` varchar(100) NOT NULL,
	`updated_by` char(26),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `branch_payment_accounts_branch_id` PRIMARY KEY(`branch_id`)
);
--> statement-breakpoint
CREATE TABLE `discount_approvals` (
	`id` char(26) NOT NULL,
	`enrollment_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`value` bigint NOT NULL,
	`approver_role` varchar(4) NOT NULL,
	`extra_discount` bigint NOT NULL,
	`extra_scholarship_months` int NOT NULL,
	`reason` varchar(500),
	`status` varchar(10) NOT NULL DEFAULT 'PENDING',
	`requested_by` char(26) NOT NULL,
	`reviewed_by` char(26),
	`reviewed_at` datetime(3),
	`review_note` varchar(500),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `discount_approvals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `enrollment_gifts` (
	`id` char(26) NOT NULL,
	`enrollment_id` char(26) NOT NULL,
	`item_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`quantity` int NOT NULL,
	`delivery_condition` varchar(10) NOT NULL,
	`status` varchar(10) NOT NULL DEFAULT 'PENDING',
	`delivered_by` char(26),
	`delivered_at` datetime(3),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `enrollment_gifts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` char(26) NOT NULL,
	`code` varchar(20) NOT NULL,
	`student_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`type` varchar(10) NOT NULL,
	`sale_id` char(26),
	`package_id` char(26) NOT NULL,
	`package_code` varchar(20) NOT NULL,
	`package_name` varchar(150) NOT NULL,
	`subject_id` char(26) NOT NULL,
	`start_level_id` char(26) NOT NULL,
	`start_level_name` varchar(150) NOT NULL,
	`promotion_id` char(26),
	`promotion_code` varchar(30),
	`list_price` bigint NOT NULL,
	`promotion_discount` bigint NOT NULL,
	`extra_discount_requested` bigint NOT NULL,
	`extra_discount_applied` bigint NOT NULL,
	`extra_discount_reason` varchar(500),
	`scholarship_months_requested` int NOT NULL,
	`scholarship_months_granted` int NOT NULL,
	`amount_due` bigint NOT NULL,
	`amount_paid` bigint NOT NULL DEFAULT 0,
	`sessions_purchased` int NOT NULL,
	`sessions_used` int NOT NULL DEFAULT 0,
	`approval_status` varchar(10) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'AWAITING_PAYMENT',
	`start_date` date NOT NULL,
	`end_date` date NOT NULL,
	`pricing_input` json NOT NULL,
	`activated_at` datetime(3),
	`cancelled_at` datetime(3),
	`cancel_reason` varchar(500),
	`note` varchar(1000),
	`idempotency_key` varchar(64),
	`created_by` char(26) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `enrollments_id` PRIMARY KEY(`id`),
	CONSTRAINT `enrollments_code_uq` UNIQUE(`code`),
	CONSTRAINT `enrollments_idem_uq` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `guardians` (
	`id` char(26) NOT NULL,
	`student_id` char(26) NOT NULL,
	`full_name` varchar(150) NOT NULL,
	`relation` varchar(30) NOT NULL,
	`phone` varchar(15) NOT NULL,
	`email` varchar(191),
	`job` varchar(150),
	`is_primary` boolean NOT NULL DEFAULT false,
	CONSTRAINT `guardians_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_appointments` (
	`id` char(26) NOT NULL,
	`lead_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`type` varchar(12) NOT NULL,
	`scheduled_at` datetime(3) NOT NULL,
	`lms_session_id` char(26),
	`status` varchar(12) NOT NULL DEFAULT 'SCHEDULED',
	`note` varchar(1000),
	`result_note` varchar(1000),
	`created_by` char(26) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `lead_appointments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lead_call_logs` (
	`id` char(26) NOT NULL,
	`lead_id` char(26) NOT NULL,
	`user_id` char(26) NOT NULL,
	`outcome` varchar(20) NOT NULL,
	`note` varchar(1000),
	`next_follow_up_at` datetime(3),
	`called_at` datetime(3) NOT NULL,
	CONSTRAINT `lead_call_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `leads` (
	`id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`owner_id` char(26),
	`parent_name` varchar(150) NOT NULL,
	`parent_phone` varchar(15) NOT NULL,
	`parent_email` varchar(191),
	`child_name` varchar(150) NOT NULL,
	`child_birth_year` int,
	`school` varchar(200),
	`interest_subject_id` char(26),
	`source` varchar(20) NOT NULL,
	`status` varchar(20) NOT NULL DEFAULT 'NEW',
	`lost_reason` varchar(500),
	`notes` varchar(2000),
	`last_contacted_at` datetime(3),
	`next_follow_up_at` datetime(3),
	`converted_student_id` char(26),
	`created_by` char(26) NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `leads_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` char(26) NOT NULL,
	`enrollment_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`amount` bigint NOT NULL,
	`method` varchar(10) NOT NULL,
	`status` varchar(10) NOT NULL,
	`reference` varchar(100),
	`note` varchar(500),
	`paid_at` datetime(3) NOT NULL,
	`recorded_by` char(26) NOT NULL,
	`confirmed_by` char(26),
	`confirmed_at` datetime(3),
	`idempotency_key` varchar(64),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `payments_id` PRIMARY KEY(`id`),
	CONSTRAINT `payments_idem_uq` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `sequences` (
	`name` varchar(50) NOT NULL,
	`value` int NOT NULL,
	CONSTRAINT `sequences_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `session_usages` (
	`enrollment_id` char(26) NOT NULL,
	`lms_session_id` char(26) NOT NULL,
	`learner_id` char(26) NOT NULL,
	`attendance_status` varchar(10) NOT NULL,
	`consumed` boolean NOT NULL,
	`session_starts_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `session_usages_enrollment_id_lms_session_id_pk` PRIMARY KEY(`enrollment_id`,`lms_session_id`)
);
--> statement-breakpoint
CREATE TABLE `student_documents` (
	`id` char(26) NOT NULL,
	`student_id` char(26) NOT NULL,
	`name` varchar(255) NOT NULL,
	`url` varchar(500) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size` int NOT NULL,
	`uploaded_by` char(26) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `student_documents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `student_status_logs` (
	`id` char(26) NOT NULL,
	`student_id` char(26) NOT NULL,
	`from_status` varchar(10) NOT NULL,
	`to_status` varchar(10) NOT NULL,
	`reason` varchar(500),
	`effective_date` date NOT NULL,
	`actor_id` char(26) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `student_status_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `students` (
	`id` char(26) NOT NULL,
	`code` varchar(20) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`owner_id` char(26),
	`care_id` char(26),
	`full_name` varchar(150) NOT NULL,
	`birth_date` date,
	`gender` varchar(6),
	`school` varchar(200),
	`address` varchar(300),
	`avatar_url` varchar(500),
	`notes` varchar(2000),
	`status` varchar(10) NOT NULL DEFAULT 'PENDING',
	`source_lead_id` char(26),
	`current_class_name` varchar(150),
	`current_level_name` varchar(150),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `students_id` PRIMARY KEY(`id`),
	CONSTRAINT `students_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE INDEX `discount_approvals_status_idx` ON `discount_approvals` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `discount_approvals_enrollment_idx` ON `discount_approvals` (`enrollment_id`);--> statement-breakpoint
CREATE INDEX `enrollment_gifts_enrollment_idx` ON `enrollment_gifts` (`enrollment_id`);--> statement-breakpoint
CREATE INDEX `enrollments_student_idx` ON `enrollments` (`student_id`);--> statement-breakpoint
CREATE INDEX `enrollments_branch_status_idx` ON `enrollments` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `enrollments_sale_idx` ON `enrollments` (`sale_id`);--> statement-breakpoint
CREATE INDEX `guardians_student_idx` ON `guardians` (`student_id`);--> statement-breakpoint
CREATE INDEX `guardians_phone_idx` ON `guardians` (`phone`);--> statement-breakpoint
CREATE INDEX `lead_appointments_lead_idx` ON `lead_appointments` (`lead_id`);--> statement-breakpoint
CREATE INDEX `lead_appointments_branch_time_idx` ON `lead_appointments` (`branch_id`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `lead_call_logs_lead_idx` ON `lead_call_logs` (`lead_id`,`called_at`);--> statement-breakpoint
CREATE INDEX `leads_branch_status_idx` ON `leads` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `leads_owner_idx` ON `leads` (`owner_id`,`status`);--> statement-breakpoint
CREATE INDEX `leads_phone_idx` ON `leads` (`parent_phone`);--> statement-breakpoint
CREATE INDEX `leads_follow_up_idx` ON `leads` (`next_follow_up_at`);--> statement-breakpoint
CREATE INDEX `payments_enrollment_idx` ON `payments` (`enrollment_id`);--> statement-breakpoint
CREATE INDEX `payments_branch_status_idx` ON `payments` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `student_documents_student_idx` ON `student_documents` (`student_id`);--> statement-breakpoint
CREATE INDEX `student_status_logs_student_idx` ON `student_status_logs` (`student_id`);--> statement-breakpoint
CREATE INDEX `students_branch_status_idx` ON `students` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `students_owner_idx` ON `students` (`owner_id`);