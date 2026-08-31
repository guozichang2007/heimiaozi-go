// 对话上下文 agent.ts 第2部分：工具结果分支 + 兜底 + streamReply
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

edit(
  `        // L3 应答
        if (tc.name === 'get_user_best_move') {
          await this.streamReply(
            [{ role: 'system', content: adviceSystem(system, result) }, { role: 'user', content: text }],
            onDelta,
            onDone,
            220,
            0.7,
          );
        } else {
          const msgs: ChatMessage[] = [
            { role: 'system', content: system },
            { role: 'user', content: text },
            { role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } }] },
            { role: 'tool', tool_call_id: tc.id, content: result },
          ];
          await this.streamReply(msgs, onDelta, onDone, 200, 0.8);
        }
        return;
      }
      onDone(first.content || '喵~');`,
  `        // L3 应答
        let reply: string;
        if (tc.name === 'get_user_best_move') {
          reply = await this.streamReply(
            this.withHistory([{ role: 'system', content: adviceSystem(system, result) }, { role: 'user', content: text }]),
            onDelta,
            onDone,
            220,
            0.7,
          );
        } else {
          const msgs: ChatMessage[] = [
            { role: 'system', content: system },
            { role: 'user', content: text },
            { role: 'assistant', content: null, tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } }] },
            { role: 'tool', tool_call_id: tc.id, content: result },
          ];
          reply = await this.streamReply(this.withHistory(msgs), onDelta, onDone, 200, 0.8);
        }
        this.pushHistory(text, reply);
        return;
      }
      const reply = first.content || '喵~';
      this.pushHistory(text, reply);
      onDone(reply);`,
  '工具结果分支',
);

edit(
  `    } catch (e) {
      console.error('[agent] 路由失败:', e);
      await this.streamReply(
        [{ role: 'system', content: system }, { role: 'user', content: text }],
        onDelta,
        onDone,
        200,
      );
    }`,
  `    } catch (e) {
      console.error('[agent] 路由失败:', e);
      const reply = await this.streamReply(
        this.withHistory([{ role: 'system', content: system }, { role: 'user', content: text }]),
        onDelta,
        onDone,
        200,
      );
      this.pushHistory(text, reply);
    }`,
  '兜底分支',
);

edit(
  `  ): Promise<void> {
    try {
      const res = await this.client!.chat({ messages, stream: true, maxTokens, temperature, onDelta });
      onDone(res.content || '喵~（本喵刚才走神了…）');
    } catch (e) {
      console.error('[agent] 回复失败:', e);
      onDelta('（黑喵子突然卡住了喵…）');
      onDone('（黑喵子突然卡住了喵…）');
    }
  }`,
  `  ): Promise<string> {
    try {
      const res = await this.client!.chat({ messages, stream: true, maxTokens, temperature, onDelta });
      const full = res.content || '喵~（本喵刚才走神了…）';
      onDone(full);
      return full;
    } catch (e) {
      console.error('[agent] 回复失败:', e);
      onDelta('（黑喵子突然卡住了喵…）');
      onDone('（黑喵子突然卡住了喵…）');
      return '（黑喵子突然卡住了喵…）';
    }
  }`,
  'streamReply 返回',
);

if (ok) {
  writeFileSync(P, t, 'utf8');
  console.log('第2部分完成');
} else {
  console.log('有失败项，未写入');
  process.exit(1);
}
