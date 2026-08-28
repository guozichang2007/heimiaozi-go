import { spawn, ChildProcess } from 'child_process';

export interface AnalysisMoveInfo {
  move: string;
  visits: number;
  winrate: number;
  scoreMean: number;
  scoreSelfplayMean?: number;
  prior?: number;
  order?: number;
  pv?: string[];
}

export interface AnalysisRootInfo {
  visits: number;
  winrate: number;
  /** 轮到方目差（rootInfo 里此字段名为 scoreLead） */
  scoreLead?: number;
  scoreMean?: number;
  scoreSelfplayMean?: number;
  utility?: number;
}

export interface AnalysisResponse {
  id: string;
  moveInfos?: AnalysisMoveInfo[];
  rootInfo?: AnalysisRootInfo;
  /** 长度为 boardXSize*boardYSize 的数组，正值 = 黑方领地倾向，负值 = 白方 */
  ownership?: number[];
  policy?: number[];
  error?: string;
}

export interface AnalysisQueryOptions {
  moves: [string, string][];
  rules?: string;
  komi?: number;
  boardXSize?: number;
  boardYSize?: number;
  maxVisits?: number;
  includeOwnership?: boolean;
  includePolicy?: boolean;
  topMoves?: number;
}

/**
 * KataGo 并行分析引擎（JSON-RPC over stdin/stdout）。
 * 用于：用户求助算棋、地盘热力图、落子前后胜率等一次性查询。
 * 与 GTP 引擎共用同一网络文件，按需懒启动。
 */
export class AnalysisEngine {
  private proc: ChildProcess | null = null;
  private pending = new Map<string, { resolve: (v: AnalysisResponse) => void; reject: (e: Error) => void }>();
  private buf = '';
  private id = 0;

  get isRunning(): boolean {
    return !!this.proc;
  }

  async start(binary: string, model: string, config: string): Promise<void> {
    if (this.proc) return;
    const override = 'reportAnalysisWinratesAs=SIDETOMOVE';
    this.proc = spawn(binary, ['analysis', '-config', config, '-model', model, '-override-config', override], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.proc.stdout!.setEncoding('utf8');
    this.proc.stderr!.setEncoding('utf8');
    this.proc.stdout!.on('data', (chunk: string) => {
      this.buf += chunk;
      this.processLines();
    });
    this.proc.stderr!.on('data', (d: string) => {
      const line = d.trim();
      if (line) console.log('[analysis]', line);
    });
    this.proc.on('error', (e) => console.error('[analysis] 进程错误:', e));
    this.proc.on('exit', (code) => {
      console.warn(`[analysis] 进程退出 code=${code}`);
      this.proc = null;
      for (const { reject } of this.pending.values()) reject(new Error('analysis engine exited'));
      this.pending.clear();
    });
  }

  private processLines(): void {
    let nl = this.buf.indexOf('\n');
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.handleLine(line);
      nl = this.buf.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let msg: AnalysisResponse;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      if (msg.error) {
        this.pending.delete(msg.id);
        p.reject(new Error(`analysis error: ${msg.error}`));
        return;
      }
      // 分析引擎可能先发一条中间响应（无 rootInfo/moveInfos），
      // 等到包含完整结果的响应才算完成
      const complete = !!msg.rootInfo || (msg.moveInfos?.length ?? 0) > 0;
      if (complete) {
        this.pending.delete(msg.id);
        p.resolve(msg);
      }
    }
  }

  async query(opts: AnalysisQueryOptions): Promise<AnalysisResponse> {
    if (!this.proc) throw new Error('analysis engine not started');
    const id = `q${++this.id}`;
    const req: Record<string, unknown> = {
      id,
      moves: opts.moves,
      rules: opts.rules || 'chinese',
      komi: opts.komi ?? 7.5,
      boardXSize: opts.boardXSize ?? 19,
      boardYSize: opts.boardYSize ?? 19,
    };
    if (opts.maxVisits) req.maxVisits = opts.maxVisits;
    if (opts.includeOwnership) req.includeOwnership = true;
    if (opts.includePolicy) req.includePolicy = true;
    if (opts.topMoves) req.topMoves = opts.topMoves;

    return new Promise<AnalysisResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc!.stdin!.write(JSON.stringify(req) + '\n');
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('analysis query 超时'));
        }
      }, 120000);
    });
  }

  async stop(): Promise<void> {
    if (!this.proc) return;
    try {
      this.proc.stdin!.end();
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        this.proc?.kill();
      } catch {
        // ignore
      }
    }, 2000);
  }
}