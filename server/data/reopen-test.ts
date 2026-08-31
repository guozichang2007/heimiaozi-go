// 回到棋盘 reopenBoard 测试（npx tsx server/data/reopen-test.ts 运行）
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
  genmoveCalls = 0;
  async clearBoard(size: number) {
    this.size = size;
  }
  async applyDifficulty() {}
  async play() {}
  async genmove(): Promise<string> {
    this.genmoveCalls++;
    return this.size === 9 ? 'E5' : 'K10';
  }
}
class MockAnalysis {
  isRunning = false;
  async query() {
    throw new Error('analysis off');
  }
}

async function run() {
  const gtp = new MockGtp();
  const mgr = new GameManager(gtp as any, new MockAnalysis() as any);
  let s = mgr.getState();
  mgr.events = { onState: (st) => (s = st) };

  await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);

  console.log('=== 正常走到数子结算完成 ===');
  {
    await mgr.humanPlay(3, 3); // 黑 D6 → AI 白 E5
    check('对局进行中', s.phase === 'playing' && s.moveCount === 2, `${s.phase}/${s.moveCount}`);
    await mgr.humanPass(); // 黑停 → AI 白 E5 已占 → AI 也停 → 数子
    check('进入数子阶段', s.phase === 'scoring', s.phase);
    const result = await mgr.finishScoring();
    check('结算完成、对局结束', s.phase === 'over' && !!result, `${s.phase}/${!!result}`);
    check('结果里有胜负', s.result !== null && !!s.result.winner, String(s.result?.winner));
  }

  console.log('=== 回到棋盘 ===');
  {
    check('回到棋盘成功', (await mgr.reopenBoard()) === true);
    check('恢复为对弈态 playing', s.phase === 'playing', s.phase);
    check('结果已清空', s.result === null, String(s.result));
    check('连续停手计数已重置', s.consecutivePasses === 0, String(s.consecutivePasses));
    check('死子标记已清空', s.deadStones.length === 0, String(s.deadStones.length));
    check('棋盘保留终局局面', s.moveCount === 4 && s.grid[3 * 9 + 3] === BLACK, `${s.moveCount}`);
  }

  console.log('=== 回到棋盘后功能正常 ===');
  {
    // 悔棋（撤掉 AI pass + 人类 pass 两手）
    check('悔棋可用', (await mgr.undo()) === true);
    check('悔棋后回到两手前', s.phase === 'playing' && s.moveCount === 2, `${s.phase}/${s.moveCount}`);
    // 看地盘（分析引擎 mock 失败返回 null，但调用链路正常）
    let terr: number[] | null | undefined = undefined;
    try {
      terr = await mgr.requestTerritory();
    } catch (e) {
      terr = undefined;
    }
    check('查看地盘调用不抛错', terr === null, String(terr));
    // 继续对弈
    check('继续落子可用', (await mgr.humanPlay(5, 5)) === true);
    check('落子后 AI 应手', s.phase === 'playing' && gtp.genmoveCalls >= 3, `${s.phase}/${gtp.genmoveCalls}`);
    // 设置仍在（SGF 可用）
    check('设置保留（SGF/新开局可用）', mgr.getSettings() !== null);
  }

  console.log('=== 非结束态不能回到棋盘 ===');
  {
    await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
    check('对局中调 reopenBoard 返回 false', (await mgr.reopenBoard()) === false);
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
