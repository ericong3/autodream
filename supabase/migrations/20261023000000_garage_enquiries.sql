-- Prepared migration: permits IC-less enquiries in the existing customer table.
-- Existing staff, orders and customer values are not rewritten.
-- Customers remain shared; new enquiry tables have no browser grants.
alter table public.garage_customers alter column ic_number drop not null;
create table public.garage_enquiries (
 id text primary key,
 customer_id text not null references public.garage_customers(id) on delete restrict,
 owner_id text not null references public.garage_building_staff(id) on delete restrict,
 asset text not null default '' check(length(asset)<=200),
 next_action text not null default '' check(length(next_action)<=1000),
 reminder_date date,
 revision integer not null default 1,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index garage_enquiries_owner on public.garage_enquiries(owner_id,updated_at desc);
create table public.garage_enquiry_services (
 enquiry_id text not null references public.garage_enquiries(id) on delete cascade,
 service text not null check(service in ('Tint','Coating','PPF','Spray','Building tint')),
 status text not null default 'New' check(status in ('New','Discussing','Quoted')),
 primary key(enquiry_id,service)
);
alter table public.garage_enquiries enable row level security;
alter table public.garage_enquiry_services enable row level security;
revoke all on public.garage_enquiries,public.garage_enquiry_services from public,anon,authenticated;

create function public.garage_enquiry_phone(p_phone text) returns text language sql immutable
set search_path=public,pg_temp as $$
 select case when n like '0060%' then '0'||substr(n,5) when n like '60%' then '0'||substr(n,3) when n ~ '^1[0-9]{8,9}$' then '0'||n else n end
 from (select regexp_replace(p_phone,'[^0-9]','','g') n) t;
$$;
revoke all on function public.garage_enquiry_phone(text) from public,anon,authenticated;

create function public.garage_enquiry_action(p_actor text,p_action text,p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare actor public.garage_building_staff; entry public.garage_enquiries; customer text; eid text;
 phone_key text; services jsonb; role_director boolean; result jsonb; saved jsonb; page_no integer; total integer;
begin
 select * into actor from public.garage_building_staff where id=p_actor for share;
 if actor.id is null or not actor.enabled or actor.registration_status='pending'
 or actor.business_access not in ('garage','both') or (actor.role not in ('director','shareholder','garage_head','garage_salesman') and not (p_action='customer_get' and actor.role in ('garage_installer','garage_detailer','garage_spray'))) then raise exception 'NOT_ALLOWED'; end if;
 role_director:=actor.role='director';
 page_no:=coalesce((p_data->>'page')::integer,0);
 if page_no not between 0 and 100000 then raise exception 'INVALID'; end if;
 if p_action='customer_complete' then
  if coalesce(p_data->>'icNumber','') !~ '^\d{6}-\d{2}-\d{4}$' then raise exception 'INVALID'; end if;
  update public.garage_customers set ic_number=p_data->>'icNumber' where id=p_data->>'id' and ic_number is null;
  if not found then raise exception 'INVALID'; end if;
  select to_jsonb(c) into result from public.garage_customers c where c.id=p_data->>'id';
  return jsonb_build_object('customer',result);
 elsif p_action in ('customer_get','customer_ic') then
  select to_jsonb(c) into result from public.garage_customers c where
   (p_action='customer_get' and c.id=p_data->>'id') or (p_action='customer_ic' and c.ic_number=p_data->>'icNumber');
  return jsonb_build_object('customer',result);
 elsif p_action='customer_create' then
  phone_key:=public.garage_enquiry_phone(p_data->>'phone');
  if length(trim(coalesce(p_data->>'name',''))) not between 1 and 100 or length(coalesce(p_data->>'phone',''))>30
   or length(phone_key) not between 7 and 15 or coalesce(p_data->>'icNumber','') !~ '^\d{6}-\d{2}-\d{4}$'
   or length(coalesce(p_data->>'email',''))>254 then raise exception 'INVALID'; end if;
  perform pg_advisory_xact_lock(hashtext(phone_key));
  if coalesce((p_data->>'separatePerson')::boolean,false)=false and exists(select 1 from public.garage_customers where public.garage_enquiry_phone(phone)=phone_key) then raise exception 'CUSTOMER_MATCH'; end if;
  customer:='gc_'||replace(gen_random_uuid()::text,'-','');
  insert into public.garage_customers(id,name,phone,ic_number,email,created_by) values(customer,trim(p_data->>'name'),trim(p_data->>'phone'),p_data->>'icNumber',nullif(trim(p_data->>'email'),''),p_actor);
  select to_jsonb(c) into result from public.garage_customers c where c.id=customer;
  return jsonb_build_object('customer',result);
 end if;
 if p_action='customers' then
  if length(trim(coalesce(p_data->>'name','')))<2 or length(p_data->>'name')>100 then raise exception 'INVALID'; end if;
  phone_key:=public.garage_enquiry_phone(p_data->>'name');
  select coalesce(jsonb_agg(to_jsonb(c)),'[]') into result from (
   select id,name,phone,ic_number from public.garage_customers
   where position(lower(trim(p_data->>'name')) in lower(name))>0
   or (length(phone_key)>=3 and position(phone_key in public.garage_enquiry_phone(phone))>0)
   order by name,id limit 20
  ) c;
  return jsonb_build_object('customers',result);
 elsif p_action='create' then
  services:=p_data->'services';
  if jsonb_typeof(services) is distinct from 'array' then raise exception 'INVALID'; end if;
  if jsonb_array_length(services) not between 1 and 5
   or exists(select 1 from jsonb_array_elements_text(services) s where s not in ('Tint','Coating','PPF','Spray','Building tint'))
   or (services ? 'Building tint' and jsonb_array_length(services)>1)
   or (select count(*)<>count(distinct s) from jsonb_array_elements_text(services) s) then raise exception 'INVALID'; end if;
  customer:=nullif(p_data->>'customerId','');
  if customer is null then
   phone_key:=public.garage_enquiry_phone(p_data->>'phone');
   if length(trim(coalesce(p_data->>'name',''))) not between 1 and 100 or length(coalesce(p_data->>'phone',''))>30 or length(phone_key) not between 7 and 15 then raise exception 'INVALID'; end if;
   -- Serializes matching phone submissions; does not silently merge family members.
   perform pg_advisory_xact_lock(hashtext(phone_key));
   if coalesce((p_data->>'separatePerson')::boolean,false)=false and exists(select 1 from public.garage_customers where public.garage_enquiry_phone(phone)=phone_key) then raise exception 'CUSTOMER_MATCH'; end if;
   customer:='gc_'||replace(gen_random_uuid()::text,'-','');
   insert into public.garage_customers(id,name,phone,ic_number) values(customer,trim(p_data->>'name'),trim(p_data->>'phone'),null);
  elsif not exists(select 1 from public.garage_customers where id=customer) then raise exception 'INVALID'; end if;
  if length(coalesce(p_data->>'asset',''))>200 then raise exception 'INVALID'; end if;
  eid:='ge_'||replace(gen_random_uuid()::text,'-','');
  insert into public.garage_enquiries(id,customer_id,owner_id,asset) values(eid,customer,p_actor,coalesce(p_data->>'asset',''));
  insert into public.garage_enquiry_services(enquiry_id,service) select eid,s from jsonb_array_elements_text(services) s;
 elsif p_action='update' then
  select * into entry from public.garage_enquiries where id=p_data->>'id' and (owner_id=p_actor or role_director) for update;
  if entry.id is null then raise exception 'NOT_ALLOWED'; end if;
  if entry.revision is distinct from (p_data->>'revision')::integer then raise exception 'REVISION_CONFLICT'; end if;
  if p_data ? 'icNumber' then
   if p_data->>'icNumber' !~ '^\d{6}-\d{2}-\d{4}$' then raise exception 'INVALID'; end if;
   update public.garage_customers set ic_number=p_data->>'icNumber' where id=entry.customer_id and ic_number is null;
   if not found then raise exception 'INVALID'; end if;
  elsif p_data ? 'service' then
   if coalesce(p_data->>'status','') not in ('New','Discussing','Quoted') then raise exception 'INVALID'; end if;
   update public.garage_enquiry_services set status=p_data->>'status' where enquiry_id=entry.id and service=p_data->>'service';
   if not found then raise exception 'INVALID'; end if;
  else
   if length(coalesce(p_data->>'nextAction',''))>1000 or length(coalesce(p_data->>'asset',''))>200
    or (coalesce(p_data->>'reminderDate','')<>'' and (p_data->>'reminderDate') !~ '^\d{4}-\d{2}-\d{2}$') then raise exception 'INVALID'; end if;
   update public.garage_enquiries set next_action=coalesce(p_data->>'nextAction',''),asset=coalesce(p_data->>'asset',''),reminder_date=nullif(p_data->>'reminderDate','')::date where id=entry.id;
  end if;
  update public.garage_enquiries set revision=revision+1,updated_at=now() where id=entry.id;
  eid:=entry.id;
 elsif p_action not in ('list','get','due') then raise exception 'INVALID';
 end if;
 select to_jsonb(e) into saved from (
  select q.*,c.name,c.phone,(select jsonb_agg(jsonb_build_object('name',s.service,'status',s.status) order by s.service) from public.garage_enquiry_services s where s.enquiry_id=q.id) services
  from public.garage_enquiries q join public.garage_customers c on c.id=q.customer_id where q.id=eid and (q.owner_id=p_actor or role_director)
 ) e;
 select count(*) into total from public.garage_enquiries where (owner_id=p_actor or role_director)
 and (p_action<>'get' or id=p_data->>'id')
 and (p_action<>'due' or (owner_id=p_actor and reminder_date<=(now() at time zone 'Asia/Kuala_Lumpur')::date));
 select coalesce(jsonb_agg(to_jsonb(e)),'[]') into result from (
  select q.*,c.name,c.phone,
   (select jsonb_agg(jsonb_build_object('name',s.service,'status',s.status) order by s.service) from public.garage_enquiry_services s where s.enquiry_id=q.id) services
  from public.garage_enquiries q join public.garage_customers c on c.id=q.customer_id
  where (q.owner_id=p_actor or role_director)
  and (p_action<>'get' or q.id=p_data->>'id')
  and (p_action<>'due' or (q.owner_id=p_actor and q.reminder_date<=(now() at time zone 'Asia/Kuala_Lumpur')::date))
  order by q.updated_at desc,q.id limit 50 offset page_no*50
 ) e;
 return jsonb_build_object('enquiries',result,'saved',saved,'hasMore',(page_no+1)*50<total);
exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
 raise exception 'INVALID';
when unique_violation then raise exception 'INVALID: already registered';
end;
$$;
revoke all on function public.garage_enquiry_action(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.garage_enquiry_action(text,text,jsonb) to service_role;
