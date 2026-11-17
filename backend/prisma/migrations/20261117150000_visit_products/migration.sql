CREATE TABLE "VisitProduct" (
    "visitId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VisitProduct_pkey" PRIMARY KEY ("visitId","productId"),
    CONSTRAINT "VisitProduct_quantity_check" CHECK ("quantity" >= 0)
);

CREATE INDEX "VisitProduct_productId_visitId_idx"
  ON "VisitProduct"("productId","visitId");

ALTER TABLE "VisitProduct"
  ADD CONSTRAINT "VisitProduct_visitId_fkey"
  FOREIGN KEY ("visitId") REFERENCES "Visit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "VisitProduct"
  ADD CONSTRAINT "VisitProduct_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
