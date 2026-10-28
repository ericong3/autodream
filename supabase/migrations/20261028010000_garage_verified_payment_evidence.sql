-- Preserve verified money state while allowing an immutable missing receipt to be attached.
create or replace function garage_tint_finance(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;inv garage_invoices;account garage_tint_accounts;payment garage_tint_payments;
 prior garage_tint_finance_requests;amount numeric;reported numeric;verified numeric;result jsonb;iid text;request text;page_no integer;
begin
 if p_action not in ('snapshot','queue') then perform 1 from garage_building_staff where id=p_actor for share;end if;
 actor:=garage_tint_money_actor(p_actor);
 if p_action not in ('snapshot','queue','record','verify','reject','void','receipt') then raise exception 'INVALID';end if;
 if p_action='queue' then
  if actor.role not in ('director','admin') then raise exception 'NOT_ALLOWED';end if;
  if coalesce(p_data->>'page','0') !~ '^\d{1,6}$' then raise exception 'INVALID';end if;
  page_no:=coalesce((p_data->>'page')::integer,0);
  return jsonb_build_object('payments',coalesce((select jsonb_agg(to_jsonb(q)) from
   (select p.*,i.invoice_number from garage_tint_payments p join garage_invoices i on i.id=p.invoice_id
    where p.state in ('pending','rejected') order by p.created_at,p.id limit 50 offset page_no*50) q),'[]'::jsonb),
   'hasMore',(select count(*)> (page_no+1)*50 from garage_tint_payments where state in ('pending','rejected')));
 end if;
 iid:=p_data->>'invoiceId';
 if p_action='snapshot' then return garage_tint_money_snapshot(p_actor,iid);end if;
 -- All finance and workshop transitions serialize on the invoice first.
 perform 1 from garage_building_staff where id=p_actor for share;
 select * into inv from garage_invoices where id=iid for update;
 if inv.id is null or inv.service<>'tinted' or (actor.role='garage_salesman' and inv.created_by is distinct from p_actor) then raise exception 'NOT_ALLOWED';end if;
 select * into account from garage_tint_accounts where invoice_id=iid;
 if account.invoice_id is null then raise exception 'FINANCE_NOT_READY';end if;
 request:=p_data->>'requestId';
 if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 select * into prior from garage_tint_finance_requests where actor_id=p_actor and request_id=request;
 if found then
  if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;
  return prior.result;
 end if;
 if p_action='record' then
  if inv.delivered_at is not null then raise exception 'ORDER_DELIVERED';end if;
  if jsonb_typeof(p_data->'amount') is distinct from 'number' or (p_data->>'amount') !~ '^\d{1,12}(\.\d{1,2})?$'
   or coalesce(p_data->>'method','') not in ('cash','card','transfer','installment')
   or length(coalesce(p_data->>'reference',''))>200 then raise exception 'INVALID';end if;
  amount:=(p_data->>'amount')::numeric;
  select coalesce(sum(p.amount),0) into reported from garage_tint_payments p where invoice_id=iid and state in ('pending','rejected','verified');
  if amount<=0 or amount>account.total_amount-reported then raise exception 'PAYMENT_EXCEEDS_BALANCE';end if;
  insert into garage_tint_payments(invoice_id,amount,method,reference,recorded_by)
   values(iid,amount,p_data->>'method',trim(coalesce(p_data->>'reference','')),p_actor) returning * into payment;
 elsif p_action in ('verify','reject','void') then
  if actor.role not in ('director','admin') then raise exception 'NOT_ALLOWED';end if;
  select * into payment from garage_tint_payments where id=p_data->>'paymentId' and invoice_id=iid for update;
  if payment.id is null then raise exception 'NOT_ALLOWED';end if;
  if payment.state not in ('pending','rejected') then raise exception 'PAYMENT_ALREADY_REVIEWED';end if;
  if length(coalesce(p_data->>'note',''))>2000 or (p_action in ('reject','void') and nullif(trim(p_data->>'note'),'') is null) then raise exception 'REASON_REQUIRED';end if;
  update garage_tint_payments set state=case when p_action='verify' then 'verified' when p_action='void' then 'voided' else 'rejected' end,
   reviewed_by=p_actor,reviewed_at=now(),review_note=trim(coalesce(p_data->>'note','')) where id=payment.id;
 else
  select * into payment from garage_tint_payments where id=p_data->>'paymentId' and invoice_id=iid for update;
  if payment.id is null or payment.state not in ('pending','rejected','verified') or (payment.recorded_by<>p_actor and actor.role not in ('director','admin')) then raise exception 'NOT_ALLOWED';end if;
  if payment.receipt_path is not null then raise exception 'RECEIPT_ALREADY_ATTACHED';end if;
  if coalesce(p_data->>'path','') not like iid||'/%' or coalesce(p_data->>'path','') like '%..%'
   or length(coalesce(p_data->>'name','')) not between 1 and 255 then raise exception 'INVALID';end if;
  update garage_tint_payments set receipt_path=p_data->>'path',receipt_name=p_data->>'name' where id=payment.id;
 end if;
 select coalesce(sum(p.amount),0) into verified from garage_tint_payments p where invoice_id=iid and state='verified';
 perform garage_lifecycle_begin();
 update garage_invoices set payment_status=case when verified>=account.total_amount then 'paid' else 'pending' end,
  paid_by=case when verified>=account.total_amount then coalesce(paid_by,p_actor) else null end,
  paid_at=case when verified>=account.total_amount then coalesce(paid_at,now()) else null end,
  payment_method=case when p_action='verify' then payment.method else payment_method end,
  work_status=case when verified>=account.total_amount and work_status='payment_due' then 'ready_for_delivery' else work_status end
 where id=iid;
 insert into garage_work_order_activity(work_order_id,event_type,actor_id,actor_role,metadata)
 values(iid,case p_action when 'record' then 'PAYMENT_REPORTED' when 'verify' then 'PAYMENT_VERIFIED' when 'reject' then 'PAYMENT_REJECTED' when 'void' then 'PAYMENT_REJECTED' else 'PAYMENT_PROOF_ATTACHED' end,p_actor,actor.role,
  jsonb_build_object('payment_id',payment.id,'action',p_action));
 result:=garage_tint_money_snapshot(p_actor,iid)||jsonb_build_object('paymentId',payment.id);
 insert into garage_tint_finance_requests values(p_actor,request,jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
end$$;

revoke all on function garage_tint_finance(text,text,jsonb) from public,anon,authenticated;
grant execute on function garage_tint_finance(text,text,jsonb) to service_role;
