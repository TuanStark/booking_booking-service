-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "paymentStatus" "PaymentStatus";
