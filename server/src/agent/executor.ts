import { GameManager } from '../game/gameManager';
import { BLACK, WHITE } from '../game/goban';
import { DIFFICULTIES } from '../katago/difficulty';

/** 把 GTP 坐标（如 Q16）转成中文方位描述（如 右上角），适配 9/13/19 路 */
function describePosition(vertex: string, size: number): string {
  const m = /^([A-Ta-t])(\d+)$/.exec(vertex.trim());
  if (!m) return '';
  let col = m[1].toUpperCase().charCodeAt(0) - 65;
  if (col >= 8) col--; // 跳过 I
  const row = Number(m[2]);
  const x = col;
  const y = size - row; // 转成从上往下的 0 基坐标
  const third = Math.floor(size / 3);
  const h = x < third ? '左' : x >= size - third ? '右' : '中';
  const v = y < third ? '上' : y >= size - third ? '下' : '中';
  if (h === '中' && v === '中') return '中腹';
  if (h === '中') return v === '上' ? '上边' : '下边';
  if (v === '中') return h === '左' ? '左边' : '右边';
  return `${h}${v}角`;
}

/**
 * Agent 的执行层（L2）：把"要干什么"翻译成真实动作。
 * - getBestMoveAdvice：调 KataGo 分析引擎算当前方最优解
 * - getBoardSummary：生成棋局上下文
 * - doAction：悔棋/认输/数子/看地盘
 */
export class Executor {
  constructor(private game: GameManager) {}

  async getBoardSummary(): Promise<string> {
    const s = this.game.getState();
    const st = s.settings;
    if (!st || s.phase === 'setup') return '对局尚未开始，还在准备中喵。';
    const side = s.currentPlayer === BLACK ? '黑棋' : '白棋';
    const who = s.currentPlayer === st.humanColor ? '你' : '黑喵子';
    const win = s.winrate != null ? `${(s.winrate * 100).toFixed(0)}%` : '未知';
    const lead = s.scoreLead != null ? `${s.scoreLead >= 0 ? '+' : ''}${s.scoreLead.toFixed(1)}目` : '未知';
    const diff = DIFFICULTIES[st.difficulty].label;
    // 盘面子数：帮黑喵子感知当前棋盘
    const blackCount = s.grid.filter((v) => v === 1).length;
    const whiteCount = s.grid.filter((v) => v === 2).length;
    // 最近几手归属：帮黑喵子分清谁下的棋
    const recent = this.game
      .getMoves()
      .slice(-6)
      .map((m) => `${m.color === BLACK ? '黑' : '白'} ${m.pass ? '停一手' : m.vertex ?? ''}`)
      .join(' → ');
    const recentText = recent ? `。最近几手：${recent}` : '';
    return `${s.boardSize}路棋盘，第${s.moveCount}手，轮到${side}（${who}），难度：${diff}，贴目 ${st.komi}，盘面黑${blackCount}子/白${whiteCount}子。最近分析：轮到方胜率约${win}，目差约${lead}${recentText}。`;
  }

  /** 为当前轮到的一方（通常是你）求最佳点，返回格式化分析结果 */
  async getBestMoveAdvice(): Promise<string> {
    const s = this.game.getState();
    if (!s.settings) return '对局还没开始，先开一局喵~';
    if (s.phase !== 'playing') return '现在不是落子的时候喵，等这盘结束再说吧！';
    if (s.currentPlayer !== s.settings.humanColor) {
      return '现在轮到黑喵子落子喵~ 你先看本喵这手怎么下，再想想自己的对策吧！';
    }
    // 求助/提示永远用最强 AI：固定高访问量，与当前难度无关
    const visits = 3000;
    const resp = await this.game.queryAnalysis(false, visits);
    const top = (resp.moveInfos ?? []).slice(0, 3);
    if (!top.length) return '本喵一时也算不清楚喵……（分析没返回结果）';
    const you = s.currentPlayer === BLACK ? '黑棋' : '白棋';
    const size = s.boardSize;
    const descs = top.map((m) => {
      const win = (m.winrate * 100).toFixed(1);
      const lead = m.scoreMean >= 0 ? '+' : '';
      const region = describePosition(m.move, size);
      const pv = (m.pv ?? []).slice(0, 3).join(' → ');
      const pvText = pv ? `，主变：${pv}` : '';
      return `${m.move}（${region}，胜率${win}%，目差${lead}${m.scoreMean.toFixed(1)}${pvText}）`;
    });
    return `【走棋分析】你执${you}，轮到你落子（${size}路棋盘）。\n最佳选择：${descs[0]}\n备选：\n${descs.slice(1).map((d, i) => `${i + 2}. ${d}`).join('\n')}\n回答时必须直接引用以上坐标（第一行即最佳点），先报坐标再解释，严禁编造其他坐标。`;
  }

  /** 执行游戏动作，返回给黑喵子的结果描述 */
  async doAction(action: 'undo' | 'resign' | 'score' | 'territory'): Promise<string> {
    const s = this.game.getState();
    switch (action) {
      case 'undo': {
        const ok = await this.game.undo();
        return ok ? '已帮用户悔棋成功，局面退回上一手，轮到用户思考。' : '悔棋失败：可能还轮不到悔棋（比如黑喵子正在思考，或还没有可撤销的落子）。';
      }
      case 'resign': {
        const ok = await this.game.resign();
        return ok ? '用户已认输，对局结束，黑喵子获胜。' : '现在无法认输（对局可能已结束）。';
      }
      case 'score': {
        if (s.phase === 'scoring') {
          await this.game.finishScoring();
          return '已完成数子并结算，对局结束。';
        }
        if (s.phase === 'playing') return '对局还没结束喵：需要双方连续各 Pass（停一手）一次才能开始数子。';
        return '对局已经结束了喵。';
      }
      case 'territory': {
        const ok = await this.game.requestTerritory();
        return ok ? '已在棋盘上叠加显示预测领地热力图（暖色=黑方倾向，冷色=白方倾向）。' : '热力图生成失败，引擎可能还在加载喵。';
      }
    }
  }
}