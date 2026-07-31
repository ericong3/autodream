alter table users add column if not exists employee_id text;
alter table users add column if not exists department text;
alter table users add column if not exists joining_date text;

create table if not exists payslips (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  payslip_no text not null,
  pay_period_start text not null,
  pay_period_end text not null,
  pay_date text not null,
  payment_method text not null default 'Bank Transfer',
  basic_salary numeric not null default 0,
  sales_commission numeric not null default 0,
  performance_bonus numeric not null default 0,
  allowance numeric not null default 0,
  epf_employee numeric not null default 0,
  socso_employee numeric not null default 0,
  eis_employee numeric not null default 0,
  pcb_tax numeric not null default 0,
  other_deduction numeric not null default 0,
  epf_employer numeric not null default 0,
  socso_employer numeric not null default 0,
  eis_employer numeric not null default 0,
  on_probation boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists idx_payslips_user on payslips(user_id);

alter table payslips enable row level security;
create policy payslips_all on payslips for all using (true) with check (true);
