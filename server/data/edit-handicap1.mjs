// 自由让子功能：gameManager + index
import { readFileSync, writeFileSync } from 'fs';

function editFile(p, edits) {
  let t = readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  let ok = true;
  for (const [anchor, replacement, label] of edits) {
    if (t.includes(anchor)) {
      t = t.replace(anchor, replacement);
      console.log(`[OK] ${label}`);
    } else {
      console.log(`[失败] ${label}`);
      ok = false;
    }
  }
  if (ok) writeFileSync(p, t, 'utf8');
}

const P = 'C:/Users/guozi/.cline/data/workspaces/chat/heimiaozi-go/server/src/';

// ============ gameManager.ts ============
editFile(`${P}game/gameManager.ts`, [
  // 1) Phase 类型加 placement
  ["export type Phase = 'setup' | 'playing' | 'scoring' | 'over';", "export type Phase = 'setup' | 'placement' | 'playing' | 'scoring' | 'over';", 'Phase 类型'],
  // 2) PublicState 接口加 handicapRemaining
  ['  /** 提示的最佳选点（GTP 坐标） */\n  hintMoves: string[];\n', '  /** 提示的最佳选点（GTP 坐标） */\n  hintMoves: string[];\n  /** 摆子阶段剩余让子手数 */\n  handicapRemaining: number;\n', 'PublicState 字段'],
  // 3) 初始状态加 handicapRemaining
  ['    hintMoves: [],\n', '    hintMoves: [],\n    handicapRemaining: 0,\n', '初始状态'],
  // 4) startGameImpl 重写
  [
    `  private async startGameImpl(settings: GameSettings): Promise<void> {
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
  }`,
    `  private async startGameImpl(settings: GameSettings): Promise<void> {
    this.moves = [];
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
    };
    await this.gtp.clearBoard(settings.boardSize, settings.komi);
    await this.gtp.applyDifficulty(settings.difficulty);
    // 让子棋：进入摆子阶段，由玩家自由摆放 N 颗黑子
    this.emit();
    // 无让子且 AI 先手（用户执白）时 AI 先落子
    if (!isHandicap && this.state.currentPlayer === settings.aiColor) {
      await this.aiMove();
    }
  }`,
    'startGameImpl 重写',
  ],
  // 5) humanPlayImpl 加摆子分支
  [
    `  private async humanPlayImpl(x: number, y: number): Promise<boolean> {
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
    }`,
    `  private async humanPlayImpl(x: number, y: number): Promise<boolean> {
    const s = this.state;
    if (!s.settings) return false;
    if (s.aiThinking) return false;
    if (s.currentPlayer !== s.settings.humanColor) return false;
    const vertex = vertexToGtp(x, y, s.boardSize);

    // 摆子阶段：玩家自由摆放让子
    if (s.phase === 'placement') {
      try {
        await this.gtp.play(s.settings.humanColor, vertex);
      } catch (e) {
        return false;
      }
      try {
        const res = this.goban.place(s.settings.humanColor, x, y);
        this.pushMove(s.settings.humanColor, x, y, false, res.captured.length);
      } catch (e) {
        await this.syncFromHistory();
        return false;
      }
      s.handicapRemaining = Math.max(0, s.handicapRemaining - 1);
      this.state.winrate = null;
      if (s.handicapRemaining <= 0) {
        s.phase = 'playing';
        s.currentPlayer = otherColor(s.settings.humanColor);
        this.emit();
        await this.aiMove(); // 摆完让子，AI 先手
      } else {
        this.emit();
      }
      return true;
    }

    // 正常对弈：先让引擎落子（引擎为规则权威）；成功后再更新本地棋盘
    if (s.phase !== 'playing') return false;
    try {
      await this.gtp.play(s.settings.humanColor, vertex);
    } catch (e) {
      console.error('[humanPlay] 引擎拒绝落子:', (e as Error).message);
      return false;
    }`,
    'humanPlayImpl 摆子分支',
  ],
]);
console.log('gameManager 前半完成');
