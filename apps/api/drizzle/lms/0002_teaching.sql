CREATE TABLE `assignments` (
	`id` char(26) NOT NULL,
	`class_id` char(26) NOT NULL,
	`session_id` char(26),
	`title` varchar(200) NOT NULL,
	`description` varchar(4000),
	`due_at` datetime(3),
	`max_score` int NOT NULL DEFAULT 10,
	`attachments` json NOT NULL,
	`created_by` char(26) NOT NULL,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `assignments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `attendance` (
	`session_id` char(26) NOT NULL,
	`learner_id` char(26) NOT NULL,
	`enrollment_id` char(26) NOT NULL,
	`status` varchar(10) NOT NULL,
	`note` varchar(300),
	`consumes_session` boolean NOT NULL DEFAULT false,
	`recorded_by` char(26) NOT NULL,
	`recorded_at` datetime(3) NOT NULL,
	CONSTRAINT `attendance_session_id_learner_id_pk` PRIMARY KEY(`session_id`,`learner_id`)
);
--> statement-breakpoint
CREATE TABLE `class_learners` (
	`id` char(26) NOT NULL,
	`class_id` char(26) NOT NULL,
	`learner_id` char(26) NOT NULL,
	`enrollment_id` char(26) NOT NULL,
	`status` varchar(10) NOT NULL DEFAULT 'ACTIVE',
	`joined_at` datetime(3) NOT NULL,
	`left_at` datetime(3),
	`left_reason` varchar(300),
	CONSTRAINT `class_learners_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `classes` (
	`id` char(26) NOT NULL,
	`code` varchar(30) NOT NULL,
	`name` varchar(150) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`subject_id` char(26) NOT NULL,
	`level_id` char(26) NOT NULL,
	`teacher_id` char(26) NOT NULL,
	`ta_id` char(26),
	`room_id` char(26),
	`capacity` int NOT NULL,
	`start_date` date NOT NULL,
	`schedule` json NOT NULL,
	`total_sessions` int NOT NULL,
	`trial_capacity` int NOT NULL DEFAULT 2,
	`status` varchar(10) NOT NULL DEFAULT 'PLANNED',
	`note` varchar(1000),
	`version` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `classes_id` PRIMARY KEY(`id`),
	CONSTRAINT `classes_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `learner_entitlements` (
	`enrollment_id` char(26) NOT NULL,
	`enrollment_code` varchar(20) NOT NULL,
	`learner_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`subject_id` char(26) NOT NULL,
	`start_level_id` char(26) NOT NULL,
	`sessions_purchased` int NOT NULL,
	`sessions_used` int NOT NULL DEFAULT 0,
	`status` varchar(10) NOT NULL DEFAULT 'ACTIVE',
	`activated_at` datetime(3) NOT NULL,
	CONSTRAINT `learner_entitlements_enrollment_id` PRIMARY KEY(`enrollment_id`)
);
--> statement-breakpoint
CREATE TABLE `learner_level_history` (
	`id` char(26) NOT NULL,
	`learner_id` char(26) NOT NULL,
	`from_level_id` char(26),
	`to_level_id` char(26) NOT NULL,
	`note` varchar(500),
	`promoted_by` char(26) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `learner_level_history_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `learners` (
	`id` char(26) NOT NULL,
	`code` varchar(20) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`full_name` varchar(150) NOT NULL,
	`birth_date` date,
	`gender` varchar(6),
	`avatar_url` varchar(500),
	`status` varchar(10) NOT NULL DEFAULT 'ACTIVE',
	`current_level_id` char(26),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `learners_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `materials` (
	`id` char(26) NOT NULL,
	`level_id` char(26),
	`class_id` char(26),
	`title` varchar(200) NOT NULL,
	`description` varchar(1000),
	`url` varchar(500) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`mime_type` varchar(100) NOT NULL,
	`size` int NOT NULL,
	`uploaded_by` char(26) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `materials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`name` varchar(100) NOT NULL,
	`capacity` int NOT NULL,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `rooms_id` PRIMARY KEY(`id`),
	CONSTRAINT `rooms_branch_name_uq` UNIQUE(`branch_id`,`name`)
);
--> statement-breakpoint
CREATE TABLE `session_feedbacks` (
	`session_id` char(26) NOT NULL,
	`learner_id` char(26) NOT NULL,
	`ratings` json NOT NULL,
	`comment` varchar(2000) NOT NULL,
	`author_id` char(26) NOT NULL,
	`published_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `session_feedbacks_session_id_learner_id_pk` PRIMARY KEY(`session_id`,`learner_id`)
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` char(26) NOT NULL,
	`class_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`index_no` int NOT NULL,
	`starts_at` datetime(3) NOT NULL,
	`ends_at` datetime(3) NOT NULL,
	`teacher_id` char(26) NOT NULL,
	`ta_id` char(26),
	`room_id` char(26),
	`status` varchar(10) NOT NULL DEFAULT 'SCHEDULED',
	`topic` varchar(200),
	`teacher_note` varchar(2000),
	`trial_capacity` int NOT NULL,
	`cancel_reason` varchar(300),
	`finalized_at` datetime(3),
	`finalized_by` char(26),
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assignment_submissions` (
	`assignment_id` char(26) NOT NULL,
	`learner_id` char(26) NOT NULL,
	`status` varchar(10) NOT NULL,
	`submitted_at` datetime(3),
	`score` int,
	`comment` varchar(1000),
	`graded_by` char(26),
	`graded_at` datetime(3),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `assignment_submissions_assignment_id_learner_id_pk` PRIMARY KEY(`assignment_id`,`learner_id`)
);
--> statement-breakpoint
CREATE TABLE `trial_guests` (
	`id` char(26) NOT NULL,
	`session_id` char(26) NOT NULL,
	`appointment_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`child_name` varchar(150) NOT NULL,
	`birth_year` int,
	`parent_name` varchar(150) NOT NULL,
	`parent_phone` varchar(15) NOT NULL,
	`result` varchar(10) NOT NULL DEFAULT 'PENDING',
	`note` varchar(500),
	`checked_by` char(26),
	`checked_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `trial_guests_id` PRIMARY KEY(`id`),
	CONSTRAINT `trial_guests_appointment_uq` UNIQUE(`appointment_id`)
);
--> statement-breakpoint
CREATE INDEX `assignments_class_idx` ON `assignments` (`class_id`);--> statement-breakpoint
CREATE INDEX `attendance_learner_idx` ON `attendance` (`learner_id`);--> statement-breakpoint
CREATE INDEX `attendance_enrollment_idx` ON `attendance` (`enrollment_id`);--> statement-breakpoint
CREATE INDEX `class_learners_class_idx` ON `class_learners` (`class_id`,`status`);--> statement-breakpoint
CREATE INDEX `class_learners_learner_idx` ON `class_learners` (`learner_id`,`status`);--> statement-breakpoint
CREATE INDEX `classes_branch_status_idx` ON `classes` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `classes_teacher_idx` ON `classes` (`teacher_id`);--> statement-breakpoint
CREATE INDEX `classes_ta_idx` ON `classes` (`ta_id`);--> statement-breakpoint
CREATE INDEX `learner_entitlements_learner_idx` ON `learner_entitlements` (`learner_id`,`status`);--> statement-breakpoint
CREATE INDEX `learner_level_history_learner_idx` ON `learner_level_history` (`learner_id`);--> statement-breakpoint
CREATE INDEX `learners_branch_idx` ON `learners` (`branch_id`,`status`);--> statement-breakpoint
CREATE INDEX `materials_level_idx` ON `materials` (`level_id`);--> statement-breakpoint
CREATE INDEX `materials_class_idx` ON `materials` (`class_id`);--> statement-breakpoint
CREATE INDEX `session_feedbacks_learner_idx` ON `session_feedbacks` (`learner_id`);--> statement-breakpoint
CREATE INDEX `sessions_class_idx` ON `sessions` (`class_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `sessions_branch_time_idx` ON `sessions` (`branch_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `sessions_teacher_time_idx` ON `sessions` (`teacher_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `sessions_room_time_idx` ON `sessions` (`room_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `submissions_learner_idx` ON `assignment_submissions` (`learner_id`);--> statement-breakpoint
CREATE INDEX `trial_guests_session_idx` ON `trial_guests` (`session_id`);