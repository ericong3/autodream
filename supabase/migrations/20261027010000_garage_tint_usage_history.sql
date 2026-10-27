-- LOCAL CANDIDATE. Never refund previously consumed film when a piece is replaced.
alter table garage_tint_installation_pieces add column source_item_id text references garage_tint_installation_pieces(id) on delete restrict,add column usage_attempt integer not null default 1 check(usage_attempt>=1),
 add column replacement_count integer not null default 0 check(replacement_count>=0);
create table garage_tint_usage_attempts(
 item_id text not null references garage_tint_installation_pieces(id) on delete restrict,
 attempt integer not null,invoice_id text not null references garage_invoices(id),
 installer_id text,series text,kind text not null check(kind in ('original','replacement')),
 sqft numeric not null default 0 check(sqft>=0),closed_at timestamptz,created_at timestamptz not null default now(),
 primary key(item_id,attempt)
);
create table garage_film_movements(
 id bigint generated always as identity primary key,
 series text not null,delta numeric not null,balance_after numeric not null check(balance_after>=0),
 kind text not null check(kind in ('opening','usage','receipt','reconcile','configuration')),
 invoice_id text,item_id text,attempt integer,actor_id text not null,reason text not null,
 created_at timestamptz not null default now()
);
insert into garage_film_movements(series,delta,balance_after,kind,actor_id,reason)
 select series,remaining_sqft,remaining_sqft,'opening','system','Recorded stock balance at tracking activation' from garage_film_stock;
create index garage_film_movements_series_idx on garage_film_movements(series,id);
create index garage_film_movements_invoice_idx on garage_film_movements(invoice_id,id);
create table garage_stock_requests(actor_id text not null,request_id text not null,payload jsonb not null,result jsonb not null,primary key(actor_id,request_id));
alter table garage_tint_usage_attempts enable row level security;
alter table garage_film_movements enable row level security;
alter table garage_stock_requests enable row level security;
revoke all on garage_tint_usage_attempts,garage_film_movements,garage_stock_requests from public,anon,authenticated;
revoke insert,update,delete on garage_film_stock from public,anon,authenticated;
revoke execute on function adjust_film_stock(text,numeric) from public,anon,authenticated;

create function garage_tint_stock(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;stock garage_film_stock;old_remaining numeric;
 prior garage_stock_requests;result jsonb;amount numeric;reason text;request text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both')
  and actor.role in ('director','shareholder','garage_head','garage_salesman','garage_installer','garage_detailer','garage_spray'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action='list' then
  return jsonb_build_object('stock',coalesce((select jsonb_agg(to_jsonb(s) order by s.series) from garage_film_stock s),'[]'::jsonb),
   'movements',coalesce((select jsonb_agg(to_jsonb(m) order by m.id desc) from (select * from garage_film_movements order by id desc limit 100) m),'[]'::jsonb));
 end if;
 if p_action='snapshot' then
  select * into inv from garage_invoices where id=p_data->>'invoiceId';
  if inv.id is null or (actor.role='garage_salesman' and inv.created_by is distinct from p_actor) then raise exception 'NOT_ALLOWED';end if;
  return jsonb_build_object('attempts',coalesce((select jsonb_agg(to_jsonb(u)||jsonb_build_object('position',p.position) order by u.item_id,u.attempt) from garage_tint_usage_attempts u join garage_tint_installation_pieces p on p.id=u.item_id where u.invoice_id=inv.id),'[]'::jsonb),
   'replacementCount',(select coalesce(sum(replacement_count),0) from garage_tint_installation_pieces where invoice_id=inv.id),
   'afterSalesReplacementCount',(select count(*) from garage_tint_installation_pieces p where p.source_item_id in (select id from garage_tint_installation_pieces where invoice_id=inv.id)),
   'afterSalesUsage',(select coalesce(sum(u.sqft),0) from garage_tint_usage_attempts u join garage_tint_installation_pieces p on p.id=u.item_id where p.source_item_id in (select id from garage_tint_installation_pieces where invoice_id=inv.id)),
   'totalUsage',(select coalesce(sum(sqft),0) from garage_tint_usage_attempts where invoice_id=inv.id));
 end if;
 if p_action not in ('receive','reconcile','config') or actor.role not in ('director','shareholder','garage_head') then raise exception 'NOT_ALLOWED';end if;
 perform 1 from garage_building_staff where id=p_actor for share;
 request:=p_data->>'requestId';reason:=trim(p_data->>'reason');
 if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' or length(coalesce(reason,'')) not between 1 and 2000 then raise exception 'REASON_REQUIRED';end if;
 select * into stock from garage_film_stock where series=p_data->>'series' for update;
 if stock.series is null then raise exception 'NO_FILM_STOCK';end if;
 select * into prior from garage_stock_requests where actor_id=p_actor and request_id=request;
 if found then
  if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;
  return prior.result;
 end if;
 old_remaining:=stock.remaining_sqft;
 if p_action='config' then
  if jsonb_typeof(p_data->'rollSqft') is distinct from 'number' or jsonb_typeof(p_data->'lowStockThreshold') is distinct from 'number'
   or (p_data->>'rollSqft')::numeric not between 0 and 10000000 or (p_data->>'lowStockThreshold')::numeric not between 0 and 10000000 then raise exception 'INVALID';end if;
  update garage_film_stock set roll_sqft=(p_data->>'rollSqft')::numeric,low_stock_threshold=(p_data->>'lowStockThreshold')::numeric,updated_at=now() where series=stock.series returning * into stock;
 else
  if jsonb_typeof(p_data->'sqft') is distinct from 'number' or (p_data->>'sqft')::numeric not between 0 and 10000000 then raise exception 'INVALID';end if;
  amount:=(p_data->>'sqft')::numeric;
  if p_action='receive' and amount<=0 then raise exception 'INVALID';end if;
  update garage_film_stock set remaining_sqft=case when p_action='receive' then remaining_sqft+amount else amount end,updated_at=now() where series=stock.series returning * into stock;
 end if;
 insert into garage_film_movements(series,delta,balance_after,kind,actor_id,reason)
  values(stock.series,stock.remaining_sqft-old_remaining,stock.remaining_sqft,case p_action when 'receive' then 'receipt' when 'reconcile' then 'reconcile' else 'configuration' end,p_actor,reason);
 result:=jsonb_build_object('stock',to_jsonb(stock));
 insert into garage_stock_requests values(p_actor,request,jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
end$$;

alter function garage_installation_workflow(text,text,jsonb) rename to garage_installation_before_usage_ledger;
create function garage_installation_workflow(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;piece garage_tint_installation_pieces;
 previous garage_installation_requests;result jsonb;iid text;old_sqft numeric;stock garage_film_stock;ids text[];current_piece garage_tint_installation_pieces;
begin
 if p_action in ('snapshot','notices') then return garage_installation_before_usage_ledger(p_actor,p_action,p_data);end if;
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.business_access in ('garage','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_data->>'jobId' is not null then select invoice_id into iid from garage_installer_jobs where id=p_data->>'jobId';
 elsif p_data->>'itemId' is not null then select invoice_id into iid from garage_tint_installation_pieces where id=p_data->>'itemId';else iid:=p_data->>'invoiceId';end if;
 select * into inv from garage_invoices where id=iid for update;
 if inv.id is null then raise exception 'NOT_ALLOWED';end if;
 select * into previous from garage_installation_requests where actor_id=p_actor and request_id=p_data->>'requestId';
 if found then
  if previous.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;
  return previous.result;
 end if;
 if p_action='pay' and exists(select 1 from garage_tint_accounts where invoice_id=iid) then raise exception 'PAYMENT_LEDGER_REQUIRED';end if;
 if p_action='deliver' and exists(select 1 from garage_tint_accounts a where a.invoice_id=iid and a.total_amount>
  (select coalesce(sum(amount),0) from garage_tint_payments where invoice_id=iid and state='verified')) then raise exception 'PAYMENT_NOT_VERIFIED';end if;
 if p_action in ('sqft','complete') then
  select * into piece from garage_tint_installation_pieces where id=p_data->>'itemId' and invoice_id=iid;
  if piece.id is null or piece.installer_id is distinct from p_actor then raise exception 'NOT_ALLOWED';end if;
  if p_action='complete' and coalesce(piece.sqft,0)<=0 then raise exception 'FILM_USAGE_REQUIRED';end if;
  if p_action='sqft' and ((p_data->>'value')::numeric<coalesce(piece.sqft,0)) then raise exception 'FILM_USAGE_CANNOT_DECREASE';end if;
  old_sqft:=coalesce(piece.sqft,0);
 end if;
 -- Legacy function remains the authoritative role/revision/stage/inspection gate.
 result:=garage_installation_before_usage_ledger(p_actor,p_action,p_data);
 if p_action='sqft' then
  select * into current_piece from garage_tint_installation_pieces where id=piece.id;
  insert into garage_tint_usage_attempts(item_id,attempt,invoice_id,installer_id,series,kind,sqft)
   values(piece.id,piece.usage_attempt,iid,p_actor,coalesce(piece.installed_series,piece.requested_series),case when piece.usage_attempt=1 and piece.source_item_id is null then 'original' else 'replacement' end,current_piece.sqft)
   on conflict(item_id,attempt) do update set sqft=excluded.sqft;
  if current_piece.sqft>old_sqft then
   select * into stock from garage_film_stock where series=coalesce(piece.installed_series,piece.requested_series);
   insert into garage_film_movements(series,delta,balance_after,kind,invoice_id,item_id,attempt,actor_id,reason)
    values(stock.series,old_sqft-current_piece.sqft,stock.remaining_sqft,'usage',iid,piece.id,piece.usage_attempt,p_actor,'Film recorded for glass');
  end if;
 elsif p_action='head_return' and p_data->>'value'='replacement' then
  select array_agg(value) into ids from jsonb_array_elements_text(p_data->'itemIds');
  for piece in select * from garage_tint_installation_pieces where invoice_id=iid and id=any(ids) loop
   update garage_tint_usage_attempts set closed_at=now() where item_id=piece.id and attempt=piece.usage_attempt;
   -- Reset usage for the new attempt directly, never through a stock-refund helper.
   update garage_tint_installation_pieces set usage_attempt=usage_attempt+1,replacement_count=replacement_count+1,sqft=null where id=piece.id;
  end loop;
 end if;
 return result;
end$$;
revoke all on function garage_tint_stock(text,text,jsonb),garage_installation_workflow(text,text,jsonb),garage_installation_before_usage_ledger(text,text,jsonb) from public,anon,authenticated;
grant execute on function garage_tint_stock(text,text,jsonb),garage_installation_workflow(text,text,jsonb) to service_role;
