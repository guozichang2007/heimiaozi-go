import express from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { Server } from 'socket.io';
import { randomUUID } from 'crypto';

import {
  PORT,
  DATA_DIR,
  DEEPSEEK_API_KEY,
  DEEPSEEK_MODEL,
  KATAGO_BACKEND,
  getEnginePaths,
  getGtpConfigPath,
  resolveHumanModel,
  getAnalysisConfigPath,
} from './config';
import { GtpEngine } from './katago/gtpEngine';
import { AnalysisEngine } from './katago/analysisEngine';
import { GameManager, GameSettings } from './game/gameManager';
import { Agent } from './agent/agent';
import { DeepSeekClient } from './agent/deepseek';
import { DIFFICULTY_KEYS, Difficulty } from './katago/difficulty';
import { buildSgf } from './sgf';
import { BLACK, WHITE, Color } from './game/goban';
import { createShockDevice } from './shock/shock';

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

function normalizeSettings(raw: any): GameSettings {
  const mode: 'ai' | 'local' = raw.mode === 'local' ? 'local' : 'ai';
  const boardSize = [9, 13, 19].includes(Number(raw.boardSize)) ? Number(raw.boardSize) : 19;
  const handicap = mode === 'local' ? 0 : Math.max(0, Math.min(40, Number(raw.handicap) || 0));
  let komi = Math.max(-20, Math.min(20, Number(raw.komi) || 7.5));
  if (handicap > 0) komi = 0; // 让子局白不贴目
  const difficulty: Difficulty = DIFFICULTY_KEYS.includes(raw.difficulty) ? raw.difficulty : 'hard';
  let humanColor: Color = raw.humanColor === 'W' ? WHITE : BLACK;
  if (handicap > 0) humanColor = BLACK; // 让子棋用户执黑
  return {
    mode,
    boardSize,
    komi,
    handicap,
    difficulty,
    humanColor,
    aiColor: humanColor === BLACK ? WHITE : BLACK,
  };
}

async function main() {
  const paths = getEnginePaths();
  if (!paths.binary) {
    console.error('[启动失败] 未找到 KataGo 可执行文件，请把引擎放到', DATA_DIR, '或设置 KATAGO_BINARY');
    process.exit(1);
  }
  if (!paths.model) {
    console.error('[启动失败] 未找到神经网络模型 (.bin.gz)，请放到', DATA_DIR, '或设置 KATAGO_MODEL');
    process.exit(1);
  }
  console.log(`[引擎] 后端=${KATAGO_BACKEND}  可执行=${paths.binary}  模型=${path.basename(paths.model!)}`);

  const gtp = new GtpEngine(paths.binary, paths.model, getGtpConfigPath(), resolveHumanModel());
  const analysis = new AnalysisEngine();

  let agent: Agent;
  const manager = new GameManager(gtp, analysis, {
    onState: (s) => io.emit('state', s),
    onPlayerDropShock: (drop) => {
      // 隐藏功能：玩家胜率大跌触发郊狼电击（不阻塞对局）
      const intensity = Math.max(0.2, Math.min(1, 0.2 + ((drop - 8) / 92) * 0.8));
      shock.trigger(intensity).catch((e) => console.error('[shock] 电击失败:', (e as Error).message));
    },
    onBgmTrigger: () => {
      // 对局一方胜率首次 ≥99% → 通知前端播放 BGM（单曲一次）
      io.emit('bgm:play');
    },
    onAiMoved: (evt) => {
      // 仅在本喵方胜率较上一手 AI 变化 ≥15% 时才发言
      if (!agent.shouldSpeakOnAiMove(evt)) return;
      const msgId = randomUUID();
      io.emit('chat:start', { id: msgId, role: 'miaomiao' });
      agent.generateAiMoveLine(
        evt,
        (chunk) => io.emit('chat:delta', { id: msgId, chunk }),
        (full) => io.emit('chat:done', { id: msgId, full }),
      );
    },
  });
  agent = new Agent(manager, DEEPSEEK_API_KEY ? new DeepSeekClient(DEEPSEEK_API_KEY, DEEPSEEK_MODEL) : null);
  if (!DEEPSEEK_API_KEY) console.warn('[黑喵子] 未配置 DEEPSEEK_API_KEY，将离线。填 server/.env 后重启即可。');
  // 隐藏功能：玩家胜率大跌时触发郊狼电击（默认 Noop，不影响任何功能）
  const shock = createShockDevice();

  // 后台启动 GTP 引擎（模型加载耗时，不阻塞 HTTP 服务）
  gtp
    .start()
    .then(() => console.log('[引擎] KataGo GTP 就绪'))
    .catch((e) => console.error('[引擎] KataGo GTP 启动失败:', e.message));

  // 分析引擎预启动（领地热力图 / 求助下棋用）
  const ensureAnalysisStarted = async () => {
    if (!analysis.isRunning) {
      try {
        await analysis.start(paths.binary!, paths.model!, getAnalysisConfigPath());
        console.log('[引擎] KataGo 分析引擎就绪');
      } catch (e) {
        console.error('[引擎] 分析引擎启动失败（领地/求助功能不可用）:', e);
      }
    }
  };
  setTimeout(() => {
    ensureAnalysisStarted().catch(() => undefined);
  }, 1500);

  // 静态资源（生产：client/dist）
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) app.use(express.static(clientDist));
  else console.warn('[前端] 未找到 client/dist，请先 npm run build -w client（或另开终端跑 dev 模式）');

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      engineReady: gtp.isReady,
      engineBackend: KATAGO_BACKEND,
      deepseekEnabled: !!DEEPSEEK_API_KEY,
    });
  });

  app.get('/api/sgf', (_req, res) => {
    const settings = manager.getSettings();
    if (!settings) {
      res.status(400).send('no active game');
      return;
    }
    const sgf = buildSgf(manager.getMoves(), settings, manager.getState().result);
    res.setHeader('Content-Type', 'application/x-go-sgf');
    res.setHeader('Content-Disposition', 'attachment; filename="heimiaozi-game.sgf"');
    res.send(sgf);
  });

  // 复盘：导入 SGF 对局文件（文本 body），成功后广播 state
  app.post('/api/import-sgf', express.text({ limit: '2mb' }), async (req, res) => {
    if (!gtp.isReady) {
      res.status(400).json({ error: 'KataGo 引擎尚未就绪，请稍候……' });
      return;
    }
    try {
      await manager.importSgf(String(req.body || ''));
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  io.on('connection', (socket) => {
    socket.emit('state', manager.getState());
    socket.emit('config', {
      deepseekEnabled: !!DEEPSEEK_API_KEY,
      engineBackend: KATAGO_BACKEND,
      engineReady: gtp.isReady,
    });

    socket.on('game:start', async (settings: any) => {
      if (!gtp.isReady) {
        socket.emit('error', 'KataGo 引擎尚未就绪，请稍候……');
        return;
      }
      try {
        agent.resetAiMoveWinrate(); // 新对局重置落子发言基准
        await manager.startGame(normalizeSettings(settings));
      } catch (e) {
        socket.emit('error', `开局失败: ${(e as Error).message}`);
      }
    });

    socket.on('game:play', async (v: { x: number; y: number }) => {
      await manager.humanPlay(Number(v.x), Number(v.y));
    });
    socket.on('game:pass', async () => {
      await manager.humanPass();
    });
    socket.on('game:undo', async () => {
      await manager.undo();
    });
    socket.on('game:resign', async () => {
      await manager.resign();
    });
    socket.on('game:markDead', (index: number) => {
      manager.toggleDeadStone(Number(index));
    });
    socket.on('game:finishScoring', async () => {
      await manager.finishScoring();
    });
    socket.on('game:reopen', async (ack) => {
      const ok = await manager.reopenBoard();
      if (typeof ack === 'function') ack(ok);
    });
    socket.on('game:reviewNext', async () => {
      await manager.reviewNext();
    });
    socket.on('game:reviewPrev', async () => {
      await manager.reviewPrev();
    });
    socket.on('game:endReview', async () => {
      await manager.endReview();
    });
    socket.on('game:territory', async (on: boolean) => {
      if (on) await manager.requestTerritory();
      else manager.clearHeatmap();
    });

    socket.on('game:hint', async () => {
      await manager.requestHint();
    });

    socket.on('chat:send', async (text: string) => {
      const cleaned = String(text).slice(0, 500);
      if (!cleaned.trim()) return;
      const userMsgId = randomUUID();
      socket.emit('chat:user', { id: userMsgId, text: cleaned });
      const msgId = randomUUID();
      socket.emit('chat:start', { id: msgId, role: 'miaomiao' });
      await agent.handleUserMessage(
        cleaned,
        (chunk) => socket.emit('chat:delta', { id: msgId, chunk }),
        (full) => socket.emit('chat:done', { id: msgId, full }),
      );
    });
  });

  server.listen(PORT, () => {
    console.log(`\n  🐱 黑喵子围棋已启动: http://localhost:${PORT}\n`);
  });
}

main().catch((e) => {
  console.error('启动失败:', e);
  process.exit(1);
});

