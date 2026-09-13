-- Full Package's VLT is now per-window (recorded in `selections`, same as
-- Mix & Match) rather than one value for the whole car — this column is no
-- longer written to. No real orders exist yet, so nothing is lost.
alter table garage_tint_orders drop column if exists full_vlt;
