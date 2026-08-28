// 端到端冒烟测试：连接服务器，跑一轮完整对局 + 聊天
import { io } from 'socket.io-client';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const socket = io('http://localhost:5177', { transports: ['websocket'] });
let lastState = null;

socket.on('connect', async () => {
  console.log('[OK] 已连接服务器');
  try {
    const health = await fetch('http://localhost:5177/api/health').then((r) => r.json());
    console.log('[OK] health:', JSON.stringify(health));
  } catch (e) {
    console.log('[FAIL] health:', e.message);
  }

  socket.on('state', (s) => {
    lastState = s;
    console.log(`[状态] phase=${s.phase} move=${s.moveCount} current=${s.currentPlayer} aiThinking=${s.aiThinking} win=${s.winrate != null ? (s.winrate * 100).toFixed(0) + '%' : '-'} lead=${s.scoreLead ?? '-'}`);
  });
  socket.on('error', (e) => console.log('[服务器错误]', e));
  socket.on('chat:start', (m) => console.log('[聊天开始]', m.id));
  socket.on('chat:delta', (m) => process.stdout.write(m.chunk));
  socket.on('chat:done', (m) => console.log('\n[聊天完成]', m.full || '(空)'));

  await sleep(500);
  console.log('\n=== 开始对局 (9路, 入门, 你执黑) ===');
  socket.emit('game:start', { boardSize: 9, difficulty: 'easy', handicap: 0, humanColor: 'B', komi: 5.5 });
  await sleep(1500);

  console.log('\n=== 你落子 (3,3) ===');
  socket.emit('game:play', { x: 3, y: 3 });
  await sleep(6000);

  console.log('\n=== 聊天：求助下棋 ===');
  socket.emit('chat:send', '这步我该怎么下呀');
  await sleep(4000);

  console.log('\n=== 聊天：闲聊 ===');
  socket.emit('chat:send', '你好呀，今天心情怎么样');
  await sleep(3000);

  console.log('\n=== 悔棋 ===');
  socket.emit('game:undo');
  await sleep(1500);

  console.log('\n=== 查看地盘 ===');
  socket.emit('game:territory', true);
  await sleep(4000);

  console.log('\n=== 认输 ===');
  socket.emit('game:resign');
  await sleep(1500);

  console.log('\n=== 最终状态 ===');
  console.log(JSON.stringify(lastState?.result, null, 2));
  console.log('\n=== 测试结束 ===');
  process.exit(0);
});

socket.on('connect_error', (e) => {
  console.log('[连接失败]', e.message);
  process.exit(1);
});
