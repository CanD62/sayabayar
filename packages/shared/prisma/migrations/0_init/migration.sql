-- CreateTable
CREATE TABLE `clients` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `email` VARCHAR(100) NOT NULL,
    `password_hash` VARCHAR(255) NULL,
    `phone` VARCHAR(20) NULL,
    `google_id` VARCHAR(100) NULL,
    `auth_provider` VARCHAR(20) NOT NULL DEFAULT 'email',
    `avatar_url` VARCHAR(500) NULL,
    `email_verified` BOOLEAN NOT NULL DEFAULT false,
    `status` ENUM('active', 'suspended', 'inactive') NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `clients_email_key`(`email`),
    UNIQUE INDEX `clients_google_id_key`(`google_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_keys` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `key_hash` VARCHAR(64) NOT NULL,
    `label` VARCHAR(100) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `api_keys_key_hash_key`(`key_hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscription_plans` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `plan_type` ENUM('free', 'subscription') NOT NULL,
    `max_channels` INTEGER NOT NULL DEFAULT 1,
    `monthly_price` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `withdraw_fee` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `can_add_own_channel` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_subscriptions` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `plan_id` CHAR(36) NOT NULL,
    `status` ENUM('active', 'expired', 'cancelled') NOT NULL DEFAULT 'active',
    `current_period_start` DATE NOT NULL,
    `current_period_end` DATE NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_channels` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `channel_type` ENUM('bca_transfer', 'qris_bca', 'qris_gopay') NOT NULL,
    `channel_owner` ENUM('platform', 'client') NOT NULL,
    `account_name` VARCHAR(100) NOT NULL,
    `account_number` VARCHAR(50) NOT NULL,
    `scraping_config` TEXT NOT NULL,
    `qris_data` TEXT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `deleted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `channel_states` (
    `channel_id` CHAR(36) NOT NULL,
    `circuit_state` ENUM('closed', 'open', 'half_open') NOT NULL DEFAULT 'closed',
    `circuit_opened_at` DATETIME(3) NULL,
    `consecutive_errors` INTEGER NOT NULL DEFAULT 0,
    `last_error_at` DATETIME(3) NULL,
    `last_error_type` ENUM('fatal', 'transient', 'empty_result') NULL,
    `last_error_message` TEXT NULL,
    `last_scraped_at` DATETIME(3) NULL,
    `last_success_at` DATETIME(3) NULL,
    `scrape_cursor` VARCHAR(255) NULL,
    `session_data` TEXT NULL,
    `next_scrape_at` DATETIME(3) NULL,
    `scrape_priority` ENUM('high', 'medium', 'low') NOT NULL DEFAULT 'medium',
    `last_known_balance` DECIMAL(15, 2) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`channel_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invoices` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `payment_channel_id` CHAR(36) NULL,
    `invoice_number` VARCHAR(50) NOT NULL,
    `customer_name` VARCHAR(200) NULL,
    `customer_email` VARCHAR(100) NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `unique_code` SMALLINT NOT NULL DEFAULT 0,
    `amount_unique` DECIMAL(15, 2) NOT NULL,
    `unique_code_revenue` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `description` TEXT NULL,
    `status` ENUM('pending', 'user_confirmed', 'paid', 'expired', 'cancelled') NOT NULL DEFAULT 'pending',
    `source` ENUM('dashboard', 'api') NOT NULL,
    `payment_url` VARCHAR(500) NOT NULL,
    `payment_token` VARCHAR(32) NOT NULL,
    `expired_at` DATETIME(3) NOT NULL,
    `paid_at` DATETIME(3) NULL,
    `fee` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `confirmed_at` DATETIME(3) NULL,
    `channel_preference` VARCHAR(20) NOT NULL DEFAULT 'platform',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `invoices_invoice_number_key`(`invoice_number`),
    UNIQUE INDEX `invoices_payment_token_key`(`payment_token`),
    INDEX `idx_status_expired`(`status`, `expired_at`),
    INDEX `idx_channel_pending`(`payment_channel_id`, `status`),
    INDEX `idx_channel_unique_code`(`payment_channel_id`, `unique_code`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transactions` (
    `id` CHAR(36) NOT NULL,
    `invoice_id` CHAR(36) NULL,
    `payment_channel_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `reference_number` VARCHAR(100) NULL,
    `unique_hash` VARCHAR(64) NOT NULL,
    `raw_data` TEXT NULL,
    `match_status` ENUM('matched', 'unmatched', 'duplicate', 'manual') NOT NULL DEFAULT 'unmatched',
    `match_attempt` INTEGER NOT NULL DEFAULT 0,
    `last_match_attempt` DATETIME(3) NULL,
    `detected_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `transactions_unique_hash_key`(`unique_hash`),
    INDEX `idx_unmatched`(`match_status`, `detected_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `client_balances` (
    `client_id` CHAR(36) NOT NULL,
    `balance_pending` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `balance_available` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_earned` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `total_withdrawn` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`client_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `balance_ledger` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `invoice_id` CHAR(36) NULL,
    `withdrawal_id` CHAR(36) NULL,
    `type` ENUM('credit_pending', 'credit_available', 'debit_withdraw') NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `available_at` DATETIME(3) NOT NULL,
    `settled_at` DATETIME(3) NULL,
    `note` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_client_available`(`client_id`, `type`, `available_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `withdrawals` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `amount` DECIMAL(15, 2) NOT NULL,
    `fee` DECIMAL(12, 2) NOT NULL DEFAULT 2500,
    `amount_received` DECIMAL(15, 2) NOT NULL,
    `destination_bank` VARCHAR(50) NOT NULL,
    `destination_account` VARCHAR(50) NOT NULL,
    `destination_name` VARCHAR(100) NOT NULL,
    `status` ENUM('pending', 'processing', 'processed', 'failed', 'rejected') NOT NULL DEFAULT 'pending',
    `rejection_reason` TEXT NULL,
    `retry_count` INTEGER NOT NULL DEFAULT 0,
    `flip_trx_id` VARCHAR(100) NULL,
    `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processed_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_endpoints` (
    `id` CHAR(36) NOT NULL,
    `client_id` CHAR(36) NOT NULL,
    `url` VARCHAR(500) NOT NULL,
    `secret_hash` VARCHAR(64) NOT NULL,
    `secret_encrypted` TEXT NULL,
    `event_types` JSON NOT NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `webhook_logs` (
    `id` CHAR(36) NOT NULL,
    `webhook_id` CHAR(36) NOT NULL,
    `invoice_id` CHAR(36) NOT NULL,
    `http_status` INTEGER NULL,
    `response_body` TEXT NULL,
    `attempt_number` INTEGER NOT NULL DEFAULT 1,
    `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `scraping_logs` (
    `id` CHAR(36) NOT NULL,
    `channel_id` CHAR(36) NOT NULL,
    `status` ENUM('success', 'transient', 'fatal') NOT NULL,
    `error_type` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `tx_found` INTEGER NOT NULL DEFAULT 0,
    `tx_new` INTEGER NOT NULL DEFAULT 0,
    `duration_ms` INTEGER NULL,
    `scraped_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_channel_time`(`channel_id`, `scraped_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `payment_providers` (
    `id` CHAR(36) NOT NULL,
    `provider_name` VARCHAR(50) NOT NULL,
    `email` VARCHAR(100) NOT NULL,
    `user_id` VARCHAR(100) NULL,
    `token` TEXT NOT NULL,
    `pin` VARCHAR(255) NOT NULL,
    `balance` DECIMAL(15, 2) NOT NULL DEFAULT 0,
    `token_expires_at` DATETIME(3) NULL,
    `auto_process` BOOLEAN NOT NULL DEFAULT false,
    `updated_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `payment_providers_provider_name_key`(`provider_name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_subscriptions` ADD CONSTRAINT `client_subscriptions_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_subscriptions` ADD CONSTRAINT `client_subscriptions_plan_id_fkey` FOREIGN KEY (`plan_id`) REFERENCES `subscription_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_channels` ADD CONSTRAINT `payment_channels_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `channel_states` ADD CONSTRAINT `channel_states_channel_id_fkey` FOREIGN KEY (`channel_id`) REFERENCES `payment_channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invoices` ADD CONSTRAINT `invoices_payment_channel_id_fkey` FOREIGN KEY (`payment_channel_id`) REFERENCES `payment_channels`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transactions` ADD CONSTRAINT `transactions_payment_channel_id_fkey` FOREIGN KEY (`payment_channel_id`) REFERENCES `payment_channels`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `client_balances` ADD CONSTRAINT `client_balances_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_ledger` ADD CONSTRAINT `balance_ledger_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_ledger` ADD CONSTRAINT `balance_ledger_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `balance_ledger` ADD CONSTRAINT `balance_ledger_withdrawal_id_fkey` FOREIGN KEY (`withdrawal_id`) REFERENCES `withdrawals`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `withdrawals` ADD CONSTRAINT `withdrawals_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_endpoints` ADD CONSTRAINT `webhook_endpoints_client_id_fkey` FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_logs` ADD CONSTRAINT `webhook_logs_webhook_id_fkey` FOREIGN KEY (`webhook_id`) REFERENCES `webhook_endpoints`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `webhook_logs` ADD CONSTRAINT `webhook_logs_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `invoices`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

