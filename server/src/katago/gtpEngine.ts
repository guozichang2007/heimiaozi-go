import { Controller } from '@sabaki/gtp';
import { Color, colorName } from '../game/goban';
import { DIFFICULTIES, Difficulty } from './difficulty';

/** 坐标(x,y) → GTP 顶点（如 "Q16"）。y 从棋盘顶部算起。 */
export function vertexToGtp(x: number, y: number, size: number): string {
  const col = String.fromCharCode(65 + x + (x >= 8 ? 1 : 0));
  const row = size - y;
  return `${col}${row}`;
}

/** GTP 顶点 → 坐标(x,y) */
export function gtpToXY(vertex: string, size: number): [number, number] {
  const m = /^([A-Ta-t])(\d+)$/.exec(vertex.trim());
  if (!m) throw new Error(`bad vertex: ${vertex}`);
  let col = m[1].toUpperCase().charCodeAt(0) - 65;
  if (col >= 8) col--; // 跳过 I
  const row = Number(m[2]);
  return [col, size - row];
}

export function starPositions(size: number): number[] {
  if (size === 19) return [3, 9, 15];
  if (size === 13) return [3, 6, 9];
  if (size === 9) return [2, 4, 6];
  const mid = Math.floor(size / 2);
  return [Math.max(2, mid - 3), mid, Math.min(size - 3, mid + 3)];
}

/** 生成 n 子让子的星位落点（GTP 顶点列表），KataGo 接受任意顺序 */
export function handicapStones(n: number, size: number): string[] {
  const [a, b, c] = starPositions(size);
  const corners: [number, number][] = [[c, a], [a, c], [a, a], [c, c]];
  const edges: [number, number][] = [[b, a], [b, c], [a, b], [c, b]];
  const center: [number, number][] = [[b, b]];
  const pts: [number, number][] = [];
  if (n >= 2) pts.push(corners[0], corners[1]);
  if (n >= 4) pts.push(corners[2], corners[3]);
  if (n >= 3) pts.splice(1, 0, edges[0]);
  if (n >= 5) pts.push(edges[1]);
  if (n >= 7) pts.push(edges[2], edges[3]);
  if (n >= 9) pts.push(center[0]);
  return pts.slice(0, n).map(([x, y]) => vertexToGtp(x, y, size));
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * KataGo GTP 引擎封装：负责实际对弈走子。
 * 通过 @sabaki/gtp 管理子进程。
 */
export class GtpEngine {
  private controller: Controller | null = null;
  private ready = false;

  constructor(
    private binary: string,
    private model: string,
    private config: string,
    private humanModel: string | null = null,
  ) {}

  get isReady(): boolean {
    return this.ready;
  }

  private async withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('command timeout')), ms);
      p.then((v) => {
        clearTimeout(t);
        resolve(v);
      }).catch((e) => {
        clearTimeout(t);
        reject(e);
      });
    });
  }

  async start(): Promise<void> {
    const override = (process.env.GTP_OVERRIDE_CONFIG || '').trim();
    const args: string[] = ['gtp', '-model', this.model, '-config', this.config];
    if (this.humanModel) args.push('-human-model', this.humanModel);
    if (override) args.push('-override-config', override);
    this.controller = new Controller(this.binary, args);
    this.controller.on('stderr', ({ content }: { content: string }) => {
      if (content.trim()) console.log('[gtp]', content.trim());
    });
    this.controller.on('error', (e: Error) => console.error('[gtp] 进程错误:', e.message));
    this.controller.on('stopped', ({ code }: { code: number | null }) => {
      if (code !== 0 && this.ready) console.warn(`[gtp] 进程退出 code=${code}`);
    });
    this.controller.start();
    // 等待引擎就绪（首次 OpenCL 内核编译可能需要数分钟）
    let attempts = 0;
    while (attempts < 400) {
      try {
        const resp = await this.withTimeout(this.controller.sendCommand({ name: 'name', args: [] }), 5000);
        if (!resp.error) {
          this.ready = true;
          return;
        }
      } catch {
        // 还没就绪或命令超时，继续等
      }
      attempts++;
      await sleep(300);
    }
    throw new Error('KataGo GTP 引擎启动超时（模型加载/内核编译失败？）');
  }

  async cmd(name: string, args: string[] = []): Promise<string> {
    if (!this.controller) throw new Error('GTP 引擎未启动');
    const resp = await this.controller.sendCommand({ name, args });
    if (resp.error) throw new Error(`GTP ${name} ${args.join(' ')} 失败: ${resp.content}`);
    return resp.content.trim();
  }

  async clearBoard(size: number, komi: number): Promise<void> {
    await this.cmd('boardsize', [String(size)]);
    await this.cmd('clear_board', []);
    await this.cmd('komi', [String(komi)]);
  }

  async setHandicap(stones: string[]): Promise<void> {
    if (stones.length) await this.cmd('set_free_handicap', stones);
  }

  async play(color: Color, vertex: string | null): Promise<void> {
    await this.cmd('play', [colorName(color), vertex ?? 'pass']);
  }

  /** 返回 GTP 顶点（小写）或 'pass' 或 'resign' */
  async genmove(color: Color): Promise<string> {
    const res = await this.cmd('genmove', [colorName(color)]);
    return res.toLowerCase();
  }

  /** 运行期调整难度。人类模仿模式：切换段位；否则：调搜索量。 */
  async applyDifficulty(d: Difficulty): Promise<void> {
    const p = DIFFICULTIES[d];
    const params: Record<string, number | string | boolean> = {};
    if (this.humanModel) {
      // 人类模仿模式：段位 + 纯人类/纯KataGo混合
      params.humanSLProfile = p.humanSLProfile;
      params.humanSLChosenMoveProp = p.humanSLChosenMoveProp;
    }
    params.maxVisits = p.maxVisits;
    params.chosenMoveTemperature = p.temperature;
    params.chosenMoveTemperatureEarly = p.temperatureEarly;
    params.resignThreshold = p.resignThreshold;
    if (p.maxStrength) {
      // 绝对最强：恢复搜索强化项 + 高线程 + 去掉拟人延迟
      params.useLcbForSelection = true;
      params.useNoisePruning = true;
      params.useUncertainty = true;
      params.subtreeValueBiasFactor = 0.45;
      params.numSearchThreads = 4;
      params.delayMoveScale = 0;
      params.delayMoveMax = 0;
    }
    for (const [k, v] of Object.entries(params)) {
      try {
        await this.cmd('kata-set-param', [`${k}=${v}`]);
      } catch (e) {
        console.warn(`[kata] 参数 ${k} 设置失败:`, (e as Error).message);
      }
    }
  }

  async stop(): Promise<void> {
    if (!this.controller) return;
    try {
      await this.controller.sendCommand({ name: 'quit' });
    } catch {
      // ignore
    }
  }
}