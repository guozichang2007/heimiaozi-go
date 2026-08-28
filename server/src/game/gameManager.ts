import { Goban, Color, BLACK, WHITE, otherColor } from './goban';
import { GtpEngine, vertexToGtp, gtpToXY, handicapStones } from '../katago/gtpEngine';
import { AnalysisEngine, AnalysisResponse } from '../katago/analysisEngine';
import { Difficulty } from '../katago/difficulty';
import { computeScoreWithKomi, ScoreResult } from './scoring';

export type Phase = 'setup' | 'playing' | 'scoring' | 'over';

export interface GameSettings {
  boardSize: number;
  komi: number;
  handicap: number;
  difficulty: Difficulty;
  humanColor: Color;
  aiColor: Color;
}

export interface MoveRecord {
  color: Color;
  x: number;
  y: number;
  pass: boolean;
  moveNumber: number;
  captured: number;
  vertex: string | null;
}

export interface GameResult {
  winner: Color;
  winnerIsHuman: boolean;
  reason: 'score' | 'resign' | 'ai-resign';
  blackScore: number;
  whiteScore: number;
  blackArea: number;
  whiteArea: number;
  margin: number;
  komi: number;
}

export interface PublicState {
  phase: Phase;
  boardSize: number;
  grid: number[];
  captures: { [BLACK]: number; [WHITE]: number };
  lastMove: [number, number] | null;
  currentPlayer: Color;
  moveCount: number;
  settings: GameSettings | null;
  deadStones: number[];
  result: GameResult | null;
  aiThinking: boolean;
  heatmap: number[] | null;
  /** 提示的最佳选点（GTP 坐标） */
  hintMoves: string[];
  /** 最近一次分析：轮到的一方（side to move）胜率 0~1 */
  winrate: number | null;
  /** 最近一次分析：轮到的一方目差（正=领先） */
  scoreLead: number | null;
  consecutivePasses: number;
}

export interface AiMoveEvent {
  aiColor: Color;
  vertex: string | null;
  pass: boolean;
  winrateBefore: number | null;
  winrateAfter: number | null;
  scoreLeadAfter: number | null;
}

export interface GameManagerEvents {
  onState?: (s: PublicState) => void;
  onAiMoved?: (e: AiMoveEvent) => void;
}

/**
 * 对局管理器：拥有棋盘规则引擎 + KataGo GTP 引擎 + 分析引擎，
 * 对外提供状态机（对弈/数子/结束）与事件。
 */
export class GameManager {
  goban: Goban;
  private state: PublicState = {
    phase: 'setup',
    boardSize: 19,
    grid: [],
    captures: { [BLACK]: 0, [WHITE]: 0 },
    lastMove: null,
    currentPlayer: BLACK,
    moveCount: 0,
    settings: null,
    deadStones: [],
    result: null,
    aiThinking: false,
    heatmap: null,
    hintMoves: [],
    winrate: null,
    scoreLead: null,
    consecutivePasses: 0,
  };

  private moves: MoveRecord[] = [];
  private events: GameManagerEvents;
  private analysisReady = false;
  /** 操作互斥队列：socket 事件并发到达时，对局操作串行执行 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private gtp: GtpEngine,
    private analysis: AnalysisEngine,
    events: GameManagerEvents = {},
  ) {
    this.events = events;
    this.goban = new Goban(19);
  }

  /** 把任务排进串行队列（所有对局操作必须经此执行） */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private emit(): void {
    this.state = { ...this.state, captures: { ...this.state.captures }, grid: this.goban.toArray(), lastMove: this.goban.lastMove };
    this.events.onState?.(this.state);
  }

  getState(): PublicState {
    return { ...this.state, captures: { ...this.state.captures }, grid: [...this.state.grid] };
  }

  getSettings(): GameSettings | null {
    return this.state.settings;
  }

  getMoves(): MoveRecord[] {
    return this.moves.map((m) => ({ ...m }));
  }

  /** 分析引擎懒启动标记 */
  private async ensureAnalysis(): Promise<void> {
    this.analysisReady = this.analysis.isRunning;
  }

  /** 开始新对局（串行队列） */
  async startGame(settings: GameSettings): Promise<void> {
    return this.enqueue(() => this.startGameImpl(settings));
  }

  private async startGameImpl(settings: GameSettings): Promise<void> {
    this.moves = [];
    this.goban = new Goban(settings.boardSize);
    this.state = {
      phase: 'playing',
      boardSize: settings.boardSize,
      grid: this.goban.toArray(),
      captures: { [BLACK]: 0, [WHITE]: 0 },
      lastMove: null,
      currentPlayer: settings.handicap > 0 ? WHITE : BLACK,
      moveCount: 0,
      settings,
      deadStones: [],
      result: null,
      aiThinking: false,
      heatmap: null,
      hintMoves: [],
      winrate: null,
      scoreLead: null,
      consecutivePasses: 0,
    };
    await this.gtp.clearBoard(settings.boardSize, settings.komi);
    await this.gtp.applyDifficulty(settings.difficulty);

    if (settings.handicap > 0) {
      const stones = handicapStones(settings.handicap, settings.boardSize);
      await this.gtp.setHandicap(stones);
      for (const s of stones) {
        const [x, y] = gtpToXY(s, settings.boardSize);
        this.goban.place(BLACK, x, y); // 让子视为黑棋落子
        this.pushMove(BLACK, x, y, false, 0, s);
      }
      this.state.currentPlayer = WHITE;
    }
    this.emit();

    // 若轮到 AI 先手
    if (this.state.phase === 'playing' && this.state.currentPlayer === settings.aiColor) {
      await this.aiMove();
    }
  }

  private pushMove(color: Color, x: number, y: number, pass: boolean, captured: number, vertex: string | null = null): void {
    const mv: MoveRecord = {
      color,
      x,
      y,
      pass,
      moveNumber: this.moves.length + 1,
      captured,
      vertex: vertex ?? (pass ? null : vertexToGtp(x, y, this.state.boardSize)),
    };
    this.moves.push(mv);
    this.state.moveCount = this.moves.length;
    this.state.hintMoves = []; // 落子后清除提示
    this.state.captures = { ...this.goban.captures };
    this.state.lastMove = this.goban.lastMove;
  }

  /** 人类落子（串行队列） */
  async humanPlay(x: number, y: number): Promise<boolean> {
    return this.enqueue(() => this.humanPlayImpl(x, y));
  }

  private async humanPlayImpl(x: number, y: number): Promise<boolean> {
    const s = this.state;
    if (s.phase !== 'playing' || !s.settings) return false;
    if (s.currentPlayer !== s.settings.humanColor) return false;
    if (s.aiThinking) return false;
    const vertex = vertexToGtp(x, y, s.boardSize);
    // 先让引擎落子（引擎为规则权威）；成功后再更新本地棋盘，避免残留幽灵子
    try {
      await this.gtp.play(s.settings.humanColor, vertex);
    } catch (e) {
      console.error('[humanPlay] 引擎拒绝落子:', (e as Error).message);
      return false;
    }
    try {
      const res = this.goban.place(s.settings.humanColor, x, y);
      this.pushMove(s.settings.humanColor, x, y, false, res.captured.length);
      this.state.winrate = null;
      await this.afterMove();
      return true;
    } catch (e) {
      // 理论上引擎接受则本地必然接受；万一不一致则重放同步，避免失同步
      console.error('[humanPlay] 本地落子异常，重放同步:', (e as Error).message);
      await this.syncFromHistory();
      return false;
    }
  }

  /** 人类 Pass（串行队列） */
  async humanPass(): Promise<boolean> {
    return this.enqueue(() => this.humanPassImpl());
  }

  private async humanPassImpl(): Promise<boolean> {
    const s = this.state;
    if (s.phase !== 'playing' || !s.settings) return false;
    if (s.currentPlayer !== s.settings.humanColor || s.aiThinking) return false;
    await this.gtp.play(s.settings.humanColor, null);
    this.pushMove(s.settings.humanColor, 0, 0, true, 0);
    await this.afterMove();
    return true;
  }

  private async afterMove(): Promise<void> {
    const last = this.moves[this.moves.length - 1];
    this.state.consecutivePasses = last && last.pass ? this.state.consecutivePasses + 1 : 0;

    // 双方连停 → 进入数子
    if (this.state.consecutivePasses >= 2) {
      this.state.phase = 'scoring';
      this.state.currentPlayer = otherColor(this.state.currentPlayer);
      this.emit();
      return;
    }

    this.state.currentPlayer = otherColor(this.state.currentPlayer);
    this.emit();
    if (this.state.settings && this.state.currentPlayer === this.state.settings.aiColor) {
      await this.aiMove();
    }
  }

  /** AI 走子 */
  private async aiMove(): Promise<void> {
    const s = this.state;
    if (!s.settings) return;
    this.state.aiThinking = true;
    this.emit();

    let before = await this.tryAnalyze();
    let res: string;
    try {
      res = await this.gtp.genmove(s.settings.aiColor);
    } catch (e) {
      console.error('[aiMove] genmove 失败:', e);
      this.state.aiThinking = false;
      this.emit();
      return;
    }
    res = res.toLowerCase();

    let pass = false;
    let resign = false;
    if (res === 'pass') pass = true;
    else if (res === 'resign') resign = true;
    else {
      try {
        const [x, y] = gtpToXY(res, s.boardSize);
        const pr = this.goban.place(s.settings.aiColor, x, y);
        // 注意：KataGo 的 genmove 会把落子直接落在引擎棋盘上（等价 play+genmove），
        // 因此这里不需要再向引擎发送 play，否则会报 illegal move。
        this.pushMove(s.settings.aiColor, x, y, false, pr.captured.length, res);
      } catch (e) {
        console.error(`[aiMove] AI 落子 "${res}" 本地判定失败，重放同步引擎:`, (e as Error).message);
        await this.syncFromHistory(); // 引擎已落下该子，本地视为非法 → 重放回本地状态
        pass = true; // 兜底：该手按过处理
      }
    }
    if (pass) this.pushMove(s.settings.aiColor, 0, 0, true, 0);

    if (resign) {
      this.state.aiThinking = false;
      this.endGame({ winner: s.settings.humanColor, reason: 'ai-resign' });
      return;
    }

    const after = await this.tryAnalyze();
    this.state.aiThinking = false;

    this.events.onAiMoved?.({
      aiColor: s.settings.aiColor,
      vertex: pass ? null : res,
      pass,
      winrateBefore: before?.winrate ?? null,
      winrateAfter: after?.winrate ?? null,
      scoreLeadAfter: after?.scoreLead ?? null,
    });

    await this.afterMove();
  }

  /** 悔棋：撤销最近一手 AI 及其前一手人类落子（若 AI 刚下完），并同步引擎（串行队列） */
  async undo(): Promise<boolean> {
    return this.enqueue(() => this.undoImpl());
  }

  private async undoImpl(): Promise<boolean> {
    const s = this.state;
    if (s.phase !== 'playing' || !s.settings || s.aiThinking) return false;
    if (this.moves.length === 0) return false;

    const human = s.settings.humanColor;
    const ai = s.settings.aiColor;
    let count = 0;
    if (this.moves[this.moves.length - 1].color === ai) {
      count++;
      if (this.moves.length - 2 >= 0 && this.moves[this.moves.length - 2].color === human) count++;
    }
    const minMoves = s.settings.handicap;
    count = Math.min(count, this.moves.length - minMoves);
    if (count <= 0) return false;

    this.moves = this.moves.slice(0, this.moves.length - count);
    await this.syncFromHistory();
    this.state.consecutivePasses = 0;
    this.state.winrate = null;
    this.state.scoreLead = null;
    this.state.heatmap = null;
    this.emit();
    // 防止悔棋后停在“AI 回合但不触发 AI 走子”的死状态
    if (this.state.phase === 'playing' && s.settings && this.state.currentPlayer === s.settings.aiColor) {
      await this.aiMove();
    }
    return true;
  }

  /** 认输（串行队列） */
  async resign(): Promise<boolean> {
    return this.enqueue(() => this.resignImpl());
  }

  private async resignImpl(): Promise<boolean> {
    const s = this.state;
    if (s.phase !== 'playing' || !s.settings) return false;
    this.endGame({ winner: s.settings.aiColor, reason: 'resign' });
    return true;
  }

  /** 标记/取消死子（数子阶段，index 为 board 一维下标） */
  toggleDeadStone(index: number): void {
    if (this.state.phase !== 'scoring') return;
    const i = this.state.deadStones.indexOf(index);
    if (i >= 0) this.state.deadStones.splice(i, 1);
    else this.state.deadStones.push(index);
    this.emit();
  }

  /** 完成数子结算（串行队列） */
  async finishScoring(): Promise<GameResult | null> {
    return this.enqueue(() => this.finishScoringImpl());
  }

  private async finishScoringImpl(): Promise<GameResult | null> {
    const s = this.state;
    if (s.phase !== 'scoring' || !s.settings) return null;
    const dead = new Set(s.deadStones);
    const sc: ScoreResult = computeScoreWithKomi(this.goban, dead, s.settings.komi);
    this.endGame({ winner: sc.winner === 'B' ? BLACK : WHITE, reason: 'score' });
    if (this.state.result) {
      this.state.result.blackArea = sc.blackArea;
      this.state.result.whiteArea = sc.whiteArea;
      this.state.result.blackScore = sc.blackScore;
      this.state.result.whiteScore = sc.whiteScore;
      this.state.result.margin = sc.margin;
    }
    this.emit();
    return this.state.result;
  }

  private endGame(partial: Partial<GameResult>): void {
    const s = this.state;
    const winner = partial.winner!;
    s.phase = 'over';
    s.result = {
      winner,
      winnerIsHuman: !!s.settings && winner === s.settings.humanColor,
      reason: partial.reason!,
      blackScore: 0,
      whiteScore: 0,
      blackArea: 0,
      whiteArea: 0,
      margin: 0,
      komi: s.settings?.komi ?? 7.5,
      ...partial,
    };
    s.aiThinking = false;
    this.emit();
  }

  /** 从历史重建棋盘 + 引擎状态（悔棋用） */
  private async syncFromHistory(): Promise<void> {
    const s = this.state;
    if (!s.settings) return;
    this.goban = new Goban(s.settings.boardSize);
    await this.gtp.clearBoard(s.settings.boardSize, s.settings.komi);
    await this.gtp.applyDifficulty(s.settings.difficulty);
    let cur: Color = s.settings.handicap > 0 ? WHITE : BLACK;
    for (const mv of this.moves) {
      if (!mv.pass) {
        try {
          this.goban.place(mv.color, mv.x, mv.y);
        } catch (e) {
          console.warn('[sync] 重放本地落子异常（忽略）:', (e as Error).message);
        }
        await this.gtp.play(mv.color, mv.vertex ?? vertexToGtp(mv.x, mv.y, s.boardSize));
      } else {
        await this.gtp.play(mv.color, null);
      }
      cur = otherColor(cur);
    }
    s.currentPlayer = cur;
    s.captures = { ...this.goban.captures };
    s.lastMove = this.goban.lastMove;
    s.moveCount = this.moves.length;
  }

  /** 获取当前方胜率/目差（分析引擎，失败返回 null 不阻塞） */
  private async tryAnalyze(): Promise<{ winrate: number | null; scoreLead: number | null } | null> {
    try {
      await this.ensureAnalysis();
      // 100 visits 足够给出稳定的粗略胜率/目差，又不拖慢对局
      const resp = await this.queryAnalysis(false, 100);
      const winrate = resp.rootInfo?.winrate ?? null;
      const scoreLead = resp.rootInfo?.scoreLead ?? null;
      this.state.winrate = winrate;
      this.state.scoreLead = scoreLead;
      this.emit(); // 立即推送胜率/目差（供右上角实时显示）
      return { winrate, scoreLead };
    } catch (e) {
      return null;
    }
  }

  /** 组装当前局面的 moves 数组（供分析引擎） */
  buildAnalysisMoves(): [string, string][] {
    return this.moves.map((m) => [m.color === BLACK ? 'B' : 'W', m.pass ? 'pass' : m.vertex!]);
  }

  /** 查询分析引擎（当前局面） */
  async queryAnalysis(includeOwnership: boolean, maxVisits = 300): Promise<AnalysisResponse> {
    const s = this.state;
    if (!s.settings) throw new Error('对局未开始');
    await this.ensureAnalysis();
    return this.analysis.query({
      moves: this.buildAnalysisMoves(),
      rules: 'chinese',
      komi: s.settings.komi,
      boardXSize: s.boardSize,
      boardYSize: s.boardSize,
      maxVisits,
      includeOwnership,
      topMoves: includeOwnership ? undefined : 5,
    });
  }

  /** 对局中查看地盘：请求热力图并缓存到 state（串行队列） */
  async requestTerritory(maxVisits = 200): Promise<number[] | null> {
    return this.enqueue(() => this.requestTerritoryImpl(maxVisits));
  }

  private async requestTerritoryImpl(maxVisits = 200): Promise<number[] | null> {
    try {
      const resp = await this.queryAnalysis(true, maxVisits);
      this.state.heatmap = resp.ownership ?? null;
      this.state.winrate = resp.rootInfo?.winrate ?? null;
      this.state.scoreLead = resp.rootInfo?.scoreLead ?? null;
      this.emit();
      return this.state.heatmap;
    } catch (e) {
      console.error('[territory] 分析失败:', e);
      return null;
    }
  }

  /** 请求最强 AI 的最佳选点（提示），top 3 存入 state.hintMoves */
  async requestHint(): Promise<boolean> {
    return this.enqueue(() => this.requestHintImpl());
  }

  private async requestHintImpl(): Promise<boolean> {
    const s = this.state;
    if (s.phase !== 'playing' || !s.settings) return false;
    try {
      const resp = await this.queryAnalysis(false, 3000);
      const top = (resp.moveInfos ?? []).slice(0, 3).map((m) => m.move);
      this.state.hintMoves = top;
      this.emit();
      return top.length > 0;
    } catch (e) {
      console.error('[hint] 提示计算失败:', e);
      return false;
    }
  }

  clearHeatmap(): void {
    this.state.heatmap = null;
    this.emit();
  }
}



