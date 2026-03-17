import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DeployConfig {
  channel: string;
  target: string;
  config: string;
  db: string;
  cron: string;
  tz: string;
}

const DEPLOY_FILE = 'crowwire.local.json';

export function getDeployConfigPath(dir: string): string {
  return join(dir, DEPLOY_FILE);
}

export function readDeployConfig(dir: string): DeployConfig | null {
  const p = getDeployConfigPath(dir);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8'));
}

export function writeDeployConfig(dir: string, cfg: DeployConfig): void {
  writeFileSync(getDeployConfigPath(dir), JSON.stringify(cfg, null, 2) + '\n');
}

export function defaultDeployConfig(dir: string): DeployConfig {
  return {
    channel: 'discord',
    target: 'channel:YOUR_CHANNEL_ID',
    config: join(dir, 'feeds.yaml'),
    db: join(dir, 'crowwire.db'),
    cron: '*/2 * * * *',
    tz: 'Asia/Shanghai',
  };
}

export function toLobsterArgsJson(cfg: DeployConfig): string {
  const { channel, target, config, db } = cfg;
  return JSON.stringify({ channel, target, config, db });
}
