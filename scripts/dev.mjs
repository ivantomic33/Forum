#!/usr/bin/env node
/**
 * `npm run dev:clean` — očisti zaostale procese sa portova 4000/5173/5174
 * pa pokreni `dev:all`.
 *
 * `EADDRINUSE: address already in use :::4000` znači da je prethodni API
 * (`tsx watch`) ostao u pozadini (npr. posle prekida rada terminala).
 * Na Windows-u procesi `tsx watch`-a preživljavaju roditelja, pa ih treba
 * ugasiti pre novog starta.
 */
import { execFileSync, spawn } from 'node:child_process';

const PORTS = [4000, 5173, 5174];
const isWindows = process.platform === 'win32';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pidsOnPort(port) {
  try {
    if (isWindows) {
      const out = execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess`,
        ],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true },
      );
      return [...new Set(out.split(/\s+/).filter(Boolean).map(Number).filter(Boolean))];
    }
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return [...new Set(out.split(/\s+/).filter(Boolean).map(Number).filter(Boolean))];
  } catch {
    return [];
  }
}

function killTree(pid) {
  try {
    if (isWindows) {
      // /T = ugasi i svu decu (tsx → node, concurrently → npm → vite)
      execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(pid, 'SIGKILL');
    }
    return true;
  } catch {
    return false;
  }
}

function freePorts() {
  for (const port of PORTS) {
    for (const pid of pidsOnPort(port)) {
      if (killTree(pid)) console.log(`  port ${port}: ugašen proces ${pid} (i njegova deca)`);
    }
  }
}

console.log(`Čistim portove ${PORTS.join(', ')}`);
freePorts();

// Sačekaj da OS oslobodi socket, pa proveri još jednom (proces može preuzeti port)
await sleep(1500);
if (PORTS.some((port) => pidsOnPort(port).length > 0)) {
  console.log('Portovi još zauzeti — drugi pokušaj…');
  freePorts();
  await sleep(1500);
}

const blocked = PORTS.filter((port) => pidsOnPort(port).length > 0);
if (blocked.length) {
  for (const port of blocked) {
    console.error(`✖ Port ${port} je zauzet (PID ${pidsOnPort(port).join(', ')}).`);
  }
  console.error('  Ugasi te procese (Task Manager) ili promeni PORT pa pokušaj ponovo.');
  process.exit(1);
}

console.log('Portovi slobodni. Pokrećem dev:all\n');
const child = spawn(isWindows ? 'npm.cmd' : 'npm', ['run', 'dev:all'], {
  stdio: 'inherit',
  shell: isWindows,
});

// Ctrl+C mora da ugasi i DECU (tsx watch / vite), ne samo npm
let stopping = false;
const shutdown = (signal) => {
  if (stopping) return;
  stopping = true;
  if (isWindows && child.pid) killTree(child.pid);
  else {
    try {
      child.kill(signal);
    } catch {
      // ignore
    }
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('exit', () => {
  if (!stopping && isWindows && child.pid) killTree(child.pid);
});
child.on('exit', (code) => {
  stopping = true;
  process.exit(code ?? 0);
});
