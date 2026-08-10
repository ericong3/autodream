-- Replaces the single processing-fee field with an itemized deductions list
-- (banks/panels can charge processing fee, service charge, insurance cover
-- note, etc. — varies per bank), plus the expected/gross amount the deal
-- calls for, so the UI can show "expected - actual = amount to itemize."
alter table cars add column if not exists disbursement_expected_amount numeric;
alter table cars add column if not exists disbursement_charges jsonb;
alter table cars drop column if exists disbursement_processing_fee;

delete from ledger_accounts where id = 'acct-exp-bank-processing-fee';
