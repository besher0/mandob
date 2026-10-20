# Doctor XLSX import — approved workflow (Mandob v2)

## Manager-driven decisions

This screen is for **COMPANY_ADMIN** only. It does **not** ask doctors for input, and it never assumes that two people are the same person merely because they have matching names.

The manager uploads an XLSX file, sees a read-only preview, and reviews rows with a matching doctor's name **within the same company** or in earlier rows of the same workbook. The manager chooses exactly one of:

1. **Same doctor:** select the actual existing Doctor ID (or an earlier new doctor row in this workbook). Add the new area to that doctor's memberships. Keep the same Doctor ID, original primary area, specialty, grade, status and historical visits **unchanged**. An already-linked area is skipped.
2. **Different doctor:** create a separate doctor with a new Doctor ID, even with an identical name.
3. **Skip:** do not create a doctor or an area for that row and do not change existing data.

Rows with no name collision are prepared to create a new doctor by default. Invalid rows appear with their validation errors and are not committed.

**There is no fourth “ask the doctor” action.** The human choice belongs to the company manager reviewing Excel.

## Accepted workbook

- Format: `.xlsx` (not the older `.xls`).
- First worksheet, first row as headings, maximum 200 nonempty doctor rows and 5MB.
- Columns: `Name` (required), `Doctor geo name` (required area), `Specailist` or `Specialist` (required specialty), `classification` (A/B/C, defaults to C if empty), `City` (optional).
- Names are compared case-insensitively for *potential* duplicates within one company. Similar but differently spelled names are not silently merged.
- When a non-skipped row references a new area name, that area is created as part of the same transaction, consistently with the original importer. Existing area data is not overwritten.

## Data model and report protection

- `Doctor.areaId` remains the legacy primary area. The `DoctorArea` join table holds additional area memberships. The migration backfills existing doctors' primary areas and never deletes or reassigns historical visit targets.
- Doctors are visible to representatives with access to *any* linked area. New doctor tours accept the same scope, and the doctor dashboard uses it too.
- Every tour references one Doctor ID; **Frequency is once per doctor per team**, aggregated across a doctor's linked areas. Different teams still have distinct targets and old visit-time team attribution remains intact.
- Doctor archive/restore behavior is unchanged. This workflow does not archive teams or areas.

## Safety and validation

- `POST /api/doctors/import/preview`: authenticated XLSX parsing; **no database changes**.
- `POST /api/doctors/import/commit`: submitted decisions, company/doctor ownership checks, one serializable database transaction, audit trail. If any row fails validation, the batch is rolled back.
- `clientImportId`: one UUID per previewed batch, retained on retries. The server stores a result+payload hash in `DoctorImportBatch`. Retrying an identical successful request returns the saved result, rather than creating duplicate records. The same import ID with different content returns HTTP 409.
- Automated PostgreSQL integration tests cover the three choices, preview purity, cross-company rejection, preserved doctor data, new-area tour authorization, shared frequency, migrations and import retries.

Production staging, live files and manual device review remain part of the separate deployment phase.
