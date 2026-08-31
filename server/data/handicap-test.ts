// 自由让子功能测试（npx tsx server/data/handicap-test.ts 运行）
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
  logs: string[] = [];
  genmoveCalls = 0;
  private size = 19;
  async clearBoard(size: number, komi: number) {
    this.size = size;
    this.logs.push(`clear ${size} komi=${komi}`);
  }
  async applyDifficulty(d: string) {
    this.logs.push(`diff ${d}`);
  }
  async play(color: number, vertex: string | null) {
    this.logs.push(`play ${color === BLACK ? 'B' : 'W'} ${vertex ?? 'pass'}`);
  }
  async genmove(color: number): Promise<string> {
    this.genmoveCalls++;
    return this.size === 9 ? 'E5' : 'K10';
  }
}

class MockAnalysis {
  isRunning = false;
  async query() {
    throw new Error('analysis off (mock)');
  }
}

function mkManager() {
  return new GameManager(new MockGtp() as any, new MockAnalysis() as any);
}

async function run() {
  // ========== 场景 A：让 3 子，摆子流程 + 摆子中悔棋 ==========
  console.log('=== A. 让 3 子：摆子 → 悔棋 → 摆完 AI 落子 ===');
  {
    const mgr = mkManager();
    let s = mgr.getState();
    mgr.events = { onState: (st) => (s = st) };

    await mgr.startGame({ boardSize: 9, komi: 0, handicap: 3, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
    check('开局进入 placement 阶段', s.phase === 'placement', s.phase);
    check('handicapRemaining=3', s.handicapRemaining === 3, String(s.handicapRemaining));
    check('轮到玩家（黑）', s.currentPlayer === BLACK, String(s.currentPlayer));
    check('空盘（无自动摆子）', s.moveCount === 0 && s.grid.every((v) => v === 0), `moveCount=${s.moveCount}`);

    check('摆第 1 子成功', await mgr.humanPlay(3, 3) === true);
    check('剩余 2，仍在 placement', s.phase === 'placement' && s.handicapRemaining === 2, `${s.phase}/${s.handicapRemaining}`);
    check('棋盘出现黑子', s.grid[3 * 9 + 3] === BLACK);

    check('摆第 2 子成功', await mgr.humanPlay(5, 5) === true);
    check('剩余 1', s.handicapRemaining === 1, String(s.handicapRemaining));

    check('摆子中悔棋成功', await mgr.undo() === true);
    check('悔棋后回到 placement 且剩余 2', s.phase === 'placement' && s.handicapRemaining === 2, `${s.phase}/${s.handicapRemaining}`);
    check('悔棋撤掉最后一颗让子', s.grid[5 * 9 + 5] === 0 && s.grid[3 * 9 + 3] === BLACK, `moves=${s.moveCount}`);
    check('悔棋后仍轮到玩家', s.currentPlayer === BLACK, String(s.currentPlayer));

    check('补摆第 2 子', await mgr.humanPlay(6, 6) === true);
    check('摆第 3 子（完成）', await mgr.humanPlay(7, 7) === true);
    check('摆完进入 playing', s.phase === 'playing', s.phase);
    check('handicapRemaining=0', s.handicapRemaining === 0, String(s.handicapRemaining));
    check('AI 已 genmove（白先手）', (mgr as any).gtp.genmoveCalls === 1, String((mgr as any).gtp.genmoveCalls));
    check('AI 落子后轮到玩家', s.currentPlayer === BLACK, String(s.currentPlayer));
    const logs = (mgr as any).gtp.logs as string[];
    const playB = logs.filter((l) => l.startsWith('play B'));
    check('引擎收到全部让子 play（含悔棋重放）', playB.length >= 3, logs.join(' | '));
    check('引擎收到最终 3 颗让子的坐标', playB.join(',').includes('D6') && playB.join(',').includes('G3') && playB.join(',').includes('H2'), playB.join(' | '));
    check('无 set_free_handicap 调用', !logs.some((l) => l.startsWith('setHandicap')));
  }

  // ========== 场景 B：让 1 子（奇数），摆完白先，悔棋回摆 ==========
  console.log('=== B. 让 1 子（奇数）：轮到计算正确 ===');
  {
    const mgr = mkManager();
    let s = mgr.getState();
    mgr.events = { onState: (st) => (s = st) };
    await mgr.startGame({ boardSize: 9, komi: 0, handicap: 1, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
    check('开局 placement', s.phase === 'placement');
    await mgr.humanPlay(3, 3);
    // 摆完让子后 AI 立即落白子，返回时已轮到玩家（黑）
    check('摆 1 子后 playing、AI 已落白先手、轮到玩家', s.phase === 'playing' && s.currentPlayer === BLACK && (mgr as any).gtp.genmoveCalls === 1, `${s.phase}/${s.currentPlayer}`);
    await mgr.undo();
    // 对弈中悔棋受 minMoves=让子数 保护：只撤 AI 手，让子棋保留
    check('对弈中悔棋不撤让子棋，仍在 playing', s.phase === 'playing' && s.grid[3 * 9 + 3] === BLACK, `${s.phase}/${s.moveCount}`);
    check('让子棋保留在历史', s.moveCount >= 1, String(s.moveCount));
  }

  // ========== 场景 C：无让子，用户执白 → AI 黑先手 ==========
  console.log('=== C. 无让子 + 执白：AI 先手 ===');
  {
    const mgr = mkManager();
    let s = mgr.getState();
    mgr.events = { onState: (st) => (s = st) };
    await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: WHITE, aiColor: BLACK } as any);
    check('无让子直接 playing', s.phase === 'playing', s.phase);
    check('AI 已先手 genmove', (mgr as any).gtp.genmoveCalls === 1, String((mgr as any).gtp.genmoveCalls));
    check('AI 黑落子后轮到玩家（白）', s.currentPlayer === WHITE, String(s.currentPlayer));
  }

  // ========== 场景 D：无让子 + 执黑 ==========
  console.log('=== D. 无让子 + 执黑：玩家先手 ===');
  {
    const mgr = mkManager();
    let s = mgr.getState();
    mgr.events = { onState: (st) => (s = st) };
    await mgr.startGame({ boardSize: 9, komi: 5.5, handicap: 0, difficulty: 'hard', humanColor: BLACK, aiColor: WHITE } as any);
    check('AI 未抢跑', (mgr as any).gtp.genmoveCalls === 0, String((mgr as any).gtp.genmoveCalls));
    check('轮到玩家', s.currentPlayer === BLACK && s.phase === 'playing', `${s.currentPlayer}/${s.phase}`);
    check('正常落子', await mgr.humanPlay(3, 3) === true);
    check('落子后 AI genmove', (mgr as any).gtp.genmoveCalls === 1, String((mgr as any).gtp.genmoveCalls));
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
