-- Approved installation required. No existing entries or photos are changed.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
-- Remove only the per-report photo-count cap. Keep actor, ownership, privacy,
-- evidence hash, review, delivery and audit checks unchanged.
do $condition_photos$
declare signature regprocedure:=to_regprocedure('public.garage_tint_damage(text,text,jsonb)');definition text;
 old_gate text:=$gate$if photo_count>=4 then raise exception 'PHOTO_LIMIT';end if;$gate$;
 new_gate text:='-- Car condition entries have no per-report photo-count cap.';
 old_snapshot text:=$gate$jsonb_build_object('invoiceId',iid,'canReport',$gate$;
 new_snapshot text:=$gate$jsonb_build_object('unlimitedPhotos',true,'invoiceId',iid,'canReport',$gate$;
begin
 perform pg_advisory_xact_lock(hashtext('garage_car_condition_photos'));
 if signature is null then raise exception 'STOP: Damage-report baseline is missing. No changes made.';end if;
 if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') then raise exception 'STOP: Damage functions must remain private. No changes made.';end if;
 definition:=pg_get_functiondef(signature);
 if strpos(definition,new_gate)>0 and strpos(definition,new_snapshot)>0 then return;end if;
 if (length(definition)-length(replace(definition,old_gate,'')))/length(old_gate)<>1 or
    (length(definition)-length(replace(definition,old_snapshot,'')))/length(old_snapshot)<>1 then
  raise exception 'STOP: Damage-report baseline changed. Review before installing. No changes made.';
 end if;
 execute replace(replace(definition,old_gate,new_gate),old_snapshot,new_snapshot);
end
$condition_photos$;

NOTIFY pgrst, 'reload schema';
SELECT jsonb_build_object(
 'unlimited_photos_ready',strpos(pg_get_functiondef('public.garage_tint_damage(text,text,jsonb)'::regprocedure),'Car condition entries have no per-report photo-count cap.')>0,
 'capability_ready',strpos(pg_get_functiondef('public.garage_tint_damage(text,text,jsonb)'::regprocedure),$$'unlimitedPhotos',true$$)>0,
 'function_private',not has_function_privilege('anon','public.garage_tint_damage(text,text,jsonb)','EXECUTE') and not has_function_privilege('authenticated','public.garage_tint_damage(text,text,jsonb)','EXECUTE'),
 'checked_at',now());
COMMIT;
