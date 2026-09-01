// Buttplug/Intiface 适配器协议测试（npx tsx server/data/buttplug-test.ts 运行）
import { ButtplugShockDevice } from '../src/shock/buttplug';
import { BpWs } from '../src/shock/buttplug';

let passed = 0;
let failed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

/** 假 Intiface 服务端：回包 + 上报设备 */
class FakeWs implements BpWs {
  static all: FakeWs[] = [];
  url: string;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWs.all.push(this);
  }
  send(data: string) {
    this.sent.push(data);
    const msg = JSON.parse(data);
    const respond = (obj: unknown) => this.onmessage?.({ data: JSON.stringify(obj) });
    if (msg.method === 'RequestServerInfo') {
      respond({ JSONRPC: '2.0', id: msg.id, result: { MessageVersion: 3, ServerName: 'Intiface', ServerVersion: 1 } });
    } else if (msg.method === 'StartScanning') {
      respond({ JSONRPC: '2.0', id: msg.id, result: {} });
      respond({ JSONRPC: '2.0', method: 'DeviceAdded', params: { DeviceName: 'Coyote', DeviceIndex: 0, DeviceMessages: { VibrateCmd: {} } } });
      respond({ JSONRPC: '2.0', method: 'ScanningFinished' });
    } else {
      respond({ JSONRPC: '2.0', id: msg.id, result: {} });
    }
  }
  close() {
    this.closed = true;
    this.onclose?.({});
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  console.log('=== 首次触发：完整协议流程 ===');
  {
    FakeWs.all = [];
    const dev = new ButtplugShockDevice({
      wsUrl: 'ws://test-intiface:12345',
      durationMs: 10,
      wsFactory: (u) => new FakeWs(u),
    });
    const ws = FakeWs.all[0];
    ws.onopen!();
    await dev.trigger(0.5);
    const msgs = ws.sent.map((s) => JSON.parse(s));
    check('连接目标 URL 正确', ws.url === 'ws://test-intiface:12345', ws.url);
    check('第1条：RequestServerInfo', msgs[0].method === 'RequestServerInfo' && msgs[0].params.ClientName === 'heimiaozi-go', JSON.stringify(msgs[0]).slice(0, 80));
    check('第2条：StartScanning', msgs[1].method === 'StartScanning', JSON.stringify(msgs[1]).slice(0, 80));
    check('第3条：VibrateCmd 强度0.5', msgs[2].method === 'VibrateCmd' && msgs[2].params.Speeds[0].Speed === 0.5, JSON.stringify(msgs[2]).slice(0, 100));
    check('第4条：StopDeviceCmd', msgs[3].method === 'StopDeviceCmd', JSON.stringify(msgs[3]).slice(0, 80));
    check('命令条数=4', msgs.length === 4, String(msgs.length));
    dev.dispose();
    check('释放后连接关闭', ws.closed);
  }

  console.log('=== 再次触发：复用已发现设备（不再扫描） ===');
  {
    FakeWs.all = [];
    const dev = new ButtplugShockDevice({
      wsUrl: 'ws://test',
      durationMs: 10,
      wsFactory: (u) => new FakeWs(u),
    });
    FakeWs.all[0].onopen!();
    await dev.trigger(0.5);
    await delay(30);
    await dev.trigger(0.8);
    const ws = FakeWs.all[0];
    const msgs = ws.sent.map((s) => JSON.parse(s));
    const methods = msgs.map((m: any) => m.method);
    check('第二次触发不再 StartScanning', methods.filter((m: any) => m === 'StartScanning').length === 1, methods.join(','));
    check('第二次 VibrateCmd 强度0.8', msgs[4].method === 'VibrateCmd' && msgs[4].params.Speeds[0].Speed === 0.8, JSON.stringify(msgs[4]).slice(0, 100));
    check('消息总数=6', msgs.length === 6, String(msgs.length));
    dev.dispose();
  }

  console.log('=== 强度倍率（opts.intensity 0.5 → 0.5*0.5=0.25） ===');
  {
    FakeWs.all = [];
    const dev = new ButtplugShockDevice({
      wsUrl: 'ws://test',
      durationMs: 10,
      intensity: 0.5,
      wsFactory: (u) => new FakeWs(u),
    });
    FakeWs.all[0].onopen!();
    await dev.trigger(0.5);
    const msgs = FakeWs.all[0].sent.map((s) => JSON.parse(s));
    check('强度缩放为 0.25', msgs[2].params.Speeds[0].Speed === 0.25, String(msgs[2].params.Speeds[0].Speed));
    dev.dispose();
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  process.exit(failed > 0 ? 1 : 0);
}

run();
