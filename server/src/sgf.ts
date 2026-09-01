import { stringify, parse } from '@sabaki/sgf';
import { Color, BLACK, WHITE } from './game/goban';
import { MoveRecord, GameSettings, GameResult, ReviewMove } from './game/gameManager';

/** SGF 坐标（如 'aa'，左上角 0 基）转内部 [x, y] */
function coordToXY(s: string | undefined): { x: number; y: number } | null {
  if (!s || s.length < 2) return null;
  const x = s.charCodeAt(0) - 97;
  const y = s.charCodeAt(1) - 97;
  if (x < 0 || y < 0 || x > 25 || y > 25) return null;
  return { x, y };
}

/**
 * 解析 SGF 对局文件（仅取主变），用于复盘导入。
 * 返回棋盘大小、贴目、让子预置子（AB）与走子序列。
 */
export function parseSgfGame(text: string): {
  boardSize: number;
  komi: number;
  handicapStones: { x: number; y: number }[];
  moves: ReviewMove[];
} {
  const trees = parse(text);
  const root = trees?.[0];
  if (!root) throw new Error('SGF 解析失败：文件为空或格式错误');
  const boardSize = Number(root.data.SZ?.[0]) || 19;
  const komiRaw = Number(root.data.KM?.[0]);
  const komi = Number.isFinite(komiRaw) ? komiRaw : 5.5;
  const handicapStones = (root.data.AB ?? [])
    .map((s) => coordToXY(s))
    .filter((c): c is { x: number; y: number } => c !== null);

  const moves: ReviewMove[] = [];
  let node = root;
  while (node.children && node.children[0]) {
    node = node.children[0];
    const d = node.data ?? {};
    const b = d.B?.[0];
    const w = d.W?.[0];
    const color = b !== undefined ? BLACK : w !== undefined ? WHITE : null;
    if (color === null) continue;
    if (b === '' || w === '') {
      moves.push({ color, x: 0, y: 0, pass: true });
    } else {
      const c = coordToXY(b ?? w);
      if (c) moves.push({ color, x: c.x, y: c.y, pass: false });
    }
  }
  return { boardSize, komi, handicapStones, moves };
}

function toSgfCoord(x: number, y: number): string {
  // SGF 坐标从左上角 'a' 开始
  return String.fromCharCode(97 + x) + String.fromCharCode(97 + y);
}

function colorKey(c: Color): 'B' | 'W' {
  return c === BLACK ? 'B' : 'W';
}

interface SgfNode {
  data: Record<string, string[]>;
  children: SgfNode[];
}

/** 把当前对局导出为 SGF 文本（@sabaki/sgf 期望链式树结构，值为不含方括号的原始值） */
export function buildSgf(moves: MoveRecord[], settings: GameSettings, result: GameResult | null): string {
  const rootData: Record<string, string[]> = {
    GM: ['1'],
    FF: ['4'],
    CA: ['UTF-8'],
    SZ: [String(settings.boardSize)],
    KM: [String(settings.komi)],
    PB: ['棋手'],
    PW: ['黑喵子'],
    DT: [new Date().toISOString().slice(0, 10)],
  };
  if (settings.mode === 'local') {
    rootData.PB = ['黑方'];
    rootData.PW = ['白方'];
  } else if (settings.handicap > 0) {
    rootData.HA = [String(settings.handicap)];
    rootData.PB = ['棋手(黑,受让)'];
  } else if (settings.humanColor === WHITE) {
    rootData.PB = ['黑喵子'];
    rootData.PW = ['棋手'];
  }
  if (result) {
    const label = result.winner === BLACK ? 'B' : 'W';
    rootData.RE = [`${label}+${result.margin.toFixed(1)}`];
  }

  const root: SgfNode = { data: rootData, children: [] };
  let cur = root;
  for (const mv of moves) {
    const data: Record<string, string[]> = mv.pass
      ? { [colorKey(mv.color)]: [''] }
      : { [colorKey(mv.color)]: [toSgfCoord(mv.x, mv.y)] };
    const node: SgfNode = { data, children: [] };
    cur.children.push(node);
    cur = node;
  }
  return stringify([root] as any);
}

