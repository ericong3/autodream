# Garage journey design, local preview

Requested visual redesign developed by Codex with two read-only Claude consultations. Claude proposed a sculpted rail and a Chapter Navigator; the implemented direction groups the same eight stages into Workshop, Final checks and Handover.

Visual decisions: stronger current-stage header; warm gold/charcoal surface; borderless connected stage rows; full stage labels; separate current and viewed states; payment shortcut integrated into the header; no animated ping. Existing MiniPipeline list-card labels remain unchanged.

Responsive behaviour: three desktop chapters, mobile chapter accordion. Heading expansion does not select a workflow stage. Selecting a step on a phone focuses and scrolls to its detail panel; reduced motion is respected. Completed and future stages remain navigable. No workflow, payment, permission or database mutation was changed.

Claude review led to restoring the MiniPipeline state-label map, separating chapter expansion from navigation, mobile detail focus/scroll, reducing current-stage indicators and exposing chapter headings to assistive technology.

Browser verification: actual signed-in local page reviewed on desktop and at 390x844. No horizontal overflow at phone width. Payment selection preserved Installation as the live stage. Chapter expansion/collapse preserved the selected stage; selecting Payment focused Selected stage details. No records were created or edited during these checks.

Screenshots: outputs/pipeline-design-desktop.png and outputs/pipeline-design-mobile.png (cropped to the pipeline, no customer contact or finance fields). Production remains unchanged.

Validation: 189 automated tests passed; production build checked before completion.
