-- Paste in the SQL editor. Do not terminate anything from these rows
-- until we have decided. Read-only.

select pid, state, wait_event_type, wait_event,
       now() - query_start as duration, left(query, 120) as query
from pg_stat_activity
where datname = current_database()
  and state <> 'idle'
order by query_start;

select relation::regclass, mode, granted, pid
from pg_locks
where relation = 'tokens'::regclass;

select indexrelid::regclass, indisvalid, indisready
from pg_index
where indrelid = 'tokens'::regclass;
