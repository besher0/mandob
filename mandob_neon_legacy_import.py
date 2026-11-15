#!/usr/bin/env python3
"""Generate a Neon SQL Editor import from Mandob's historic SQLite git blob.

This script does not connect to Neon, upload personal data, or alter the repository.
It uses only Python's standard library. Legacy passwords are NEVER imported.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import secrets
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

SOURCE_COMMIT = "69eca28685788dc574ccc340e2285624d568ea56"
SOURCE_FILES = {
    "latest": "backend/medrep.db",
    "backup": "backend/medrep.backup-before-cleanup.db",
}
NAMESPACE = uuid.UUID("8682facc-642e-4ab5-8d7b-68aa394ed044")
SAFE_TABLES = (
    "users", "doctors", "pharmacies", "visits", "settings", "leave_requests",
    "areas", "hospitals", "teams", "products", "rep_areas", "rep_products",
    "team_products", "visit_targets", "area_groups", "team_specialties",
    "rep_specialties",
)
GRADES = {"A", "B", "C"}
ALLOWED_ROLES = {"REP", "TEAM_MANAGER", "COMPANY_ADMIN"}


def sql_literal(x):
    if x is None:
        return "NULL"
    if isinstance(x, bool):
        return "TRUE" if x else "FALSE"
    if isinstance(x, (float, int)):
        return str(x)
    # PostgreSQL text cannot contain embedded NUL.
    return "'" + str(x).replace("\x00", "").replace("'", "''") + "'"


def sql_json(x):
    return sql_literal(json.dumps(x, ensure_ascii=False, separators=(",", ":"))) + "::jsonb"


def value(x):
    return "" if x is None else str(x).strip()


def joined(value_or_empty):
    return [x.strip() for x in re.split(r"[,،]", value(value_or_empty)) if x.strip()]


def checked_date(x):
    try:
        d = date.fromisoformat(value(x))
        return d.isoformat()
    except ValueError:
        return None


def checked_int(x, default, low=0, high=100000):
    try:
        number = int(x)
    except (TypeError, ValueError):
        return default
    return number if low <= number <= high else default


def hash_login_password(cleartext):
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(cleartext.encode("utf-8"), salt=salt, n=16384,
                            r=8, p=1, dklen=64, maxmem=64 * 1024 * 1024)
    return "scrypt$16384$8$1$" + salt.hex() + "$" + digest.hex()


def read_git_snapshot(repo, source):
    relative = SOURCE_FILES[source]
    cmd = ["git", "-C", str(repo), "show", SOURCE_COMMIT + ":" + relative]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode:
        raise RuntimeError("Git cannot load the archived SQLite file. Check your "
                           "repository path and commit history.\n" +
                           p.stderr.decode("utf-8", "replace")[-1600:])
    if not p.stdout.startswith(b"SQLite format 3\x00"):
        raise RuntimeError("The historical git object was not an SQLite database")
    return p.stdout, relative


def sqlite_snapshot(blob):
    handle = tempfile.NamedTemporaryFile(prefix="mandob-archive-", suffix=".db", delete=False)
    try:
        handle.write(blob)
        handle.close()
        conn = sqlite3.connect(handle.name)
        conn.row_factory = sqlite3.Row
        try:
            names = {x[0] for x in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            return {table: [dict(r) for r in conn.execute(f'SELECT * FROM "{table}"')]
                    if table in names else [] for table in SAFE_TABLES}
        finally:
            conn.close()
    finally:
        try:
            os.unlink(handle.name)
        except OSError:
            pass


class SqlWriter:
    def __init__(self):
        self.fragments = []
        self.counts = Counter()

    def line(self, line):
        self.fragments.append(line.rstrip() + "\n")

    def insert(self, table, row):
        columns = ", ".join('"' + col + '"' for col in row)
        values = ", ".join(sql_json(v[1]) if isinstance(v, tuple) and v[0] == "json" else
                           v[1] if isinstance(v, tuple) and v[0] == "raw" else
                           sql_literal(v) for v in row.values())
        self.line(f'INSERT INTO "{table}" ({columns}) VALUES ({values});')
        self.counts[table] += 1


class Converter:
    def __init__(self, db, company_name, source, enable_test_logins, with_superadmin):
        self.db = db
        self.name = company_name
        self.source = source
        self.company_id = self.uid("company", company_name)
        self.enable = enable_test_logins
        self.with_superadmin = with_superadmin
        self.sql = SqlWriter()
        self.warnings = []
        self.skipped = defaultdict(list)
        self.credentials = []
        self.tables = {name: {str(r.get("id")): r for r in db.get(name, [])}
                       for name in ("teams", "users", "areas", "products", "doctors", "area_groups")}
        self.maps = defaultdict(dict)
        self.area_sources = {}
        self.archived_counts = Counter()
        self.archive_sql = None

    def uid(self, table, identifier):
        return str(uuid.uuid5(NAMESPACE, f"mandob:{self.source}:{self.name}:{table}:{identifier}"))

    def map_id(self, table, old_id):
        return self.maps[table].get(str(old_id))

    def warn(self, msg):
        self.warnings.append(msg)

    def skip(self, table, row, why):
        self.skipped[table].append({"old_id": row.get("id"), "reason": why})

    def prepare(self):
        self.sql.line("-- Mandob legacy SQLite -> PostgreSQL / Neon SQL Editor")
        self.sql.line("-- SOURCE: Git commit " + SOURCE_COMMIT + " / " + SOURCE_FILES[self.source])
        self.sql.line("-- Old passwords are NOT imported. Old tours have NO fabricated GPS/area.")
        self.sql.line("-- This SQL assumes the Prisma schema/migrations are already deployed.")
        self.sql.line("-- REVIEW: run only on a NEW/isolated Neon TEST BRANCH after taking a backup.")
        self.sql.line("BEGIN;")
        self.sql.line("DO $mandob$ BEGIN")
        self.sql.line("  IF to_regclass('public.\"Company\"') IS NULL OR")
        self.sql.line("     to_regclass('public.\"DoctorArea\"') IS NULL OR")
        self.sql.line("     to_regclass('public.\"CompanySettings\"') IS NULL THEN")
        self.sql.line("    RAISE EXCEPTION 'Mandob Prisma tables missing. Deploy migrations first.';")
        self.sql.line("  END IF;")
        self.sql.line("  IF EXISTS(SELECT 1 FROM \"Company\" WHERE \"name\" = " + sql_literal(self.name) + ") THEN")
        self.sql.line("    RAISE EXCEPTION 'Company already exists. Import would duplicate records: %', " + sql_literal(self.name) + ";")
        self.sql.line("  END IF;")
        self.sql.line("END $mandob$;")
        self.sql.line("")
        self.sql.insert("Company", {"id": self.company_id, "name": self.name})
        self.convert_settings()
        self.convert_groups_areas()
        self.convert_teams_products()
        self.convert_medical()
        self.convert_users()
        self.convert_links()
        if self.with_superadmin:
            self.add_superadmin()
        self.sql.line("COMMIT;")
        core_sql = self.sql
        self.archive_sql = SqlWriter()
        self.sql = self.archive_sql
        self.sql.line("-- Mandob archived history: run AFTER the core file succeeds.")
        self.sql.line("-- Legacy visits have no trusted GPS/per-target area; do NOT")
        self.sql.line("-- insert them into the modern Visit/VisitTarget tables.")
        self.sql.line("BEGIN;")
        self.sql.line("DO $archive$ BEGIN")
        self.sql.line("  IF NOT EXISTS(SELECT 1 FROM \"Company\" WHERE \"id\" = " + sql_literal(self.company_id) + ") THEN")
        self.sql.line("    RAISE EXCEPTION 'Core import is missing; run core SQL first.';")
        self.sql.line("  END IF;")
        self.sql.line("END $archive$;")
        self.convert_legacy_archive()
        self.sql.line("COMMIT;")
        self.sql = core_sql

    def convert_settings(self):
        settings = {value(r.get("key")): value(r.get("value")) for r in self.db["settings"]}
        a = checked_date(settings.get("cycle_start_date"))
        b = checked_date(settings.get("cycle_end_date"))
        if a and b and a > b:
            self.warn("Legacy cycleEnd before cycleStart; using database defaults")
            a = b = None
        rawdays = settings.get("working_days", "")
        try:
            days = json.loads(rawdays)
            if not isinstance(days, list) or any(type(d) is not int or d < 0 or d > 6 for d in days):
                raise ValueError("invalid days")
        except (ValueError, TypeError):
            days = [0, 1, 2, 3, 4, 6]
            self.warn("Invalid/missing legacy working_days; using schema default")
        def frequency(k, default):
            return checked_int(settings.get(k), default, 1, 100)
        self.sql.insert("CompanySettings", {
            "companyId": self.company_id,
            "cycleStart": a,
            "cycleEnd": b,
            "frequencyA": frequency("frequency_A", 4),
            "frequencyB": frequency("frequency_B", 2),
            "frequencyC": frequency("frequency_C", 1),
            "annualLeaveBalance": checked_int(settings.get("annual_leave_balance"), 12, 0, 365),
            "workingDays": ("raw", "ARRAY[" + ",".join(str(d) for d in sorted(set(days))) + "]::integer[]"),
            "updatedAt": ("raw", "NOW()"),
        })

    def convert_groups_areas(self):
        for row in self.db["area_groups"]:
            name = value(row.get("name"))
            if not name:
                self.skip("area_groups", row, "blank group name")
                continue
            pk = str(row["id"])
            new_id = self.uid("area_groups", pk)
            self.maps["area_groups"][pk] = new_id
            self.sql.insert("AreaGroup", {"id": new_id, "companyId": self.company_id,
                                          "name": name,
                                          "sortOrder": checked_int(row.get("sort_order"), 0, -100000, 100000)})
        # Some medical rows refer to an area name absent from the old areas
        # directory. Keep the SOURCE name and transparently record reconstruction.
        seen = set()
        for row in self.db["areas"]:
            name = value(row.get("name"))
            if not name:
                self.skip("areas", row, "empty area name")
                continue
            seen.add(name)
            pk = str(row["id"])
            new_id = self.uid("areas", pk)
            self.maps["areas"][pk] = new_id
            self.area_sources[name] = new_id
            self.sql.insert("Area", {"id": new_id, "companyId": self.company_id,
                                     "name": name, "city": value(row.get("city")) or None,
                                     "groupId": self.map_id("area_groups", row.get("group_id"))})
        referenced = set()
        for table, field in (("doctors", "area"), ("pharmacies", "area"), ("hospitals", "area")):
            referenced.update(value(x.get(field)) for x in self.db[table])
        for name in sorted(referenced):
            if not name or name in self.area_sources:
                continue
            new_id = self.uid("extra_area", name)
            self.area_sources[name] = new_id
            self.sql.insert("Area", {"id": new_id, "companyId": self.company_id,
                                     "name": name, "city": None, "groupId": None})
            self.warn("Created missing area from medical record's actual area label: " + name)

    def convert_teams_products(self):
        for row in self.db["teams"]:
            name = value(row.get("name"))
            if not name:
                self.skip("teams", row, "empty name")
                continue
            pk = str(row["id"])
            id_ = self.uid("teams", pk)
            self.maps["teams"][pk] = id_
            self.sql.insert("Team", {"id": id_, "companyId": self.company_id, "name": name})
        for row in self.db["products"]:
            name = value(row.get("name"))
            if not name:
                self.skip("products", row, "empty name")
                continue
            pk = str(row["id"])
            id_ = self.uid("products", pk)
            self.maps["products"][pk] = id_
            self.sql.insert("Product", {"id": id_, "companyId": self.company_id, "name": name,
                                        "activeIngredient": value(row.get("active_ingredient")) or None,
                                        "active": bool(row.get("is_active", 1))})
        team_specs = set()
        for row in self.db["team_specialties"]:
            team_id = self.map_id("teams", row.get("team_id"))
            specialty = value(row.get("specialty"))
            if not team_id or not specialty:
                self.skip("team_specialties", row, "orphan team/blank specialty")
                continue
            team_specs.add((team_id, specialty))
        # Use the normalized relation as authoritative; fall back to textual
        # list only for old teams without any normalized specialty association.
        for row in self.db["teams"]:
            team_id = self.map_id("teams", row.get("id"))
            if team_id and not any(k[0] == team_id for k in team_specs):
                for specialty in joined(row.get("specialties")):
                    team_specs.add((team_id, specialty))
                    self.warn(f"Used legacy textual specialties for team #{row['id']}")
        for team_id, specialty in sorted(team_specs):
            self.sql.insert("TeamSpecialty", {"teamId": team_id, "specialty": specialty})
        for row in self.db["team_products"]:
            tid = self.map_id("teams", row.get("team_id"))
            pid = self.map_id("products", row.get("product_id"))
            if tid and pid:
                self.sql.insert("TeamProduct", {"teamId": tid, "productId": pid})
            else:
                self.skip("team_products", row, "orphan team/product")

    def convert_medical(self):
        for row in self.db["doctors"]:
            name = value(row.get("name"))
            area = self.area_sources.get(value(row.get("area")))
            specialty = value(row.get("spec"))
            if not name or not area or not specialty:
                self.skip("doctors", row, "missing name / mapped area / specialty")
                continue
            grade = value(row.get("grade")).upper()
            if grade not in GRADES:
                self.warn(f"Doctor #{row['id']} had invalid grade; defaulted to C")
                grade = "C"
            pk = str(row["id"])
            id_ = self.uid("doctors", pk)
            self.maps["doctors"][pk] = id_
            self.sql.insert("Doctor", {"id": id_, "companyId": self.company_id, "areaId": area,
                                       "name": name, "specialty": specialty, "grade": grade,
                                       "city": value(row.get("city")) or None})
            self.sql.insert("DoctorArea", {"doctorId": id_, "areaId": area})
        for row in self.db["pharmacies"]:
            name = value(row.get("name"))
            area = self.area_sources.get(value(row.get("area")))
            if not name or not area:
                self.skip("pharmacies", row, "missing name / mapped area")
                continue
            grade = value(row.get("category")).upper()
            if grade not in GRADES:
                self.warn(f"Pharmacy #{row['id']} had invalid category; defaulted to A")
                grade = "A"
            pk = str(row["id"])
            id_ = self.uid("pharmacies", pk)
            self.maps["pharmacies"][pk] = id_
            self.sql.insert("Pharmacy", {"id": id_, "companyId": self.company_id, "areaId": area,
                                         "name": name, "target": checked_int(row.get("target"), 4, 1, 100),
                                         "grade": grade, "kind": value(row.get("type")) or "مستقلة"})
        for row in self.db["hospitals"]:
            name = value(row.get("name"))
            area = self.area_sources.get(value(row.get("area")))
            if not name or not area:
                self.skip("hospitals", row, "missing name / mapped area")
                continue
            pk = str(row["id"])
            id_ = self.uid("hospitals", pk)
            self.maps["hospitals"][pk] = id_
            self.sql.insert("Hospital", {"id": id_, "companyId": self.company_id, "areaId": area,
                                         "name": name, "category": value(row.get("category")) or "خاص",
                                         "specialty": value(row.get("specialty")) or "عام",
                                         "target": checked_int(row.get("target"), 4, 1, 100)})

    def convert_users(self):
        for row in self.db["users"]:
            role = value(row.get("role"))
            name = value(row.get("name"))
            if role == "SUPER_ADMIN":
                self.skip("users", row, "historical SUPER_ADMIN excluded; create a new secure root")
                continue
            if role not in ALLOWED_ROLES or not name:
                self.skip("users", row, "unknown role or empty name")
                continue
            pk = str(row["id"])
            id_ = self.uid("users", pk)
            self.maps["users"][pk] = id_
            login = "legacy_" + self.company_id[:8] + "_" + pk
            if self.enable:
                generated = secrets.token_urlsafe(20)
                password_hash = hash_login_password(generated)
                self.credentials.append({"source_table": "users", "old_id": pk,
                                         "name": name, "role": role, "new_username": login,
                                         "temporary_password": generated})
            else:
                password_hash = "RESET_REQUIRED_LEGACY"
            mode = value(row.get("specialty_mode"))
            if mode not in ("TEAM", "CUSTOM"):
                mode = "TEAM"
            original_team = row.get("team_id")
            if original_team is not None and not self.map_id("teams", original_team):
                self.warn(f"User #{pk} references old team #{original_team} which is missing")
            self.sql.insert("User", {
                "id": id_, "companyId": self.company_id, "name": name,
                "username": login, "passwordHash": password_hash, "role": role,
                "teamId": self.map_id("teams", original_team),
                "dailyTarget": checked_int(row.get("daily_target"), 8, 1, 100),
                "annualLeaveBalance": checked_int(row.get("annual_leave_balance"), 12, 0, 365),
                "active": self.enable, "specialtyMode": mode,
                "updatedAt": ("raw", "NOW()"),
            })

    def convert_links(self):
        for table, source_a, source_b, target, target_a, target_b, keys in [
            ("rep_areas", "rep_id", "area_id", "RepArea", "repId", "areaId", ("users", "areas")),
            ("rep_products", "rep_id", "product_id", "RepProduct", "repId", "productId", ("users", "products")),
            ("rep_specialties", "rep_id", "specialty", "RepSpecialty", "repId", "specialty", ("users", None)),
        ]:
            dedup = set()
            for row in self.db[table]:
                a = self.map_id(keys[0], row.get(source_a))
                b = self.map_id(keys[1], row.get(source_b)) if keys[1] else value(row.get(source_b))
                if (not a or not b):
                    self.skip(table, row, "orphan/missing relation")
                    continue
                if (a, b) in dedup:
                    continue
                dedup.add((a, b))
                self.sql.insert(target, {target_a: a, target_b: b})
        # Compare old freeform area labels to canonical rep_areas without
        # filling in missing associations by guessing.
        old_areas = self.tables["areas"]
        memberships = defaultdict(set)
        for link in self.db["rep_areas"]:
            row = old_areas.get(str(link.get("area_id")))
            if row:
                memberships[str(link["rep_id"])].add(value(row.get("name")))
        for row in self.db["users"]:
            if row.get("role") != "REP" or not self.map_id("users", row.get("id")):
                continue
            textual = set(joined(row.get("areas")))
            canonical = memberships.get(str(row["id"]), set())
            if textual and textual != canonical:
                self.warn(f"User #{row['id']} freeform area labels differ from canonical rep_areas; canonical links preserved")

    def add_superadmin(self):
        username = "legacy_root_" + self.company_id[:8]
        password = secrets.token_urlsafe(24)
        self.sql.insert("User", {
            "id": self.uid("superadmin", "root"), "companyId": None,
            "name": "مدير نظام الاستيراد", "username": username,
            "passwordHash": hash_login_password(password),
            "role": "SUPER_ADMIN", "active": True,
            "updatedAt": ("raw", "NOW()"),
        })
        self.credentials.append({"source_table": "generated", "old_id": "", "name": "مدير نظام الاستيراد",
                                 "role": "SUPER_ADMIN", "new_username": username,
                                 "temporary_password": password})

    def convert_legacy_archive(self):
        self.sql.line("")
        self.sql.line("-- Read-only historical archive: no invented GPS or per-target area attribution.")
        self.sql.line("CREATE SCHEMA IF NOT EXISTS mandob_legacy;")
        self.sql.line("CREATE TABLE IF NOT EXISTS mandob_legacy.records (")
        self.sql.line("  import_company_id TEXT NOT NULL, source_table TEXT NOT NULL,")
        self.sql.line("  legacy_pk TEXT NOT NULL, data JSONB NOT NULL,")
        self.sql.line("  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),")
        self.sql.line("  PRIMARY KEY (import_company_id, source_table, legacy_pk)")
        self.sql.line(");")
        for table in SAFE_TABLES:
            for index, row in enumerate(self.db.get(table, [])):
                # No passwords, hashes, session secrets or tokens are ever
                # copied into the active tables or the historical archive.
                filtered = {key: val for key, val in row.items()
                            if not re.search(r"password|token|secret|credential", key, re.I)}
                pk = str(row.get("id") if row.get("id") is not None else
                         ":".join(value(z) for z in row.values()) or str(index))
                payload = sql_json(filtered)
                self.sql.line("INSERT INTO mandob_legacy.records ")
                self.sql.line(" (import_company_id, source_table, legacy_pk, data) VALUES (" +
                              ", ".join([sql_literal(self.company_id), sql_literal(table),
                                         sql_literal(pk), payload]) + ")")
                self.sql.line(" ON CONFLICT (import_company_id, source_table, legacy_pk) DO NOTHING;")
                self.archived_counts[table] += 1

    def report(self):
        return {
            "source": SOURCE_COMMIT + ":" + SOURCE_FILES[self.source],
            "companyName": self.name, "companyId": self.company_id,
            "sourceTableCounts": {k: len(v) for k, v in self.db.items()},
            "activeNewRecords": dict(self.sql.counts),
            "archivedRecords": dict(self.archived_counts),
            "skipped": dict(self.skipped), "warnings": self.warnings,
            "userAccountsActive": self.enable,
            "createdSuperadmin": self.with_superadmin,
            "oldPasswordsImported": False,
            "oldVisitsImportedIntoLiveVisit": False,
            "oldLeavesImportedIntoLiveLeaveRequest": False,
        }


def main():
    p = argparse.ArgumentParser(description="Generate an SQL import for Neon from Mandob's Git-history SQLite snapshot")
    p.add_argument("--repo", default=".", help="Path to the local Mandob git repository")
    p.add_argument("--company-name", default="Mandob Legacy Import", help="NEW company name; old SQLite had no Company table")
    p.add_argument("--source", choices=("latest", "backup"), default="latest")
    p.add_argument("--out", default="mandob_neon_import.sql")
    p.add_argument("--enable-test-logins", action="store_true",
                   help="Create random new passwords and activate historical users; writes SENSITIVE local credentials CSV")
    p.add_argument("--with-superadmin", action="store_true",
                   help="Create a fresh SUPER_ADMIN with a new random password; saved only in local credentials CSV")
    args = p.parse_args()
    if not args.company_name.strip():
        p.error("--company-name must not be blank")
    repo = Path(args.repo).resolve()
    if not (repo / ".git").exists():
        p.error("--repo must point to a Mandob Git checkout (folder containing .git)")
    try:
        blob, source_path = read_git_snapshot(repo, args.source)
        data = sqlite_snapshot(blob)
        converter = Converter(data, args.company_name.strip(), args.source,
                              args.enable_test_logins, args.with_superadmin)
        converter.prepare()
        out = Path(args.out).resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text("".join(converter.sql.fragments), encoding="utf-8")
        archive_out = out.with_name(out.stem + "_archive.sql")
        archive_out.write_text("".join(converter.archive_sql.fragments), encoding="utf-8")
        report = out.with_suffix(".report.json")
        report.write_text(json.dumps(converter.report(), indent=2, ensure_ascii=False), encoding="utf-8")
        print("Source Git blob:", SOURCE_COMMIT + ":" + source_path)
        print("Source records:", ", ".join(f"{k}={len(v)}" for k,v in data.items() if v))
        print("Step 1, CORE SQL:", out)
        print("Step 2, HISTORICAL ARCHIVE SQL:", archive_out)
        print("Review:", report)
        print("Records inserted into active model:", dict(converter.sql.counts))
        print("Archived historical rows:", sum(converter.archived_counts.values()))
        print("Skipped rows:", {k: len(v) for k,v in converter.skipped.items()})
        print("Warnings:", len(converter.warnings))
        if converter.credentials:
            secrets_path = out.with_suffix(".credentials.csv")
            with secrets_path.open("w", encoding="utf-8-sig", newline="") as handle:
                writer = csv.DictWriter(handle, fieldnames=["source_table", "old_id", "name", "role",
                                                            "new_username", "temporary_password"])
                writer.writeheader()
                writer.writerows(converter.credentials)
            try:
                os.chmod(secrets_path, 0o600)
            except OSError:
                pass
            print("SENSITIVE LOCAL FILE - never upload/commit/share:", secrets_path)
        print("NEXT: review report, back up Neon branch, then paste SQL into Neon SQL Editor.")
        if not converter.enable:
            print("Historical accounts are INACTIVE; use --enable-test-logins only for isolated TEST branches.")
        if not converter.with_superadmin:
            print("No SUPER_ADMIN created: existing secure bootstrap/admin remains necessary.")
    except (RuntimeError, sqlite3.Error, OSError, ValueError) as e:
        print("ERROR:", e, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
