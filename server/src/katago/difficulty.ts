export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'master';

export interface DifficultyPreset {
  label: string;
  /** 前端显示的段位说明 */
  rankLabel: string;
  /** KataGo 人类模仿段位（rank_20k ~ rank_9d） */
  humanSLProfile: string;
  /** 1=纯人类策略（弱）；0=纯KataGo搜索（强） */
  humanSLChosenMoveProp: number;
  /** 每手搜索量 */
  maxVisits: number;
  temperature: number;
  temperatureEarly: number;
  /** 认输阈值 utility(-1~1)，-1.0=永不认输 */
  resignThreshold: number;
  /** 绝对最强模式：恢复全部搜索强化项 */
  maxStrength?: boolean;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyPreset> = {
  easy:   { label: '入门', rankLabel: '约15级',  humanSLProfile: 'rank_15k', humanSLChosenMoveProp: 1, maxVisits: 40,  temperature: 1.0, temperatureEarly: 1.0,  resignThreshold: -1.0 },
  medium: { label: '初级', rankLabel: '约8级',   humanSLProfile: 'rank_8k',  humanSLChosenMoveProp: 1, maxVisits: 40,  temperature: 0.9, temperatureEarly: 0.9,  resignThreshold: -1.0 },
  hard:   { label: '中级', rankLabel: '约4级',   humanSLProfile: 'rank_4k',  humanSLChosenMoveProp: 1, maxVisits: 60,  temperature: 0.8, temperatureEarly: 0.8,  resignThreshold: -1.0 },
  expert: { label: '高级', rankLabel: '约1段',   humanSLProfile: 'rank_1d',  humanSLChosenMoveProp: 1, maxVisits: 80,  temperature: 0.7, temperatureEarly: 0.7,  resignThreshold: -0.95 },
  master: { label: '职业', rankLabel: '全力AI',  humanSLProfile: 'rank_9d',  humanSLChosenMoveProp: 0, maxVisits: 3000, temperature: 0.05, temperatureEarly: 0.1, resignThreshold: -0.95, maxStrength: true },
};

export const DIFFICULTY_KEYS: Difficulty[] = ['easy', 'medium', 'hard', 'expert', 'master'];