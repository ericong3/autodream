-- Local candidate: customer-profile purchase history remains the after-sales entry point.
create table garage_tint_reworks(
 id text primary key,source_invoice_id text not null references garage_invoices(id) on delete restrict,
 invoice_id text not null unique references garage_invoices(id) on delete restrict,
 claim_id text unique references garage_invoice_claims(id) on delete restrict,
 kind text not null check(kind in ('warranty','replacement','paid')),reason text not null,
 created_by text not null references users(id),created_at timestamptz not null default now()
);
create table garage_tint_rework_requests(actor_id text not null,request_id text not null,payload jsonb not null,result jsonb not null,primary key(actor_id,request_id));
alter table garage_tint_reworks enable row level security;alter table garage_tint_rework_requests enable row level security;
revoke all on garage_tint_reworks,garage_tint_rework_requests from public,anon,authenticated;
-- Claim records can no longer be forged directly from a browser.
create policy garage_tint_claim_insert_private on garage_invoice_claims as restrictive for insert to anon,authenticated with check(not exists(select 1 from garage_invoices i where i.id=invoice_id and i.service='tinted'));
create policy garage_tint_claim_update_private on garage_invoice_claims as restrictive for update to anon,authenticated using(not exists(select 1 from garage_invoices i where i.id=invoice_id and i.service='tinted')) with check(not exists(select 1 from garage_invoices i where i.id=invoice_id and i.service='tinted'));
create policy garage_tint_claim_delete_private on garage_invoice_claims as restrictive for delete to anon,authenticated using(not exists(select 1 from garage_invoices i where i.id=invoice_id and i.service='tinted'));
create function garage_tint_rework(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;ord garage_tint_orders;prior garage_tint_rework_requests;
 ids text[];selections jsonb;kind text;reason text;request text;price numeric;result jsonb;newid text;claimid text;rid text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both') and actor.role in ('director','shareholder','garage_head','garage_salesman'),false) then raise exception 'NOT_ALLOWED';end if;
 select * into inv from garage_invoices where id=p_data->>'invoiceId' for update;
 if inv.id is null or inv.service<>'tinted' then raise exception 'NOT_ALLOWED';end if;
 if p_action='snapshot' then
  return jsonb_build_object('delivered',inv.delivered_at is not null,'items',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'position',p.position,'series',coalesce(p.installed_series,p.requested_series),'vlt',p.requested_vlt)) from garage_tint_installation_pieces p where p.invoice_id=inv.id),'[]'::jsonb),
   'reworks',coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object('invoice_number',i.invoice_number,'delivered_at',i.delivered_at) order by r.created_at desc) from garage_tint_reworks r join garage_invoices i on i.id=r.invoice_id where r.source_invoice_id=inv.id),'[]'::jsonb),
   'source', (select to_jsonb(r)||jsonb_build_object('invoice_number',i.invoice_number) from garage_tint_reworks r join garage_invoices i on i.id=r.source_invoice_id where r.invoice_id=inv.id));
 end if;
 if p_action<>'create' then raise exception 'INVALID';end if;
 request:=p_data->>'requestId';kind:=p_data->>'kind';reason:=trim(p_data->>'reason');
 if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 select * into prior from garage_tint_rework_requests where actor_id=p_actor and request_id=request;
 if found then if prior.payload is distinct from p_data then raise exception 'REQUEST_CHANGED';end if;return prior.result;end if;
 if inv.delivered_at is null then raise exception 'DELIVERY_REQUIRED';end if;
 if kind is null or kind not in ('warranty','replacement','paid') or length(coalesce(reason,'')) not between 1 and 2000 or jsonb_typeof(p_data->'itemIds') is distinct from 'array' then raise exception 'REASON_REQUIRED';end if;
 select array_agg(value) into ids from jsonb_array_elements_text(p_data->'itemIds');
 if coalesce(cardinality(ids),0) not between 1 and 32 or cardinality(ids)<>(select count(distinct x) from unnest(ids) x)
 or cardinality(ids)<>(select count(*) from garage_tint_installation_pieces where invoice_id=inv.id and id=any(ids)) then raise exception 'INVALID';end if;
 if exists(select 1 from garage_tint_installation_pieces p join garage_invoices i on i.id=p.invoice_id where p.source_item_id=any(ids) and i.delivered_at is null) then raise exception 'REPLACEMENT_OPEN';end if;
 if jsonb_typeof(p_data->'amount') is distinct from 'number' then raise exception 'INVALID';end if;
 price:=(p_data->>'amount')::numeric;
 if price<0 or price>10000000 or price<>round(price,2) or (kind='paid' and price<=0) or (kind<>'paid' and price<>0) then raise exception 'INVALID';end if;
 select * into ord from garage_tint_orders where invoice_id=inv.id;
 select jsonb_agg(jsonb_build_object('position',position,'series',coalesce(installed_series,requested_series),'vlt',requested_vlt,'price',0) order by position) into selections from garage_tint_installation_pieces where invoice_id=inv.id and id=any(ids);
 result:=garage_sale_confirmation(p_actor,'confirm','rework_'||md5(p_actor||request),jsonb_build_object('customerId',inv.customer_id,'vehicleId',inv.vehicle_id,'paymentStatus','pending','receiptExpected',false,'remark','After-sales '||kind||' for '||inv.invoice_number||': '||reason,'pending',jsonb_build_object('packageType','mix','vehicleLayout',ord.vehicle_layout,'selections',selections,'extras','[]'::jsonb,'discount',0,'finalTotal',price),'addons','[]'::jsonb,'booking',jsonb_build_object('mode','none')));
 newid:=result->>'invoiceId';
 if kind<>'paid' then
  claimid:='gcl_'||replace(gen_random_uuid()::text,'-','');
  insert into garage_invoice_claims(id,invoice_id,type,bear_by,reason,created_by) values(claimid,inv.id,kind,case when kind='warranty' then 'supplier' else 'company' end,reason,p_actor);
 end if;
 rid:='grw_'||replace(gen_random_uuid()::text,'-','');
 insert into garage_tint_reworks(id,source_invoice_id,invoice_id,claim_id,kind,reason,created_by) values(rid,inv.id,newid,claimid,kind,reason,p_actor);
 update garage_tint_installation_pieces n set source_item_id=o.id,replacement_count=1 from garage_tint_installation_pieces o where n.invoice_id=newid and o.invoice_id=inv.id and o.id=any(ids) and o.position=n.position;
 result:=result||jsonb_build_object('reworkId',rid,'claimId',claimid);
 insert into garage_tint_rework_requests values(p_actor,request,p_data,result);return result;
end$$;
revoke all on function garage_tint_rework(text,text,jsonb) from public,anon,authenticated;
grant execute on function garage_tint_rework(text,text,jsonb) to service_role;

