// Local dev: runs the screens (Vite) and the /api login server together.
// Plain `vite` can't sign anyone in — the users table is server-only now.
// vercel.dev.json drops the production catch-all rewrite, which would
// otherwise serve index.html for Vite's module requests (blank page).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

// vercel dev silently moves to another port when 3002 is taken, and the
// login server only accepts http://localhost:3002 — so stop with a clear
// message instead.
const busy = await new Promise(resolve => {
  const probe = createServer().once('error', () => resolve(true)).once('listening', () => probe.close(() => resolve(false)));
  probe.listen(3002);
});
if (busy) {
  console.error('\nAutoDream is already running at http://localhost:3002 — open that instead.\n(Login only works on port 3002.)\n');
  process.exit(1);
}

const child = spawn('vercel', ['dev', '--listen', '3002', '--local-config', 'vercel.dev.json'], {
  stdio: 'inherit',
  shell: true,
});
child.on('exit', code => process.exit(code ?? 0));
