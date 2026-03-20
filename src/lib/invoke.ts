import { execSync, execFileSync } from 'node:child_process';

export interface InvokeOptions {
  tool: string;
  action: string;
  args: Record<string, unknown>;
  input?: string;
  timeoutMs?: number;
}

export interface InvokeResult {
  output: string;
  transport: 'http' | 'binary' | 'lobster';
}

/** Build HTTP gateway config from environment variables. */
function getHttpConfig(): { url: string; token: string } | null {
  const clawdUrl = process.env.CLAWD_URL;
  const clawdToken = process.env.CLAWD_TOKEN;
  if (clawdUrl && clawdToken) {
    return { url: clawdUrl.replace(/\/$/, ''), token: clawdToken };
  }
  const port = process.env.OPENCLAW_GATEWAY_PORT;
  const token = process.env.OPENCLAW_GATEWAY_TOKEN;
  if (port && token) {
    return { url: `http://127.0.0.1:${port}`, token };
  }
  return null;
}

/** HTTP direct transport to OpenClaw gateway /tools/invoke. */
async function tryHttp(opts: InvokeOptions): Promise<string | null> {
  const cfg = getHttpConfig();
  if (!cfg) return null;

  const url = `${cfg.url}/tools/invoke`;
  const body: Record<string, unknown> = {
    tool: opts.tool,
    action: opts.action,
    args: opts.args,
  };
  if (opts.input !== undefined) {
    body.input = opts.input;
  }

  const timeout = opts.timeoutMs ?? 60_000;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      process.stderr.write(`[invoke/http] ${res.status}: ${errText.slice(0, 200)}\n`);
      return null;
    }

    return await res.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[invoke/http] failed: ${msg}\n`);
    return null;
  }
}

/** PATH binary transport (clawd.invoke / openclaw.invoke). */
function tryBinary(opts: InvokeOptions): string | null {
  for (const name of ['clawd.invoke', 'openclaw.invoke'] as const) {
    try {
      execSync(`command -v ${name}`, { stdio: 'pipe' });
    } catch {
      continue;
    }

    try {
      const argsJson = JSON.stringify(opts.args);
      return execFileSync(name, [
        '--tool', opts.tool,
        '--action', opts.action,
        '--args-json', argsJson,
      ], {
        timeout: (opts.timeoutMs ?? 60_000) + 5000,
        encoding: 'utf-8',
        input: opts.input,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[invoke/binary] ${name} failed: ${msg}\n`);
    }
  }
  return null;
}

/** Lobster wrapper transport: lobster "clawd.invoke ...". */
function tryLobster(opts: InvokeOptions): string | null {
  try {
    execSync('command -v lobster', { stdio: 'pipe' });
  } catch {
    return null;
  }

  const httpCfg = getHttpConfig();
  const connArgs = httpCfg ? ` --url ${httpCfg.url} --token ${httpCfg.token}` : '';

  const argsJson = JSON.stringify(opts.args);
  const escapedArgs = argsJson.replace(/'/g, "'\\''");
  const innerCmd = `clawd.invoke${connArgs} --tool ${opts.tool} --action ${opts.action} --args-json '${escapedArgs}'`;

  try {
    return execFileSync('lobster', [innerCmd], {
      timeout: (opts.timeoutMs ?? 60_000) + 10_000,
      encoding: 'utf-8',
      input: opts.input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[invoke/lobster] failed: ${msg}\n`);
    return null;
  }
}

/**
 * Invoke an OpenClaw tool via the best available transport.
 * Priority: HTTP direct > PATH binary > Lobster wrapper.
 */
export async function invokeTool(opts: InvokeOptions): Promise<InvokeResult> {
  const httpResult = await tryHttp(opts);
  if (httpResult !== null) return { output: httpResult, transport: 'http' };

  const binaryResult = tryBinary(opts);
  if (binaryResult !== null) return { output: binaryResult, transport: 'binary' };

  const lobsterResult = tryLobster(opts);
  if (lobsterResult !== null) return { output: lobsterResult, transport: 'lobster' };

  throw new Error(
    '[invoke] All transports failed. Configure at least one:\n' +
    '  HTTP: set CLAWD_URL+CLAWD_TOKEN or OPENCLAW_GATEWAY_PORT+OPENCLAW_GATEWAY_TOKEN\n' +
    '  Binary: ensure clawd.invoke or openclaw.invoke is in PATH\n' +
    '  Lobster: ensure lobster is in PATH',
  );
}

// ── Legacy compat (used by existing tests) ───────────────────

type InvokeShim = 'clawd.invoke' | 'openclaw.invoke';
let _cached: InvokeShim | null | undefined;

export function detectInvokeShim(): InvokeShim | null {
  if (_cached !== undefined) return _cached;
  for (const name of ['clawd.invoke', 'openclaw.invoke'] as const) {
    try {
      execSync(`command -v ${name}`, { stdio: 'pipe' });
      _cached = name;
      return name;
    } catch { /* not found */ }
  }
  _cached = null;
  return null;
}

export function getInvokeShim(): InvokeShim {
  const shim = detectInvokeShim();
  if (!shim) {
    throw new Error(
      'Neither clawd.invoke nor openclaw.invoke found in PATH. ' +
      'Use HTTP transport: set CLAWD_URL+CLAWD_TOKEN or OPENCLAW_GATEWAY_PORT+OPENCLAW_GATEWAY_TOKEN.',
    );
  }
  return shim;
}

export function _resetCache(): void {
  _cached = undefined;
}
