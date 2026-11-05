-- Index for company-scoped, stable alphabetical user paging.
CREATE INDEX "User_companyId_name_id_idx" ON "User"("companyId","name","id");
