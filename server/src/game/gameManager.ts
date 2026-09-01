import { Goban, Color, BLACK, WHITE, otherColor } from './goban';
import { GtpEngine, vertexToGtp, gtpToXY } from '../katago/gtpEngine';
import { AnalysisEngine, AnalysisResponse } from '../katago/analysisEngine';
import { Difficulty } from '../katago/difficulty';
import { computeScoreWithKomi, ScoreResult } from './scoring';
import { parseSgfGame } from '../sgf';

/** 玩家落子后胜率下跌触发隐藏电击的阈值（百分比） */
const PLAYER_DROP_SHOCK_THRESHOLD = 8;

export type Phase = 'setup' | 'placement' | 'playing' | 'scoring' | 'over';

export interface GameSettings {
  /** 对弈模式：ai=人机对战；local=线下真人对弈（黑白轮流，无 AI 自动应手） */
  mode: 'ai' | 'local';
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

/** 提示的单个候选选点（GTP 坐标 + KataGo 返回的参数） */
export interface HintMove {
  /** GTP 坐标 */
  move: string;
  /** 该着法的轮到方胜率 0~1 */
  winrate: number;
  /** 该着法的目差（轮到方视角，正=领先） */
  scoreMean: number;
}

/** 复盘记录中的单步（来自 SGF 主变） */
export interface ReviewMove {
  color: Color;
  x: number;
  y: number;
  pass: boolean;
}

/** 复盘状态（本地双人模式） */
export interface ReviewState {
  /** 下一个要落的记录手（0 基） */
  index: number;
  /** 记录总手数 */
  total: number;
  /** 虚影（未偏离且未走完时的下一手）；pass 时无落点 */
  ghost: { color: Color; x: number; y: number; pass: boolean } | null;
  /** 是否处于自由推演（棋盘手数超过记录 index） */
  deviated: boolean;
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
  /** 提示的最佳选点（GTP 坐标 + 胜率/目差参数） */
  hintMoves: HintMove[];
  /** 摆子阶段剩余让子手数 */
  handicapRemaining: number;
  /** 最近一次分析：轮到的一方（side to move）胜率 0~1 */
  winrate: number | null;
  /** 最近一次分析：轮到的一方目差（正=领先） */
  scoreLead: number | null;
  /** 复盘状态（本地双人模式导入 SGF 后非空） */
  review: ReviewState | null;
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
  /** 隐藏功能：玩家落子后胜率较上一次下跌 ≥8% 时回调（dropPct 为跌幅百分比） */
  onPlayerDropShock?: (dropPct: number) => void;
  /** 对局一方胜率首次 ≥98.5% 时触发 BGM（复盘模式除外，每方每局至多一次） */
  onBgmTrigger?: () => void;
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
    handicapRemaining: 0,
    winrate: null,
    scoreLead: null,
    consecutivePasses: 0,
    review: null,
  };

  private moves: MoveRecord[] = [];
  /** 玩家上一手落子后的胜率（隐藏电击功能用） */
  private lastPlayerWinrate: number | null = null;
  /** 复盘记录（导入 SGF 后非空）；index 指向下一个要落的记录手 */
  private reviewMoves: ReviewMove[] | null = null;
  private reviewIndex = 0;
  /** 复盘的让子/AB 预置子 */
  private reviewAbStones: { x: number; y: number }[] = [];
  /** BGM 触发标记（每方每局至多一次） */
  private bgmTriggeredBlack = false;
  private bgmTriggeredWhite = false;
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
    this.state = {
      ...this.state,
      captures: { ...this.state.captures },
      grid: this.goban.toArray(),
      lastMove: this.goban.lastMove,
      review: this.reviewPublic(),
    };
    this.events.onState?.(this.state);
  }

  /** 推导复盘公开状态（虚影/偏离） */
  private reviewPublic(): ReviewState | null {
    if (!this.reviewMoves) return null;
    const deviated = this.moves.length > this.reviewIndex;
    const ghost =
      !deviated && this.reviewIndex < this.reviewMoves.length
        ? this.reviewMoves[this.reviewIndex]
        : null;
    return { index: this.reviewIndex, total: this.reviewMoves.length, ghost, deviated };
  }

  getState(): PublicState {
    return {
      ...this.state,
      captures: { ...this.state.captures },
      grid: [...this.state.grid],
      review: this.reviewPublic(),
    };
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
    this.lastPlayerWinrate = null;
    this.reviewMoves = null;
    this.reviewIndex = 0;
    this.reviewAbStones = [];
    this.bgmTriggeredBlack = false;
    this.bgmTriggeredWhite = false;
    this.goban = new Goban(settings.boardSize);
    const isHandicap = settings.handicap > 0;
    this.state = {
      phase: isHandicap ? 'placement' : 'playing',
      boardSize: settings.boardSize,
      grid: this.goban.toArray(),
      captures: { [BLACK]: 0, [WHITE]: 0 },
      lastMove: null,
      currentPlayer: isHandicap ? settings.humanColor : BLACK,
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
      handicapRemaining: isHandicap ? settings.handicap : 0,
      review: null,
    };
    await this.gtp.clearBoard(settings.boardSize, settings.komi);
    await this.gtp.applyDifficulty(settings.difficulty);
    // 让子棋：进入摆子阶段，由玩家自由摆放 N 颗黑子
    this.emit();
    // 双人模式：开局即显示初始胜率；不自动应手
    if (settings.mode === 'local') {
      await this.tryAnalyze();
      return;
    }
    // 无让子且 AI 先手（用户执白）时 AI 先落子
    if (!isHandicap && this.state.currentPlayer === settings.aiColor) {
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
    if (!s.settings) return false;
    if (s.aiThinking) return false;
    // 双人模式：当前方即可落子；人机模式：仅玩家
    if (s.settings.mode !== 'local' && s.currentPlayer !== s.settings.humanColor) return false;
    const player = s.settings.mode === 'local' ? s.currentPlayer : s.settings.humanColor;
    const vertex = vertexToGtp(x, y, s.boardSize);

    // 摆子阶段：玩家自由摆放让子
    if (s.phase === 'placement') {
      try {
        await this.gtp.play(player, vertex);
      } catch (e) {
        return false;
      }
      try {
        const res = this.goban.place(player, x, y);
        this.pushMove(player, x, y, false, res.captured.length);
      } catch (e) {
        await this.syncFromHistory();
        return false;
      }
      s.handicapRemaining = Math.max(0, s.handicapRemaining - 1);
      this.state.winrate = null;
      if (s.handicapRemaining <= 0) {
        s.phase = 'playing';
        s.currentPlayer = otherColor(player);
        this.emit();
        await this.aiMove(); // 摆完让子，AI 先手
      } else {
        this.emit();
      }
      return true;
    }

    // 正常对弈：先让引擎落子（引擎为规则权威）；成功后再更新本地棋盘
    if (s.phase !== 'playing') return false;
    // 复盘模式：点在虚影处 = 按记录前进（否则为自由推演的普通落子）
    if (this.reviewMoves && this.moves.length === this.reviewIndex && this.reviewIndex < this.reviewMoves.length) {
      const mv = this.reviewMoves[this.reviewIndex];
      if (!mv.pass && mv.color === player && mv.x === x && mv.y === y) {
        return await this.reviewNextImpl();
      }
    }
    try {
      await this.gtp.play(player, vertex);
    } catch (e) {
      console.error('[humanPlay] 引擎拒绝落子:', (e as Error).message);
      return false;
    }
    try {
      const res = this.goban.place(player, x, y);
      this.pushMove(player, x, y, false, res.captured.length);
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
    if (s.settings.mode !== 'local' && s.currentPlayer !== s.settings.humanColor) return false;
    if (s.aiThinking) return false;
    const player = s.settings.mode === 'local' ? s.currentPlayer : s.settings.humanColor;
    await this.gtp.play(player, null);
    this.pushMove(player, 0, 0, true, 0);
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
    // 双人模式：不自动应手，但每次落子后更新实时胜率
    if (this.state.settings?.mode === 'local') {
      await this.tryAnalyze();
      return;
    }
    if (
      this.state.settings &&
      this.state.currentPlayer === this.state.settings.aiColor
    ) {
      await this.aiMove();
    }
  }

  /** 隐藏功能：玩家落子后胜率较上一次大跌 ≥8% 时回调（用于触发郊狼电击） */
  private maybePlayerDropShock(sideToMoveWinrate: number | null): void {
    const s = this.state;
    if (sideToMoveWinrate == null || !s.settings) return;
    const last = this.moves[this.moves.length - 1];
    // 仅在上一手是玩家的真实落子（非 Pass）时判定
    if (!last || last.color !== s.settings.humanColor || last.pass) return;
    // 此刻轮到 AI，sideToMoveWinrate 为 AI 方胜率 → 玩家胜率 = 1 - 之
    const playerWr = 1 - sideToMoveWinrate;
    const prev = this.lastPlayerWinrate;
    this.lastPlayerWinrate = playerWr;
    if (prev == null) return;
    const drop = (prev - playerWr) * 100; // 正=玩家胜率下降
    if (drop >= PLAYER_DROP_SHOCK_THRESHOLD) {
      console.log(`[shock] 玩家胜率下跌 ${drop.toFixed(1)}%（${(prev * 100).toFixed(0)}% → ${(playerWr * 100).toFixed(0)}%）`);
      this.events.onPlayerDropShock?.(drop);
    }
  }

  /** AI 走子 */
  private async aiMove(): Promise<void> {
    const s = this.state;
    if (!s.settings) return;
    this.state.aiThinking = true;
    this.emit();

    let before = await this.tryAnalyze();
    this.maybePlayerDropShock(before?.winrate ?? null);
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
    if ((s.phase !== 'playing' && s.phase !== 'placement') || !s.settings || s.aiThinking) return false;
    if (this.moves.length === 0) return false;
    this.lastPlayerWinrate = null; // 悔棋后局面回退，胜率基准作废

    // 摆子阶段：撤掉最后一颗让子
    if (s.phase === 'placement') {
      this.moves = this.moves.slice(0, this.moves.length - 1);
      s.handicapRemaining = Math.min(s.settings.handicap, s.handicapRemaining + 1);
      await this.syncFromHistory();
      this.state.winrate = null;
      this.state.hintMoves = [];
      this.emit();
      return true;
    }

    // 双人模式：撤掉最后一手（当前方刚落的子）
    if (s.settings.mode === 'local') {
      this.moves = this.moves.slice(0, this.moves.length - 1);
      // 复盘：若之前处于严格回放，撤销记录手 → index 回退
      if (this.reviewMoves && this.moves.length < this.reviewIndex) {
        this.reviewIndex = this.moves.length;
      }
      await this.syncFromHistory();
      this.state.consecutivePasses = 0;
      this.state.winrate = null;
      this.state.scoreLead = null;
      this.state.heatmap = null;
      this.emit();
      await this.tryAnalyze(); // 悔棋后刷新实时胜率
      return true;
    }

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
    // 双人模式：当前回合方认输；人机模式：玩家认输
    const loser = s.settings.mode === 'local' ? s.currentPlayer : s.settings.humanColor;
    this.endGame({ winner: otherColor(loser), reason: 'resign' });
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

  /** 数子结算后回到棋盘：恢复为可交互对弈状态（悔棋/看地盘/存SGF等正常可用） */
  async reopenBoard(): Promise<boolean> {
    return this.enqueue(() => this.reopenBoardImpl());
  }

  private async reopenBoardImpl(): Promise<boolean> {
    const s = this.state;
    if (s.phase !== 'over' || !s.settings) return false;
    s.phase = 'playing';
    s.result = null;
    s.consecutivePasses = 0;
    s.deadStones = [];
    s.winrate = null;
    s.scoreLead = null;
    s.heatmap = null;
    s.hintMoves = [];
    this.emit();
    // 若轮到 AI 先手则继续走子，避免停在"AI 回合但不动"的死状态；双人模式不自动应手
    if (s.settings.mode !== 'local' && s.currentPlayer === s.settings.aiColor) {
      await this.aiMove();
    }
    return true;
  }

  /** 导入 SGF 对局，进入复盘模式（本地双人） */
  async importSgf(text: string): Promise<boolean> {
    return this.enqueue(() => this.importSgfImpl(text));
  }

  private async importSgfImpl(text: string): Promise<boolean> {
    const parsed = parseSgfGame(text);
    const { boardSize, komi, handicapStones, moves } = parsed;
    if (![9, 13, 19].includes(boardSize)) throw new Error(`不支持的棋盘大小：${boardSize}（仅支持 9/13/19）`);
    if (!moves.length) throw new Error('SGF 中没有找到走子记录');
    // 以本地双人模式开新局（空盘）
    this.moves = [];
    this.lastPlayerWinrate = null;
    this.goban = new Goban(boardSize);
    const settings: GameSettings = {
      mode: 'local',
      boardSize,
      komi,
      handicap: 0,
      difficulty: 'hard',
      humanColor: BLACK,
      aiColor: WHITE,
    };
    this.state = {
      phase: 'playing',
      boardSize,
      grid: this.goban.toArray(),
      captures: { [BLACK]: 0, [WHITE]: 0 },
      lastMove: null,
      currentPlayer: moves[0]?.color ?? BLACK,
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
      handicapRemaining: 0,
      review: null,
    };
    await this.gtp.clearBoard(boardSize, komi);
    await this.gtp.applyDifficulty('hard');
    // 预置让子/AB 子（不计入手数）
    this.reviewAbStones = handicapStones;
    this.bgmTriggeredBlack = false;
    this.bgmTriggeredWhite = false;
    for (const st of handicapStones) {
      await this.gtp.play(BLACK, vertexToGtp(st.x, st.y, boardSize));
      this.goban.place(BLACK, st.x, st.y);
    }
    this.reviewMoves = moves;
    this.reviewIndex = 0;
    this.emit();
    await this.tryAnalyze(); // 开局即显示初始胜率
    return true;
  }

  /** 复盘：按记录下一手 */
  async reviewNext(): Promise<boolean> {
    return this.enqueue(() => this.reviewNextImpl());
  }

  private async reviewNextImpl(): Promise<boolean> {
    const s = this.state;
    if (!s.settings || !this.reviewMoves || s.phase !== 'playing') return false;
    if (this.moves.length > this.reviewIndex) return false; // 自由推演中禁止
    if (this.reviewIndex >= this.reviewMoves.length) return false;
    const mv = this.reviewMoves[this.reviewIndex];
    if (mv.color !== s.currentPlayer) return false;
    try {
      if (mv.pass) {
        await this.gtp.play(mv.color, null);
        this.pushMove(mv.color, 0, 0, true, 0);
      } else {
        await this.gtp.play(mv.color, vertexToGtp(mv.x, mv.y, s.boardSize));
        const res = this.goban.place(mv.color, mv.x, mv.y);
        this.pushMove(mv.color, mv.x, mv.y, false, res.captured.length);
      }
    } catch (e) {
      return false;
    }
    this.reviewIndex++;
    s.currentPlayer = otherColor(mv.color);
    this.state.winrate = null;
    this.state.hintMoves = [];
    this.emit();
    await this.tryAnalyze(); // 每手刷新实时胜率
    return true;
  }

  /** 复盘：上一手（自由推演时直接跳回记录位置） */
  async reviewPrev(): Promise<boolean> {
    return this.enqueue(() => this.reviewPrevImpl());
  }

  private async reviewPrevImpl(): Promise<boolean> {
    const s = this.state;
    if (!s.settings || !this.reviewMoves || s.phase !== 'playing') return false;
    if (this.moves.length === 0) return false;
    if (this.moves.length > this.reviewIndex) {
      // 自由推演：一步撤光自由推演的落子，回到记录位置
      this.moves = this.moves.slice(0, this.reviewIndex);
      await this.syncFromHistory();
    } else if (this.reviewIndex > 0) {
      // 严格回放：撤一手记录
      this.moves = this.moves.slice(0, this.moves.length - 1);
      this.reviewIndex--;
      await this.syncFromHistory();
    } else {
      return false;
    }
    this.state.winrate = null;
    this.state.hintMoves = [];
    this.emit();
    await this.tryAnalyze(); // 回退后刷新实时胜率
    return true;
  }

  /** 结束复盘：退出复盘，保留当前局面转普通双人对弈 */
  async endReview(): Promise<boolean> {
    return this.enqueue(() => this.endReviewImpl());
  }

  private async endReviewImpl(): Promise<boolean> {
    this.reviewMoves = null;
    this.reviewIndex = 0;
    this.reviewAbStones = [];
    this.emit();
    return true;
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
    // 复盘：先重放让子/AB 预置子
    if (this.reviewMoves) {
      for (const st of this.reviewAbStones) {
        await this.gtp.play(BLACK, vertexToGtp(st.x, st.y, s.boardSize));
        this.goban.place(BLACK, st.x, st.y);
      }
    }
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
    }
    // 计算当前轮到谁：摆子阶段始终玩家；否则按最后一手交替
    if (s.phase === 'placement') {
      s.currentPlayer = s.settings.humanColor;
    } else if (this.moves.length === 0) {
      s.currentPlayer = this.reviewMoves
        ? (this.reviewMoves[0]?.color ?? BLACK)
        : s.settings.handicap > 0
          ? WHITE
          : BLACK;
    } else if (this.reviewMoves && this.moves.length <= this.reviewIndex) {
      // 复盘严格回放态：轮到记录中下一手方（记录走完则轮到最后一手的对方）
      s.currentPlayer =
        this.reviewIndex < this.reviewMoves.length
          ? this.reviewMoves[this.reviewIndex].color
          : otherColor(this.moves[this.moves.length - 1].color);
    } else {
      s.currentPlayer = otherColor(this.moves[this.moves.length - 1].color);
    }
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
      this.maybeTriggerBgm(winrate);
      return { winrate, scoreLead };
    } catch (e) {
      return null;
    }
  }

  /** 对局一方胜率首次 ≥98.5% 时触发 BGM 事件（复盘模式除外，每方每局至多一次） */
  private maybeTriggerBgm(sideToMoveWinrate: number | null): void {
    const s = this.state;
    if (sideToMoveWinrate == null || !s.settings) return;
    if (this.reviewMoves) return; // 复盘模式不触发
    if (s.phase !== 'playing') return;
    // winrate 为"轮到方"视角，换算双方胜率
    const blackWr = s.currentPlayer === BLACK ? sideToMoveWinrate : 1 - sideToMoveWinrate;
    const whiteWr = 1 - blackWr;
    if (blackWr >= 0.985 && !this.bgmTriggeredBlack) {
      this.bgmTriggeredBlack = true;
      this.events.onBgmTrigger?.();
    } else if (whiteWr >= 0.985 && !this.bgmTriggeredWhite) {
      this.bgmTriggeredWhite = true;
      this.events.onBgmTrigger?.();
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
      // 分析引擎按 reportAnalysisWinratesAs=SIDETOMOVE 报告 ownership：正值=轮到方领地。
      // 统一换算为「正值=黑方领地」，供前端"黑=黑、白=白"配色正确。
      const ownership = resp.ownership;
      this.state.heatmap = ownership
        ? this.state.currentPlayer === WHITE
          ? ownership.map((v) => -v)
          : [...ownership]
        : null;
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
      // 保留 KataGo 返回的每个选点参数（胜率/目差），供悬停提示框展示
      const top: HintMove[] = (resp.moveInfos ?? [])
        .slice(0, 3)
        .map((m) => ({ move: m.move, winrate: m.winrate, scoreMean: m.scoreMean ?? 0 }));
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



