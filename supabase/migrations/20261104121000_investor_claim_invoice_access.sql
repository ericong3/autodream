-- PREPARED ONLY. Own-claim invoice access for Used Car salespeople/mechanics.
-- Staff receive no general investor-account or bill access.
begin;
create function public.uc_staff_claim_proof(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;bill uc_investor_car_bills;car uc_investor_cars;doc uc_investor_documents;prior uc_investor_commands;
 req text;payload jsonb;path text;stored boolean;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role in ('salesperson','mechanic') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if jsonb_typeof(p_data) is distinct from 'object' or p_action not in ('proof_prepare','proof_confirm','proof_read') then raise exception 'INVALID';end if;
 if p_action in ('proof_confirm','proof_read') then
  if exists(select 1 from jsonb_object_keys(p_data) k where k<>'documentId') or jsonb_typeof(p_data->'documentId') is distinct from 'string' or p_data->>'documentId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID';end if;
  select * into doc from uc_investor_documents where id=(p_data->>'documentId')::uuid;
  if doc.id is null or doc.kind<>'bill' or not coalesce(uc_staff_claim_bill_owned(p_actor,doc.bill_id),false) then raise exception 'NOT_ALLOWED';end if;
  if p_action='proof_read' then
   if doc.state<>'confirmed' then raise exception 'NOT_ALLOWED';end if;
   return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'fileName',doc.file_name,'mimeType',doc.mime_type);
  end if;
  select * into bill from uc_investor_car_bills where id=doc.bill_id;
 else
  if exists(select 1 from jsonb_object_keys(p_data) k where k not in ('billId','kind','fileName','mimeType','sha256','sizeBytes','requestId'))
   or p_data->>'kind' is distinct from 'bill' or jsonb_typeof(p_data->'billId') is distinct from 'string' or p_data->>'billId' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(p_data->'fileName') is distinct from 'string' or p_data->>'fileName'<>trim(p_data->>'fileName') or length(p_data->>'fileName') not between 1 and 120 or p_data->>'fileName' ~ '[[:cntrl:]/\\]'
   or coalesce(p_data->>'mimeType','') not in ('image/png','image/jpeg','application/pdf') or coalesce(p_data->>'sha256','') !~ '^[0-9a-f]{64}$'
   or jsonb_typeof(p_data->'sizeBytes') is distinct from 'number' or p_data->>'sizeBytes' !~ '^[1-9][0-9]{0,6}$' or (p_data->>'sizeBytes')::integer>1400000
   or jsonb_typeof(p_data->'requestId') is distinct from 'string' or p_data->>'requestId' !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
  if not coalesce(uc_staff_claim_bill_owned(p_actor,(p_data->>'billId')::uuid),false) then raise exception 'NOT_ALLOWED';end if;
  req:=p_data->>'requestId';payload:=jsonb_build_object('action','staff_claim_proof','data',p_data);
  perform pg_advisory_xact_lock(hashtextextended(p_actor||':'||req,0));
  select * into prior from uc_investor_commands where actor_id=p_actor and request_id=req;
  if found then
   if prior.payload is distinct from payload then raise exception 'REQUEST_CHANGED';end if;
   select * into doc from uc_investor_documents where id=(prior.result->>'documentId')::uuid;
   return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'state',doc.state);
  end if;
  select * into bill from uc_investor_car_bills where id=(p_data->>'billId')::uuid;
 end if;
 select * into car from uc_investor_cars where car_id=bill.car_id;
 perform 1 from uc_investor_pots where id=car.pot_id for update;
 select * into bill from uc_investor_car_bills where id=bill.id for update;
 if p_action='proof_confirm' then
  select * into doc from uc_investor_documents where id=doc.id for update;
  if doc.state='confirmed' then return jsonb_build_object('documentId',doc.id,'state',doc.state);end if;
  if bill.state<>'pending' or car.settled_at is not null then raise exception 'CLAIM_LOCKED';end if;
  if to_regclass('storage.objects') is not null then
   execute 'select exists(select 1 from storage.objects where bucket_id=$1 and name=$2)' into stored using 'finance-evidence',doc.storage_path;
   if not stored then raise exception 'UPLOAD_MISSING';end if;
  end if;
  update uc_investor_documents set state='confirmed',confirmed_by=p_actor,confirmed_at=now() where id=doc.id;
  insert into uc_investor_audit(pot_id,actor_id,action,detail) values(car.pot_id,p_actor,'proof_upload',jsonb_build_object('billId',bill.id,'carId',car.car_id,'documentId',doc.id));
  return jsonb_build_object('documentId',doc.id,'state','confirmed');
 end if;
 if bill.state<>'pending' or car.settled_at is not null then raise exception 'CLAIM_LOCKED';end if;
 path:='bills/'||bill.id::text||'/bill-'||(p_data->>'sha256')||case p_data->>'mimeType' when 'image/png' then '.png' when 'image/jpeg' then '.jpg' else '.pdf' end;
 select * into doc from uc_investor_documents where storage_path=path;
 if doc.id is null then
  if (select count(*) from uc_investor_documents where bill_id=bill.id)>=20 then raise exception 'PROOF_LIMIT';end if;
  insert into uc_investor_documents(car_id,bill_id,kind,file_name,mime_type,size_bytes,sha256,storage_path,created_by,request_id)
  values(car.car_id,bill.id,'bill',p_data->>'fileName',p_data->>'mimeType',(p_data->>'sizeBytes')::integer,p_data->>'sha256',path,p_actor,req) returning * into doc;
 end if;
 insert into uc_investor_commands(actor_id,request_id,payload,result) values(p_actor,req,payload,jsonb_build_object('documentId',doc.id));
 return jsonb_build_object('documentId',doc.id,'path',doc.storage_path,'state',doc.state);
end $$;
revoke all on function public.uc_staff_claim_proof(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.uc_staff_claim_proof(text,text,jsonb) to service_role;
commit;
