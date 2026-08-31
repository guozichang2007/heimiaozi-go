// AI 落子发言门槛测试（npx tsx server/data/agent-speak-test.ts 运行）
import { Agent } from '../src/agent/agent';
import { GameManager } from '../src/game/gameManager';
import { BLACK, WHITE } from '../src/game/goban';
import { AiMoveEvent } from '../src/game/gameManager';

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
class MockClient {
  calls: any[] = [];
  async chat(opts: any) {
    this.calls.push(opts);
    if (opts.stream) {
      const content = '喵喵哒';
      opts.onDelta?.(content);
      return { content, toolCalls: [] };
    }
    return { content: '喵~', toolCalls: [] };
  }
}

function evt(wb: number | null, wa: number | null): AiMoveEvent {
  return { aiColor: WHITE, vertex: 'D8', pass: false, winrateBefore: wb, winrateAfter: wa, scoreLeadAfter: null };
}

async function run() {
  const mgr = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
  const client = new MockClient();
  const agent = new Agent(mgr, client as any);

  console.log('=== 发言判定（本喵方胜率换算 + 8% 阈值） ===');
  check('第一手（无基准）→ 发言', agent.shouldSpeakOnAiMove(evt(0.5, 0.5)) === true);
  // winrateAfter 0.45 → 本喵方 0.55，较上基准 0.50 变化 +5%
  check('小幅 +5% → 不发言', agent.shouldSpeakOnAiMove(evt(0.5, 0.45)) === false);
  // winrateAfter 0.35 → 本喵方 0.65，较 0.55 变化 +10%（>8% → 发言）
  check('大涨 +10% → 发言', agent.shouldSpeakOnAiMove(evt(0.55, 0.35)) === true);
  // winrateAfter 0.90 → 本喵方 0.10，较 0.65 变化 -55%
  check('大跌 -55% → 发言', agent.shouldSpeakOnAiMove(evt(0.65, 0.9)) === true);

  console.log('=== 发言时台词带胜率提升/减少量 ===');
  {
    await agent.generateAiMoveLine(evt(0.65, 0.9), () => {}, () => {});
    const last = client.calls[client.calls.length - 1];
    const userContent = String(last.messages[last.messages.length - 1].content);
    check('台词包含「本手本喵方胜率减少55%」', userContent.includes('本手本喵方胜率减少55%'), userContent.slice(-60));
  }

  console.log('=== 重置基准（新对局） ===');
  {
    agent.resetAiMoveWinrate();
    check('重置后第一手 → 发言', agent.shouldSpeakOnAiMove(evt(0.5, 0.5)) === true);
    check('重置后小幅波动仍不发言', agent.shouldSpeakOnAiMove(evt(0.5, 0.48)) === false);
  }

  console.log('=== 分析缺失（winrateAfter=null）不发言且不改基准 ===');
  {
    agent.resetAiMoveWinrate();
    check('缺分析 → 不发言', agent.shouldSpeakOnAiMove(evt(null, null)) === false);
    check('基准未被污染（下一手视为第一手）→ 发言', agent.shouldSpeakOnAiMove(evt(0.5, 0.5)) === true);
    check('再下一手 +16% → 发言', agent.shouldSpeakOnAiMove(evt(0.5, 0.34)) === true);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
