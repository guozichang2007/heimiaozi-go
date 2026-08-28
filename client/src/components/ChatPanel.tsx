import { useRef, useEffect } from 'preact/hooks';
import { chatMessages, actions, serverConfig, state, showWinrate } from '../state/store';
import { CatAvatar } from './CatAvatar';

/** 聊天面板右上角：黑白胜率徽标（含隐藏开关） */
function WinrateBadge() {
  const s = state.value;
  const visible = showWinrate.value;
  const inGame = (s.phase === 'playing' || s.phase === 'scoring') && s.settings;
  let blackText = '黑--';
  let whiteText = '白--';
  let blackPct = 50;
  let leadText = '';
  if (visible && inGame && s.winrate != null) {
    const blackWr = s.currentPlayer === 1 ? s.winrate : 1 - s.winrate;
    blackPct = Math.round(blackWr * 100);
    blackText = `黑${blackPct}%`;
    whiteText = `白${100 - blackPct}%`;
    if (s.scoreLead != null) {
      const sideName = s.currentPlayer === 1 ? '黑' : '白';
      const sign = s.scoreLead >= 0 ? '+' : '';
      leadText = `${sideName} ${sign}${s.scoreLead.toFixed(1)}目`;
    }
  } else if (visible && inGame && s.aiThinking) {
    leadText = '计算中…';
  }
  if (!visible) {
    return (
      <button className="wr-toggle-btn" onClick={() => actions.toggleWinrate()} title="显示胜率">
        📊
      </button>
    );
  }
  return (
    <div className="chat-wr">
      <div className="chat-wr-bar">
        <span className="b" style={{ width: `${blackPct}%` }} />
        <span className="w" style={{ width: `${100 - blackPct}%` }} />
      </div>
      <div className="chat-wr-info">
        <div className="chat-wr-text">
          {blackText} · {whiteText}
        </div>
        {leadText && <div className="chat-wr-lead">{leadText}</div>}
      </div>
      <button className="wr-toggle-btn" onClick={() => actions.toggleWinrate()} title="隐藏胜率">
        ⛔
      </button>
    </div>
  );
}

export function ChatPanel() {
  const msgs = chatMessages.value;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, msgs[msgs.length - 1]?.text.length]);

  const onSubmit = (evt: Event) => {
    evt.preventDefault();
    const input = (evt.target as HTMLFormElement).querySelector('input') as HTMLInputElement;
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    actions.sendChat(text);
  };

  return (
    <div className="chat-panel">
      <div className="chat-head">
        <CatAvatar size={36} />
        <div className="chat-id">
          <div className="chat-name">黑喵子</div>
          <div className="chat-status">
            {serverConfig.value.deepseekEnabled ? '在线（DeepSeek 接入）' : '离线（未配置 API Key）'}
          </div>
        </div>
        <div className="chat-head-right">
          <WinrateBadge />
        </div>
      </div>
      <div className="chat-list" ref={listRef}>
        {msgs.length === 0 && (
          <div className="chat-empty">
            跟黑喵子聊聊天喵~
            <br />
            比如：<span className="chip">这步我该怎么下？</span>
            <br />
            <span className="chip">悔棋</span> <span className="chip">认输</span> <span className="chip">帮我看看地盘</span>
          </div>
        )}
        {msgs.map((m) => (
          <div key={m.id} className={`chat-msg ${m.role}`}>
            {m.role === 'miaomiao' && <CatAvatar size={20} className="mini" />}
            <div className="bubble">
              {m.text}
              {m.streaming && <span className="cursor">▌</span>}
            </div>
          </div>
        ))}
      </div>
      <form className="chat-input" onSubmit={onSubmit}>
        <input placeholder="跟黑喵子说点什么…（可以问棋、悔棋、认输、闲聊）" maxLength={500} />
        <button type="submit">发送</button>
      </form>
    </div>
  );
}