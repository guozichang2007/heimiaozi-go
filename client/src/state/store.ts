import { signal } from '@preact/signals';
import { io, Socket } from 'socket.io-client';

export type Phase = 'setup' | 'playing' | 'scoring' | 'over';
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
  hintMoves: string[];
  winrate: number | null;
  scoreLead: number | null;
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
  winrate: null,
  scoreLead: null,
  consecutivePasses: 0,
});

export const chatMessages = signal<ChatMsg[]>([]);
export const serverConfig = signal<ServerConfig>({ deepseekEnabled: false, engineBackend: '', engineReady: false });
export const territoryView = signal(false);
export const showWinrate = signal(true);
export const hintLoading = signal(false);
export const connected = signal(false);
export const lastError = signal('');

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
};
