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
