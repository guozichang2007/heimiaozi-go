// 双人模式（线下真人对弈）测试（npx tsx server/data/local-mode-test.ts 运行）
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
  private used = new Set<string>();
  private size = 9;
  genmoveCalls = 0;
  async clearBoard(size: number) {
    this.size = size;
    this.used = new Set();
  }
  async applyDifficulty() {}
  async play(_c: number, v: string | null) {
    if (v) this.used.add(v);
  }
  async genmove(): Promise<string> {
    this.genmoveCalls++;
    for (let n = 0; n < this.size * this.size; n++) {
      const row = Math.floor(n / this.size) + 1;
      const col = n % this.size;
      const letter = String.fromCharCode(65 + (col >= 8 ? col + 1 : col));
      const v = letter + row;
      if (!this.used.has(v)) {
        this.used.add(v);
        return v;
      }
    }
    return 'pass';
  }
}
class MockAnalysis {
  isRunning = false;
  async query() {
    throw new Error('analysis off');
  }
}
class MockClient {
  calls: { messages: any[]; stream: boolean }[] = [];
  async chat(opts: any) {
    this.calls.push({ messages: opts.messages, stream: !!opts.stream });
    return { content: '喵~', toolCalls: [] };
  }
}

/** 返回脚本化胜率的分析 mock（模拟真实 KataGo 分析） */
class WinrateAnalysis {
  isRunning = false;
  constructor(private q: number[]) {}
  async query(): Promise<{ rootInfo: { winrate: number; scoreLead: number } }> {
    const w = this.q.length ? this.q.shift()! : 0.5;
    return { rootInfo: { winrate: w, scoreLead: 0 } };
  }
}

const localSettings = {
  mode: 'local',
  boardSize: 9,
  komi: 5.5,
  handicap: 0,
  difficulty: 'hard',
  humanColor: BLACK,
  aiColor: WHITE,
};

async function run() {
  console.log('=== 开局：双人模式，无 AI 自动应手 ===');
  const gtp = new MockGtp();
  const mgr = new GameManager(gtp as any, new MockAnalysis() as any);
  let s = mgr.getState();
  mgr.events = { onState: (st) => (s = st) };
  await mgr.startGame(localSettings as any);
  check('直接进入 playing', s.phase === 'playing', s.phase);
  check('黑先', s.currentPlayer === BLACK, String(s.currentPlayer));
  check('AI 未 genmove', gtp.genmoveCalls === 0, String(gtp.genmoveCalls));

  console.log('=== 黑白轮流落子 ===');
  check('黑落子成功', (await mgr.humanPlay(3, 3)) === true);
  check('轮到白', s.currentPlayer === WHITE, String(s.currentPlayer));
  check('黑落子后无 AI 应手', gtp.genmoveCalls === 0, String(gtp.genmoveCalls));
  check('白落子成功', (await mgr.humanPlay(5, 5)) === true);
  check('轮到黑', s.currentPlayer === BLACK, String(s.currentPlayer));
  check('白落子后仍无 AI 应手', gtp.genmoveCalls === 0, String(gtp.genmoveCalls));

  console.log('=== 悔棋：撤 1 手 ===');
  check('悔棋成功', (await mgr.undo()) === true);
  check('撤到 1 手', s.moveCount === 1, String(s.moveCount));
  check('回到白方回合', s.currentPlayer === WHITE, String(s.currentPlayer));

  console.log('=== 双 Pass 进数子 ===');
  await mgr.humanPass(); // 白停
  check('白停后轮到黑', s.currentPlayer === BLACK, String(s.currentPlayer));
  await mgr.humanPass(); // 黑停
  check('进入数子', s.phase === 'scoring', s.phase);
  await mgr.finishScoring();
  check('结算结束', s.phase === 'over' && !!s.result, `${s.phase}`);

  console.log('=== 认输 = 当前回合方认输 ===');
  const mgr2 = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  let s2 = mgr2.getState();
  mgr2.events = { onState: (st) => (s2 = st) };
  await mgr2.startGame(localSettings as any);
  await mgr2.humanPlay(3, 3); // 黑落子 → 轮到白
  check('白回合认输', (await mgr2.resign()) === true);
  check('黑胜（白认输）', s2.result?.winner === BLACK && s2.result?.reason === 'resign', JSON.stringify(s2.result));

  const mgr3 = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  let s3 = mgr3.getState();
  mgr3.events = { onState: (st) => (s3 = st) };
  await mgr3.startGame(localSettings as any); // 轮到黑
  check('黑回合认输', (await mgr3.resign()) === true);
  check('白胜（黑认输）', s3.result?.winner === WHITE && s3.result?.reason === 'resign', JSON.stringify(s3.result));

  console.log('=== 提示 / 地盘可用（不崩） ===');
  const gtp4 = new MockGtp();
  const mgr4 = new GameManager(gtp4 as any, new MockAnalysis() as any);
  let s4 = mgr4.getState();
  mgr4.events = { onState: (st) => (s4 = st) };
  await mgr4.startGame(localSettings as any);
  await mgr4.humanPlay(3, 3);
  const terr = await mgr4.requestTerritory();
  check('查看地盘调用不抛错', terr === null, String(terr));
  const hint = await mgr4.requestHint();
  check('提示调用不抛错', hint === false, String(hint));
  // 双 Pass → 数子 → 结束 → 回到棋盘
  await mgr4.humanPass(); // 白停 → 黑
  await mgr4.humanPass(); // 黑停 → 数子
  await mgr4.finishScoring();
  check('回到棋盘可用', (await mgr4.reopenBoard()) === true);
  check('回到棋盘后恢复 playing', s4.phase === 'playing', s4.phase);
  check('回到棋盘不触发 AI', gtp4.genmoveCalls === 0, String(gtp4.genmoveCalls));

  console.log('=== 黑喵子聊天 = 未开局状态 ===');
  const mgr5 = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  await mgr5.startGame(localSettings as any);
  const client = new MockClient();
  const agent = new Agent(mgr5, client as any);
  await agent.handleUserMessage('你好', () => {}, () => {});
  const sys = String(client.calls[0].messages[0].content);
  check('首句含"新对局尚未开始"', sys.includes('新对局尚未开始'), sys.slice(0, 60));
  check('上下文含"对局尚未开始"', sys.includes('对局尚未开始'), '');
  check('不包含棋盘信息', !sys.includes('轮到'), '');

  console.log('=== 双人模式实时胜率更新 ===');
  const mgr6 = new GameManager(new MockGtp() as any, new WinrateAnalysis([0.6, 0.55, 0.58]) as any);
  let s6 = mgr6.getState();
  mgr6.events = { onState: (st) => (s6 = st) };
  await mgr6.startGame(localSettings as any);
  check('开局即显示初始胜率 60%', s6.winrate != null && Math.abs(s6.winrate - 0.6) < 1e-9, String(s6.winrate));
  await mgr6.humanPlay(3, 3);
  check('落子后胜率更新为 55%', s6.winrate != null && Math.abs(s6.winrate - 0.55) < 1e-9, String(s6.winrate));
  await mgr6.humanPlay(5, 5);
  check('再落子后胜率更新为 58%', s6.winrate != null && Math.abs(s6.winrate - 0.58) < 1e-9, String(s6.winrate));
  await mgr6.humanPlay(6, 6);
  check('AI 仍不 genmove', (mgr6 as any).gtp.genmoveCalls === 0, String((mgr6 as any).gtp.genmoveCalls));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
