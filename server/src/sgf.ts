import { stringify } from '@sabaki/sgf';
import { Color, BLACK, WHITE } from './game/goban';
import { MoveRecord, GameSettings, GameResult } from './game/gameManager';

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
  if (settings.handicap > 0) {
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

