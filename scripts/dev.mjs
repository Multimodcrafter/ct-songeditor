import { spawn } from 'node:child_process';

// Both processes share the project root, so Wrangler reads .dev.vars and Vite
// can proxy authentication and API calls through the actual Pages Functions.
const children = [
  spawn('node', ['node_modules/wrangler/bin/wrangler.js', 'pages', 'dev', '--ip', '127.0.0.1', '--port', '8788'], { stdio: 'inherit' }),
  spawn('node', ['node_modules/vite/bin/vite.js', '--host', 'localhost', '--port', '5173', '--strictPort'], { stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}
for (const child of children) {
  child.on('error', (error) => { console.error(error.message); stop(1); });
  child.on('exit', (code) => stop(code ?? 1));
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
