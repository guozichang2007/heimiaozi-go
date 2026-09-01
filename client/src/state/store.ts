import { signal } from '@preact/signals';
import { io, Socket } from 'socket.io-client';
import { playTriggerBgm, stopTriggerBgm } from '../music';

export type Phase = 'setup' | 'placement' | 'playing' | 'scoring' | 'over';
export type Color = 1 | 2;

export interface ChatMsg {
  id: string;
  role: 'user' | 'miaomiao' | 'system';
  text: string;
  streaming?: boolean;
}

export interface GameState {
  phase: Phase;
  boardSize: number;
  grid: number[];
  captures: { 1: number; 2: number };
  lastMove: [number, number] | null;
  currentPlayer: Color;
  moveCount: number;
  settings: {
    mode: 'ai' | 'local';
    boardSize: number;
    komi: number;
    handicap: number;
    difficulty: string;
    humanColor: Color;
    aiColor: Color;
  } | null;
  deadStones: number[];
  result: {
    winner: Color;
    winnerIsHuman: boolean;
    reason: string;
    blackScore: number;
    whiteScore: number;
    blackArea: number;
    whiteArea: number;
    margin: number;
    komi: number;
  } | null;
  aiThinking: boolean;
  heatmap: number[] | null;
  hintMoves: { move: string; winrate: number; scoreMean: number }[];
  /** 摆子阶段剩余让子手数 */
  handicapRemaining: number;
  winrate: number | null;
  scoreLead: number | null;
  review: {
    index: number;
    total: number;
    ghost: { color: Color; x: number; y: number; pass: boolean } | null;
    deviated: boolean;
  } | null;
  consecutivePasses: number;
}

export interface ServerConfig {
  deepseekEnabled: boolean;
  engineBackend: string;
  engineReady: boolean;
}

export const state = signal<GameState>({
  phase: 'setup',
  boardSize: 19,
  grid: [],
  captures: { 1: 0, 2: 0 },
  lastMove: null,
  currentPlayer: 1,
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
  review: null,
  consecutivePasses: 0,
});

export const chatMessages = signal<ChatMsg[]>([]);
export const serverConfig = signal<ServerConfig>({ deepseekEnabled: false, engineBackend: '', engineReady: false });
export const territoryView = signal(false);
export const showWinrate = signal(true);
export const hintLoading = signal(false);
export const connected = signal(false);
export const lastError = signal('');
/** 声音/静音（影响对局 99% 触发的 BGM），无音量条 */
export const bgmMuted = signal(typeof localStorage !== 'undefined' && localStorage.getItem('bgmMuted') === '1');

let socket: Socket | null = null;

export function connect(): void {
  if (socket) return;
  socket = io();
  socket.on('connect', () => (connected.value = true));
  socket.on('disconnect', () => (connected.value = false));
  socket.on('state', (s: GameState) => {
    state.value = s;
    if (s.hintMoves && s.hintMoves.length) hintLoading.value = false;
  });
  socket.on('config', (c: ServerConfig) => (serverConfig.value = c));
  socket.on('error', (e: string) => {
    lastError.value = String(e);
    setTimeout(() => (lastError.value = ''), 4000);
  });
  socket.on('bgm:play', () => {
    // 对局一方胜率首次 ≥99%：未静音时播放 BGM（单曲一次）
    if (!bgmMuted.value) playTriggerBgm();
  });
  socket.on('chat:user', (m: { id: string; text: string }) => pushMsg({ id: m.id, role: 'user', text: m.text }));
  socket.on('chat:start', (m: { id: string; role: string }) => {
    pushMsg({ id: m.id, role: 'miaomiao', text: '', streaming: true });
  });
  socket.on('chat:delta', (m: { id: string; chunk: string }) => {
    chatMessages.value = chatMessages.value.map((c) => (c.id === m.id ? { ...c, text: c.text + m.chunk } : c));
  });
  socket.on('chat:done', (m: { id: string; full: string }) => {
    chatMessages.value = chatMessages.value.map((c) =>
      c.id === m.id ? { ...c, text: m.full || c.text, streaming: false } : c,
    );
  });
}

function pushMsg(m: ChatMsg): void {
  chatMessages.value = [...chatMessages.value, m];
}

export const actions = {
  startGame(settings: unknown): void {
    socket?.emit('game:start', settings);
  },
  play(x: number, y: number): void {
    socket?.emit('game:play', { x, y });
  },
  pass(): void {
    socket?.emit('game:pass');
  },
  undo(): void {
    socket?.emit('game:undo');
  },
  resign(): void {
    socket?.emit('game:resign');
  },
  markDead(index: number): void {
    socket?.emit('game:markDead', index);
  },
  finishScoring(): void {
    socket?.emit('game:finishScoring');
  },
  reopenBoard(): void {
    // 带超时 ack：服务端未更新/未响应时给出明确提示，而不是静默失败
    socket?.timeout(3000).emit('game:reopen', (err: unknown) => {
      if (err) {
        lastError.value = '服务端未响应「回到棋盘」，请重启服务端（关掉重跑 start.cmd / dev.cmd）';
        setTimeout(() => (lastError.value = ''), 5000);
      }
    });
  },
  reviewNext(): void {
    socket?.emit('game:reviewNext');
  },
  reviewPrev(): void {
    socket?.emit('game:reviewPrev');
  },
  endReview(): void {
    socket?.emit('game:endReview');
  },
  /** 导入 SGF 对局文件（复盘）。返回错误信息或 null */
  async importSgfText(text: string): Promise<string | null> {
    try {
      const res = await fetch('/api/import-sgf', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: text,
      });
      const data = await res.json().catch(() => ({}));
      return res.ok ? null : String((data as { error?: unknown })?.error ?? '导入失败');
    } catch (e) {
      return String(e);
    }
  },
  toggleTerritory(): void {
    territoryView.value = !territoryView.value;
    socket?.emit('game:territory', territoryView.value);
  },
  toggleWinrate(): void {
    showWinrate.value = !showWinrate.value;
  },
  hint(): void {
    hintLoading.value = true;
    socket?.emit('game:hint');
    setTimeout(() => {
      hintLoading.value = false;
    }, 15000);
  },
  sendChat(text: string): void {
    socket?.emit('chat:send', text);
  },
  downloadSgf(): void {
    window.location.href = '/api/sgf';
  },
  toggleBgmMuted(): void {
    bgmMuted.value = !bgmMuted.value;
    if (bgmMuted.value) stopTriggerBgm(); // 静音时立即停止当前播放
    try {
      localStorage.setItem('bgmMuted', bgmMuted.value ? '1' : '0');
    } catch {
      // ignore
    }
  },
};
