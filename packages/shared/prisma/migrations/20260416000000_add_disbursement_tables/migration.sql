-- AlterTable
ALTER TABLE `clients` ADD COLUMN `role` ENUM('merchant', 'disbursement_user') NOT NULL DEFAULT 'merchant';

-- CreateTable
CREATE TABLE `kyc_documents` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `ktp_image_path` VARCHAR(500) NOT NULL,
    `selfie_image_path` VARCHAR(500) NOT NULL,
    `full_name` VARCHAR(200) NOT NULL,
    `ktp_number` VARCHAR(20) NOT NULL,
    `status` ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
    `rejection_reason` TEXT NULL,
    `reviewed_by` CHAR(36) NULL,
    `reviewed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `kyc_documents_client_id_key`(`client_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `disbursement_balances` (
    `client_id` CHAR(36) NOT NULL,
    `balance` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_deposited` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_disbursed` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_fees` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`client_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `disbursement_deposits` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `unique_code` SMALLINT NOT NULL DEFAULT 0,
    `total_transfer` DECIMAL(15, 2) NOT NULL,
    `sender_bank` VARCHAR(50) NOT NULL,
    `flip_topup_id` VARCHAR(100) NULL,
    `status` ENUM('pending', 'confirmed', 'done', 'expired', 'failed') NOT NULL DEFAULT 'pending',
    `receiver_bank` JSON NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `confirmed_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    UNIQUE INDEX `disbursement_deposits_idempotency_key_key`(`idempotency_key`),
    INDEX `idx_deposit_client`(`client_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `disbursements` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `fee` DECIMAL(12, 2) NOT NULL DEFAULT 2500,
    `total_deducted` DECIMAL(15, 2) NOT NULL,
    `destination_bank` VARCHAR(50) NOT NULL,
    `destination_account` VARCHAR(50) NOT NULL,
    `destination_name` VARCHAR(100) NOT NULL,
    `status` ENUM('pending', 'processing', 'success', 'failed') NOT NULL DEFAULT 'pending',
    `failure_reason` TEXT NULL,
    `flip_trx_id` VARCHAR(100) NULL,
    `idempotency_key` VARCHAR(100) NOT NULL,
    `source` ENUM('dashboard', 'api') NOT NULL DEFAULT 'dashboard',
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,

    UNIQUE INDEX `disbursements_idempotency_key_key`(`idempotency_key`),
    INDEX `idx_disbursement_client`(`client_id`, `created_at`),
    INDEX `idx_disbursement_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `kyc_documents` ADD CONSTRAINT `kyc_documents_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disbursement_balances` ADD CONSTRAINT `disbursement_balances_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disbursement_deposits` ADD CONSTRAINT `disbursement_deposits_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `disbursements` ADD CONSTRAINT `disbursements_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

