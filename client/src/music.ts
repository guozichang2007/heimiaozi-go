// 对局 98.5% 胜率触发的 BGM：单曲一次性播放，结尾 60 秒音量淡出。
// 把 mp3 命名为 trigger.mp3 放到 client/public/music/ 目录。

export const BGM_VOLUME = 0.6;
export const FADE_SECONDS = 60;
export const TRACK_URL = '/music/trigger.mp3';

/** 淡出进度（0~1）对应的音量倍率（1→0，越界截断） */
export function fadeMultiplier(progress: number): number {
  return Math.max(0, 1 - Math.min(1, Math.max(0, progress)));
}

let audio: HTMLAudioElement | null = null;
let fadeTimer: number | null = null;

function stopFade(): void {
  if (fadeTimer != null) {
    window.clearInterval(fadeTimer);
    fadeTimer = null;
  }
}

/** 播放触发 BGM（每次从头播一遍，末尾 FADE_SECONDS 秒线性淡出到 0） */
export function playTriggerBgm(): void {
  try {
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      audio.src = TRACK_URL;
    }
    stopFade();
    audio.currentTime = 0;
    audio.volume = BGM_VOLUME;
    audio.onended = () => {
      stopFade();
      audio && (audio.currentTime = 0);
    };
    audio.ontimeupdate = () => {
      if (!audio || !audio.duration || audio.duration <= FADE_SECONDS) return;
      if (audio.duration - audio.currentTime <= FADE_SECONDS && fadeTimer == null) startFade();
    };
    // 播放可能被浏览器自动播放策略拦截，静默处理（用户已交互页面时通常可播放）
    audio.play().catch(() => undefined);
  } catch {
    // ignore
  }
}

/** 停止当前 BGM（停止淡出 + 暂停 + 归位） */
export function stopTriggerBgm(): void {
  try {
    stopFade();
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
  } catch {
    // ignore
  }
}

function startFade(): void {
  const stepMs = 100;
  const total = Math.max(1, Math.round((FADE_SECONDS * 1000) / stepMs));
  let i = 0;
  fadeTimer = window.setInterval(() => {
    i++;
    if (audio) audio.volume = BGM_VOLUME * fadeMultiplier(i / total);
    if (i >= total) {
      stopFade();
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }
  }, stepMs);
}
