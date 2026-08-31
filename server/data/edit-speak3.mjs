// 落子发言：带20轮上下文 + 阈值8% + 明确提升/减少
import { readFileSync, writeFileSync } from 'fs';

const P = 'C:/Users/guozi/.cline/data/workspaces/chat/heimiaozi-go/server/src/agent/agent.ts';
let t = readFileSync(P, 'utf8').replace(/\r\n/g, '\n');
let ok = true;
function edit(anchor, replacement, label) {
  if (t.includes(anchor)) {
    t = t.replace(anchor, replacement);
    console.log(`[OK] ${label}`);
  } else {
    console.log(`[失败] ${label}`);
    ok = false;
  }
}

// 1) 阈值 15% → 8%
edit(
  `  /** 判定 AI 落子后是否发言：对局第一手直接发言；之后仅当本喵方胜率较上一手 AI 变化 |Δ|≥15% 才发言；并更新基准 */
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
  }`,
  `  /** 判定 AI 落子后是否发言：对局第一手直接发言；之后仅当本喵方胜率较上一手 AI 变化 |Δ|≥8% 才发言；并更新基准 */
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
    return Math.abs(this.lastAiMoveSwing) >= 8;
  }`,
  '阈值 8%',
);

// 2) 落子台词：带20轮上下文 + 胜率变化改为"提升/减少"
edit(
  `    const swingText = this.lastAiMoveSwing != null ? \`，本喵方胜率变化\${this.lastAiMoveSwing >= 0 ? '+' : ''}\${this.lastAiMoveSwing.toFixed(0)}%\` : '';
    const content = \`\${event}（\${wb} \${wa}\${swingText}）。\`;
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: \`请以黑喵子的口吻，就刚才这手棋说一句简短、可爱、自然的台词（35 字以内，可点评局势/自夸/吐槽）。事件：\${content}\` },
    ];`,
  `    const swingText = this.lastAiMoveSwing != null ? \`，本手本喵方胜率\${this.lastAiMoveSwing >= 0 ? '提升' : '减少'}\${Math.abs(this.lastAiMoveSwing).toFixed(0)}%\` : '';
    const content = \`\${event}（\${wb} \${wa}\${swingText}）。\`;
    // 落子发言同样带上 20 轮聊天上下文，保持对话连贯
    const messages: ChatMessage[] = this.withHistory([
      { role: 'system', content: system },
      { role: 'user', content: \`请以黑喵子的口吻，就刚才这手棋说一句简短、可爱、自然的台词（35 字以内，可点评局势/自夸/吐槽）。事件：\${content}\` },
    ]);`,
  '台词带上下文+提升/减少',
);

if (ok) {
  writeFileSync(P, t, 'utf8');
  console.log('agent.ts 完成');
} else {
  process.exit(1);
}
