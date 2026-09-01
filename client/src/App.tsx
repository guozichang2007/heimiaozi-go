import { useState, useEffect } from 'preact/hooks';
import { state, serverConfig, connected, lastError, bgmMuted, actions } from './state/store';
import { BoardView } from './components/BoardView';
import { ChatPanel } from './components/ChatPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { ControlBar } from './components/ControlBar';
import { GameOverModal } from './components/GameOverModal';
import { CatAvatar } from './components/CatAvatar';

const DIFF_LABEL: Record<string, string> = { easy: '入门', medium: '初级', hard: '中级', expert: '高级', master: '职业' };

function StatusBar() {
  const s = state.value;
  const cfg = serverConfig.value;
  const isLocal = s.settings?.mode === 'local';
  const turn =
    s.phase === 'placement'
      ? `摆让子：还剩 ${s.handicapRemaining ?? 0} 手，自由摆放`
      : s.phase === 'playing'
        ? isLocal
          ? s.currentPlayer === 1
            ? '黑棋回合'
            : '白棋回合'
          : s.currentPlayer === s.settings?.humanColor
            ? '你的回合'
            : '黑喵子思考中…'
        : s.phase === 'scoring'
          ? '数子阶段：点选死子，然后「完成数子」'
          : s.phase === 'over'
            ? '对局结束'
            : '等待开局';
  return (
    <div className="statusbar">
      <span className={`dot ${connected.value ? 'ok' : ''}`} /> {connected.value ? '已连接' : '未连接'}
      {cfg.engineReady ? <span className="tag ok">引擎就绪</span> : <span className="tag">引擎加载中…</span>}
      <span className="tag">{cfg.engineBackend === 'cuda' ? 'CUDA' : 'OpenCL'}</span>
      <span className="turn">{turn}</span>
      {s.settings && s.phase !== 'setup' && (
        <span className="info">
          {s.boardSize}路{isLocal ? ' · 双人对弈' : ` · ${DIFF_LABEL[s.settings.difficulty] ?? ''}`}
          {!isLocal && s.settings.handicap > 0 ? ` · 让${s.settings.handicap}子` : ''} · 第{s.moveCount}手
        </span>
      )}
      {s.review && (
        <span className="info">
          复盘 {s.review.index}/{s.review.total} 手{s.review.deviated ? ' · 自由推演中' : ''}
        </span>
      )}
    </div>
  );
}

export function App() {
  const [settingsOpen, setSettingsOpen] = useState(state.value.phase === 'setup');

  // 对局开始后自动收起设置面板（含让子摆子阶段）
  useEffect(() => {
    const p = state.value.phase;
    if (p === 'playing' || p === 'scoring' || p === 'placement') {
      setSettingsOpen(false);
    }
  }, [state.value.phase, state.value.moveCount, state.value.settings]);
  const s = state.value;
  const err = lastError.value;

  const openSettings = () => setSettingsOpen(true);
  const closeSettings = () => setSettingsOpen(false);

  return (
    <div className="app">
      <header className="header">
        <div className="logo"><CatAvatar size={24} /> 黑喵子围棋</div>
        <div className="header-right">
          <StatusBar />
          <button
            className={`sound-btn ${bgmMuted.value ? 'off' : ''}`}
            onClick={() => actions.toggleBgmMuted()}
            title={bgmMuted.value ? '声音已静音' : '声音开启'}
          >
            {bgmMuted.value ? '🔇' : '🔊'}
          </button>
        </div>
      </header>

      {err && <div className="toast">{err}</div>}

      <main className="main">
        <div className="board-column">
          <BoardView />
          <ControlBar onNewGame={openSettings} />
        </div>
        <aside className="side-column">
          <ChatPanel />
        </aside>
      </main>

      {settingsOpen && <SettingsPanel />}
      {!settingsOpen && s.phase === 'over' && <GameOverModal onNewGame={openSettings} />}
    </div>
  );
}
