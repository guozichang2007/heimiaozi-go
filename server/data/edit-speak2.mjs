// 对局第一手 AI 也发言
import { readFileSync, writeFileSync } from 'fs';

const P = 'C:/Users/guozi/.cline/data/workspaces/chat/heimiaozi-go/server/src/agent/agent.ts';
let t = readFileSync(P, 'utf8').replace(/\r\n/g, '\n');

const anchor = `  /** 判定 AI 落子后是否发言：本喵方胜率较上一手 AI 变化 |Δ|≥15% 才发言；并更新基准 */
  shouldSpeakOnAiMove(evt: AiMoveEvent): boolean {
    // winrateAfter 为「轮到方(用户)」视角，换算为本喵方
    const catWr = evt.winrateAfter != null ? 1 - evt.winrateAfter : null;
    if (catWr == null) return false; // 分析缺失，跳过且不改基准
    const prev = this.lastAiMoveWinrate;
    this.lastAiMoveWinrate = catWr;
    this.lastAiMoveSwing = prev != null ? (catWr - prev) * 100 : null;
    if (prev == null) return false;
    return Math.abs(this.lastAiMoveSwing!) >= 15;
  }`;

const replacement = `  /** 判定 AI 落子后是否发言：对局第一手直接发言；之后仅当本喵方胜率较上一手 AI 变化 |Δ|≥15% 才发言；并更新基准 */
  shouldSpeakOnAiMove(evt: AiMoveEvent): boolean {
    // winrateAfter 为「轮到方(用户)」视角，换算为本喵方
    const catWr = evt.winrateAfter != null ? 1 - evt.winrateAfter : null;
    if (catWr == null) return false; // 分析缺失，跳过且不改基准
    const prev = this.lastAiMoveWinrate;
    this.lastAiMoveWinrate = catWr;
    // 对局第一手（无基准）：直接发言
    if (prev == null) {
      this.lastAiMoveSwing = null;
      return true;
    }
    this.lastAiMoveSwing = (catWr - prev) * 100;
    return Math.abs(this.lastAiMoveSwing) >= 15;
  }`;

if (t.includes(anchor)) {
  t = t.replace(anchor, replacement);
  writeFileSync(P, t, 'utf8');
  console.log('[OK] 第一手也发言');
} else {
  console.log('[失败] 未找到锚点');
  process.exit(1);
}
