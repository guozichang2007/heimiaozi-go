import { Goban } from '@sabaki/shudan';
import { state, actions, territoryView } from '../state/store';
import { GameState } from '../state/store';

function toSignMap(grid: number[], size: number): (0 | 1 | -1)[][] {
  const rows: (0 | 1 | -1)[][] = [];
  for (let y = 0; y < size; y++) {
    const row: (0 | 1 | -1)[] = [];
    for (let x = 0; x < size; x++) {
      const v = grid[y * size + x];
      row.push(v === 1 ? 1 : v === 2 ? -1 : 0);
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 把 KataGo ownership(-1..1，正值=黑方领地倾向)转成 shudan heatMap。
 * strength 范围 1~9：正值(黑)→6~9，负值(白)→1~4，配合自定义 CSS 上色。
 */
function toHeatMap(heatmap: number[] | null, size: number): ({ strength: number; text?: string } | null)[][] {
  const rows: ({ strength: number; text?: string } | null)[][] = [];
  if (!heatmap) return rows;
  for (let y = 0; y < size; y++) {
    const row: ({ strength: number; text?: string } | null)[] = [];
    for (let x = 0; x < size; x++) {
      const v = heatmap[y * size + x];
      const a = Math.abs(v);
      if (a < 0.12) {
        row.push(null);
        continue;
      }
      let s = Math.round(a * 4);
      if (s < 1) s = 1;
      if (s > 4) s = 4;
      row.push({ strength: v > 0 ? 5 + s : s });
    }
    rows.push(row);
  }
  return rows;
}

function gtpToXY(vertex: string, size: number): [number, number] | null {
  const m = /^([A-Ta-t])(\d+)$/.exec(vertex.trim());
  if (!m) return null;
  let col = m[1].toUpperCase().charCodeAt(0) - 65;
  if (col >= 8) col--;
  const row = Number(m[2]);
  return [col, size - row];
}

function toMarkerMap(s: GameState): ({ type: string; label?: string } | null)[][] {
  const size = s.boardSize;
  const rows: ({ type: string; label?: string } | null)[][] = Array.from({ length: size }, () =>
    Array(size).fill(null),
  );
  if (s.lastMove) {
    const [x, y] = s.lastMove;
    rows[y][x] = { type: 'circle' };
  }
  if (s.phase === 'scoring') {
    for (const idx of s.deadStones) {
      const y = Math.floor(idx / size);
      const x = idx % size;
      rows[y][x] = { type: 'square' };
    }
  }
  // 提示最佳落点（①②③ 标签）
  if (s.hintMoves && s.hintMoves.length) {
    s.hintMoves.slice(0, 3).forEach((v, i) => {
      const xy = gtpToXY(v, size);
      if (xy) rows[xy[1]][xy[0]] = { type: 'label', label: `${i + 1}` };
    });
  }
  return rows;
}

export function BoardView() {
  const s = state.value;
  const size = s.boardSize;
  const signMap = toSignMap(s.grid, size);
  const heat = territoryView.value && s.heatmap ? toHeatMap(s.heatmap, size) : null;
  const markerMap = toMarkerMap(s);

  const humanTurn =
    (s.phase === 'playing' || s.phase === 'placement') &&
    s.settings &&
    s.currentPlayer === s.settings.humanColor &&
    !s.aiThinking;
  const dimmed = s.phase === 'scoring' ? s.deadStones.map((idx) => [idx % size, Math.floor(idx / size)] as [number, number]) : [];

  const onVertex = (_evt: MouseEvent, [x, y]: [number, number]) => {
    if (s.phase === 'scoring') {
      actions.markDead(y * size + x);
      return;
    }
    if (humanTurn) actions.play(x, y);
  };

  return (
    <div className={`board-wrap ${territoryView.value ? 'territory-on' : ''}`}>
      <Goban
        signMap={signMap}
        heatMap={heat}
        markerMap={markerMap}
        dimmedVertices={dimmed}
        showCoordinates={true}
        busy={s.aiThinking}
        fuzzyStonePlacement={false}
        animateStonePlacement={true}
        onVertexMouseUp={onVertex as any}
        innerProps={{ onContextMenu: (e: Event) => e.preventDefault() }}
      />
    </div>
  );
}