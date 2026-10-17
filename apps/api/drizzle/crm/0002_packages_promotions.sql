CREATE TABLE `package_branch_prices` (
	`package_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`price` bigint NOT NULL,
	`updated_by` char(26),
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `package_branch_prices_package_id_branch_id_pk` PRIMARY KEY(`package_id`,`branch_id`)
);
--> statement-breakpoint
CREATE TABLE `packages` (
	`id` char(26) NOT NULL,
	`code` varchar(20) NOT NULL,
	`name` varchar(150) NOT NULL,
	`subject_id` char(26) NOT NULL,
	`months` int NOT NULL,
	`sessions_count` int NOT NULL,
	`sessions_per_week` int NOT NULL DEFAULT 2,
	`base_price` bigint NOT NULL,
	`default_scholarship_months` int NOT NULL DEFAULT 0,
	`description` varchar(1000),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `packages_id` PRIMARY KEY(`id`),
	CONSTRAINT `packages_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `promotion_items` (
	`id` char(26) NOT NULL,
	`code` varchar(30) NOT NULL,
	`name` varchar(200) NOT NULL,
	`unit` varchar(20) NOT NULL DEFAULT 'cái',
	`min_stock` int NOT NULL DEFAULT 5,
	`description` varchar(1000),
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `promotion_items_id` PRIMARY KEY(`id`),
	CONSTRAINT `promotion_items_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `promotion_programs` (
	`id` char(26) NOT NULL,
	`code` varchar(30) NOT NULL,
	`name` varchar(200) NOT NULL,
	`description` varchar(1000),
	`discount_type` varchar(10) NOT NULL,
	`discount_value` bigint NOT NULL,
	`max_discount` bigint,
	`start_date` date,
	`end_date` date,
	`branch_ids` json,
	`package_ids` json,
	`is_active` boolean NOT NULL DEFAULT true,
	`created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	`updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
	CONSTRAINT `promotion_programs_id` PRIMARY KEY(`id`),
	CONSTRAINT `promotion_programs_code_uq` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `promotion_stock_moves` (
	`id` char(26) NOT NULL,
	`item_id` char(26) NOT NULL,
	`branch_id` char(26) NOT NULL,
	`quantity` int NOT NULL,
	`kind` varchar(10) NOT NULL,
	`ref_id` char(26),
	`note` varchar(500),
	`created_by` char(26) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `promotion_stock_moves_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `packages_subject_idx` ON `packages` (`subject_id`);--> statement-breakpoint
CREATE INDEX `promotion_stock_item_branch_idx` ON `promotion_stock_moves` (`item_id`,`branch_id`);