#!/usr/bin/env bash
# Throwaway local Postgres for testing schema/migration_*.sql and schema/test_*.sql
# without touching the live database. Needs Homebrew postgres (no Docker).
#   scripts/test-db.sh up                 # init + start on port 54329, load bootstrap
#   scripts/test-db.sh sql <file.sql>...  # run files in order (ON_ERROR_STOP)
#   scripts/test-db.sh down               # stop and delete
set -euo pipefail
DIR="${TEST_DB_DIR:-${TMPDIR:-/tmp}/bc-test-db}"
PORT="${TEST_DB_PORT:-54329}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Live is PostgreSQL 17; Homebrew postgresql@18 is the closest working build here.
PG_BIN="${PG_BIN:-$(cd /opt/homebrew/opt/postgresql@18 && pwd -P)/bin}"
export PATH="$PG_BIN:$PATH"
case "${1:-}" in
  up)
    pg_ctl -D "$DIR" stop -m fast >/dev/null 2>&1 || true; rm -rf "$DIR"; initdb -L "$PG_BIN/../share/postgresql" -D "$DIR" -U postgres --auth=trust >/dev/null
    pg_ctl -D "$DIR" -o "-p $PORT -k $DIR" -l "$DIR/log" start >/dev/null
    psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$ROOT/schema/test_harness/bootstrap.sql"
    echo "test db up: psql -h $DIR -p $PORT -U postgres" ;;
  sql)
    shift; for f in "$@"; do psql -h "$DIR" -p "$PORT" -U postgres -v ON_ERROR_STOP=1 -q -f "$f"; done ;;
  down)
    pg_ctl -D "$DIR" stop >/dev/null 2>&1 || true; rm -rf "$DIR" ;;
  *) echo "usage: $0 up|sql <files>|down" >&2; exit 2 ;;
esac
