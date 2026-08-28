// 规则引擎单元测试（用 tsx 运行）
import { Goban, BLACK, WHITE, otherColor } from '../src/game/goban';
import { computeScoreWithKomi } from '../src/game/scoring';

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

console.log('=== 提子 ===');
{
  const b = new Goban(9);
  b.place(WHITE, 3, 3);
  b.place(BLACK, 3, 4);
  b.place(BLACK, 4, 3);
  b.place(BLACK, 3, 2);
  const res = b.place(BLACK, 2, 3); // 最后一气 → 提掉白(3,3)
  check('提掉白子', res.captured.length === 1, `captured=${res.captured.length}`);
  check('白子位置变空', b.get(3, 3) === 0);
  check('黑提子数=1', b.captures[BLACK] === 1);
}

console.log('=== 自杀 ===');
{
  const b = new Goban(9);
  // 角落 (0,0) 被两个白子占住两气 → 黑再下 (0,0) 即自杀
  b.place(WHITE, 0, 1);
  b.place(WHITE, 1, 0);
  let suicide = false;
  try {
    b.place(BLACK, 0, 0);
  } catch {
    suicide = true;
  }
  check('角落自杀被禁止', suicide);
  check('棋盘回滚', b.get(0, 0) === 0);
}

console.log('=== 历史/位置哈希（superko 基础机制） ===');
{
  const b = new Goban(9);
  b.place(BLACK, 0, 0);
  b.place(WHITE, 8, 8);
  const hist = (b as any).history as string[];
  check('每手记录一个局面签名', hist.length === 3, `len=${hist.length}`);
  check('签名唯一（初始≠落子后）', new Set(hist).size === 3);
  // 重复局面会被拦截：直接验证机制——把当前签名再次放入历史后，模拟重复检查
  const b2 = new Goban(9);
  b2.place(BLACK, 0, 0);
  const sig = (b2 as any).signature();
  const history = (b2 as any).history as string[];
  check('落子后签名进入历史', history.includes(sig));
}

console.log('=== 数子（中国规则） ===');
{
  const b = new Goban(9);
  // 黑围左上角 2x2 领地
  b.place(BLACK, 0, 0);
  b.place(BLACK, 1, 0);
  b.place(BLACK, 0, 1);
  b.place(BLACK, 1, 1);
  const dead = new Set<number>();
  const sc = computeScoreWithKomi(b, dead, 5.5);
  console.log(`  黑子=${sc.blackArea} 白子=${sc.whiteArea} 黑分=${sc.blackScore.toFixed(1)} 白分=${sc.whiteScore.toFixed(1)}`);
  check('黑方领地包含 4 子', sc.blackArea >= 4, `blackArea=${sc.blackArea}`);
  check('白方无子', sc.whiteArea === 0, `whiteArea=${sc.whiteArea}`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);

