-- Add reason_code metadata for withdrawal audit trails (e.g. KYC_OPTOUT)
ALTER TABLE `withdrawals`
  ADD COLUMN `reason_code` VARCHAR(50) NULL AFTER `destination_name`;
