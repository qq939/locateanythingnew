const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8082);
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const LOG_DIR = path.join(ROOT, 'logs');
const RUN_LOG = path.join(LOG_DIR, 'run.log');
const PYTHON = process.env.PYTHON || 'python3';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

for (const dir of [DATA_DIR, LOG_DIR]) fs.mkdirSync(dir, { recursive: true });

let worker = null;
let workerReady = null;
let workerRequests = new Map();
let workerSeq = 0;

function log(line) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  fs.appendFile(RUN_LOG, `[${ts}] ${line}\n`, () => {});
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function collectJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > 80 * 1024 * 1024) {
        reject(new Error('request too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function serveFile(res, filePath) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) throw new Error('not file');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  }
}

function checkModelStatus() {
  const result = spawnSync(PYTHON, ['locateanything_service.py', '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    timeout: 15000,
  });
  if (result.error) return { ok: false, error: result.error.message };
  try {
    return JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
  } catch (error) {
    return { ok: false, error: error.message, stderr: result.stderr };
  }
}

function stopWorker() {
  if (worker) worker.kill('SIGTERM');
  worker = null;
  workerReady = null;
  for (const pending of workerRequests.values()) pending.reject(new Error('LocateAnything worker stopped'));
  workerRequests.clear();
}

function ensureWorker() {
  if (worker && !worker.killed) return workerReady;

  worker = spawn(PYTHON, ['locateanything_service.py'], {
    cwd: ROOT,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });
  workerRequests = new Map();
  const rl = readline.createInterface({ input: worker.stdout });

  workerReady = new Promise((resolve, reject) => {
    const startupTimer = setTimeout(() => reject(new Error('LocateAnything worker startup timeout')), 60000);
    rl.once('line', (line) => {
      clearTimeout(startupTimer);
      try {
        const payload = JSON.parse(line);
        log(`worker ready ${line}`);
        resolve(payload);
      } catch (error) {
        reject(error);
      }
    });
  });

  rl.on('line', (line) => {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (error) {
      log(`worker invalid json: ${line}`);
      return;
    }
    if (payload.id && workerRequests.has(payload.id)) {
      const pending = workerRequests.get(payload.id);
      workerRequests.delete(payload.id);
      pending.resolve(payload);
    }
  });

  worker.stderr.on('data', (chunk) => log(`worker stderr: ${chunk.toString().trim()}`));
  worker.on('exit', (code, signal) => {
    log(`worker exit code=${code} signal=${signal}`);
    worker = null;
    workerReady = null;
    for (const pending of workerRequests.values()) pending.reject(new Error('LocateAnything worker exited'));
    workerRequests.clear();
  });

  return workerReady;
}

async function callWorker(payload) {
  await ensureWorker();
  const id = String(++workerSeq);
  const message = { ...payload, id };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      workerRequests.delete(id);
      reject(new Error('LocateAnything inference timeout'));
    }, Number(process.env.LOCATEANYTHING_TIMEOUT_MS || 10 * 60 * 1000));
    workerRequests.set(id, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
    });
    worker.stdin.write(`${JSON.stringify(message)}\n`);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  log(`${req.method} ${url.pathname}`);
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true, app: 'LocateAnything Video Annotator', port: PORT });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/model-status') {
      json(res, 200, checkModelStatus());
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/save') {
      const payload = await collectJson(req);
      const file = path.join(DATA_DIR, 'annotations.json');
      await fsp.writeFile(file, JSON.stringify({ ...payload, saved_at: new Date().toISOString() }, null, 2));
      json(res, 200, { ok: true, path: file, annotations: payload.annotations?.length || 0 });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/locate') {
      const payload = await collectJson(req);
      const result = await callWorker({ type: 'locate', ...payload });
      json(res, result.ok ? 200 : 500, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/restart-worker') {
      stopWorker();
      json(res, 200, { ok: true });
      return;
    }

    const requestPath = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    const target = path.normalize(path.join(PUBLIC_DIR, requestPath));
    if (!target.startsWith(PUBLIC_DIR)) {
      json(res, 403, { ok: false, error: 'forbidden' });
      return;
    }
    await serveFile(res, target);
  } catch (error) {
    log(`ERROR ${error.stack || error.message}`);
    json(res, 500, { ok: false, error: error.message });
  }
});

process.on('SIGTERM', () => {
  stopWorker();
  server.close(() => process.exit(0));
});

server.listen(PORT, '0.0.0.0', () => {
  log(`listening on ${PORT}`);
  console.log(`LocateAnything video annotator: http://127.0.0.1:${PORT}`);
});
