// AI 落子发言门槛：胜率突变 ≥15% 才发言
import { readFileSync, writeFileSync } from 'fs';

const A = 'C:/Users/guozi/.cline/data/workspaces/chat/heimiaozi-go/server/src/agent/agent.ts';
const I = 'C:/Users/guozi/.cline/data/workspaces/chat/heimiaozi-go/server/src/index.ts';

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

// ===== agent.ts =====
editFile(A, [
  [
    `  /** 用户对话滚动上下文：保留最近 20 轮（黑喵子落子台词不参与） */
  private history: ChatMessage[] = [];
  private static readonly HISTORY_TURNS = 20;`,
    `  /** 用户对话滚动上下文：保留最近 20 轮（黑喵子落子台词不参与） */
  private history: ChatMessage[] = [];
  private static readonly HISTORY_TURNS = 20;
  /** 上一次 AI 落子后的本喵方胜率（落子发言的胜率突变判定基准） */
  private lastAiMoveWinrate: number | null = null;
  /** 最近一手 AI 的本喵方胜率变化量（百分比，供台词引用） */
  private lastAiMoveSwing: number | null = null;`,
    'agent 字段',
  ],
  [
    `  /** 记录一轮对话（user+assistant），只保留最近 20 轮 */
  private pushHistory(userText: string, replyText: string): void {
    this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: replyText });
    const max = Agent.HISTORY_TURNS * 2;
    if (this.history.length > max) this.history = this.history.slice(this.history.length - max);
  }`,
    `  /** 记录一轮对话（user+assistant），只保留最近 20 轮 */
  private pushHistory(userText: string, replyText: string): void {
    this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: replyText });
    const max = Agent.HISTORY_TURNS * 2;
    if (this.history.length > max) this.history = this.history.slice(this.history.length - max);
  }

  /** 判定 AI 落子后是否发言：本喵方胜率较上一手 AI 变化 |Δ|≥15% 才发言；并更新基准 */
  shouldSpeakOnAiMove(evt: AiMoveEvent): boolean {
    // winrateAfter 为「轮到方(用户)」视角，换算为本喵方
    const catWr = evt.winrateAfter != null ? 1 - evt.winrateAfter : null;
    if (catWr == null) return false; // 分析缺失，跳过且不改基准
    const prev = this.lastAiMoveWinrate;
    this.lastAiMoveWinrate = catWr;
    this.lastAiMoveSwing = prev != null ? (catWr - prev) * 100 : null;
    if (prev == null) return false;
    return Math.abs(this.lastAiMoveSwing!) >= 15;
  }

  /** 新对局开始时重置落子发言基准 */
  resetAiMoveWinrate(): void {
    this.lastAiMoveWinrate = null;
    this.lastAiMoveSwing = null;
  }`,
    'shouldSpeakOnAiMove',
  ],
  [
    `    const event = evt.pass
      ? '本喵刚才选择停一手（Pass）'
      : \`本喵刚刚下了 \${(evt.vertex ?? '').toUpperCase()} 这手棋\`;
    const content = \`\${event}（\${wb} \${wa}）。\`;`,
    `    const event = evt.pass
      ? '本喵刚才选择停一手（Pass）'
      : \`本喵刚刚下了 \${(evt.vertex ?? '').toUpperCase()} 这手棋\`;
    const swingText = this.lastAiMoveSwing != null ? \`，本喵方胜率变化\${this.lastAiMoveSwing >= 0 ? '+' : ''}\${this.lastAiMoveSwing.toFixed(0)}%\` : '';
    const content = \`\${event}（\${wb} \${wa}\${swingText}）。\`;`,
    '台词加变化量',
  ],
]);

// ===== index.ts =====
editFile(I, [
  [
    `    onAiMoved: (evt) => {
      const msgId = randomUUID();
      io.emit('chat:start', { id: msgId, role: 'miaomiao' });
      agent.generateAiMoveLine(
        evt,
        (chunk) => io.emit('chat:delta', { id: msgId, chunk }),
        (full) => io.emit('chat:done', { id: msgId, full }),
      );
    },`,
    `    onAiMoved: (evt) => {
      // 仅在本喵方胜率较上一手 AI 变化 ≥15% 时才发言
      if (!agent.shouldSpeakOnAiMove(evt)) return;
      const msgId = randomUUID();
      io.emit('chat:start', { id: msgId, role: 'miaomiao' });
      agent.generateAiMoveLine(
        evt,
        (chunk) => io.emit('chat:delta', { id: msgId, chunk }),
        (full) => io.emit('chat:done', { id: msgId, full }),
      );
    },`,
    'onAiMoved 发言门槛',
  ],
  [
    `      try {
        await manager.startGame(normalizeSettings(settings));
      } catch (e) {
        socket.emit('error', \`开局失败: \${(e as Error).message}\`);
      }`,
    `      try {
        agent.resetAiMoveWinrate(); // 新对局重置落子发言基准
        await manager.startGame(normalizeSettings(settings));
      } catch (e) {
        socket.emit('error', \`开局失败: \${(e as Error).message}\`);
      }`,
    'game:start 重置基准',
  ],
]);
console.log('全部完成');
