-- Speed up overlap checks on active leave requests for a representative.
-- Adds only an index; no historical rows or business rules are changed.
CREATE INDEX "LeaveRequest_repId_status_fromDate_toDate_idx"
  ON "LeaveRequest"("repId", "status", "fromDate", "toDate");
