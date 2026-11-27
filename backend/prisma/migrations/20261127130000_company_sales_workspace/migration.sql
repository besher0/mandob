-- Sales workspace is isolated from medical Visit / VisitTarget tables.
CREATE TYPE "SalesOrderStatus" AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE "SalesOfferType" AS ENUM ('NONE','BONUS','DISCOUNT');

CREATE TABLE "SalesAgent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
  "provinceId" TEXT NOT NULL REFERENCES "Province"("id") ON DELETE RESTRICT,
  "name" VARCHAR(120) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "SalesAgent_companyId_provinceId_name_key" ON "SalesAgent"("companyId","provinceId","name");
CREATE INDEX "SalesAgent_companyId_active_idx" ON "SalesAgent"("companyId","active");

CREATE TABLE "SalesVisit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
  "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "provinceId" TEXT NOT NULL REFERENCES "Province"("id") ON DELETE RESTRICT,
  "pharmacyId" TEXT REFERENCES "Pharmacy"("id") ON DELETE RESTRICT,
  "hospitalId" TEXT REFERENCES "Hospital"("id") ON DELETE RESTRICT,
  "clientRef" TEXT NOT NULL,
  "visitDate" DATE NOT NULL,
  "notes" VARCHAR(2000) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesVisit_exactly_one_target" CHECK (
    (CASE WHEN "pharmacyId" IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN "hospitalId" IS NULL THEN 0 ELSE 1 END) = 1)
);
CREATE UNIQUE INDEX "SalesVisit_authorId_clientRef_key" ON "SalesVisit"("authorId","clientRef");
CREATE INDEX "SalesVisit_companyId_visitDate_createdAt_id_idx" ON "SalesVisit"("companyId","visitDate","createdAt","id");

CREATE TABLE "SalesOrder" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
  "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
  "provinceId" TEXT NOT NULL REFERENCES "Province"("id") ON DELETE RESTRICT,
  "pharmacyId" TEXT REFERENCES "Pharmacy"("id") ON DELETE RESTRICT,
  "hospitalId" TEXT REFERENCES "Hospital"("id") ON DELETE RESTRICT,
  "agentId" TEXT NOT NULL REFERENCES "SalesAgent"("id") ON DELETE RESTRICT,
  "visitId" TEXT REFERENCES "SalesVisit"("id") ON DELETE RESTRICT,
  "clientRef" TEXT NOT NULL,
  "orderDate" DATE NOT NULL,
  "notes" VARCHAR(2000) NOT NULL,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'SYP',
  "status" "SalesOrderStatus" NOT NULL DEFAULT 'PENDING',
  "total" DECIMAL(20,2) NOT NULL,
  "reviewerId" TEXT REFERENCES "User"("id") ON DELETE RESTRICT,
  "reviewNote" VARCHAR(2000),
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesOrder_exactly_one_target" CHECK (
    (CASE WHEN "pharmacyId" IS NULL THEN 0 ELSE 1 END) +
    (CASE WHEN "hospitalId" IS NULL THEN 0 ELSE 1 END) = 1),
  CONSTRAINT "SalesOrder_total_check" CHECK ("total" >= 0 AND "currency" = 'SYP')
);
CREATE UNIQUE INDEX "SalesOrder_authorId_clientRef_key" ON "SalesOrder"("authorId","clientRef");
CREATE INDEX "SalesOrder_companyId_status_orderDate_createdAt_id_idx" ON "SalesOrder"("companyId","status","orderDate","createdAt","id");
CREATE INDEX "SalesOrder_companyId_provinceId_orderDate_idx" ON "SalesOrder"("companyId","provinceId","orderDate");

CREATE TABLE "SalesOrderItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "orderId" TEXT NOT NULL REFERENCES "SalesOrder"("id") ON DELETE CASCADE,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT,
  "productName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" DECIMAL(16,2) NOT NULL,
  "offerType" "SalesOfferType" NOT NULL DEFAULT 'NONE',
  "bonusQuantity" INTEGER NOT NULL DEFAULT 0,
  "discountPercent" DECIMAL(5,2) NOT NULL,
  "total" DECIMAL(20,2) NOT NULL,
  CONSTRAINT "SalesOrderItem_values" CHECK ("quantity">0 AND "unitPrice">0 AND "bonusQuantity">=0 AND "discountPercent">=0 AND "discountPercent"<=100 AND "total">=0)
);
CREATE UNIQUE INDEX "SalesOrderItem_orderId_productId_key" ON "SalesOrderItem"("orderId","productId");
CREATE INDEX "SalesOrderItem_productId_idx" ON "SalesOrderItem"("productId");
