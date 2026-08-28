import { DeepSeekClient, ChatMessage, ChatTool } from './deepseek';
import { fastRoute } from './router';
import { Executor } from './executor';
import { systemPrompt, contextHeader } from './persona';
import { GameManager, AiMoveEvent } from '../game/gameManager';

const TOOLS: ChatTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_user_best_move',
      description: '计算当前局面轮到用户一方时的最佳着法（由围棋引擎分析）。用户明显在求助下棋方案时调用。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'do_game_action',
      description: '执行游戏操作：悔棋(undo)、认输(resign)、开始数子结算(score)、显示领地热力图(territory)。用户明确要求时调用。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['undo', 'resign', 'score', 'territory'] },
        },
        required: ['action'],
      },
    },
  },
];

/** 把分析结果注入系统上下文，并要求模型严格引用坐标 */
function adviceSystem(system: string, result: string): string {
  return `${system}\n\n【本喵刚心算好的推荐】\n${result}\n（回答用户时，必须直接引用以上坐标，先报坐标再解释；严禁编造或改动坐标。）`;
}

function buildToolResultMessages(system: string, userText: string, toolName: string, result: string): ChatMessage[] {
  const callId = 'call_fast_route';
  return [
    { role: 'system', content: system },
    { role: 'user', content: userText },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: callId, type: 'function', function: { name: toolName, arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: callId, content: result },
  ];
}

/**
 * 黑喵子 Agent（三层）：
 * L1 意图路由（关键词快路径 + LLM 工具路由）
 * L2 执行（Executor：KataGo 分析 / 游戏动作）
 * L3 角色应答（DeepSeek 生成流式回复）
 */
export class Agent {
  private executor: Executor;
  private client: DeepSeekClient | null;

  constructor(
    private game: GameManager,
    client: DeepSeekClient | null,
  ) {
    this.executor = new Executor(game);
    this.client = client;
  }

  get enabled(): boolean {
    return !!this.client;
  }

  private systemWithContext(): Promise<string> {
    return this.executor.getBoardSummary().then((ctx) => systemPrompt() + contextHeader(ctx));
  }

  /** 处理用户聊天消息 */
  async handleUserMessage(text: string, onDelta: (chunk: string) => void, onDone: (full: string) => void): Promise<void> {
    if (!this.client) {
      onDelta('喵……黑喵子现在没睡醒（未配置 DeepSeek API Key）。请把 key 填进 server/.env 的 DEEPSEEK_API_KEY 再重启喵~');
      onDone('喵……黑喵子现在没睡醒（未配置 DeepSeek API Key）。');
      return;
    }
    const system = await this.systemWithContext();

    // L1 关键词快路径
    const fast = fastRoute(text);
    console.log('[agent] 路由判定:', JSON.stringify(fast), '文本:', text.slice(0, 30));
    if (fast?.type === 'game_action') {
      const result = await this.executor.doAction(fast.action);
      await this.streamReply(buildToolResultMessages(system, text, 'do_game_action', result), onDelta, onDone, 120);
      return;
    }
    if (fast?.type === 'help_move') {
      const result = await this.executor.getBestMoveAdvice();
      await this.streamReply(
        [{ role: 'system', content: adviceSystem(system, result) }, { role: 'user', content: text }],
        onDelta,
        onDone,
        220,
        0.7,
      );
      return;
    }

    // L1 LLM 工具路由
    try {
      const first = await this.client.chat({
        messages: [{ role: 'system', content: system }, { role: 'user', content: text }],
        tools: TOOLS,
        temperature: 1.05,
        maxTokens: 300,
      });
      const tc = first.toolCalls?.[0];
      console.log('[agent] LLM路由 toolCalls:', JSON.stringify(first.toolCalls));
      if (tc) {
        // L2 执行
        let result = '';
        if (tc.name === 'get_user_best_move') result = await this.executor.getBestMoveAdvice();
        else if (tc.name === 'do_game_action') {
          let action: string = 'score';
          try {
            action = (JSON.parse(tc.args) as { action?: string }).action ?? 'score';
          } catch {
            // ignore
          }
          result = await this.executor.doAction(action as 'undo' | 'resign' | 'score' | 'territory');
        } else result = await this.executor.getBoardSummary();
        // L3 应答
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
      onDone(first.content || '喵~');
    } catch (e) {
      console.error('[agent] 路由失败:', e);
      await this.streamReply(
        [{ role: 'system', content: system }, { role: 'user', content: text }],
        onDelta,
        onDone,
        200,
      );
    }
  }

  /** AI 落子后生成一句可爱台词 */
  async generateAiMoveLine(evt: AiMoveEvent, onDelta: (chunk: string) => void, onDone: (full: string) => void): Promise<void> {
    if (!this.client) {
      onDone('');
      return;
    }
    const system = await this.systemWithContext();
    // 胜率均换算为黑喵子（本喵）方视角，便于正确评价本喵这手棋
    const wb = evt.winrateBefore != null ? `落子前本喵方胜率${(evt.winrateBefore * 100).toFixed(0)}%` : '';
    const wa = evt.winrateAfter != null ? `落子后本喵方胜率${((1 - evt.winrateAfter) * 100).toFixed(0)}%` : '';
    const event = evt.pass
      ? '本喵刚才选择停一手（Pass）'
      : `本喵刚刚下了 ${(evt.vertex ?? '').toUpperCase()} 这手棋`;
    const content = `${event}（${wb} ${wa}）。`;
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: `请以黑喵子的口吻，就刚才这手棋说一句简短、可爱、自然的台词（35 字以内，可点评局势/自夸/吐槽）。事件：${content}` },
    ];
    try {
      await this.streamReply(messages, onDelta, onDone, 70, 1.2);
    } catch (e) {
      console.error('[agent] 落子台词失败:', e);
      onDone('');
    }
  }

  private async streamReply(
    messages: ChatMessage[],
    onDelta: (chunk: string) => void,
    onDone: (full: string) => void,
    maxTokens: number,
    temperature = 1.1,
  ): Promise<void> {
    try {
      const res = await this.client!.chat({ messages, stream: true, maxTokens, temperature, onDelta });
      onDone(res.content || '喵~（本喵刚才走神了…）');
    } catch (e) {
      console.error('[agent] 回复失败:', e);
      onDelta('（黑喵子突然卡住了喵…）');
      onDone('（黑喵子突然卡住了喵…）');
    }
  }
}