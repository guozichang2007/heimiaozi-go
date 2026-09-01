/**
 * 郊狼（Coyote）电刺激设备的通用接口适配器。
 *
 * 通道：Buttplug.io / Intiface 标准通道（WebSocket JSON-RPC，默认 ws://127.0.0.1:12345）。
 * 郊狼通过 BLE 连接 Intiface Central，本适配器用 VibrateCmd/StopDeviceCmd 触发刺激。
 * WebSocket 实现可注入（便于单测）；默认使用 Node 24 全局 WebSocket。
 */
import { ShockDevice } from './shock';

/** 我们只依赖的最小子集（Node 全局 WebSocket 结构兼容） */
export interface BpWs {
  onopen: (() => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(): void;
}
export type BpWsFactory = (url: string) => BpWs;

export interface ButtplugOptions {
  wsUrl?: string; // 默认 ws://127.0.0.1:12345
  intensity?: number; // 0~1 基础强度倍率
  durationMs?: number; // 每次电击持续时间
  wsFactory?: BpWsFactory; // 测试用
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export class ButtplugShockDevice implements ShockDevice {
  private ws: BpWs | null = null;
  private deviceIndex: number | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private serverInfo: Promise<void>;
  private disposed = false;

  constructor(private opts: ButtplugOptions) {
    const factory = opts.wsFactory ?? ((url: string) => new WebSocket(url) as unknown as BpWs);
    this.serverInfo = this.connect(factory);
  }

  private connect(factory: BpWsFactory): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = factory(this.opts.wsUrl ?? 'ws://127.0.0.1:12345');
      this.ws = ws;
      let settled = false;
      const fail = (e: Error) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      };
      const timeout = setTimeout(() => fail(new Error('连接 Intiface 超时')), 6000);
      ws.onopen = () => {
        this.request('RequestServerInfo', { ClientName: 'heimiaozi-go', MessageVersion: 3 })
          .then(() => {
            settled = true;
            clearTimeout(timeout);
            resolve();
          })
          .catch((e) => {
            clearTimeout(timeout);
            fail(e);
          });
      };
      ws.onmessage = (ev) => this.onServerMessage(ev.data);
      ws.onerror = () => undefined; // 由 onclose 统一处理
      ws.onclose = () => {
        clearTimeout(timeout);
        this.failAllPending(new Error('与 Intiface 的连接已关闭'));
        fail(new Error('连接已关闭'));
      };
    });
  }

  private onServerMessage(raw: string): void {
    let msg: { id?: number; method?: string; result?: unknown; error?: unknown; params?: any };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(String(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    // 服务端主动事件
    if (msg.method === 'DeviceAdded') {
      const params = msg.params ?? {};
      if (this.deviceIndex == null && params.DeviceIndex != null) {
        this.deviceIndex = Number(params.DeviceIndex);
        console.log(`[shock] 已发现设备：${String(params.DeviceName ?? '未知')}（index=${this.deviceIndex}）`);
      }
    }
  }

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.ws) return Promise.reject(new Error('未连接'));
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ JSONRPC: '2.0', id, method, params }));
    });
  }

  /** 等待扫描到郊狼设备 */
  private ensureDevice(): Promise<void> {
    if (this.deviceIndex != null) return Promise.resolve();
    return this.request('StartScanning', {}).then(
      () =>
        new Promise<void>((resolve, reject) => {
          const t0 = Date.now();
          const iv = setInterval(() => {
            if (this.deviceIndex != null) {
              clearInterval(iv);
              resolve();
            } else if (Date.now() - t0 > 10000) {
              clearInterval(iv);
              reject(new Error('扫描超时：未找到郊狼设备（请确认 Intiface 已启动并配对）'));
            }
          }, 200);
        }),
    );
  }

  async trigger(intensity: number): Promise<void> {
    if (this.disposed) throw new Error('设备已释放');
    await this.serverInfo;
    await this.ensureDevice();
    const level = Math.max(0, Math.min(1, intensity * (this.opts.intensity ?? 1)));
    await this.request('VibrateCmd', {
      DeviceIndex: this.deviceIndex,
      Speeds: [{ Index: 0, Speed: level }],
    });
    const dur = this.opts.durationMs ?? 1200;
    await new Promise((r) => setTimeout(r, dur));
    await this.request('StopDeviceCmd', { DeviceIndex: this.deviceIndex });
    console.log(`[shock] 🐺 电击已触发：强度 ${level.toFixed(2)}，持续 ${dur}ms`);
  }

  dispose(): void {
    this.disposed = true;
    this.ws?.close();
    this.ws = null;
  }

  private failAllPending(e: Error): void {
    for (const p of this.pending.values()) p.reject(e);
    this.pending.clear();
  }
}
