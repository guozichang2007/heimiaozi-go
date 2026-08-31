import { state, actions, territoryView, hintLoading } from '../state/store';

export function ControlBar({ onNewGame }: { onNewGame: () => void }) {
  const s = state.value;
  const playing = s.phase === 'playing';
  const placement = s.phase === 'placement';
  const scoring = s.phase === 'scoring';
  const over = s.phase === 'over';
  const humanTurn = playing && !s.aiThinking && !!s.settings && s.currentPlayer === s.settings.humanColor;

  return (
    <div className="controls">
      <button disabled={!(playing || placement) || s.aiThinking} onClick={() => actions.undo()} title="撤销一步">
        ⏪ 悔棋
      </button>
      <button disabled={!playing || s.aiThinking} onClick={() => actions.pass()} title="停一手（双方连停两次进入数子）">
        ⏸ Pass
      </button>
      <button disabled={!playing} onClick={() => actions.resign()} title="认输">
        🏳 认输
      </button>
      <button
        disabled={!playing}
        className={territoryView.value ? 'active' : ''}
        onClick={() => actions.toggleTerritory()}
        title="显示/隐藏 AI 预测领地热力图"
      >
        {territoryView.value ? '🗺 关闭地盘' : '🗺 查看地盘'}
      </button>
      <button disabled={!playing} onClick={() => actions.hint()} title="让最强 AI 标出最佳落点">
        {hintLoading.value ? '⏳ 计算中…' : '💡 提示'}
      </button>
      {scoring && (
        <button className="primary" onClick={() => actions.finishScoring()}>
          ✅ 完成数子
        </button>
      )}
      <button disabled={!s.settings && !over} onClick={() => actions.downloadSgf()} title="下载本局 SGF">
        📥 SGF
      </button>
      <button onClick={onNewGame} title="开始新对局">
        🔄 新开局
      </button>
    </div>
  );
}
