// 自由让子功能：undo + syncFromHistory + index
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

// ============ gameManager.ts：undo + syncFromHistory ============
editFile(`${P}game/gameManager.ts`, [
  // undoImpl：允许摆子阶段撤销 + 摆子分支
  [
    `  private async undoImpl(): Promise<boolean> {
    const s = this.state;
    if (s.phase !== 'playing' || !s.settings || s.aiThinking) return false;
    if (this.moves.length === 0) return false;

    const human = s.settings.humanColor;`,
    `  private async undoImpl(): Promise<boolean> {
    const s = this.state;
    if ((s.phase !== 'playing' && s.phase !== 'placement') || !s.settings || s.aiThinking) return false;
    if (this.moves.length === 0) return false;

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

    const human = s.settings.humanColor;`,
    'undoImpl 摆子分支',
  ],
  // syncFromHistory：修正 currentPlayer 计算（让子棋奇偶不影响）
  [
    `    let cur: Color = s.settings.handicap > 0 ? WHITE : BLACK;
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
    s.currentPlayer = cur;`,
    `    for (const mv of this.moves) {
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
      s.currentPlayer = s.settings.handicap > 0 ? WHITE : BLACK;
    } else {
      s.currentPlayer = otherColor(this.moves[this.moves.length - 1].color);
    }`,
    'syncFromHistory 轮到计算',
  ],
]);

// ============ index.ts：让子 1-40 + komi=0 ============
editFile(`${P}index.ts`, [
  [
    '  const komi = Math.max(-20, Math.min(20, Number(raw.komi) || 7.5));\n  const handicap = Math.max(0, Math.min(9, Number(raw.handicap) || 0));',
    '  const handicap = Math.max(0, Math.min(40, Number(raw.handicap) || 0));\n  let komi = Math.max(-20, Math.min(20, Number(raw.komi) || 7.5));\n  if (handicap > 0) komi = 0; // 让子局白不贴目',
    'index 让子上限+komi',
  ],
]);
console.log('后端全部完成');
