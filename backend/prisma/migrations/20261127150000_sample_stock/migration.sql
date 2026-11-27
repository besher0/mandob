-- Balances are custody-specific; historical sample quantities are not backfilled.
CREATE TABLE "SampleStock" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "holderType" VARCHAR(12) NOT NULL,
  "holderId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SampleStock_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SampleStock_quantity_nonnegative" CHECK ("quantity" >= 0),
  CONSTRAINT "SampleStock_holder_type" CHECK ("holderType" IN ('COMPANY','TEAM','REP'))
);
CREATE UNIQUE INDEX "SampleStock_companyId_productId_holderType_holderId_key"
  ON "SampleStock"("companyId","productId","holderType","holderId");
CREATE INDEX "SampleStock_companyId_holderType_holderId_idx"
  ON "SampleStock"("companyId","holderType","holderId");
ALTER TABLE "SampleStock" ADD CONSTRAINT "SampleStock_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SampleStock" ADD CONSTRAINT "SampleStock_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SampleMovement" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "movementType" VARCHAR(24) NOT NULL,
  "sourceType" VARCHAR(12),
  "sourceId" TEXT,
  "targetType" VARCHAR(12),
  "targetId" TEXT,
  "quantity" INTEGER NOT NULL,
  "actorId" TEXT NOT NULL,
  "visitId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SampleMovement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SampleMovement_quantity_positive" CHECK ("quantity" > 0)
);
CREATE INDEX "SampleMovement_companyId_createdAt_idx"
  ON "SampleMovement"("companyId","createdAt");
CREATE INDEX "SampleMovement_companyId_sourceType_sourceId_idx"
  ON "SampleMovement"("companyId","sourceType","sourceId");
CREATE INDEX "SampleMovement_companyId_targetType_targetId_idx"
  ON "SampleMovement"("companyId","targetType","targetId");
CREATE INDEX "SampleMovement_visitId_idx" ON "SampleMovement"("visitId");
ALTER TABLE "SampleMovement" ADD CONSTRAINT "SampleMovement_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SampleMovement" ADD CONSTRAINT "SampleMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
