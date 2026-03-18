import { execSync } from 'node:child_process';

type InvokeShim = 'clawd.invoke' | 'openclaw.invoke';

let _cached: InvokeShim | null | undefined;

/**
 * Detect which invoke shim is available in PATH.
 * lobster >= 2026.1.24 ships `clawd.invoke`; older versions use `openclaw.invoke`.
 * Returns null if neither is found.
 */
export function detectInvokeShim(): InvokeShim | null {
  if (_cached !== undefined) return _cached;
  for (const name of ['clawd.invoke', 'openclaw.invoke'] as const) {
    try {
      execSync(`command -v ${name}`, { stdio: 'pipe' });
      _cached = name;
      return name;
    } catch { /* not found, try next */ }
  }
  _cached = null;
  return null;
}

/**
 * Get the invoke shim name, throwing a clear error if neither exists.
 */
export function getInvokeShim(): InvokeShim {
  const shim = detectInvokeShim();
  if (!shim) {
    throw new Error(
      'Neither clawd.invoke nor openclaw.invoke found in PATH. ' +
      'Ensure the llm-task plugin is enabled in openclaw.json: ' +
      'plugins.entries."llm-task".enabled = true',
    );
  }
  return shim;
}

/** Reset cached detection (for testing). */
export function _resetCache(): void {
  _cached = undefined;
}
