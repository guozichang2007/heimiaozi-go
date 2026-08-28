import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// 优先加载 server/.env（npm -w server 时 cwd=server）；再兼容项目根目录的 .env
dotenv.config();
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

export const DATA_DIR = path.join(__dirname, '..', 'data');
export const PORT = Number(process.env.PORT || 5177);
export const DEEPSEEK_API_KEY = (process.env.DEEPSEEK_API_KEY || '').trim();
export const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash';
export const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

/** 引擎后端：opencl（默认）| cuda */
export const KATAGO_BACKEND = (process.env.KATAGO_BACKEND || 'opencl').toLowerCase();

export function findInData(pred: (name: string) => boolean): string | null {
  if (!fs.existsSync(DATA_DIR)) return null;
  const files = fs.readdirSync(DATA_DIR);
  const hit = files.find(pred);
  return hit ? path.join(DATA_DIR, hit) : null;
}

function resolveBinary(backend: string): string | null {
  const fromEnv = process.env.KATAGO_BINARY;
  if (fromEnv && fromEnv !== 'auto') return fromEnv;
  if (!fs.existsSync(DATA_DIR)) return null;
  for (const name of [`katago.exe`, `katago-${backend}.exe`]) {
    const p = path.join(DATA_DIR, backend, name);
    if (fs.existsSync(p)) return p;
    const top = path.join(DATA_DIR, name);
    if (fs.existsSync(top)) return top;
  }
  const dirs = fs.readdirSync(DATA_DIR).filter((d) => {
    try {
      return fs.statSync(path.join(DATA_DIR, d)).isDirectory();
    } catch {
      return false;
    }
  });
  dirs.sort((a, b) => {
    const sa = a === backend ? 0 : 1;
    const sb = b === backend ? 0 : 1;
    return sa - sb;
  });
  for (const dir of dirs) {
    const exe = path.join(DATA_DIR, dir, 'katago.exe');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

export const KATAGO_BINARY = resolveBinary(KATAGO_BACKEND);

export function resolveModel(): string | null {
  const fromEnv = process.env.KATAGO_MODEL;
  if (fromEnv && fromEnv !== 'auto') return fromEnv;
  const b28 = findInData((n) => n.endsWith('.bin.gz') && n.includes('b28'));
  if (b28) return b28;
  return findInData((n) => n.endsWith('.bin.gz'));
}

export function resolveHumanModel(): string | null {
  const fromEnv = process.env.KATAGO_HUMAN_MODEL;
  if (fromEnv && fromEnv !== 'auto') return fromEnv;
  return findInData((n) => n.endsWith('.bin.gz') && n.includes('human'));
}

export interface EnginePaths {
  binary: string | null;
  model: string | null;
}

export function getEnginePaths(): EnginePaths {
  return { binary: KATAGO_BINARY, model: resolveModel() };
}

/** GTP 引擎配置：人类模仿模式用官方 human 配置，否则用默认配置 */
export function getGtpConfigPath(): string {
  if (resolveHumanModel()) {
    const p = path.join(DATA_DIR, KATAGO_BACKEND, 'gtp_human5k_example.cfg');
    if (fs.existsSync(p)) return p;
    return path.join(DATA_DIR, 'opencl', 'gtp_human5k_example.cfg');
  }
  const p = path.join(DATA_DIR, KATAGO_BACKEND, 'default_gtp.cfg');
  if (fs.existsSync(p)) return p;
  return path.join(DATA_DIR, 'opencl', 'default_gtp.cfg');
}

/** 分析引擎配置：直接使用官方 analysis_example.cfg */
export function getAnalysisConfigPath(): string {
  const p = path.join(DATA_DIR, KATAGO_BACKEND, 'analysis_example.cfg');
  if (fs.existsSync(p)) return p;
  return path.join(DATA_DIR, 'opencl', 'analysis_example.cfg');
}

/** 通过 -override-config 覆盖的 GTP 参数（KataGo 要求完整配置，只能覆盖） */
export const GTP_OVERRIDE_CONFIG = 'rules=chinese,logAllGTPCommunication=false,logSearchInfo=false,maxVisits=40';

/** 分析引擎覆盖：胜率报告为"轮到的一方"视角，方便我们解读 */
export const ANALYSIS_OVERRIDE_CONFIG = 'reportAnalysisWinratesAs=SIDETOMOVE';