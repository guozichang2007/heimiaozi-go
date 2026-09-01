import { useRef } from 'preact/hooks';
import { state, actions, territoryView, hintLoading, lastError } from '../state/store';

export function ControlBar({ onNewGame }: { onNewGame: () => void }) {
  const s = state.value;
  const importInputRef = useRef<HTMLInputElement>(null);

  const onImportFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const err = await actions.importSgfText(String(reader.result || ''));
      if (err) {
        lastError.value = `SGF 导入失败：${err}`;
        setTimeout(() => (lastError.value = ''), 5000);
      }
    };
    reader.readAsText(file);
  };
  const playing = s.phase === 'playing';
  const placement = s.phase === 'placement';
  const scoring = s.phase === 'scoring';
  const over = s.phase === 'over';
  const isLocal = s.settings?.mode === 'local';
  const humanTurn = playing && !s.aiThinking && !!s.settings && (isLocal || s.currentPlayer === s.settings.humanColor);

  return (
    <div className="controls">
      <button disabled={!(playing || placement) || s.aiThinking} onClick={() => actions.undo()} title="撤销一步">
        ⏪ 悔棋
      </button>
      <button disabled={!playing || s.aiThinking} onClick={() => actions.pass()} title="停一手（双方连停两次进入数子）">
        ⏸ Pass
      </button>
      <button disabled={!playing} onClick={() => actions.resign()} title={isLocal ? '当前回合方认输' : '认输'}>
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
      <button onClick={() => importInputRef.current?.click()} title="导入 SGF 对局文件，进入复盘（本地双人）">
        📂 导入 SGF
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept=".sgf,.txt"
        style={{ display: 'none' }}
        onChange={onImportFile}
      />
      {s.review && (
        <>
          <button
            disabled={s.review.index <= 0}
            onClick={() => actions.reviewPrev()}
            title="上一手（自由推演时直接跳回记录位置）"
          >
            ⏮ 上一手
          </button>
          <button
            disabled={s.review.deviated || s.review.index >= s.review.total}
            onClick={() => actions.reviewNext()}
            title="按记录落下一手"
          >
            下一手 ⏭
          </button>
          <button onClick={() => actions.endReview()} title="结束复盘，转为普通双人对弈">
            ⏹ 结束复盘
          </button>
        </>
      )}
      <button onClick={onNewGame} title="开始新对局">
        🔄 新开局
      </button>
    </div>
  );
}
