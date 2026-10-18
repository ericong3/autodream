# AutoDream Garage trial

Standalone Garage prototypes, separate from the used-car application.

Run the existing project development server (`npm run dev`) and open `/work/garage-review.html`.

- Car tint: `/work/garage-car-trial.html`
- Building planner: `/work/garage-building-sketch.html`
- Building workflow: `/work/garage-building-preview.html?view=overview`

Data is fictional and saved in the current browser's localStorage. No backend, live stock, payments, or customer records are updated. Browser sketches and uploaded local data are not included in this repository.

The planner can explicitly copy its draft into the workflow with confirmation and a local backup; signed or progressed workflow records cannot be replaced. This is a one-way handoff, not shared production storage.

The HTML files under work/ are development previews and are not included automatically in the current Vite production output. This branch does not change build or deployment configuration, used-car source files, dependencies, or database migrations.

Node's built-in test runner covers the `garage-*.test.mjs`, `garage-*.test.cjs`, and `garage-review-building-checks.cjs` files. Last verification: 97 tests passed. Visual/browser checks for the latest simplification remain pending.
