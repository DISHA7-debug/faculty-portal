-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "phoneExt" TEXT,
ADD COLUMN     "showPhoneExt" BOOLEAN NOT NULL DEFAULT true;
