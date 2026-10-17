#!/bin/sh
# PostgreSQL backups for Boundra, run by the Compose `backup` service (postgres image).
#   backup.sh         every BACKUP_INTERVAL_SECONDS, keeping the newest BACKUP_KEEP dumps
#   backup.sh once    a single backup, then exit (pnpm db:backup)
# Connection comes from PGHOST/PGUSER/PGPASSWORD/PGDATABASE; nothing secret is written to disk
# except the dump itself. Each dump is a consistent pg_dump snapshot in custom format, written
# under a temporary name and renamed only when complete, with a .sha256 file and a .json file
# of row counts. Counts are taken before and after the dump: a table that did not change has
# an exact count the restore must match; one written to meanwhile (e.g. Job) gets a [min, max]
# range the restored count must fall within.
set -eu
umask 077 # dumps hold user data: readable by their owner only

DIR=/backups
KEEP="${BACKUP_KEEP:-28}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-21600}"

count_rows() {
  for table in $(psql -Atq -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1"); do
    echo "$table $(psql -Atq -c "SELECT count(*) FROM public.\"$table\"")"
  done
}

backup() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  name="boundra-$stamp"
  before=$(count_rows)
  pg_dump --format=custom --no-owner --file="$DIR/$name.dump.partial"
  after=$(count_rows)
  mv "$DIR/$name.dump.partial" "$DIR/$name.dump"
  (cd "$DIR" && sha256sum "$name.dump" > "$name.dump.sha256")
  counts=$(printf '%s
%s
' "$before" "$after" | awk '
    !($1 in first) { first[$1] = $2; order[++n] = $1; next }
    { last[$1] = $2 }
    END {
      for (i = 1; i <= n; i++) {
        t = order[i]; v = first[t]
        if ((t in last) && last[t] != v) v = "[" (v < last[t] ? v : last[t]) "," (v < last[t] ? last[t] : v) "]"
        printf "%s\"%s\":%s", (i > 1 ? "," : ""), t, v
      }
    }')
  migrations=$(psql -Atq -c "SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL")
  printf '{"file":"%s.dump","createdAt":"%s","database":"%s","migrations":%s,"rowCounts":%s}\n' \
    "$name" "$stamp" "$PGDATABASE" "$migrations" "{$counts}" > "$DIR/$name.json"
  echo "backup $name.dump ($(wc -c < "$DIR/$name.dump") bytes)"
  # Keep the newest $KEEP dumps (and their sidecar files).
  ls -1t "$DIR"/boundra-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
    rm -f "$old" "$old.sha256" "${old%.dump}.json"
    echo "pruned $(basename "$old")"
  done
}

mkdir -p "$DIR"
if [ "${1:-}" = "once" ]; then
  backup
  exit 0
fi
while true; do
  backup || echo "backup failed; retrying next interval" >&2
  sleep "$INTERVAL"
done
