alter table loan_case_documents drop constraint loan_case_documents_type_check;
alter table loan_case_documents add constraint loan_case_documents_type_check
  check (type = any (array['applicant'::text, 'guarantor'::text, 'additional'::text]));
