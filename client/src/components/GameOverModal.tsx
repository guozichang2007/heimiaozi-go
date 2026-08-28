import { state, actions } from '../state/store';
import { CatAvatar } from './CatAvatar';

export function GameOverModal({ onNewGame }: { onNewGame: () => void }) {
  const r = state.value.result;
  if (!r) return null;

  const winnerName = r.winnerIsHuman ? '你' : '黑喵子';
  const reasonText =
    r.reason === 'resign' ? '黑喵子中盘获胜（你认输）' : r.reason === 'ai-resign' ? '你获胜（黑喵子认输）' : '按中国规则数子终局';

  return (
    <div className="settings-overlay">
      <div className="settings-card gameover">
        <div className="gameover-emoji">{r.winnerIsHuman ? '🎉' : <CatAvatar size={52} />}</div>
        <div className="gameover-title">
          {r.winnerIsHuman ? '恭喜你赢了黑喵子喵！' : '黑喵子获胜喵~ 再试一次！'}
        </div>
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
