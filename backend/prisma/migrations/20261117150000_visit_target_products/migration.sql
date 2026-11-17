CREATE TABLE "VisitTargetProduct" (
    "visitTargetId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitTargetProduct_pkey" PRIMARY KEY ("visitTargetId","productId")
);

CREATE INDEX "VisitTargetProduct_productId_visitTargetId_idx"
  ON "VisitTargetProduct"("productId","visitTargetId");

ALTER TABLE "VisitTargetProduct"
  ADD CONSTRAINT "VisitTargetProduct_visitTargetId_fkey"
  FOREIGN KEY ("visitTargetId") REFERENCES "VisitTarget"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitTargetProduct"
  ADD CONSTRAINT "VisitTargetProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
