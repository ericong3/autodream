# Compact Garage pipeline, local preview

This supersedes the rejected three-chapter navigator. The user approved trying the second generated compact black/gold/steel-blue mockup locally.

Implementation: one thin connected eight-step rail, gold capsule for the actual current stage, separate cool highlight for the viewed stage, contextual hover/focus hints, press feedback and reduced-motion handling. Desktop shows eight steps in one row; phones show two rows of four with complete labels and no horizontal scroller. The deposit/balance shortcut moves next to Car Condition in the invoice header. Existing car artwork/geometry is preserved; available glass gets restrained hover feedback. No backend, permissions or workflow transitions were changed.

Validation: 188 tests passed; TypeScript/Vite/PWA build passed; localhost module/CSS delivery verified. The in-app browser connection became unavailable during final visual review, so the new design still needs the user’s visual trial. Existing pipeline-design-desktop/mobile screenshots show the superseded chapter design and must not be treated as current evidence.

Nothing in this design task was deployed or applied to the database. The unrelated unlimited-photo backend activation remains separately pending.
