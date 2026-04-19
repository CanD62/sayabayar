-- CreateTable
CREATE TABLE `admin_fix_audit_logs` (
    `id` CHAR(36) NOT NULL,
    `admin_id` CHAR(36) NOT NULL,
    `issue_id` VARCHAR(100) NOT NULL,
    `issue_type` VARCHAR(120) NOT NULL,
    `action` ENUM('dry_run', 'execute') NOT NULL,
    `entity_type` VARCHAR(50) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `before_snapshot` JSON NULL,
    `after_snapshot` JSON NULL,
    `status` ENUM('success', 'failed') NOT NULL,
    `error_message` TEXT NULL,
    `idempotency_key` VARCHAR(120) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `admin_fix_audit_logs_idempotency_key_key`(`idempotency_key`),
    INDEX `idx_admin_fix_issue_time`(`issue_type`, `created_at`),
    INDEX `idx_admin_fix_entity_time`(`entity_type`, `entity_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `admin_fix_audit_logs` ADD CONSTRAINT `admin_fix_audit_logs_admin_id_fkey` FOREIGN KEY (`admin_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
