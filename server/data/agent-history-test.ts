// 对话上下文（20 轮滚动历史）测试（npx tsx server/data/agent-history-test.ts 运行）
import { Agent } from '../src/agent/agent';
import { GameManager } from '../src/game/gameManager';
import { BLACK, WHITE } from '../src/game/goban';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

class MockGtp {
  private size = 19;
  async clearBoard(size: number) {
    this.size = size;
  }
  async applyDifficulty() {}
  async play() {}
  async genmove(): Promise<string> {
    return this.size === 9 ? 'E5' : 'K10';
  }
}
class MockAnalysis {
  isRunning = false;
  async query() {
    throw new Error('off');
  }
}

/** 记录每次 chat 调用；流式返回一段内容 */
class MockClient {
  calls: { messages: any[]; stream: boolean }[] = [];
  async chat(opts: any) {
    this.calls.push({ messages: opts.messages, stream: !!opts.stream });
    if (opts.stream) {
      const last = opts.messages[opts.messages.length - 1];
      const content = `喵，回「${String(last?.content ?? '').slice(0, 8)}」`;
      opts.onDelta?.(content);
      return { content, toolCalls: [] };
    }
    return { content: '喵~', toolCalls: [] };
  }
}

async function run() {
  const mgr = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
  const client = new MockClient();
  const agent = new Agent(mgr, client as any);

  console.log('=== 历史逐轮累积 ===');
  {
    await agent.handleUserMessage('你好', () => {}, () => {});
    check('第1条请求只有 system+user', client.calls[0].messages.length === 2, String(client.calls[0].messages.length));
    await agent.handleUserMessage('吃了吗', () => {}, () => {});
    const m2 = client.calls[1].messages;
    check('第2条带上前一轮（4条）', m2.length === 4, String(m2.length));
    check('前一轮 user 在历史里', m2[1].role === 'user' && m2[1].content === '你好', JSON.stringify(m2[1]));
    check('前一轮 assistant 在历史里', m2[2].role === 'assistant' && m2[2].content === '喵~', JSON.stringify(m2[2]));
    check('当前 user 在末尾', m2[3].role === 'user' && m2[3].content === '吃了吗', JSON.stringify(m2[3]));
  }

  console.log('=== 关键词快路径也带历史 ===');
  {
    await agent.handleUserMessage('帮我悔棋', () => {}, () => {});
    const m3 = client.calls[client.calls.length - 1].messages;
    // system + 2轮历史(4条) + 当前user + assistant(tool) + tool = 8 条
    check('含历史+当前user+tool 结构（8条）', m3.length === 8, `len=${m3.length}`);
    check('第一条历史在 m3[1]', m3[1].role === 'user' && m3[1].content === '你好', JSON.stringify(m3[1]));
    const roles = m3.map((m: any) => m.role).join(',');
    check('结构为 system,history,user,assistant(tool),tool', roles === 'system,user,assistant,user,assistant,user,assistant,tool', roles);
  }

  console.log('=== 上限 20 轮（40 条） ===');
  {
    for (let i = 0; i < 24; i++) await agent.handleUserMessage(`消息${i}`, () => {}, () => {});
    const m = client.calls[client.calls.length - 1].messages;
    check('system+40条历史+当前user=42', m.length === 42, String(m.length));
    check('最早的一轮已被截断', !m.some((x: any) => x.content === '你好'), '');
    check('最近一轮保留', m[m.length - 1].content === '消息23', String(m[m.length - 1].content));
  }

  console.log('=== 落子台词带 20 轮上下文 ===');
  {
    const before = client.calls.length;
    await agent.generateAiMoveLine(
      { aiColor: WHITE, vertex: 'D8', pass: false, winrateBefore: 0.5, winrateAfter: 0.6 },
      () => {},
      () => {},
    );
    const m = client.calls[client.calls.length - 1].messages;
    // system + 40条历史 + 台词user = 42
    check('台词带 20 轮上下文（42条）', m.length === 42, String(m.length));
    check('历史位于 system 与当前 prompt 之间', m[1].role === 'user' && String(m[1].content).startsWith('消息'), JSON.stringify(m[1]).slice(0, 40));
    check('台词 prompt 在末尾', m[m.length - 1].role === 'user' && String(m[m.length - 1].content).startsWith('请以黑喵子的口吻'), String(m[m.length - 1].content).slice(0, 20));
    check('确实发生了调用', client.calls.length === before + 1, String(client.calls.length - before));
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
