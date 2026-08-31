// 对话上下文 agent.ts 第1部分：字段 + 方法 + 快路径 + 路由注入
import { readFileSync, writeFileSync } from 'fs';

const P = 'C:/Users/guozi/.cline/data/workspaces/chat/heimiaozi-go/server/src/agent/agent.ts';
let t = readFileSync(P, 'utf8').replace(/\r\n/g, '\n');
let ok = true;
function edit(anchor, replacement, label) {
  if (t.includes(anchor)) {
    t = t.replace(anchor, replacement);
    console.log(`[OK] ${label}`);
  } else {
    console.log(`[失败] ${label}`);
    ok = false;
  }
}

edit(
  `export class Agent {
  private executor: Executor;
  private client: DeepSeekClient | null;`,
  `export class Agent {
  private executor: Executor;
  private client: DeepSeekClient | null;
  /** 用户对话滚动上下文：保留最近 20 轮（黑喵子落子台词不参与） */
  private history: ChatMessage[] = [];
  private static readonly HISTORY_TURNS = 20;`,
  '历史字段',
);

edit(
  `  private systemWithContext(): Promise<string> {
    return this.executor.getBoardSummary().then((ctx) => systemPrompt() + contextHeader(ctx));
  }`,
  `  private systemWithContext(): Promise<string> {
    return this.executor.getBoardSummary().then((ctx) => systemPrompt() + contextHeader(ctx));
  }

  /** 把滚动对话历史插入 system（第一条消息）之后 */
  private withHistory(msgs: ChatMessage[]): ChatMessage[] {
    if (!this.history.length) return msgs;
    return [...msgs.slice(0, 1), ...this.history, ...msgs.slice(1)];
  }

  /** 记录一轮对话（user+assistant），只保留最近 20 轮 */
  private pushHistory(userText: string, replyText: string): void {
    this.history.push({ role: 'user', content: userText }, { role: 'assistant', content: replyText });
    const max = Agent.HISTORY_TURNS * 2;
    if (this.history.length > max) this.history = this.history.slice(this.history.length - max);
  }`,
  'withHistory/pushHistory',
);

edit(
  `    if (fast?.type === 'game_action') {
      const result = await this.executor.doAction(fast.action);
      await this.streamReply(buildToolResultMessages(system, text, 'do_game_action', result), onDelta, onDone, 120);
      return;
    }
    if (fast?.type === 'help_move') {
      const result = await this.executor.getBestMoveAdvice();
      await this.streamReply(
        [{ role: 'system', content: adviceSystem(system, result) }, { role: 'user', content: text }],
        onDelta,
        onDone,
        220,
        0.7,
      );
      return;
    }`,
  `    if (fast?.type === 'game_action') {
      const result = await this.executor.doAction(fast.action);
      const reply = await this.streamReply(this.withHistory(buildToolResultMessages(system, text, 'do_game_action', result)), onDelta, onDone, 120);
      this.pushHistory(text, reply);
      return;
    }
    if (fast?.type === 'help_move') {
      const result = await this.executor.getBestMoveAdvice();
      const reply = await this.streamReply(
        this.withHistory([{ role: 'system', content: adviceSystem(system, result) }, { role: 'user', content: text }]),
        onDelta,
        onDone,
        220,
        0.7,
      );
      this.pushHistory(text, reply);
      return;
    }`,
  '快路径分支',
);

edit(
  `        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        tools: TOOLS,`,
  `        messages: this.withHistory([{ role: 'system', content: system }, { role: 'user', content: text }]),
        tools: TOOLS,`,
  'LLM 路由注入',
);

if (ok) {
  writeFileSync(P, t, 'utf8');
  console.log('第1部分完成');
} else {
  console.log('有失败项，未写入');
  process.exit(1);
}
