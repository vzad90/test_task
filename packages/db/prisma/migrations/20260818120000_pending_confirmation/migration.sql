-- AlterEnum
ALTER TYPE "LoanApplicationStatus" ADD VALUE 'PENDING_CONFIRMATION';

-- AlterTable
ALTER TABLE "LoanApplication" ADD COLUMN "proposedByUserId" TEXT;

-- AddForeignKey
ALTER TABLE "LoanApplication" ADD CONSTRAINT "LoanApplication_proposedByUserId_fkey" FOREIGN KEY ("proposedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
