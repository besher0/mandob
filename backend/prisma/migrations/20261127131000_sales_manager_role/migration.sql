-- Dedicated authenticated sales role; no permissions to existing medical endpoints.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SALES_MANAGER';
