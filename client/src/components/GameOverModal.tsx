import { state, actions } from '../state/store';
import { CatAvatar } from './CatAvatar';

export function GameOverModal({ onNewGame }: { onNewGame: () => void }) {
  const s = state.value;
  const r = s.result;
  if (!r) return null;

  const isLocal = s.settings?.mode === 'local';
  const winnerName = isLocal ? (r.winner === 1 ? '黑方' : '白方') : r.winnerIsHuman ? '你' : '黑喵子';
  const title = isLocal
    ? `${winnerName}获胜！`
    : r.winnerIsHuman
      ? '恭喜你赢了黑喵子喵！'
      : '黑喵子获胜喵~ 再试一次！';
  const reasonText = isLocal
    ? r.reason === 'resign'
      ? `${winnerName}中盘获胜（${r.winner === 1 ? '白方' : '黑方'}认输）`
      : '按中国规则数子终局'
    : r.reason === 'resign'
      ? '黑喵子中盘获胜（你认输）'
      : r.reason === 'ai-resign'
        ? '你获胜（黑喵子认输）'
        : '按中国规则数子终局';

  return (
    <div className="settings-overlay">
      <div className="settings-card gameover">
        <div className="gameover-emoji">
          {isLocal ? '🏆' : r.winnerIsHuman ? '🎉' : <CatAvatar size={52} />}
        </div>
        <div className="gameover-title">{title}</div>
        <div className="gameover-detail">
          {winnerName} 获胜 · {reasonText}
        </div>
        {r.reason === 'score' && (
          <div className="score-line">
            <span>黑（{r.blackArea} 子）</span>
            <span>白（{r.whiteArea} 子）</span>
          </div>
        )}
        <div className="score-line muted">
          含贴目：黑 {r.blackScore.toFixed(1)} · 白 {r.whiteScore.toFixed(1)} · 领先 {r.margin.toFixed(1)}
        </div>
        <div className="gameover-actions">
          <button className="ghost-btn" onClick={() => actions.reopenBoard()}>
            ⏪ 回到棋盘
          </button>
          <button className="start-btn" onClick={onNewGame}>
            再来一局
          </button>
          <button className="ghost-btn" onClick={() => actions.downloadSgf()}>
            下载 SGF
          </button>
        </div>
      </div>
    </div>
  );
}
