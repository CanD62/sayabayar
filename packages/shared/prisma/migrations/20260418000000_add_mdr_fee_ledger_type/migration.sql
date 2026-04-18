-- AlterTable: Add mdr_fee to BalanceLedgerType enum
ALTER TABLE `balance_ledger` MODIFY COLUMN `type` ENUM('credit_pending', 'credit_available', 'debit_withdraw', 'mdr_fee') NOT NULL;
