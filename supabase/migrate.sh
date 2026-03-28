#!/bin/bash
# ============================================================================
# Chisquare — Database Migration Runner
# Usage: ./migrate.sh [--dry-run] [--from 008] [--to 013]
# Tracks applied migrations in a _schema_migrations table.
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

# DB connection from environment or .env
DB_URL="${DATABASE_URL:-postgresql://postgres:${SUPABASE_DB_PASSWORD:-}@${SUPABASE_DB_HOST:-localhost}:5432/postgres}"
DRY_RUN=false
FROM_VERSION=""
TO_VERSION=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true ;;
    --from) FROM_VERSION="$2"; shift ;;
    --to)   TO_VERSION="$2";   shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
  shift
done

# Ensure tracking table exists
PGPASSWORD="${SUPABASE_DB_PASSWORD:-}" psql "$DB_URL" -q << 'EOSQL'
CREATE TABLE IF NOT EXISTS public._schema_migrations (
  version     TEXT PRIMARY KEY,
  filename    TEXT NOT NULL,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum    TEXT
);
EOSQL

echo "📋 Checking migrations in: $MIGRATIONS_DIR"
echo ""

applied=0
skipped=0
errors=0

for migration_file in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  filename=$(basename "$migration_file")
  version=$(echo "$filename" | grep -oE '^[0-9]+')

  # Apply --from / --to filters
  [[ -n "$FROM_VERSION" && "$version" < "$FROM_VERSION" ]] && continue
  [[ -n "$TO_VERSION" && "$version" > "$TO_VERSION" ]] && continue

  # Check if already applied
  already_applied=$(PGPASSWORD="${SUPABASE_DB_PASSWORD:-}" psql "$DB_URL" -tAc \
    "SELECT COUNT(*) FROM public._schema_migrations WHERE version = '$version'" 2>/dev/null || echo "0")

  if [[ "$already_applied" -gt 0 ]]; then
    echo "  ✓ $filename (already applied)"
    ((skipped++)) || true
    continue
  fi

  echo "  → Applying: $filename"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "    [DRY RUN — would execute $filename]"
    ((applied++)) || true
    continue
  fi

  # Compute checksum
  checksum=$(sha256sum "$migration_file" | awk '{print $1}')

  # Apply migration
  if PGPASSWORD="${SUPABASE_DB_PASSWORD:-}" psql "$DB_URL" -f "$migration_file" -q 2>&1; then
    # Record in tracking table
    PGPASSWORD="${SUPABASE_DB_PASSWORD:-}" psql "$DB_URL" -q << EOSQL
INSERT INTO public._schema_migrations (version, filename, checksum)
VALUES ('$version', '$filename', '$checksum')
ON CONFLICT (version) DO NOTHING;
EOSQL
    echo "    ✅ Applied"
    ((applied++)) || true
  else
    echo "    ❌ FAILED: $filename"
    ((errors++)) || true
  fi
done

echo ""
echo "Summary: $applied applied, $skipped skipped, $errors errors"
[[ "$errors" -gt 0 ]] && exit 1 || exit 0
