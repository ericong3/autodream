-- Loan Order: pre-submission deal structure per customer
ALTER TABLE customers ADD COLUMN IF NOT EXISTS loan_order JSONB;

-- Banker profile: optional link to a User account
ALTER TABLE bankers ADD COLUMN IF NOT EXISTS user_id TEXT;

-- Loan case: store banker display name for bankers without app accounts
ALTER TABLE loan_cases ADD COLUMN IF NOT EXISTS banker_name TEXT;
