# Local investor finance sample

This folder is a development preview, not a production application. Its role
picker deliberately chooses fixed fictional users. Do not deploy this server.
It has no Supabase credentials and cannot read or change live records.

Run `node work/investor-finance-preview/saved-server.mjs <PGlite-package-directory>`
from the repository. It listens only on `127.0.0.1:5204` and uses a file-backed
sample database below the ignored `sample-data/` folder.

The sample loads the two prepared investor SQL migrations. A hash of their
contents identifies its schema; changes create a fresh sample database rather
than silently reusing old functions. Normal page refreshes and server restarts
retain records when the schema has not changed. Reset creates a fresh sample;
prior disposable sample folders are retained, not deleted.

Start as Director. In Accounts, record the purchase; approve and pay the repair;
record sale money; confirm profit. View as Investor to inspect the resulting car
and account. The example ends at RM506,600, with RM9,900 allocated to the company.
Withdrawals originate from the Investor view and are reviewed by the Director.

Only the receipt filename is demonstrated; no file is uploaded. Bank matching
uses generated sample cash lines, not an independent bank statement. Real bank
account registration, receipt storage, login/invitation integration, immutable
late-cost adjustments, grouped payments, shared journals, bank import and
multi-connection PostgreSQL testing remain before production readiness.

`check-investor-saved-preview.mjs` exercises the local sample endpoints only.
`investor-preview-render.test.mjs` uses a fake DOM and is not visual verification.

The car photograph is illustrative, not a Toyota Vios record. Sample photo:
https://images.unsplash.com/photo-1492144534655-ae79c964c9d7
