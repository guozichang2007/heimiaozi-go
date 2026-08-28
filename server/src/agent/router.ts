export type Intent =
  | { type: 'help_move' }
  | { type: 'game_action'; action: 'undo' | 'resign' | 'score' | 'territory' }
  | { type: 'chat' };

const HELP_PATTERNS = [
  /(怎么下|下哪|该下|走哪|怎么办|帮我|教教|提示|建议|下一步|哪里|妙手|求指教|指个|这步|这手)/,
  /(help|advice|move|suggest)/i,
];

const ACTION_RULES: { action: 'undo' | 'resign' | 'score' | 'territory'; patterns: RegExp[] }[] = [
  { action: 'undo', patterns: [/(悔棋|撤销|回退|返回上一步|重来这一步|反悔)/] },
  { action: 'resign', patterns: [/(认输|投降|不下了|我输了|投了|输了输)/] },
  { action: 'score', patterns: [/(数子|算地|结算|终局|判胜负|谁赢|点目|数目)/] },
  { action: 'territory', patterns: [/(地盘|领地|领空|形势|目数对比|看下地)/] },
];

/** 关键词快速路由：命中直接分流，省一次 LLM 调用 */
export function fastRoute(text: string): Intent | null {
  for (const rule of ACTION_RULES) {
    for (const p of rule.patterns) {
      if (p.test(text)) return { type: 'game_action', action: rule.action };
    }
  }
  if (HELP_PATTERNS.some((p) => p.test(text))) return { type: 'help_move' };
  return null;
}

