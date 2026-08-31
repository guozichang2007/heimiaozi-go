// 棋局上下文 getBoardSummary 测试（npx tsx server/data/board-summary-test.ts 运行）
import { GameManager } from '../src/game/gameManager';
import { Executor } from '../src/agent/executor';
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
  logs: string[] = [];
  genmoveCalls = 0;
  private size = 19;
  async clearBoard(size: number, _komi: number) {
    this.size = size;
  }
  async applyDifficulty() {}
  async play(_color: number, _vertex: string | null) {}
  async genmove(_color: number): Promise<string> {
    this.genmoveCalls++;
    return this.size === 9 ? 'E5' : 'K10';
  }
}
class MockAnalysis {
  isRunning = false;
  async query() {
    throw new Error('off');
  }
}
function mkMgr() {
  return new GameManager(new MockGtp() as any, new MockAnalysis() as any);
}

async function run() {
  console.log('=== 轮到用户：胜率/目差换算为"本喵方" ===');
  {
    const mgr = mkMgr();
    const ex = new Executor(mgr);
    await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
    await mgr.humanPlay(3, 3); // 用户黑 D6 → 本喵白 E5 → 轮到用户
    // 分析引擎报"轮到方"视角：用户胜率80%、领先5目
    (mgr as any).state.winrate = 0.8;
    (mgr as any).state.scoreLead = 5.0;
    const summary = await ex.getBoardSummary();
    console.log('  输出:', summary);
    check('轮到用户（执黑子）', summary.includes('轮到用户（执黑子）'));
    check('本喵方胜率约20%', summary.includes('本喵方胜率约20%'), summary);
    check('本喵方目差约-5.0目', summary.includes('目差约-5.0目'), summary);
    check('不含难度/贴目/盘面子数', !summary.includes('难度') && !summary.includes('贴目') && !summary.includes('盘面'));
    check('含最近几手', summary.includes('黑 D6 → 白 E5'), summary);
  }

  console.log('=== 轮到本喵：直接采用轮到方视角 ===');
  {
    const mgr = mkMgr();
    const ex = new Executor(mgr);
    await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
    await mgr.humanPlay(3, 3);
    (mgr as any).state.currentPlayer = WHITE; // 模拟轮到本喵
    (mgr as any).state.winrate = 0.65; // 轮到方=本喵 → 65%
    (mgr as any).state.scoreLead = 3.2; // 本喵 +3.2
    const summary = await ex.getBoardSummary();
    console.log('  输出:', summary);
    check('轮到本喵（执白子）', summary.includes('轮到本喵（执白子）'));
    check('本喵方胜率约65%', summary.includes('本喵方胜率约65%'), summary);
    check('本喵方目差约+3.2目', summary.includes('目差约+3.2目'), summary);
  }

  console.log('=== 未开局 ===');
  {
    const ex = new Executor(mkMgr());
    const summary = await ex.getBoardSummary();
    check('提示未开始', summary.includes('对局尚未开始'), summary);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
