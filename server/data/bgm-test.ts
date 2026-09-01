// 99% 胜率触发 BGM 测试（npx tsx server/data/bgm-test.ts 运行）
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
  async clearBoard(size: number) {
    this.size = size;
    this.used = new Set();
  }
  async applyDifficulty() {}
  async play(_c: number, v: string | null) {
    if (v) this.used.add(v);
  }
  async genmove(): Promise<string> {
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

/** 脚本化胜率队列（每次 query 消耗一个；tryAnalyze 每次 AI 走子调用 2 次） */
class WinrateAnalysis {
  isRunning = false;
  constructor(private q: number[]) {}
  async query(): Promise<{ rootInfo: { winrate: number; scoreLead: number } }> {
    const w = this.q.length ? this.q.shift()! : 0.5;
    return { rootInfo: { winrate: w, scoreLead: 0 } };
  }
}

async function run() {
  console.log('=== 人机模式：98.5% 触发 + 每方一次 ===');
  const triggers: number[] = [];
  const analysis = new WinrateAnalysis([0.984, 0.5, 0.985, 0.5, 0.015, 0.5, 0.985, 0.5]);
  const mgr = new GameManager(new MockGtp() as any, analysis as any, {
    onBgmTrigger: () => triggers.push(triggers.length + 1),
  });
  await mgr.startGame({ mode: 'ai', boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
  await mgr.humanPlay(3, 3); // 白(轮到方)胜率 98.4% → 未达阈值
  check('白 98.4%（未达阈值）不触发', triggers.length === 0, String(triggers.length));
  await mgr.humanPlay(5, 5); // 白 98.5% → 触发
  check('白方首次 98.5% 触发', triggers.length === 1, String(triggers.length));
  await mgr.humanPlay(6, 6); // 白 1.5% → 黑 98.5% → 触发
  check('黑方首次 98.5% 触发（每方一次）', triggers.length === 2, String(triggers.length));
  await mgr.humanPlay(7, 7); // 白再次 98.5% → 已触发过 → 不触发
  check('同方再次达标不重复触发', triggers.length === 2, String(triggers.length));

  console.log('=== 新对局重置标记 ===');
  const triggers2: number[] = [];
  const mgr2 = new GameManager(new MockGtp() as any, new WinrateAnalysis([0.985, 0.5]) as any, {
    onBgmTrigger: () => triggers2.push(1),
  });
  await mgr2.startGame({ mode: 'ai', boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
  await mgr2.humanPlay(3, 3); // 白 98.5% → 新对局可触发
  check('新对局重新可触发', triggers2.length === 1, String(triggers2.length));

  console.log('=== 复盘模式不触发 ===');
  const triggers3: number[] = [];
  const mgr3 = new GameManager(new MockGtp() as any, new WinrateAnalysis([0.985, 0.5]) as any, {
    onBgmTrigger: () => triggers3.push(1),
  });
  await mgr3.importSgf('(;GM[1]SZ[9]KM[5.5];B[dd];W[ee];B[gg])');
  await mgr3.reviewNext(); // 复盘里分析 0.5
  check('复盘不触发 BGM', triggers3.length === 0, String(triggers3.length));

  console.log('=== 双人模式同样触发 ===');
  const triggers4: number[] = [];
  const mgr4 = new GameManager(new MockGtp() as any, new WinrateAnalysis([0.985]) as any, {
    onBgmTrigger: () => triggers4.push(1),
  });
  await mgr4.startGame({ mode: 'local', boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
  await mgr4.humanPlay(3, 3); // 轮到白 → 白 98.5% → 触发
  check('双人模式触发', triggers4.length === 1, String(triggers4.length));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
