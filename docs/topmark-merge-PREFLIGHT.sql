-- READ-ONLY preflight for merging dealer "Topmark" into "2TN" (2026-11-14).
-- Changes nothing. Lists every table/column that mentions Topmark, plus the
-- locked consignment cases on Topmark cars.
-- Result: one row per (table, column) with the number of matching rows.
with cols as (
  select c.table_name, c.column_name, c.data_type
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
  where c.table_schema = 'public' and c.data_type in ('text','character varying','jsonb','json')
), hits as (
  select table_name, column_name,
    (xpath('/row/n/text()', query_to_xml(format(
      'select count(*) as n from public.%I where %I::text ilike %L or %I::text = %L',
      table_name, column_name, '%topmark%', column_name, '1782957129282-l6ijrgxqs'), false, true, '')))[1]::text::int as matching_rows
  from cols
)
select 'mention' as kind, table_name, column_name, matching_rows from hits where matching_rows > 0
union all
select 'locked_case', 'uc_consignment_cases', case when k.approved_at is null then 'opened, not approved' else 'approved settlement' end, count(*)::int
from uc_consignment_cases k join cars c on c.id = k.car_id
where c.consignment->>'dealer' ilike 'topmark'
group by 2, 3
order by 1, 2, 3;
