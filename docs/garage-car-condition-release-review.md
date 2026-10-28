# Car Condition local preview

The invoice header now has a Car Condition button below the status. The old inline damage section is removed from the pipeline. Inside the popup: Add entry, Upload photos or Take photo, select the area, Submit entry. No description or report-type input. Entry and photo audit attribution use the existing server records. Previous reports and outcomes remain visible. Garage Head review and the damage-related handover gate are preserved.

Multiple entries and unlimited photo selection are implemented. The server and guarded SQL change remove the four-photo limit together. The live API/database still enforce that limit until rollout; the preview explicitly blocks oversized submissions before partially saving them when the capability is absent. Existing individual photo size and private-storage restrictions remain unchanged.

Installation: after approval, deploy the matching API/UI update and install garage-car-condition-INSTALL-AND-CHECK.sql, then verify its three true flags before claiming unlimited photos is live. Do not replay historical migrations. No database changes or deployment were performed for this local work.

Validation: 184 automated tests passed; exact SQL bundle rehearsed with 12 photos on one entry, repeat entries, idempotency, ownership, Head review and private permissions; production build passed. Phone-camera/device and signed-in visual trial remain user acceptance checks.
