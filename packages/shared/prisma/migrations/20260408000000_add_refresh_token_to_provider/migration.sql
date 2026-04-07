-- AlterTable: tambah refresh_token ke payment_providers
ALTER TABLE `payment_providers` ADD COLUMN `refresh_token` TEXT NULL;
