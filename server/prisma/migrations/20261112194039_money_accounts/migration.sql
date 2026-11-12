-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'EFT', 'SALARY_DEDUCTION', 'CARD', 'CREDIT');

-- AlterTable
ALTER TABLE "Item" ADD COLUMN     "priceCents" INTEGER;

-- AlterTable
ALTER TABLE "Movement" ADD COLUMN     "amountCents" INTEGER,
ADD COLUMN     "recordedById" TEXT,
ADD COLUMN     "supplier" TEXT,
ADD COLUMN     "unitPriceCents" INTEGER;

-- AlterTable
ALTER TABLE "Restaurant" ADD COLUMN     "statementStartDay" INTEGER NOT NULL DEFAULT 16;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "restaurantId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "paidOn" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Payment_restaurantId_paidOn_idx" ON "Payment"("restaurantId", "paidOn");

-- CreateIndex
CREATE INDEX "Payment_staffId_paidOn_idx" ON "Payment"("staffId", "paidOn");

-- CreateIndex
CREATE INDEX "Movement_staffId_createdAt_idx" ON "Movement"("staffId", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
