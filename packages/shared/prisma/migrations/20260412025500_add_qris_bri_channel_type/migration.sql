-- AlterTable: Add qris_bri to channel_type enum
ALTER TABLE `payment_channels` MODIFY COLUMN `channel_type` ENUM('bca_transfer', 'qris_bca', 'qris_gopay', 'qris_bri') NOT NULL;
