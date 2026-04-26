# Postgres roles runbook (Phase 2)

Operator reference for the three custom roles Comradarr's v1 baseline
migration depends on:

| Role                    | Purpose                                                                  | Login? | Schema-level grants                          |
| ----------------------- | ------------------------------------------------------------------------ | ------ | -------------------------------------------- |
| `comradarr_migration`   | Owns DDL — runs `alembic upgrade head` and any future schema migrations. | NOLOGIN | `ALL ON SCHEMA public`, `ALL ON ALL TABLES` |
| `comradarr_app`         | Runtime application connect role — DML only on non-audit tables.         | NOLOGIN | `USAGE ON SCHEMA public`, per-table DML grants |
| `comradarr_audit_admin` | Retention / vacuum role for `audit_log` only.                            | NOLOGIN | `USAGE ON SCHEMA public`, `SELECT, DELETE ON audit_log` |

The carve-out is intentional: `comradarr_app` has `SELECT, INSERT` on
`audit_log` but **never** `UPDATE` or `DELETE` (PRD §8). The audit
trail is append-only at the application layer; only the dedicated
`comradarr_audit_admin` role can vacuum old rows under retention policy.

The three roles are `NOLOGIN`; runtime connections authenticate as a
login role (e.g. the `comradarr` user a deployment operator creates) and
acquire role permissions via `GRANT comradarr_app TO comradarr` (or the
equivalent `SET ROLE` at session start). Plan §3 Milestone 11 covers
the runtime wiring; this runbook scopes to *role + grant* setup.

---

## Why this runbook exists (R1 in plan §6)

The v1 baseline migration runs `CREATE ROLE` inside an idempotent
`DO $$ ... IF NOT EXISTS $$;` block. This works fine when the connect
user has CREATEROLE (the typical superuser-or-similar setup on
self-hosted Postgres and on the CI service container).

**Managed Postgres often denies CREATEROLE** to the application's connect
user — Amazon RDS, Cloud SQL, Heroku Postgres, Supabase, and Neon all
restrict it by default. In that case `alembic upgrade head` raises
`InsufficientPrivilege` mid-migration and the structured error names
the failed helper:

```
RuntimeError: v1 baseline failed at _create_roles_idempotent;
              see docs/runbook/postgres-roles.md (...)
```

The fix is to have an operator with elevated credentials pre-create
the three roles before running the migration. The migration's
idempotent guard then makes the role-creation block a no-op on the
re-run; only `_create_tables_and_indexes()` and `_apply_grants()` do
real work.

---

## Operator pre-creation SQL

Connect as a role with `CREATEROLE` (RDS calls this `rds_superuser`;
Cloud SQL calls it `cloudsqlsuperuser`; on self-hosted Postgres the
`postgres` superuser works) and run:

```sql
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='comradarr_migration') THEN
        CREATE ROLE comradarr_migration NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='comradarr_app') THEN
        CREATE ROLE comradarr_app NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='comradarr_audit_admin') THEN
        CREATE ROLE comradarr_audit_admin NOLOGIN;
    END IF;
END
$$;
```

This is byte-for-byte identical to the migration's
`_create_roles_idempotent()` body (plan §3 Milestone 7 step 25). After
the operator runs it, `alembic upgrade head` succeeds because the
`IF NOT EXISTS` guard skips the already-created roles.

If the connect user holds CREATEROLE but **not** the privilege to grant
permissions back into `public`, the next failure surfaces as:

```
RuntimeError: v1 baseline failed at _apply_grants;
              see docs/runbook/postgres-roles.md (...)
```

Have the operator follow the [§"Recovering from a half-applied
migration"](#recovering-from-a-half-applied-migration) section below.

---

## Pre-flight check (CLI + lifespan)

Both `uv run migrate` (the CLI script) and the in-process lifespan
migration runner call a shared `preflight_role_check(engine)` function
that:

1. Queries `pg_roles` for the three names.
2. If any are missing AND the connect user lacks CREATEROLE, raises
   `ConfigurationError("postgres roles missing and connect user lacks
   CREATEROLE; see docs/runbook/postgres-roles.md")`.

This converts the failure mode from a *mid-migration*
`InsufficientPrivilege` (which leaves a half-applied schema) into a
*pre-migration* configuration error that points operators directly at
this runbook. The CLI exits 1 before any DDL runs; the lifespan emits
`db.lifespan.migrations.failed` with `error=...` and refuses to serve
traffic.

---

## Local development setup

Use this when running `uv run pytest tests/db/`, `uv run alembic check`,
or `tools/lint/check_alembic_clean.sh` against a local Postgres.

```sh
# 1. Start Postgres 16 locally (Docker; adjust if you run it natively).
docker run --rm -d --name comradarr-pg \
  -e POSTGRES_USER=comradarr \
  -e POSTGRES_PASSWORD=comradarr \
  -e POSTGRES_DB=comradarr_test \
  -p 5432:5432 \
  postgres:16

# 2. The `comradarr` superuser created by the image holds CREATEROLE,
#    so the migration's idempotent role block runs without operator
#    pre-creation.

# 3. Point the conftest + alembic at the DB.
export TEST_DATABASE_URL='postgresql+asyncpg://comradarr:comradarr@localhost:5432/comradarr_test'
export DATABASE_URL='postgresql+asyncpg://comradarr:comradarr@localhost:5432/comradarr_test'

# 4. Apply migrations + run the integration suite.
( cd backend && uv run alembic upgrade head )
( cd backend && uv run pytest tests/db/ -n auto -m "not e2e" )
```

The conftest's per-worker schema fixture (`wid_<worker_id>`) creates
fresh schemas under the same DB on every test run; you do **not** need
to recreate the database between runs.

---

## Adding a table in a later phase

The v1 baseline migration's `_apply_grants()` body uses two hand-maintained
Python lists (`TABLES_FOR_APP_GRANT` and `TABLES_FOR_AUDIT_GRANT`) to drive
explicit per-table GRANTs — the audit_log carve-out is unambiguous because
it sits in the audit list, not the app list (plan §3 Milestone 7 step 26).

When a later phase adds a new model:

1. **Author the model + autogenerate the migration.**
   `uv run alembic revision --autogenerate -m "phase-N: <feature>"`.
2. **Extend the GRANT list in the new migration's upgrade()**.
   Append the new table name to whichever list it belongs in:
   - Regular application table → `TABLES_FOR_APP_GRANT` (gets full DML
     for `comradarr_app`).
   - A future audit-style append-only carve-out → `TABLES_FOR_AUDIT_GRANT`.
3. **Run the integration tests.** The
   [sentinel test](../../backend/tests/db/test_role_permissions.py) iterates
   `Base.metadata.tables` and asserts the matrix covers every table —
   if you skipped step 2, this test fails with the missing table name.
4. **Run the M1 DDL-escalation matrix.**
   `tests/db/test_role_permissions.py::test_app_role_cannot_perform_ddl`
   confirms `comradarr_app` still lacks DDL on the new table by
   default. A migration that accidentally `GRANT ALL`-ed the table
   instead of using the explicit DML verbs would fail this gate.

---

## Recovering from a half-applied migration

`alembic upgrade head` runs the v1 baseline inside Alembic's default
`transactional_ddl=True` outer transaction, so a failure at any of
the three named helpers (`_create_tables_and_indexes`,
`_create_roles_idempotent`, `_apply_grants`) rolls the entire revision
back atomically. The `alembic_version` table is not advanced and no
schema objects are left behind.

The error message names the failed helper. Resolve as follows:

* **`_create_tables_and_indexes`** — usually a Postgres extension
  missing (`uuid-ossp`, `pgcrypto`) or insufficient `CREATE TABLE`
  privilege on the schema. Resolve at the Postgres layer; re-run.
* **`_create_roles_idempotent`** — connect user lacks CREATEROLE on
  managed Postgres. Follow [§"Operator pre-creation
  SQL"](#operator-pre-creation-sql) above; re-run.
* **`_apply_grants`** — connect user lacks GRANT privilege on a
  specific table or schema. Verify the connect user is a member of
  the role that owns the schema (`comradarr_migration` should own the
  schema in production); re-run.

If a previous run left orphan roles but no tables (e.g. operator
manually pre-created roles, then the `_create_tables_and_indexes`
step failed), the next `alembic upgrade head` succeeds — the
idempotent role block recognizes them and skips. No `DROP ROLE`
recovery is needed.

---

## Cross-references

* PRD §8 — three-role separation rationale.
* Plan §3 Milestone 7 step 25–26 — the migration helpers.
* Plan §6 R1 — risk write-up that this runbook closes.
* `backend/tests/db/test_role_permissions.py` — the security gate that
  exercises this matrix on every CI run.
* `tools/lint/check_alembic_clean.sh` — local-only autogenerate-clean
  check; the CI equivalent is `test_alembic_baseline.py`.
