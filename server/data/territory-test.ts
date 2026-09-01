// 领地热力图 ownership 归一化测试（npx tsx server/data/territory-test.ts 运行）
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
class MockAnalysis {
  ownership: number[] = [];
  async query() {
    return { ownership: this.ownership, rootInfo: { winrate: 0.6, scoreLead: 2 } };
  }
}

async function run() {
  const analysis = new MockAnalysis();
  analysis.ownership = [0.8, -0.5, 0.2, -0.9, 0.7, -0.1, 0.3, -0.6, 0.4];
  const mgr = new GameManager(new MockGtp() as any, analysis as any, {});
  await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);

  console.log('=== SIDETOMOVE 视角归一化为"正值=黑方" ===');
  // 轮到白（AI）：ownership 正值=白方 → 应取反
  (mgr as any).state.currentPlayer = WHITE;
  const t1 = await mgr.requestTerritory();
  check('轮到白：0.8(白) → -0.8(黑负)', t1 !== null && t1[0] === -0.8 && t1[1] === 0.5, String(t1));
  check('轮到白：-0.9(黑) → +0.9', t1 !== null && t1[3] === 0.9, String(t1));

  // 轮到黑：ownership 正值已是黑方 → 保持
  (mgr as any).state.currentPlayer = BLACK;
  const t2 = await mgr.requestTerritory();
  check('轮到黑：保持正值=黑', t2 !== null && t2[0] === 0.8 && t2[1] === -0.5 && t2[3] === -0.9, String(t2));

  // 无 ownership → null
  (analysis as any).ownership = undefined;
  const t3 = await mgr.requestTerritory();
  check('无 ownership 返回 null', t3 === null, String(t3));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
