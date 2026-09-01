// BGM 淡出逻辑测试（npx tsx server/data/music-fade-test.ts 运行）
import { fadeMultiplier, FADE_SECONDS, BGM_VOLUME } from '../../client/src/music';

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

check('淡出时长 = 60 秒', FADE_SECONDS === 60, String(FADE_SECONDS));
check('默认音量 0.6', BGM_VOLUME === 0.6, String(BGM_VOLUME));
check('淡出开始(进度0) 音量倍率 1', fadeMultiplier(0) === 1, String(fadeMultiplier(0)));
check('淡出中段(进度0.5) 倍率 0.5', Math.abs(fadeMultiplier(0.5) - 0.5) < 1e-9, String(fadeMultiplier(0.5)));
check('淡出结尾(进度1) 倍率 0', fadeMultiplier(1) === 0, String(fadeMultiplier(1)));
check('越界(1.2) 倍率 0', fadeMultiplier(1.2) === 0, String(fadeMultiplier(1.2)));
check('负值(-0.1) 倍率 1', fadeMultiplier(-0.1) === 1, String(fadeMultiplier(-0.1)));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
