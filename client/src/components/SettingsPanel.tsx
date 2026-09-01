import { useState } from 'preact/hooks';
import { actions } from '../state/store';

const DIFFICULTY_OPTIONS = [
  { key: 'easy', label: '入门 15k', desc: '约业余15级，新手友好' },
  { key: 'medium', label: '初级 8k', desc: '约业余8级' },
  { key: 'hard', label: '中级 4k', desc: '约业余4级' },
  { key: 'expert', label: '高级 1d', desc: '约业余1段' },
  { key: 'master', label: '职业 AI', desc: '最强 AI 全力' },
];

export function SettingsPanel() {
  const [mode, setMode] = useState<'ai' | 'local'>('ai');
  const [boardSize, setBoardSize] = useState(19);
  const [difficulty, setDifficulty] = useState('hard');
  const [handicapEnabled, setHandicapEnabled] = useState(false);
  const [handicap, setHandicap] = useState(4);
  const [humanColor, setHumanColor] = useState<'B' | 'W'>('B');
  const komi = boardSize === 9 ? 5.5 : boardSize === 13 ? 6.5 : 7.5;

  const start = () => {
    actions.startGame({
      mode,
      boardSize,
      difficulty,
      handicap: mode === 'local' ? 0 : handicapEnabled ? handicap : 0,
      humanColor: mode === 'local' ? 'B' : handicapEnabled ? 'B' : humanColor,
      komi,
    });
  };

  return (
    <div className="settings-overlay">
      <div className="settings-card">
        <div className="settings-title">🐱 黑喵子围棋</div>
        <div className="settings-sub">猫娘天才棋手，等你来战喵~</div>

        <div className="field">
          <label>对弈模式</label>
          <div className="seg">
            <button className={mode === 'ai' ? 'on' : ''} onClick={() => setMode('ai')}>
              🤖 人机对战
            </button>
            <button className={mode === 'local' ? 'on' : ''} onClick={() => setMode('local')}>
              👥 线下真人对弈
            </button>
          </div>
        </div>

        <div className="field">
          <label>棋盘大小</label>
          <div className="seg">
            {[9, 13, 19].map((n) => (
              <button key={n} className={boardSize === n ? 'on' : ''} onClick={() => setBoardSize(n)}>
                {n}路
              </button>
            ))}
          </div>
        </div>

        {mode === 'ai' && (
        <>
        <div className="field">
          <label>黑喵子难度</label>
          <div className="seg">
            {DIFFICULTY_OPTIONS.map((d) => (
              <button key={d.key} className={difficulty === d.key ? 'on' : ''} onClick={() => setDifficulty(d.key)} title={d.desc}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="handicap-chk">
            <input
              type="checkbox"
              checked={handicapEnabled}
              onChange={(e) => setHandicapEnabled((e.target as HTMLInputElement).checked)}
            />
            让子（黑喵子让给你）
          </label>
          <div className="handicap-row">
            <input
              type="number"
              min={1}
              max={40}
              value={handicap}
              disabled={!handicapEnabled}
              onInput={(e) => {
                const v = Number((e.target as HTMLInputElement).value);
                setHandicap(Number.isFinite(v) ? Math.max(1, Math.min(40, Math.round(v))) : 1);
              }}
            />
            <span>子</span>
          </div>
          <div className="hint">
            {handicapEnabled
              ? `开启后你执黑，先在空棋盘上自由摆放 ${handicap} 颗黑子，摆完黑喵子才落子`
              : '让子 1~40 手：开局由你自由选择落点连续摆子'}
          </div>
        </div>

        <div className="field">
          <label>你执</label>
          <div className="seg">
            <button className={humanColor === 'B' ? 'on' : ''} onClick={() => setHumanColor('B')}>
              ● 黑棋
            </button>
            <button className={humanColor === 'W' ? 'on' : ''} onClick={() => setHumanColor('W')}>
              ○ 白棋
            </button>
          </div>
        </div>
        </>
        )}

        <div className="field-info">
          {mode === 'local'
            ? `贴目 ${komi} · 中国规则数子法 · 双人轮流落子`
            : handicapEnabled
              ? '贴目 0 · 让子局白不贴目 · 中国规则数子法 · 黑喵子会边下边聊天'
              : `贴目 ${komi} · 中国规则数子法 · 黑喵子会边下边聊天`}
        </div>

        <button className="start-btn" onClick={start}>
          开始对弈
        </button>
      </div>
    </div>
  );
}
