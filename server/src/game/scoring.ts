import { Goban, EMPTY, BLACK, WHITE } from './goban';

export interface ScoreResult {
  /** 黑方地域(子+空) */
  blackArea: number;
  /** 白方地域(子+空) */
  whiteArea: number;
  /** 黑方得分（含贴目） */
  blackScore: number;
  whiteScore: number;
  komi: number;
  winner: 'B' | 'W';
  /** 胜者（含贴目后）领先的目数 */
  margin: number;
}

/**
 * 中国规则（数子法）计地。
 * 双方 Pass 两次后进入终局，用户手动标记死子后调用本函数。
 * 死子视为提掉；空点归属 = 包围它的唯一颜色（边界区域若黑白都邻接则为单官，不计）。
 * 黑方得 185 子以上胜（数子法），这里换算成"得分 = 子数 + 领地"，贴目换算：
 *   中国规则黑贴 7.5 目 ≈ 黑 185 子赢 3/4 子。为便于展示，我们采用：
 *   黑得分 = blackArea - komi/2，白得分 = whiteArea + komi/2（等价于贴目归入比较）
 */
export function computeScore(board: Goban, dead: Set<number>): ScoreResult {
  const size = board.size;
  const grid = board.cloneGrid();

  // 1. 移除死子
  for (const idx of dead) grid[idx] = EMPTY;

  // 2. 统计活子
  let blackStones = 0, whiteStones = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === BLACK) blackStones++;
    else if (grid[i] === WHITE) whiteStones++;
  }

  // 3. 空点归属
  let blackTerritory = 0, whiteTerritory = 0;
  const visited = new Set<number>();
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== EMPTY || visited.has(i)) continue;
    // flood fill 空区域
    const region: number[] = [];
    const queue = [i];
    visited.add(i);
    const adjacent = new Set<number>();
    while (queue.length) {
      const cur = queue.pop()!;
      region.push(cur);
      const x = cur % size, y = Math.floor(cur / size);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
        const ni = ny * size + nx;
        if (grid[ni] === EMPTY) {
          if (!visited.has(ni)) { visited.add(ni); queue.push(ni); }
        } else {
          adjacent.add(grid[ni]);
        }
      }
    }
    if (adjacent.has(BLACK) && !adjacent.has(WHITE)) blackTerritory += region.length;
    else if (adjacent.has(WHITE) && !adjacent.has(BLACK)) whiteTerritory += region.length;
    // 双色邻接 → 单官，不计
  }

  const komi = 0;
  void komi;
  const blackArea = blackStones + blackTerritory;
  const whiteArea = whiteStones + whiteTerritory;

  return {
    blackArea,
    whiteArea,
    blackScore: blackArea,
    whiteScore: whiteArea,
    komi: 0,
    winner: blackArea > whiteArea ? 'B' : 'W',
    margin: Math.abs(blackArea - whiteArea),
  };
}

/**
 * 数子法对局结算（含贴目）。
 * 中国规则：黑贴 3¾ 子（≈7.5目），黑棋 184¼ 子则白胜。
 * 简化：subOwner = blackArea - komi/2，subWhite = whiteArea + komi/2
 */
export function computeScoreWithKomi(board: Goban, dead: Set<number>, komi: number): ScoreResult {
  const base = computeScore(board, dead);
  const blackScore = base.blackArea - komi / 2;
  const whiteScore = base.whiteArea + komi / 2;
  return {
    ...base,
    blackScore,
    whiteScore,
    komi,
    winner: blackScore > whiteScore ? 'B' : 'W',
    margin: Math.abs(blackScore - whiteScore),
  };
}
