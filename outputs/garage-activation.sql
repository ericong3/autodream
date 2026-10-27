begin;
do $$begin
 if to_regclass('public.garage_installation_reviews') is not null or exists(select 1 from information_schema.columns where table_schema='public' and table_name='garage_tint_orders' and column_name='vehicle_layout') then raise exception 'Garage setup already exists or is partly installed. Stop and ask for a setup check.';end if;
end $$;
-- Car tint: personal confirmation -> Garage Head -> owning salesman.
create table public.garage_installation_reviews(
 invoice_id text primary key references public.garage_invoices(id) on delete cascade,
 revision bigint not null default 0,
 state text not null default 'working' check(state in ('working','head','sales','correction_review','ready')),
 confirmations jsonb not null default '{}',head_by text,head_at timestamptz,sales_by text,sales_at timestamptz,reason text,updated_at timestamptz not null default now()
);
create table public.garage_installation_review_events(id bigint generated always as identity primary key,invoice_id text not null references public.garage_invoices(id) on delete cascade,actor_id text not null,action text not null,details jsonb not null,created_at timestamptz not null default now());
create table public.garage_installation_requests(actor_id text not null,request_id text not null,payload jsonb not null,result jsonb not null,primary key(actor_id,request_id));
create index garage_installation_review_events_invoice_idx on public.garage_installation_review_events(invoice_id,id);
alter table public.garage_installation_reviews enable row level security;
alter table public.garage_installation_review_events enable row level security;
alter table public.garage_installation_requests enable row level security;
revoke all on public.garage_installation_reviews,public.garage_installation_review_events,public.garage_installation_requests from public,anon,authenticated;

alter table public.garage_invoices drop constraint garage_invoices_work_status_check;
alter table public.garage_invoices add constraint garage_invoices_work_status_check check(work_status in ('draft','waiting_for_installer','installer_assigned','in_progress','pending_approval','installation_completed','sales_inspection','head_correction_review','payment_due','ready_for_delivery','ready_for_warranty','closed'));
alter function public.garage_work_status_from_facts(text) rename to garage_legacy_work_status_from_facts;
create function public.garage_work_status_from_facts(p_invoice_id text) returns text language plpgsql stable security definer set search_path=public,pg_temp as $$
declare w public.garage_installation_reviews;begin
 select * into w from public.garage_installation_reviews where invoice_id=p_invoice_id;
 if w.state='sales' then return 'sales_inspection';end if;
 if w.state='correction_review' then return 'head_correction_review';end if;
 return public.garage_legacy_work_status_from_facts(p_invoice_id);
end;$$;
alter function public.garage_work_status_transition_allowed(text,text) rename to garage_legacy_work_status_transition_allowed;
create function public.garage_work_status_transition_allowed(p_from text,p_to text) returns boolean language sql immutable as $$
 select public.garage_legacy_work_status_transition_allowed(p_from,p_to) or (p_from,p_to) in (('ready_for_delivery','sales_inspection'),('payment_due','sales_inspection'),('sales_inspection','head_correction_review'),('sales_inspection','ready_for_delivery'),('sales_inspection','payment_due'));
$$;

create function public.garage_initialize_installation_review() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if new.service='tinted' then insert into public.garage_installation_reviews(invoice_id) values(new.invoice_id) on conflict do nothing;end if;return new;
end;$$;
create trigger garage_initialize_installation_review after insert on public.garage_installer_jobs for each row execute function public.garage_initialize_installation_review();
insert into public.garage_installation_reviews(invoice_id,state,head_by,head_at)
select i.id,case when i.delivered_at is not null then 'ready' when j.approved_at is not null then 'sales' when j.status in ('submitted','completed') then 'head' else 'working' end,j.approved_by,j.approved_at from public.garage_installer_jobs j join public.garage_invoices i on i.id=j.invoice_id where i.service='tinted' on conflict do nothing;
-- Preserve old completion evidence before requiring the missing Head inspection.
insert into public.garage_installation_review_events(invoice_id,actor_id,action,details)
select i.id,coalesce(j.completed_by,'migration'),'legacy_completion',jsonb_build_object('completedAt',j.completed_at,'completedBy',j.completed_by) from public.garage_installer_jobs j join public.garage_invoices i on i.id=j.invoice_id where i.delivered_at is null and j.status='completed' and j.approved_at is null;
select set_config('garage.lifecycle_admin','on',true);
update public.garage_installer_jobs j set status='submitted',submitted_for_approval_at=coalesce(submitted_for_approval_at,completed_at,now()),completed_at=null,completed_by=null from public.garage_invoices i where i.id=j.invoice_id and i.delivered_at is null and j.status='completed' and j.approved_at is null;
update public.garage_invoices i set work_status='pending_approval' from public.garage_installation_reviews r where r.invoice_id=i.id and r.state='head';
-- Historical deliveries remain historical; no salesman inspection timestamp is invented.
select set_config('garage.lifecycle_admin','on',true);
update public.garage_invoices i set work_status='sales_inspection' from public.garage_installation_reviews r where r.invoice_id=i.id and r.state='sales';

create function public.garage_installation_workflow(p_actor text,p_action text,p_data jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.garage_building_staff;inv public.garage_invoices;j public.garage_installer_jobs;w public.garage_installation_reviews;piece public.garage_tint_installation_pieces;previous public.garage_installation_requests;iid text;result jsonb;changed jsonb;ids text[];
begin
 select * into actor from public.garage_building_staff where id=p_actor;
 if p_action not in ('snapshot','notices') then select * into actor from public.garage_building_staff where id=p_actor for share;end if;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both') and actor.role in ('garage_installer','garage_detailer','garage_spray','garage_head','garage_salesman','director','shareholder'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action in ('pay','deliver','warranty','receipt') and actor.role not in ('garage_salesman','garage_head','director','shareholder') then raise exception 'NOT_ALLOWED';end if;
 if p_action='notices' then
 return jsonb_build_object('notices',coalesce((select jsonb_agg(jsonb_build_object('invoiceId',r.invoice_id,'jobId',jb.id,'invoiceNumber',i.invoice_number,'state',r.state,'reason',r.reason)) from public.garage_installation_reviews r join public.garage_invoices i on i.id=r.invoice_id join public.garage_installer_jobs jb on jb.invoice_id=i.id where (actor.role='garage_head' and r.state in ('head','correction_review')) or (i.created_by=p_actor and r.state='sales')),'[]'::jsonb));end if;
 if p_data->>'jobId' is not null then select invoice_id into iid from public.garage_installer_jobs where id=p_data->>'jobId';elsif p_data->>'itemId' is not null then select invoice_id into iid from public.garage_tint_installation_pieces where id=p_data->>'itemId';else iid:=p_data->>'invoiceId';end if;
 if p_action='snapshot' then
  select * into inv from public.garage_invoices where id=iid;
  if inv.id is null or (actor.role='garage_salesman' and inv.created_by is distinct from p_actor) then raise exception 'NOT_ALLOWED';end if;
  if inv.service<>'tinted' then return jsonb_build_object('review',jsonb_build_object('invoice_id',iid,'revision',0,'state','ready','confirmations','{}'::jsonb),'job',jsonb_build_object('id',iid));end if;
  select jsonb_build_object('review',to_jsonb(r),'job',to_jsonb(jb),'itemIds',coalesce((select jsonb_agg(p.id) from public.garage_tint_installation_pieces p where p.invoice_id=iid),'[]'::jsonb),'history',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.garage_installation_review_events e where e.invoice_id=iid),'[]'::jsonb)) into result from public.garage_installation_reviews r join public.garage_installer_jobs jb on jb.invoice_id=r.invoice_id where r.invoice_id=iid;
  if result is null then raise exception 'NOT_READY';end if;return result;
 end if;
 -- Serialize each work order, always invoice then job then review/pieces.
 select * into inv from public.garage_invoices where id=iid for update;
 if inv.id is null then raise exception 'NOT_ALLOWED';end if;
 if inv.service<>'tinted' then
  if inv.created_by is distinct from p_actor and actor.role not in ('director','shareholder','garage_head') then raise exception 'NOT_ALLOWED';end if;
  if p_action='snapshot' then return jsonb_build_object('review',jsonb_build_object('invoice_id',iid,'revision',0,'state','ready','confirmations','{}'::jsonb),'job',jsonb_build_object('id',iid));end if;
  select * into previous from public.garage_installation_requests where actor_id=p_actor and request_id=p_data->>'requestId';
  if found then if previous.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return previous.result;end if;
  if p_action='receipt' then
   if left(coalesce(p_data->'value'->>'path',''),length(iid)+1)<>iid||'/' or coalesce(p_data->'value'->>'path','') like '%..%' or length(coalesce(p_data->'value'->>'name','')) not between 1 and 255 then raise exception 'INVALID';end if;
   update public.garage_invoices set receipt_path=p_data->'value'->>'path',receipt_name=p_data->'value'->>'name' where id=iid returning to_jsonb(garage_invoices.*) into changed;
  elsif p_action='pay' then changed:=to_jsonb(mark_garage_work_order_paid(iid,p_actor,p_data->>'value'));elsif p_action='deliver' then changed:=to_jsonb(deliver_garage_work_order(iid,p_actor));elsif p_action='warranty' then changed:=to_jsonb(register_garage_work_order_warranty(iid,p_actor));else raise exception 'NOT_ALLOWED';end if;
  result:=jsonb_build_object('result',changed,'review',jsonb_build_object('invoice_id',iid,'revision',0,'state','ready','confirmations','{}'::jsonb),'job',jsonb_build_object('id',iid));insert into public.garage_installation_requests values(p_actor,p_data->>'requestId',jsonb_build_object('action',p_action,'data',p_data),result);return result;
 end if;
 select * into j from public.garage_installer_jobs jb where jb.invoice_id=iid for update;
 if j.id is null then raise exception 'NOT_READY';end if;
 if actor.role='garage_salesman' and inv.created_by is distinct from p_actor then raise exception 'NOT_ALLOWED';end if;
 select * into w from public.garage_installation_reviews where invoice_id=iid for update;
 if w.invoice_id is null then raise exception 'NOT_READY';end if;
 if p_data->>'requestId' is null or length(p_data->>'requestId') not between 16 and 80 then raise exception 'INVALID';end if;
 select * into previous from public.garage_installation_requests where actor_id=p_actor and request_id=p_data->>'requestId';
 if found then if previous.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return previous.result;end if;
 if (p_data->>'revision')::bigint is distinct from w.revision then raise exception 'REVISION_CONFLICT';end if;
 if inv.delivered_at is not null and p_action<>'warranty' then raise exception 'NOT_READY';end if;
 if p_action in ('head_approve','head_return','eta') and actor.role<>'garage_head' then raise exception 'NOT_ALLOWED';end if;
 perform garage_lifecycle_begin();
 if p_action in ('claim','release','complete','reopen','remark','sqft','start','confirm') then
  if actor.role not in ('garage_installer','garage_detailer','garage_spray') then raise exception 'NOT_ALLOWED';end if;
  if w.state<>'working' then raise exception 'NOT_READY';end if;
  if p_action='start' then changed:=to_jsonb(start_garage_installer_job(j.id,p_actor));
  elsif p_action='confirm' then
   if not exists(select 1 from public.garage_tint_installation_pieces where invoice_id=iid and garage_is_required_glass(position) and installer_id=p_actor) or exists(select 1 from public.garage_tint_installation_pieces where invoice_id=iid and garage_is_required_glass(position) and installer_id=p_actor and status<>'installed') then raise exception 'OWN_WORK_INCOMPLETE';end if;
   update public.garage_installation_reviews set confirmations=jsonb_set(confirmations,array[p_actor],to_jsonb(now())) where invoice_id=iid;
  else
   select * into piece from public.garage_tint_installation_pieces where id=p_data->>'itemId' and invoice_id=iid for update;
   if piece.id is null then raise exception 'INVALID';end if;
   if p_action<>'claim' and piece.installer_id is distinct from p_actor then raise exception 'NOT_ALLOWED';end if;
   if p_action='release' and piece.needs_correction then raise exception 'ORIGINAL_INSTALLER';end if;
   case p_action
    when 'claim' then changed:=to_jsonb(claim_garage_glass_item(piece.id,p_actor));
    when 'release' then changed:=to_jsonb(release_garage_glass_item(piece.id,p_actor));
    when 'complete' then changed:=to_jsonb(set_garage_glass_item_status(piece.id,'installed',p_actor));
    when 'reopen' then changed:=to_jsonb(set_garage_glass_item_status(piece.id,'taken',p_actor));
    when 'remark' then changed:=to_jsonb(set_garage_glass_item_remark(piece.id,p_data->>'value',p_actor));
    when 'sqft' then changed:=set_garage_glass_item_sqft(piece.id,(p_data->>'value')::numeric,p_actor);
   end case;
   update public.garage_installation_reviews set confirmations=confirmations-p_actor where invoice_id=iid;
  end if;
  select * into w from public.garage_installation_reviews where invoice_id=iid;
  if exists(select 1 from public.garage_tint_installation_pieces where invoice_id=iid and garage_is_required_glass(position)) and not exists(select 1 from public.garage_tint_installation_pieces where invoice_id=iid and garage_is_required_glass(position) and (status<>'installed' or installer_id is null or not(w.confirmations ? installer_id))) then
   perform submit_garage_installation(j.id,p_actor);update public.garage_installation_reviews set state='head' where invoice_id=iid;
  end if;
 elsif p_action='head_approve' then
  if p_data->'value' is distinct from 'true'::jsonb then raise exception 'INSPECTION_REQUIRED';end if;
  if w.state<>'head' then raise exception 'NOT_READY';end if;
  perform approve_garage_installation(j.id,p_actor,true,null);
  update public.garage_installation_reviews set state='sales',head_by=p_actor,head_at=now(),sales_by=null,sales_at=null,reason=null where invoice_id=iid;
  update public.garage_invoices set work_status='sales_inspection' where id=iid;
 elsif p_action='head_return' then
  if w.state not in ('head','correction_review') then raise exception 'NOT_READY';end if;
  select array_agg(value) into ids from jsonb_array_elements_text(p_data->'itemIds');
  if nullif(trim(p_data->>'reason'),'') is null or coalesce(cardinality(ids),0)=0 then raise exception 'REASON_REQUIRED';end if;
  if exists(select 1 from unnest(ids) s(id) where not exists(select 1 from public.garage_tint_installation_pieces p where p.id=s.id and p.invoice_id=iid and p.installer_id is not null and garage_is_required_glass(p.position))) then raise exception 'INVALID';end if;
  perform set_config('garage.lifecycle_admin','on',true);
  update public.garage_installer_jobs set status='in_progress',approved_at=null,approved_by=null,completed_at=null,completed_by=null,final_inspection_at=null,returned_at=now(),returned_by=p_actor,return_reason=trim(p_data->>'reason') where id=j.id;
  update public.garage_tint_installation_pieces set status='taken',installed_series=null,completed_at=null,completed_by=null,needs_correction=true,correction_note=trim(p_data->>'reason'),updated_at=now() where invoice_id=iid and id=any(ids);
  update public.garage_invoices set work_status='in_progress' where id=iid;
  perform log_garage_work_order_event(iid,'INSTALLATION_RETURNED',p_actor,jsonb_build_object('reason',p_data->>'reason','item_ids',to_jsonb(ids),'kind',p_data->>'value'));
  update public.garage_installation_reviews set state='working',confirmations='{}',head_by=null,head_at=null,sales_by=null,sales_at=null,reason=trim(p_data->>'reason') where invoice_id=iid;
 elsif p_action in ('sales_approve','sales_return') then
  if inv.created_by is distinct from p_actor or w.state<>'sales' then raise exception 'NOT_ALLOWED';end if;
  if p_action='sales_approve' and p_data->'value' is distinct from 'true'::jsonb then raise exception 'INSPECTION_REQUIRED';end if;
  if p_action='sales_return' and nullif(trim(p_data->>'reason'),'') is null then raise exception 'REASON_REQUIRED';end if;
  update public.garage_installation_reviews set state=case when p_action='sales_approve' then 'ready' else 'correction_review' end,sales_by=p_actor,sales_at=now(),reason=case when p_action='sales_return' then trim(p_data->>'reason') else null end where invoice_id=iid;
  update public.garage_invoices set work_status=case when p_action='sales_return' then 'head_correction_review' when payment_status='paid' then 'ready_for_delivery' else 'payment_due' end where id=iid;
 elsif p_action='eta' then changed:=to_jsonb(set_garage_installation_eta(j.id,(p_data->>'value')::timestamptz,p_actor));
 elsif p_action in ('pay','deliver','warranty','receipt') then
  if inv.created_by is distinct from p_actor and actor.role not in ('director','shareholder','garage_head') then raise exception 'NOT_ALLOWED';end if;
  if p_action='receipt' then
   if left(coalesce(p_data->'value'->>'path',''),length(iid)+1)<>iid||'/' or coalesce(p_data->'value'->>'path','') like '%..%' or length(coalesce(p_data->'value'->>'name','')) not between 1 and 255 then raise exception 'INVALID';end if;
   update public.garage_invoices set receipt_path=p_data->'value'->>'path',receipt_name=p_data->'value'->>'name' where id=iid returning to_jsonb(garage_invoices.*) into changed;
  elsif p_action='pay' then changed:=to_jsonb(mark_garage_work_order_paid(iid,p_actor,p_data->>'value'));
  elsif p_action='deliver' then
   if w.state<>'ready' or w.head_at is null or w.sales_at is null then raise exception 'INSPECTION_REQUIRED';end if;
   changed:=to_jsonb(deliver_garage_work_order(iid,p_actor));
  else changed:=to_jsonb(register_garage_work_order_warranty(iid,p_actor));end if;
 else raise exception 'INVALID';end if;
 update public.garage_installation_reviews set revision=revision+1,updated_at=now() where invoice_id=iid returning * into w;
 insert into public.garage_installation_review_events(invoice_id,actor_id,action,details) values(iid,p_actor,p_action,case when p_action in ('pay','receipt') then jsonb_build_object('invoiceId',iid) else p_data-'requestId' end);
 select * into j from public.garage_installer_jobs jb where jb.id=j.id;
 result:=jsonb_build_object('review',to_jsonb(w),'job',to_jsonb(j),'itemIds',coalesce((select jsonb_agg(p.id) from public.garage_tint_installation_pieces p where p.invoice_id=iid),'[]'::jsonb),'result',changed);
 insert into public.garage_installation_requests values(p_actor,p_data->>'requestId',jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
end;$$;
revoke all on function public.garage_installation_workflow(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.garage_installation_workflow(text,text,jsonb) to service_role;

-- No browser access to the old actor-by-argument mutation functions.
do $$declare f record;begin
 for f in select oid::regprocedure sig from pg_proc where pronamespace='public'::regnamespace and (proname in ('garage_lifecycle_begin','garage_begin_installation','log_garage_work_order_event','start_garage_installer_job','submit_garage_installation','approve_garage_installation','return_garage_installation','set_garage_installation_eta','accept_garage_installer_job','assign_garage_installer_job','complete_garage_installer_job','mark_garage_work_order_paid','deliver_garage_work_order','register_garage_work_order_warranty','set_garage_glass_item_installer') or proname ~ '^(claim|release|assign|set)_garage_glass_item') loop
 execute format('revoke execute on function %s from public,anon,authenticated',f.sig);execute format('grant execute on function %s to service_role',f.sig);
 end loop;
end;$$;
revoke insert,update,delete on public.garage_installer_jobs,public.garage_tint_installation_pieces,public.garage_tint_orders,public.garage_invoices,public.garage_work_order_activity from public,anon,authenticated;
revoke update(receipt_path,receipt_name) on public.garage_invoices from public,anon,authenticated;

create or replace function mark_garage_work_order_paid(p_invoice_id text, p_actor_id text, p_method text)
returns garage_invoices
language plpgsql
as $$
declare
  inv garage_invoices;
  result garage_invoices;
begin
  perform garage_lifecycle_begin();
  perform assert_not_installer(p_actor_id);
  if (select payment_status from garage_invoices where id = p_invoice_id) = 'paid' then
    raise exception 'ALREADY_PAID';
  end if;
  inv := garage_require_stage(p_invoice_id,
    array['waiting_for_installer', 'installer_assigned', 'in_progress', 'pending_approval', 'sales_inspection', 'head_correction_review', 'payment_due'],
    'CANNOT_TAKE_PAYMENT');

  update garage_invoices
  set payment_status = 'paid', paid_at = now(), paid_by = p_actor_id,
      payment_method = coalesce(p_method, payment_method),
      work_status = case when work_status = 'payment_due' then 'ready_for_delivery' else work_status end
  where id = p_invoice_id and payment_status = 'pending'
  returning * into result;
  if not found then raise exception 'ALREADY_PAID'; end if;

  perform log_garage_work_order_event(p_invoice_id, 'PAYMENT_COLLECTED', p_actor_id,
    jsonb_build_object('method', p_method));
  if inv.work_status = 'payment_due' then
    perform log_garage_work_order_event(p_invoice_id, 'VEHICLE_READY', p_actor_id, '{}'::jsonb);
  end if;
  return result;
end;
$$;

revoke execute on function public.garage_work_status_from_facts(text),public.garage_legacy_work_status_from_facts(text),public.garage_work_status_transition_allowed(text,text),public.garage_legacy_work_status_transition_allowed(text,text) from public,anon,authenticated;
grant execute on function public.garage_work_status_from_facts(text),public.garage_legacy_work_status_from_facts(text),public.garage_work_status_transition_allowed(text,text),public.garage_legacy_work_status_transition_allowed(text,text) to service_role;

-- Persist the salesman-confirmed vehicle layout with the sale. No existing orders change.
create or replace function public.garage_vehicle_glass_positions(config jsonb) returns text[] language plpgsql immutable set search_path=public,pg_temp as $$
declare b text;r text;n integer;positions text[];i integer;
begin
 if jsonb_typeof(config) is distinct from 'object' or config-array['body','roof','sideRows']<>'{}'::jsonb then raise exception 'INVALID_LAYOUT';end if;
 b:=config->>'body';r:=config->>'roof';
 if coalesce(b,'') not in ('sedan','coupe','mpv','suv','van','bus') or coalesce(r,'') not in ('none','single','split','panoramic') or jsonb_typeof(config->'sideRows') is distinct from 'number' then raise exception 'INVALID_LAYOUT';end if;
 if (config->>'sideRows')::numeric<>trunc((config->>'sideRows')::numeric) or (config->>'sideRows')::numeric not between 0 and 10 then raise exception 'INVALID_LAYOUT';end if;
 n:=(config->>'sideRows')::integer;
 if (b='bus' and (r<>'none' or n<1)) or (b='van' and n>6) or (b not in ('van','bus') and n<>0) then raise exception 'INVALID_LAYOUT';end if;
 positions:=array['front_windscreen','front_left_window','front_right_window'];
 if b in ('van','bus') then
  if n>0 then for i in 1..n loop positions:=positions||array['side_left_'||i,'side_right_'||i];end loop;end if;
 elsif b<>'coupe' then positions:=positions||array['rear_left_window','rear_right_window'];end if;
 if b not in ('van','bus') then positions:=positions||array['rear_left_panel_window','rear_right_panel_window'];end if;
 positions:=positions||array['rear_windscreen'];
 if r='single' then positions:=positions||array['front_roof_glass'];elsif r='split' then positions:=positions||array['front_roof_glass','rear_roof_glass'];elsif r='panoramic' then positions:=positions||array['panoramic_roof_glass'];end if;
 return positions;
end $$;
revoke all on function public.garage_vehicle_glass_positions(jsonb) from public,anon,authenticated;
grant execute on function public.garage_vehicle_glass_positions(jsonb) to service_role;
alter table public.garage_tint_orders add column vehicle_layout jsonb;
create or replace function public.garage_sale_confirmation(p_actor text,p_action text,p_request text,p_sale jsonb default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.garage_building_staff; existing public.garage_sale_confirmations; invoice public.garage_invoices;
 pending jsonb; selections jsonb; extras jsonb; addons jsonb; item jsonb; booking jsonb; iid text; count_items integer; config jsonb; allowed_positions text[];
begin
 select * into actor from public.garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both') and actor.role in ('director','shareholder','garage_head','garage_salesman'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_request is null or p_request !~ '^[A-Za-z0-9_-]{16,80}$' or p_action not in ('confirm','status','abandon') then raise exception 'INVALID';end if;
 -- Status and abandonment take the same lock as confirm. They wait for an
 -- in-flight confirmation and cannot mislabel it as unsaved while it commits.
 perform pg_advisory_xact_lock(104025,hashtext(p_actor||':'||p_request));
 select * into existing from public.garage_sale_confirmations where actor_id=p_actor and request_id=p_request;
 if existing.request_id is not null then
  if existing.state='abandoned' then
   if p_action='confirm' then raise exception 'REQUEST_ABANDONED';end if;
   return jsonb_build_object('state','abandoned','replacementRequestId',existing.replacement_id);
  end if;
  if p_action='confirm' and existing.sale is distinct from p_sale then raise exception 'REQUEST_CHANGED';end if;
  select * into invoice from public.garage_invoices where id=existing.invoice_id;
  if invoice.id is null then
   if p_action='abandon' then update public.garage_sale_confirmations set replacement_id=coalesce(replacement_id,gen_random_uuid()::text) where actor_id=p_actor and request_id=p_request returning * into existing;end if;
   return jsonb_build_object('state','removed','replacementRequestId',existing.replacement_id);end if;
  return jsonb_build_object('state','saved','invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number,'paymentStatus',invoice.payment_status,'receiptPath',invoice.receipt_path,'receiptExpected',existing.sale->'receiptExpected','replayed',true);
 end if;
 if p_action='status' then return jsonb_build_object('state','missing');end if;
 if p_action='abandon' then
  insert into public.garage_sale_confirmations(actor_id,request_id,state,replacement_id) values(p_actor,p_request,'abandoned',gen_random_uuid()::text) returning * into existing;
  return jsonb_build_object('state','abandoned','replacementRequestId',existing.replacement_id);
 end if;
 if jsonb_typeof(p_sale) is distinct from 'object' or jsonb_typeof(p_sale->'pending') is distinct from 'object'
 or coalesce(p_sale->>'paymentStatus','') not in ('paid','pending')
 or (p_sale->>'paymentStatus'='paid' and coalesce(p_sale->>'paymentMethod','') not in ('cash','card','transfer','installment'))
 or length(coalesce(p_sale->>'remark',''))>2000 or jsonb_typeof(p_sale->'receiptExpected') is distinct from 'boolean'
 or not exists(select 1 from public.garage_vehicles where id=p_sale->>'vehicleId' and customer_id=p_sale->>'customerId') then raise exception 'INVALID';end if;
 pending:=p_sale->'pending';config:=pending->'vehicleLayout';
 if config is not null and config<>'null'::jsonb then allowed_positions:=public.garage_vehicle_glass_positions(config)||array['extra_rear_2pc','small_window'];else allowed_positions:=array['front_windscreen','front_left_window','front_right_window','rear_left_window','rear_right_window','rear_left_panel_window','rear_right_panel_window','rear_windscreen','extra_rear_2pc','small_window'];end if;
selections:=pending->'selections';extras:=pending->'extras';addons:=p_sale->'addons';booking:=p_sale->'booking';
 if coalesce(pending->>'packageType','') not in ('full','mix') or jsonb_typeof(selections) is distinct from 'array' or jsonb_typeof(extras) is distinct from 'array' or jsonb_typeof(addons) is distinct from 'array' then raise exception 'INVALID';end if;
 if jsonb_array_length(selections)<1 or jsonb_array_length(selections||extras)>32 or jsonb_array_length(addons)>50
 or jsonb_typeof(pending->'discount') is distinct from 'number' or jsonb_typeof(pending->'finalTotal') is distinct from 'number'
 or (pending->>'discount')::numeric not between 0 and 10000000 or (pending->>'finalTotal')::numeric not between 0 and 10000000
 or (pending->>'packageType'='full' and coalesce(pending->>'fullSeries','') not in ('eco','lite','classic','majestic','unique','royal')) then raise exception 'INVALID';end if;
 for item in select value from jsonb_array_elements(selections||extras) loop
  if jsonb_typeof(item) is distinct from 'object' or not (coalesce(item->>'position','')=any(allowed_positions))
  or coalesce(item->>'series','') not in ('eco','lite','classic','majestic','unique','royal') or length(coalesce(item->>'vlt','')) not between 1 and 30
  or jsonb_typeof(item->'price') is distinct from 'number' or (item->>'price')::numeric not between 0 and 10000000 then raise exception 'INVALID';end if;
 end loop;
 select count(distinct value->>'position') into count_items from jsonb_array_elements(selections||extras);
 if count_items<>jsonb_array_length(selections||extras) then raise exception 'INVALID';end if;
 for item in select value from jsonb_array_elements(addons) loop
  if jsonb_typeof(item) is distinct from 'object' or length(trim(coalesce(item->>'name',''))) not between 1 and 200
   or jsonb_typeof(item->'price') is distinct from 'number' or (item->>'price')::numeric not between 0 and 10000000
   or jsonb_typeof(item->'qty') is distinct from 'number' or (item->>'qty')::numeric not between 1 and 1000 or (item->>'qty')::numeric<>trunc((item->>'qty')::numeric) then raise exception 'INVALID';end if;
 end loop;
 if jsonb_typeof(booking) is distinct from 'object' or coalesce(booking->>'mode','') not in ('none','existing','new') then raise exception 'INVALID';end if;
 if booking->>'mode'='new' then
  if coalesce(booking->>'startsAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$'
   or coalesce(booking->>'endsAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$' then raise exception 'INVALID';end if;
 elsif booking->>'mode'='existing' and (coalesce(booking->>'appointmentId','')='' or jsonb_typeof(booking->'revision') is distinct from 'number' or (booking->>'revision')::numeric<1) then raise exception 'INVALID';end if;
 iid:='gi_'||replace(gen_random_uuid()::text,'-','');
 insert into public.garage_invoices(id,customer_id,vehicle_id,service,payment_method,payment_status,work_status,remark,created_by,paid_at,paid_by)
 values(iid,p_sale->>'customerId',p_sale->>'vehicleId','tinted',case when p_sale->>'paymentStatus'='paid' then p_sale->>'paymentMethod' else null end,p_sale->>'paymentStatus','waiting_for_installer',p_sale->>'remark',p_actor,case when p_sale->>'paymentStatus'='paid' then now() else null end,case when p_sale->>'paymentStatus'='paid' then p_actor else null end) returning * into invoice;
 insert into public.garage_tint_orders(invoice_id,package_type,full_series,selections,extras,discount,final_total,vehicle_layout)
 values(iid,pending->>'packageType',nullif(pending->>'fullSeries',''),selections,extras,(pending->>'discount')::numeric,(pending->>'finalTotal')::numeric,nullif(config,'null'::jsonb));
 insert into public.garage_tint_installation_pieces(id,invoice_id,position,requested_series,requested_vlt)
 select 'gp_'||replace(gen_random_uuid()::text,'-',''),iid,value->>'position',value->>'series',value->>'vlt' from jsonb_array_elements(selections||extras);
 insert into public.garage_invoice_addons(id,invoice_id,name,price,qty)
 select 'gad_'||replace(gen_random_uuid()::text,'-',''),iid,trim(value->>'name'),(value->>'price')::numeric,(value->>'qty')::integer from jsonb_array_elements(addons);
 insert into public.garage_installer_jobs(id,invoice_id,service) values('gj_'||replace(gen_random_uuid()::text,'-',''),iid,'tinted');
 if booking->>'mode'='existing' then
  perform public.garage_appointment_invoice_action(p_actor,'confirm_sale',jsonb_build_object('invoiceId',iid,'appointmentId',booking->>'appointmentId','revision',booking->'revision'));
 elsif booking->>'mode'='new' then
  perform public.garage_appointment_invoice_action(p_actor,'confirm_sale',jsonb_build_object('invoiceId',iid,'startsAt',booking->>'startsAt','endsAt',booking->>'endsAt'));
 end if;
 insert into public.garage_sale_confirmations(actor_id,request_id,state,sale,invoice_id) values(p_actor,p_request,'saved',p_sale,iid);
 return jsonb_build_object('state','saved','invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number,'paymentStatus',invoice.payment_status,'receiptPath',null,'receiptExpected',p_sale->'receiptExpected','replayed',false);
end $$;
revoke all on function public.garage_sale_confirmation(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.garage_sale_confirmation(text,text,text,jsonb) to service_role;

notify pgrst, 'reload schema';
commit;
select to_regclass('public.garage_installation_reviews') is not null as installation_ready,exists(select 1 from information_schema.columns where table_schema='public' and table_name='garage_tint_orders' and column_name='vehicle_layout') as layout_ready;
