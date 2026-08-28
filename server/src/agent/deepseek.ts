import { DEEPSEEK_BASE_URL } from '../config';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatOptions {
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  onDelta?: (chunk: string) => void;
}

export interface ChatResult {
  content: string;
  toolCalls: { id: string; name: string; args: string }[];
}

/** DeepSeek Chat Completions 客户端（OpenAI 兼容、支持流式与工具调用） */
export class DeepSeekClient {
  constructor(
    private apiKey: string,
    private model: string,
  ) {}

  async chat(opts: ChatOptions): Promise<ChatResult> {
    // 禁用思考模式：规避 reasoning_content 需回传的兼容问题，回复更快更稳
    const body: Record<string, unknown> = {
      model: this.model,
      messages: opts.messages,
      stream: !!opts.stream,
      thinking: { type: 'disabled' },
    };
    if (opts.temperature != null) body.temperature = opts.temperature;
    if (opts.maxTokens != null) body.max_tokens = opts.maxTokens;
    if (opts.tools?.length) body.tools = opts.tools;

    const res = await fetch(`${DEEPSEEK_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`DeepSeek ${res.status}: ${text.slice(0, 300)}`);
    }

    if (opts.stream) {
      let full = '';
      await this.parseSse(res, (chunk) => {
        full += chunk;
        opts.onDelta?.(chunk);
      });
      return { content: full, toolCalls: [] };
    }

    const json = await res.json();
    const msg = json?.choices?.[0]?.message;
    const toolCalls = (msg?.tool_calls ?? []).map((tc: ToolCall) => ({
      id: tc.id,
      name: tc.function.name,
      args: tc.function.arguments,
    }));
    return { content: msg?.content ?? '', toolCalls };
  }

  private async parseSse(res: Response, onData: (chunk: string) => void): Promise<void> {
    if (!res.body) throw new Error('no body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          const j = JSON.parse(data);
          const delta = j?.choices?.[0]?.delta;
          if (delta?.content) onData(String(delta.content));
        } catch {
          // 忽略无法解析的行
        }
      }
    }
  }
}