// 复盘（SGF 导入 + 虚影 + 自由推演）测试（npx tsx server/data/review-test.ts 运行）
import { GameManager } from '../src/game/gameManager';
import { buildSgf } from '../src/sgf';
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
  console.log('=== 往返：本地对局导出 SGF → 导入复盘 ===');
  const mgrA = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  await mgrA.startGame(localSettings as any);
  await mgrA.humanPlay(3, 3); // 黑
  await mgrA.humanPlay(3, 5); // 白
  await mgrA.humanPlay(5, 3); // 黑
  await mgrA.humanPlay(5, 5); // 白
  await mgrA.humanPlay(7, 7); // 黑
  const sgfText = buildSgf(mgrA.getMoves(), mgrA.getSettings()!, null);

  const mgrB = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  let s = mgrB.getState();
  mgrB.events = { onState: (st) => (s = st) };
  check('导入成功', (await mgrB.importSgf(sgfText)) === true);
  check('复盘激活，total=5 index=0', s.review !== null && s.review.total === 5 && s.review.index === 0, JSON.stringify(s.review));
  check('虚影=第1手黑(3,3)', s.review?.ghost?.color === BLACK && s.review?.ghost?.x === 3 && s.review?.ghost?.y === 3, JSON.stringify(s.review?.ghost));
  check('轮到黑', s.currentPlayer === BLACK, String(s.currentPlayer));
  check('空盘开始', s.moveCount === 0, String(s.moveCount));

  console.log('=== 下一手/上一手导航 ===');
  check('下一手成功', (await mgrB.reviewNext()) === true);
  check('index=1 手数=1 虚影=白(3,5)', s.review?.index === 1 && s.moveCount === 1 && s.review?.ghost?.x === 3 && s.review?.ghost?.y === 5, JSON.stringify(s.review));
  check('轮到白', s.currentPlayer === WHITE, String(s.currentPlayer));
  for (let i = 0; i < 4; i++) await mgrB.reviewNext();
  check('走完记录 index=5 无虚影', s.review?.index === 5 && s.moveCount === 5 && s.review?.ghost === null, JSON.stringify(s.review));
  check('记录走完不能下一手', (await mgrB.reviewNext()) === false);
  check('上一手成功', (await mgrB.reviewPrev()) === true);
  check('回退 index=4 虚影=黑(7,7)', s.review?.index === 4 && s.review?.ghost?.x === 7 && s.review?.ghost?.y === 7, JSON.stringify(s.review));

  console.log('=== 虚影处落子 = 下一手 ===');
  const mgrC = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  let sc = mgrC.getState();
  mgrC.events = { onState: (st) => (sc = st) };
  await mgrC.importSgf(sgfText);
  check('点在虚影(3,3)触发下一手', (await mgrC.humanPlay(3, 3)) === true);
  check('前进到第2手', sc.review?.index === 1 && sc.moveCount === 1, JSON.stringify(sc.review));

  console.log('=== 自由推演 ===');
  const mgrD = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  let sd = mgrD.getState();
  mgrD.events = { onState: (st) => (sd = st) };
  await mgrD.importSgf(sgfText);
  check('下非虚影处(6,6) → 自由推演', (await mgrD.humanPlay(6, 6)) === true);
  check('deviated=true 虚影消失', sd.review?.deviated === true && sd.review?.ghost === null, JSON.stringify(sd.review));
  await mgrD.humanPlay(7, 7);
  check('自由推演中下一手被拒', (await mgrD.reviewNext()) === false);
  check('悔棋撤1手', (await mgrD.undo()) === true && sd.moveCount === 1, String(sd.moveCount));
  check('仍在自由推演', sd.review?.deviated === true, JSON.stringify(sd.review));
  check('悔棋撤到记录位置 → 退出自由推演', (await mgrD.undo()) === true);
  check('恢复严格回放 虚影回来', sd.review?.deviated === false && sd.review?.ghost?.x === 3 && sd.review?.ghost?.y === 3, JSON.stringify(sd.review));
  // 再次偏离 → 上一手跳回记录位置
  await mgrD.humanPlay(6, 6);
  await mgrD.humanPlay(7, 7);
  await mgrD.humanPlay(8, 8);
  check('再次自由推演 3 手', sd.review?.deviated === true && sd.moveCount === 3, `${sd.review?.deviated}/${sd.moveCount}`);
  check('上一手直接跳回记录位置', (await mgrD.reviewPrev()) === true);
  check('跳回后 moveCount=0 退出偏离', sd.moveCount === 0 && sd.review?.deviated === false, `${sd.moveCount}/${sd.review?.deviated}`);

  console.log('=== 结束复盘 / 解析失败 / 让子 AB ===');
  check('结束复盘', (await mgrD.endReview()) === true);
  check('review 置空，仍是双人模式', sd.review === null && sd.settings?.mode === 'local', JSON.stringify(sd.settings));
  let threw = false;
  try {
    await mgrD.importSgf('not-a-sgf-file');
  } catch {
    threw = true;
  }
  check('非法 SGF 抛错', threw);
  const mgrE = new GameManager(new MockGtp() as any, new MockAnalysis() as any);
  let se = mgrE.getState();
  mgrE.events = { onState: (st) => (se = st) };
  // 让子局：AB 预置黑(3,3)(6,6)，主变白(4,4) 黑(2,2)
  await mgrE.importSgf('(;GM[1]SZ[9]KM[0]AB[dd][gg];W[ee];B[cc])');
  check('让子 AB 预置', se.grid[3 * 9 + 3] === BLACK && se.grid[6 * 9 + 6] === BLACK, '');
  check('首手为白(4,4) 虚影正确', se.review?.ghost?.color === WHITE && se.review?.ghost?.x === 4 && se.review?.ghost?.y === 4, JSON.stringify(se.review?.ghost));
  check('轮到白', se.currentPlayer === WHITE, String(se.currentPlayer));
  check('下一手落白(4,4)', (await mgrE.reviewNext()) === true && se.grid[4 * 9 + 4] === WHITE);

  console.log('=== 复盘每手刷新实时胜率 ===');
  const mgrF = new GameManager(new MockGtp() as any, new WinrateAnalysis([0.6, 0.55, 0.58, 0.61]) as any);
  let sf = mgrF.getState();
  mgrF.events = { onState: (st) => (sf = st) };
  await mgrF.importSgf(sgfText);
  check('导入后初始胜率 60%', sf.winrate != null && Math.abs(sf.winrate - 0.6) < 1e-9, String(sf.winrate));
  await mgrF.reviewNext();
  check('下一手后胜率 55%', sf.winrate != null && Math.abs(sf.winrate - 0.55) < 1e-9, String(sf.winrate));
  await mgrF.reviewNext();
  check('再下一手后胜率 58%', sf.winrate != null && Math.abs(sf.winrate - 0.58) < 1e-9, String(sf.winrate));
  await mgrF.reviewPrev();
  check('上一手后胜率刷新 61%', sf.winrate != null && Math.abs(sf.winrate - 0.61) < 1e-9, String(sf.winrate));

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
