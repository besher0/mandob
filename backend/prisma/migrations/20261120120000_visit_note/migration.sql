-- Allow representatives to record an optional note with each completed tour.
-- Existing tours keep a NULL note; no backfill or history rewrite.
ALTER TABLE "Visit" ADD COLUMN "note" VARCHAR(2000);
