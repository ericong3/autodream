-- Tint work orders now track every individual glass (front left / front
-- right / rear left panel ...) instead of grouped "door window" /
-- "rear panel window" entries. garage_tint_installation_pieces is already
-- one row per (invoice, position), so it becomes the tint work-order item
-- table rather than adding a duplicate one: each row also carries what the
-- salesman sold for that glass, plus room for the installer to confirm what
-- actually went on later.
--
-- Additive only — no data is deleted or rewritten. Old orders keep their
-- grouped `selections` in garage_tint_orders; the app expands those to
-- individual positions when reading them.
alter table garage_tint_installation_pieces
  add column if not exists requested_series text,
  add column if not exists requested_vlt text,
  add column if not exists installed_series text,
  add column if not exists status text not null default 'pending',
  add column if not exists remark text;

alter table garage_tint_installation_pieces
  add constraint garage_tint_installation_pieces_status_check check (status in ('pending', 'installed'));

-- Rows seeded before this carry only a position — fill in what was
-- requested for it from the order itself.
update garage_tint_installation_pieces p
set requested_series = s.value->>'series',
    requested_vlt = s.value->>'vlt'
from garage_tint_orders o,
     jsonb_array_elements(o.selections || o.extras) s
where o.invoice_id = p.invoice_id
  and s.value->>'position' = p.position
  and p.requested_series is null;
