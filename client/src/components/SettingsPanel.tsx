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
  const [boardSize, setBoardSize] = useState(19);
  const [difficulty, setDifficulty] = useState('hard');
  const [handicap, setHandicap] = useState(0);
  const [humanColor, setHumanColor] = useState<'B' | 'W'>('B');
  const komi = boardSize === 9 ? 5.5 : boardSize === 13 ? 6.5 : 7.5;

  const start = () => {
    actions.startGame({ boardSize, difficulty, handicap, humanColor, komi });
  };

  return (
    <div className="settings-overlay">
      <div className="settings-card">
        <div className="settings-title">🐱 黑喵子围棋</div>
        <div className="settings-sub">猫娘天才棋手，等你来战喵~</div>

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
          <label>让子（黑喵子让给你）</label>
          <div className="seg">
            {[0, 2, 3, 4, 5, 6, 7, 9].map((n) => (
              <button key={n} className={handicap === n ? 'on' : ''} onClick={() => setHandicap(n)}>
                {n === 0 ? '不让' : `${n}子`}
              </button>
            ))}
          </div>
          <div className="hint">让子 ≥ 1 时你将执黑先落子</div>
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

        <div className="field-info">贴目 {komi} · 中国规则数子法 · 黑喵子会边下边聊天</div>

        <button className="start-btn" onClick={start}>
          开始对弈
        </button>
      </div>
    </div>
  );
}
