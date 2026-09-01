// 玩家胜率大跌触发电击事件测试（npx tsx server/data/shock-trigger-test.ts 运行）
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
  async play(_color: number, vertex: string | null) {
    if (vertex) this.used.add(vertex);
  }
  async genmove(): Promise<string> {
    for (let n = 0; n < this.size * this.size; n++) {
      const row = Math.floor(n / this.size) + 1;
      const col = n % this.size;
      const letter = String.fromCharCode(65 + (col >= 8 ? col + 1 : col)); // 跳过 I
      const v = letter + row;
      if (!this.used.has(v)) {
        this.used.add(v);
        return v;
      }
    }
    return 'pass';
  }
}

/** 按队列吐出 winrate（每次 query 消耗一个；tryAnalyze 每次 AI 走子调用 2 次） */
class MockAnalysis {
  isRunning = false;
  constructor(private queue: number[]) {}
  async query(): Promise<{ rootInfo: { winrate: number | null; scoreLead: number | null } }> {
    const winrate = this.queue.length ? this.queue.shift()! : 0.5;
    return { rootInfo: { winrate, scoreLead: 0 } };
  }
}

async function run() {
  // 队列：aiMove1 before/after, aiMove2 before/after, aiMove3 before/after, aiMove4 before/after
  // 玩家胜率 = 1 - before：0.5→50%(基准), 0.6→40%(跌10%), 0.5→50%(升), 0.65→35%(跌15%)
  const analysis = new MockAnalysis([0.5, 0.5, 0.6, 0.5, 0.5, 0.5, 0.65, 0.5]);
  const drops: number[] = [];
  const mgr = new GameManager(new MockGtp() as any, analysis as any, {
    onPlayerDropShock: (drop) => drops.push(Number(drop.toFixed(1))),
  });
  await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);

  console.log('=== 逐手触发判定 ===');
  await mgr.humanPlay(3, 3); // 第1手：建档，不触发
  check('第1手（无基准）不触发', drops.length === 0, String(drops.length));
  await mgr.humanPlay(5, 5); // 第2手：玩家胜率跌 10% → 触发
  check('跌 10% → 触发 1 次', drops.length === 1, String(drops.length));
  check('跌幅值 ≈10', drops[0] >= 9.9 && drops[0] <= 10.1, String(drops[0]));
  await mgr.humanPlay(6, 6); // 第3手：玩家胜率回升 → 不触发
  check('胜率回升不触发', drops.length === 1, String(drops.length));
  await mgr.humanPlay(7, 7); // 第4手：再跌 15% → 触发
  check('跌 15% → 触发 2 次', drops.length === 2, String(drops.length));
  check('跌幅值 ≈15', drops[1] >= 14.9 && drops[1] <= 15.1, String(drops[1]));

  console.log('=== Pass 不触发 ===');
  await mgr.humanPass();
  check('玩家 Pass 不触发', drops.length === 2, String(drops.length));

  console.log('=== 新对局重置基准 ===');
  const analysis2 = new MockAnalysis([0.5, 0.5, 0.6, 0.5]);
  const drops2: number[] = [];
  const mgr2 = new GameManager(new MockGtp() as any, analysis2 as any, {
    onPlayerDropShock: (drop) => drops2.push(Number(drop.toFixed(1))),
  });
  await mgr2.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
  await mgr2.humanPlay(3, 3);
  check('新对局第1手不触发', drops2.length === 0, String(drops2.length));
  await mgr2.humanPlay(5, 5);
  check('新对局第2手跌10%触发', drops2.length === 1, String(drops2.length));

  console.log('=== 悔棋重置基准 ===');
  const mgr3 = new GameManager(new MockGtp() as any, new MockAnalysis([0.5, 0.5, 0.6, 0.5, 0.7, 0.5]) as any, {});
  await mgr3.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
  await mgr3.humanPlay(3, 3);
  await mgr3.undo(); // 悔棋后基准作废
  const drops3: number[] = [];
  mgr3.events = { onPlayerDropShock: (d) => drops3.push(d) };
  await mgr3.humanPlay(5, 5); // 悔棋后第一手 → 建档不触发
  check('悔棋后第1手不触发', drops3.length === 0, String(drops3.length));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
