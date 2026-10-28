-- Narrow permission correction. Keeps ownership, stock, stage, revision,
-- idempotency and inspection checks in the existing functions unchanged.
do $head_installs$
declare
 target regprocedure;
 definition text;
 old_gate text;
 new_gate text;
 n integer;
begin
 perform pg_advisory_xact_lock(hashtext('garage_head_tint_installation'));
 for n in 1..2 loop
  if n=1 then
   target:=to_regprocedure('public.garage_installation_before_usage_ledger(text,text,jsonb)');
   old_gate:=$gate$if actor.role not in ('garage_installer','garage_detailer','garage_spray') then raise exception 'NOT_ALLOWED';end if;$gate$;
   new_gate:=$gate$if actor.role not in ('garage_installer','garage_detailer','garage_spray','garage_head') then raise exception 'NOT_ALLOWED';end if;$gate$;
  else
   target:=to_regprocedure('public.claim_garage_glass_item(text,text)');
   old_gate:=$gate$if not garage_is_workshop(p_actor_id) then raise exception 'NOT_AN_INSTALLER'; end if;$gate$;
   new_gate:=$gate$if not garage_is_workshop(p_actor_id) and not exists(select 1 from public.garage_building_staff where id=p_actor_id and role='garage_head' and enabled and registration_status='active' and business_access in ('garage','both')) then raise exception 'NOT_AN_INSTALLER'; end if;$gate$;
  end if;
  if target is null then raise exception 'STOP: Required installation function is missing. No changes made.';end if;
  if has_function_privilege('anon',target,'EXECUTE') or has_function_privilege('authenticated',target,'EXECUTE') then
   raise exception 'STOP: Installation functions must remain service-only. No changes made.';
  end if;
  definition:=pg_get_functiondef(target);
  if strpos(definition,new_gate)>0 and strpos(definition,old_gate)=0 then continue;end if;
  if (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate)<>1 then
   raise exception 'STOP: Installation permission baseline changed (%). Review before installing. No changes made.',target;
  end if;
  execute replace(definition,old_gate,new_gate);
 end loop;
end
$head_installs$;
