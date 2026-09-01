/**
 * 电刺激设备抽象层（隐藏功能：玩家落子后胜率大跌时触发郊狼电击）。
 * 不涉及任何网页端功能与显示；未启用/未连接设备时为空实现。
 */
import { ButtplugShockDevice, ButtplugOptions } from './buttplug';
import { SHOCK_ENABLED, SHOCK_INTENSITY, SHOCK_WS_URL, SHOCK_DURATION_MS } from '../config';

export interface ShockDevice {
  /** 触发一次电击，intensity 0~1 */
  trigger(intensity: number): Promise<void>;
  dispose(): void;
}

/** 未连接设备/未启用时的空实现：仅在服务端控制台记录，不影响对局 */
export class NoopShockDevice implements ShockDevice {
  async trigger(intensity: number): Promise<void> {
    console.log(`[shock] 🔌 触发电击请求（未启用设备，仅记录）：强度 ${intensity.toFixed(2)}`);
  }
  dispose(): void {}
}

/** 按配置创建设备：SHOCK_ENABLED=true 时走 Intiface/郊狼，否则空实现 */
export function createShockDevice(): ShockDevice {
  if (!SHOCK_ENABLED) {
    console.log('[shock] 隐藏电击功能未启用（SHOCK_ENABLED=false）。开启：设置环境变量 SHOCK_ENABLED=true');
    return new NoopShockDevice();
  }
  console.log(`[shock] 🐺 电击功能已启用，连接 Intiface（${SHOCK_WS_URL}）…`);
  const opts: ButtplugOptions = {
    wsUrl: SHOCK_WS_URL,
    intensity: SHOCK_INTENSITY,
    durationMs: SHOCK_DURATION_MS,
  };
  return new ButtplugShockDevice(opts);
}
