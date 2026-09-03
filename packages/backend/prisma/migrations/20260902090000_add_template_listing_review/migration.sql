-- AlterTable
ALTER TABLE "TemplateListing" ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" INTEGER,
ADD COLUMN     "submittedAt" TIMESTAMP(3);
