// 마이크·녹음·신호음·문항 음성(브라우저 TTS).
import { NO_TTS } from './runner.js';

let stream = null, ctx = null, ttsFailed = false;
const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());

export async function openMic() {
  if (stream) return stream;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  ac().resume?.();
  return stream;
}
export const hasMic = () => !!stream;

export function meter(cb) {
  if (!stream) return () => {};
  const c = ac(), src = c.createMediaStreamSource(stream), an = c.createAnalyser();
  an.fftSize = 512; src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let raf, on = true;
  const loop = () => {
    if (!on) return;
    an.getByteTimeDomainData(buf);
    let m = 0; for (const v of buf) m = Math.max(m, Math.abs(v - 128));
    cb(m / 128);
    if (on) raf = requestAnimationFrame(loop);
  };
  loop();
  return () => { if (!on) return; on = false; cancelAnimationFrame(raf); src.disconnect(); };
}

// 시험 중 녹음 표시: 레벨 막대가 움직이고, 몇 초 동안 소리가 안 잡히면 경고를 띄워요.
export const REC_HTML = `<div id="rec" class="rec" hidden><span class="dot">● 녹음 중</span><span class="meter sm"><i></i></span><span class="quiet">소리가 안 잡혀요. 마이크를 확인해 주세요.</span></div>`;
const QUIET_LEVEL = 0.03, QUIET_SEC = 4;
export function recIndicator(el) {
  let stop = () => {};
  return (on) => {
    stop(); stop = () => {};
    el.hidden = !on; el.classList.remove('silent');
    if (!on || !stream) return;
    const bar = el.querySelector('i');
    let lastSound = performance.now();
    stop = meter((v) => {
      if (!el.isConnected) return stop();           // 그만두기 등으로 화면이 바뀌면 멈춰요
      bar.style.width = `${Math.min(100, v * 250)}%`;
      const now = performance.now();
      if (v > QUIET_LEVEL) lastSound = now;
      el.classList.toggle('silent', now - lastSound > QUIET_SEC * 1000);
    });
  };
}

export function beep() {
  return new Promise((res) => {
    setTimeout(res, 500);
    try {
      const c = ac(), o = c.createOscillator(), g = c.createGain();
      o.frequency.value = 880; g.gain.value = 0.15;
      o.connect(g).connect(c.destination);
      o.start(); o.stop(c.currentTime + 0.35);
    } catch { /* 소리를 못 내도 진행은 계속 */ }
  });
}

const MIMES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
export function startRecording() {
  if (!stream || typeof MediaRecorder === 'undefined') return null;
  const mimeType = MIMES.find((m) => MediaRecorder.isTypeSupported?.(m));
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : {});
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  rec.start(250);
  const t0 = performance.now();
  return {
    stop: () => new Promise((res) => {
      const done = () => res({ blob: new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' }), ms: Math.round(performance.now() - t0) });
      if (rec.state === 'inactive') return done();
      rec.onstop = done; rec.stop();
    }),
  };
}

export const ttsAvailable = () => !NO_TTS && 'speechSynthesis' in window;
export const ttsWorking = () => ttsAvailable() && !ttsFailed;   // 한 번이라도 실패하면 질문을 글자로 보여 줘요
let voice;
function pickVoice() {
  if (voice !== undefined) return voice;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => v.lang === 'en-US' && /natural|google|samantha/i.test(v.name)) || vs.find((v) => v.lang?.startsWith('en')) || null;
  return voice;
}
// 문항 음성. TTS가 없으면 읽는 시간만큼 기다려요. 건너뛰기로 끊을 수 있어요.
export function speak(text, runner) {
  const words = String(text || '').split(/\s+/).filter(Boolean).length;
  if (!words) return Promise.resolve();
  const readTime = Math.max(2, words * 0.35);       // 음성이 없을 때 글을 읽는 시간
  if (!ttsAvailable() || !speechSynthesis.getVoices().length && ttsFailed) return runner.wait(readTime);
  return new Promise((res) => {
    let done = false, to;
    const fin = () => { if (done) return; done = true; clearTimeout(to); runner.onSkip(null); res(); };
    const fail = () => {                               // 음성 엔진 오류: 읽는 시간만큼 기다려요
      if (done) return; done = true; clearTimeout(to); ttsFailed = true;
      runner.wait(readTime).then(res);
    };
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 0.95;
    const v = pickVoice(); if (v) u.voice = v;
    u.onend = fin;
    u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? fin() : fail());
    to = setTimeout(fin, (words * 0.5 + 3) * 1000);    // onend가 안 오는 브라우저 대비
    runner.onSkip(() => { speechSynthesis.cancel(); fin(); });
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
    if (runner.aborted) { speechSynthesis.cancel(); fin(); }
  });
}
export function stopSpeaking() { try { speechSynthesis.cancel(); } catch { /* 없음 */ } }
