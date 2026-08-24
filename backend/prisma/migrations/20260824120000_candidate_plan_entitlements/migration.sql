-- CreateEnum
CREATE TYPE "CandidatePlan" AS ENUM ('FREE', 'PRO', 'MAX');

-- AlterTable
ALTER TABLE "candidate_accounts" ADD COLUMN     "plan" "CandidatePlan" NOT NULL DEFAULT 'FREE';

