-- Prepared only. No campaign, employee enrolment or payroll payment is seeded.
create table public.used_car_bonus_campaigns (
 id uuid primary key default gen_random_uuid(),title text not null check(length(trim(title)) between 1 and 120),
 start_month text not null check(start_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 end_month text not null check(end_month ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'),
 minimum_units integer not null check(minimum_units between 1 and 10000),
 amount_per_unit numeric(12,2) not null check(amount_per_unit between 0 and 100000),
 revision integer not null default 1,published_at timestamptz,
 created_by text not null references public.garage_building_staff(id),created_at timestamptz not null default now(),
 check(start_month<=end_month),
 check((substring(end_month,1,4)::integer-substring(start_month,1,4)::integer)*12+substring(end_month,6,2)::integer-substring(start_month,6,2)::integer<60)
);
create table public.used_car_bonus_enrolments (
 campaign_id uuid not null references public.used_car_bonus_campaigns(id),
 staff_id text not null references public.garage_building_staff(id),name text not null,
 primary key(campaign_id,staff_id)
);
create table public.used_car_bonus_months (
 campaign_id uuid not null references public.used_car_bonus_campaigns(id),month text not null,
 snapshot jsonb not null,confirmed_by text not null references public.garage_building_staff(id),confirmed_at timestamptz not null default now(),
 primary key(campaign_id,month)
);
create table public.used_car_bonus_requests (
 actor_id text not null,request_id text not null,payload jsonb not null,result jsonb not null,
 created_at timestamptz not null default now(),primary key(actor_id,request_id)
);
do $$declare tab text;begin
 foreach tab in array array['used_car_bonus_campaigns','used_car_bonus_enrolments','used_car_bonus_months','used_car_bonus_requests'] loop
  execute format('alter table public.%I enable row level security',tab);
  execute format('revoke all on public.%I from public,anon,authenticated',tab);
 end loop;
end $$;

create function public.used_car_bonus_preview(p_campaign uuid,p_month text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare campaign used_car_bonus_campaigns;result jsonb;cars_json jsonb;issues jsonb;units integer;people integer;pool numeric;cents bigint;
begin
 select * into campaign from used_car_bonus_campaigns where id=p_campaign;
 if campaign.id is null or p_month is null or p_month !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or p_month not between campaign.start_month and campaign.end_month then raise exception 'INVALID';end if;
 select snapshot||jsonb_build_object('confirmed',true,'confirmedAt',confirmed_at) into result from used_car_bonus_months where campaign_id=p_campaign and month=p_month;
 if found then return result;end if;
 -- Use actual handover dates in Malaysia, never intake/deal-paperwork dates or
 -- commission credited early. One car counts once, even with duplicate leads.
 with deliveries as (
  select c.id,concat_ws(' · ',c.car_plate,c.make,c.model) label,c.status,
   (select min(cu.delivered_at::timestamptz) from customers cu where cu.interested_car_id=c.id and cu.delivered=true and cu.delivered_at is not null) handed_over
  from cars c where (c.consignment is null or c.consignment='null'::jsonb) and (c.outgoing_consignment is null or c.outgoing_consignment='null'::jsonb)
 ), relevant as (
  select *,to_char(handed_over at time zone 'Asia/Kuala_Lumpur','YYYY-MM') delivery_month from deliveries
 ) select
  coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label) order by id) filter(where status='delivered' and delivery_month=p_month),'[]'::jsonb),
  coalesce(jsonb_agg(jsonb_build_object('id',id,'label',label,'reason',case when handed_over is null then 'Missing customer handover date' else 'Customer says delivered; car is not delivered' end) order by id)
   filter(where (status='delivered' and handed_over is null) or (status<>'delivered' and delivery_month=p_month)),'[]'::jsonb)
  into cars_json,issues from relevant;
 units:=jsonb_array_length(cars_json);
 select count(*) into people from used_car_bonus_enrolments where campaign_id=p_campaign;
 if people=0 then raise exception 'INVALID_ENROLMENT';end if;
 pool:=case when units>=campaign.minimum_units then units*campaign.amount_per_unit else 0 end;cents:=round(pool*100)::bigint;
 result:=jsonb_build_object('campaignId',p_campaign,'month',p_month,'units',units,'minimumUnits',campaign.minimum_units,
  'pool',pool,'qualified',units>=campaign.minimum_units,'confirmed',false,'cars',cars_json,'issues',issues,
  'rule',jsonb_build_object('title',campaign.title,'minimumUnits',campaign.minimum_units,'amountPerUnit',campaign.amount_per_unit,'revision',campaign.revision),
  'shares',(select jsonb_agg(jsonb_build_object('id',staff_id,'name',name,'amount',((cents/people)+case when n<=mod(cents,people) then 1 else 0 end)::numeric/100) order by staff_id)
   from (select staff_id,name,row_number() over(order by staff_id) n from used_car_bonus_enrolments where campaign_id=p_campaign) x));
 return result||jsonb_build_object('previewHash',md5(result::text));
end $$;

create function public.used_car_bonus_campaign(p_actor text,p_action text,p_data jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor garage_building_staff;c used_car_bonus_campaigns;prior used_car_bonus_requests;details jsonb;result jsonb;ids text[];page_no integer;request text;current_month text;
begin
 select * into actor from garage_building_staff where id=p_actor for share;
 if actor.id is null or not coalesce(actor.enabled and actor.registration_status='active' and actor.role in ('director','shareholder') and actor.business_access in ('used_car','both'),false) then raise exception 'NOT_ALLOWED';end if;
 if p_action='list' then
  if coalesce(p_data->>'page','0') !~ '^\d{1,5}$' then raise exception 'INVALID';end if;page_no:=coalesce((p_data->>'page')::integer,0);
  return jsonb_build_object('enabled',true,
   'campaigns',coalesce((select jsonb_agg(to_jsonb(q) order by q."startMonth" desc,q.id) from
    (select row_c.id,row_c.title,row_c.start_month "startMonth",row_c.end_month "endMonth",row_c.minimum_units "minimumUnits",row_c.amount_per_unit "amountPerUnit",row_c.revision,row_c.published_at "publishedAt",
     (select coalesce(jsonb_agg(jsonb_build_object('id',staff_id,'name',name) order by name,staff_id),'[]'::jsonb) from used_car_bonus_enrolments where campaign_id=row_c.id) participants,
     (select coalesce(jsonb_agg(month order by month),'[]'::jsonb) from used_car_bonus_months where campaign_id=row_c.id) "confirmedMonths"
     from used_car_bonus_campaigns row_c order by row_c.start_month desc,row_c.id limit 100 offset page_no*100) q),'[]'::jsonb),
   'hasMore',(select count(*)>(page_no+1)*100 from used_car_bonus_campaigns),
   'participants',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by name,id) from garage_building_staff where enabled and registration_status='active' and role='salesperson' and business_access in ('used_car','both')),'[]'::jsonb));
 end if;
 if p_action='preview' then return used_car_bonus_preview((p_data->>'id')::uuid,p_data->>'month');end if;
 if actor.role<>'director' then raise exception 'NOT_ALLOWED';end if;
 if p_action not in ('save','publish','confirm_month') then raise exception 'INVALID';end if;
 request:=p_data->>'requestId';
 if request is null or request !~ '^[A-Za-z0-9_-]{16,80}$' then raise exception 'INVALID';end if;
 perform pg_advisory_xact_lock(112026,hashtext(p_actor||':'||request));
 select * into prior from used_car_bonus_requests where actor_id=p_actor and request_id=request;
 if found then
  if prior.payload is distinct from jsonb_build_object('action',p_action,'data',p_data) then raise exception 'REQUEST_CHANGED';end if;return prior.result;
 end if;
 if p_action='save' then
  details:=p_data->'campaign';
  if jsonb_typeof(details) is distinct from 'object' or details-array['title','startMonth','endMonth','minimumUnits','amountPerUnit','participantIds']<>'{}'::jsonb
  or jsonb_typeof(details->'title') is distinct from 'string' or length(trim(details->>'title')) not between 1 and 120
  or coalesce(details->>'startMonth','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' or coalesce(details->>'endMonth','') !~ '^20[0-9]{2}-(0[1-9]|1[0-2])$'
  or details->>'startMonth'>details->>'endMonth'
  or jsonb_typeof(details->'minimumUnits') is distinct from 'number' or coalesce(details->>'minimumUnits','') !~ '^\d{1,5}$'
  or (details->>'minimumUnits')::integer not between 1 and 10000
  or jsonb_typeof(details->'amountPerUnit') is distinct from 'number' or (details->>'amountPerUnit')::numeric not between 0 and 100000
  or (details->>'amountPerUnit')::numeric<>round((details->>'amountPerUnit')::numeric,2)
  or jsonb_typeof(details->'participantIds') is distinct from 'array' or jsonb_array_length(details->'participantIds') not between 1 and 200
  or exists(select 1 from jsonb_array_elements(details->'participantIds') v where jsonb_typeof(v) is distinct from 'string') then raise exception 'INVALID';end if;
  select array_agg(value) into ids from jsonb_array_elements_text(details->'participantIds');
  if (select count(distinct x) from unnest(ids) x)<>cardinality(ids) then raise exception 'INVALID';end if;
  perform 1 from garage_building_staff where id=any(ids) order by id for share;
  if (select count(*) from garage_building_staff where id=any(ids) and enabled and registration_status='active' and role='salesperson' and business_access in ('used_car','both'))<>cardinality(ids) then raise exception 'NOT_ALLOWED';end if;
  if p_data->>'id' is not null then
   select * into c from used_car_bonus_campaigns where id=(p_data->>'id')::uuid for update;
   if c.id is null then raise exception 'NOT_ALLOWED';end if;
   if c.published_at is not null then raise exception 'PUBLISHED_LOCKED';end if;
   if c.revision is distinct from (p_data->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
   update used_car_bonus_campaigns set title=trim(details->>'title'),start_month=details->>'startMonth',end_month=details->>'endMonth',minimum_units=(details->>'minimumUnits')::integer,amount_per_unit=(details->>'amountPerUnit')::numeric,revision=revision+1 where id=c.id returning * into c;
   delete from used_car_bonus_enrolments where campaign_id=c.id;
  else
   insert into used_car_bonus_campaigns(title,start_month,end_month,minimum_units,amount_per_unit,created_by)
    values(trim(details->>'title'),details->>'startMonth',details->>'endMonth',(details->>'minimumUnits')::integer,(details->>'amountPerUnit')::numeric,p_actor) returning * into c;
  end if;
  insert into used_car_bonus_enrolments(campaign_id,staff_id,name) select c.id,id,name from garage_building_staff where id=any(ids);
  result:=jsonb_build_object('id',c.id,'revision',c.revision);
 else
  select * into c from used_car_bonus_campaigns where id=(p_data->>'id')::uuid for update;
  if c.id is null then raise exception 'NOT_ALLOWED';end if;
  if p_action='publish' then
   if c.revision is distinct from (p_data->>'revision')::integer then raise exception 'REVISION_CONFLICT';end if;
   if c.published_at is not null then raise exception 'PUBLISHED_LOCKED';end if;
   if not exists(select 1 from used_car_bonus_enrolments where campaign_id=c.id) or exists(select 1 from used_car_bonus_enrolments e join garage_building_staff s on s.id=e.staff_id where e.campaign_id=c.id and not coalesce(s.enabled and s.registration_status='active' and s.role='salesperson' and s.business_access in ('used_car','both'),false)) then raise exception 'NOT_ALLOWED';end if;
   update used_car_bonus_campaigns set published_at=now(),revision=revision+1 where id=c.id;
   result:=jsonb_build_object('id',c.id,'published',true);
  else
   if c.published_at is null then raise exception 'NOT_ALLOWED';end if;
   current_month:=to_char(now() at time zone 'Asia/Kuala_Lumpur','YYYY-MM');
   if p_data->>'month'>=current_month then raise exception 'FUTURE_MONTH';end if;
   result:=used_car_bonus_preview(c.id,p_data->>'month');
   if not coalesce((result->>'confirmed')::boolean,false) then
    if result->>'previewHash' is distinct from p_data->>'previewHash' then raise exception 'PREVIEW_CHANGED';end if;
    if jsonb_array_length(result->'issues')>0 then raise exception 'DELIVERY_REVIEW_REQUIRED';end if;
    insert into used_car_bonus_months(campaign_id,month,snapshot,confirmed_by) values(c.id,p_data->>'month',result,p_actor);
    result:=used_car_bonus_preview(c.id,p_data->>'month');
   end if;
  end if;
 end if;
 insert into used_car_bonus_requests(actor_id,request_id,payload,result) values(p_actor,request,jsonb_build_object('action',p_action,'data',p_data),result);
 return result;
end $$;
revoke all on function public.used_car_bonus_preview(uuid,text),public.used_car_bonus_campaign(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.used_car_bonus_campaign(text,text,jsonb) to service_role;
NOTIFY pgrst,'reload schema';
