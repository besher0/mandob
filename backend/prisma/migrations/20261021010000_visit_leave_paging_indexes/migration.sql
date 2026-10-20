-- Add non-destructive indexes for the existing paginated history endpoints.
-- Multicolumn btree keys match company/representative/team scoping followed
-- by deterministic (visitDate, createdAt, id) or (createdAt, id) paging.
CREATE INDEX "Visit_companyId_visitDate_createdAt_id_idx"
  ON "Visit"("companyId", "visitDate", "createdAt", "id");
CREATE INDEX "Visit_repId_visitDate_createdAt_id_idx"
  ON "Visit"("repId", "visitDate", "createdAt", "id");
CREATE INDEX "Visit_companyId_teamIdAtVisit_visitDate_createdAt_id_idx"
  ON "Visit"("companyId", "teamIdAtVisit", "visitDate", "createdAt", "id");
CREATE INDEX "LeaveRequest_companyId_createdAt_id_idx"
  ON "LeaveRequest"("companyId", "createdAt", "id");
CREATE INDEX "LeaveRequest_repId_createdAt_id_idx"
  ON "LeaveRequest"("repId", "createdAt", "id");
