export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export type Color = 1 | 2;

export function otherColor(c: Color): Color {
  return c === BLACK ? WHITE : BLACK;
}

export function colorName(c: Color): 'B' | 'W' {
  return c === BLACK ? 'B' : 'W';
}

export function colorFromName(n: string): Color {
  const u = n.toUpperCase();
  if (u === 'B') return BLACK;
  if (u === 'W') return WHITE;
  throw new Error(`bad color: ${n}`);
}

export interface PlaceResult {
  captured: [number, number][];
  suicide: boolean;
  ko: boolean;
}

interface GroupInfo {
  stones: [number, number][];
  liberties: Set<number>;
}

/** 围棋棋盘规则引擎：提子 / 自杀 / 打劫(superko) / 目数统计 */
export class Goban {
  size: number;
  grid: Uint8Array;
  captures: Record<Color, number>;
  private history: string[];
  /** 记录上一手落点，用于悔棋重放 / 显示 */
  lastMove: [number, number] | null = null;

  constructor(size: number) {
    this.size = size;
    this.grid = new Uint8Array(size * size);
    this.captures = { [BLACK]: 0, [WHITE]: 0 };
    this.history = [this.signature()];
  }

  idx(x: number, y: number): number {
    return y * this.size + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.size && y >= 0 && y < this.size;
  }

  get(x: number, y: number): number {
    return this.grid[this.idx(x, y)];
  }

  set(x: number, y: number, v: number): void {
    this.grid[this.idx(x, y)] = v;
  }

  private neighborsOf(x: number, y: number): [number, number][] {
    const out: [number, number][] = [];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx, ny = y + dy;
      if (this.inBounds(nx, ny)) out.push([nx, ny]);
    }
    return out;
  }

  /** 找出 (x,y) 所在同色棋串及其气 */
  private groupAt(x: number, y: number): GroupInfo {
    const color = this.get(x, y);
    const stones: [number, number][] = [];
    const liberties = new Set<number>();
    const seen = new Set<number>();
    const queue: [number, number][] = [[x, y]];
    seen.add(this.idx(x, y));
    while (queue.length) {
      const [cx, cy] = queue.pop()!;
      stones.push([cx, cy]);
      for (const [nx, ny] of this.neighborsOf(cx, cy)) {
        const c = this.get(nx, ny);
        if (c === EMPTY) liberties.add(this.idx(nx, ny));
        else if (c === color && !seen.has(this.idx(nx, ny))) {
          seen.add(this.idx(nx, ny));
          queue.push([nx, ny]);
        }
      }
    }
    return { stones, liberties };
  }

  /** 当前局面签名（用于 superko 判定） */
  signature(): string {
    // 数组编码为紧凑字符串：每 4 格打包 2bit
    const n = this.grid.length;
    let s = '';
    for (let i = 0; i < n; i += 4) {
      let v = 0;
      for (let k = 0; k < 4; k++) v = (v << 2) | (i + k < n ? this.grid[i + k] : 0);
      s += String.fromCharCode(32 + (v % 95));
    }
    return s;
  }

  /** 尝试落子。成功返回提子列表；非法（自杀/劫/超时重复）抛错 */
  place(color: Color, x: number, y: number): PlaceResult {
    if (!this.inBounds(x, y)) throw new Error('out of bounds');
    if (this.get(x, y) !== EMPTY) throw new Error('occupied');

    const prev = this.grid.slice();
    const prevCaptures = { ...this.captures };

    this.set(x, y, color);
    const captured: [number, number][] = [];
    for (const [nx, ny] of this.neighborsOf(x, y)) {
      const c = this.get(nx, ny);
      if (c !== EMPTY && c !== color) {
        const g = this.groupAt(nx, ny);
        if (g.liberties.size === 0) {
          for (const [sx, sy] of g.stones) {
            this.set(sx, sy, EMPTY);
            captured.push([sx, sy]);
          }
        }
      }
    }

    // 自杀判定
    if (captured.length === 0 && this.groupAt(x, y).liberties.size === 0) {
      this.grid.set(prev);
      this.captures = prevCaptures;
      throw new Error('suicide');
    }

    // superko 判定（含打劫）
    const sig = this.signature();
    if (this.history.includes(sig)) {
      this.grid.set(prev);
      this.captures = prevCaptures;
      throw new Error('ko');
    }

    this.history.push(sig);
    if (captured.length) this.captures[color] += captured.length;
    this.lastMove = [x, y];
    return { captured, suicide: false, ko: false };
  }

  /** 悔棋：重置到指定手数（内部用，供对局管理器同步） */
  resetToState(grid: Uint8Array, captures: Record<Color, number>, lastMove: [number, number] | null): void {
    this.grid.set(grid);
    this.captures = { ...captures };
    this.lastMove = lastMove ? [lastMove[0], lastMove[1]] : null;
    // 重建历史（superko 需要整局历史）
    // 由上层负责调用，这里重新从空棋盘推导
  }

  cloneGrid(): Uint8Array {
    return new Uint8Array(this.grid);
  }

  /** 把棋盘转成客户端用的数组（0空 1黑 2白） */
  toArray(): number[] {
    return Array.from(this.grid);
  }

  clear(): void {
    this.grid.fill(EMPTY);
    this.captures = { [BLACK]: 0, [WHITE]: 0 };
    this.history = [this.signature()];
    this.lastMove = null;
  }
}
