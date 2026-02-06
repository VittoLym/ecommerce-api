-- AlterTable
ALTER TABLE "PaymentAttempt" ADD COLUMN     "retryable" BOOLEAN NOT NULL DEFAULT true;
