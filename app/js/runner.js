// 시험 진행 시계. ?fast=20 이면 20배 빠르게(확인용), ?notts 면 음성 대신 글자로 보여 줘요.
const params = new URLSearchParams(location.search);
export const FAST = Math.max(1, Number(params.get('fast')) || 1);
export const NO_TTS = params.has('notts');

export class Aborted extends Error {}

export class Runner {
  aborted = false;
  #skip = null;
  skip() { this.#skip?.(); }
  abort() { this.aborted = true; this.#skip?.(); }
  check() { if (this.aborted) throw new Aborted(); }
  onSkip(fn) { this.#skip = fn; }
  // sec: 실제 시험 기준 초. onTick(남은 초, 전체 초)
  wait(sec, onTick) {
    return new Promise((res) => {
      const t0 = performance.now();
      let done = false, iv;
      const finish = () => {
        if (done) return;
        done = true; clearInterval(iv); this.#skip = null; onTick?.(0, sec); res();
      };
      this.#skip = finish;
      onTick?.(sec, sec);
      iv = setInterval(() => {
        const left = sec - ((performance.now() - t0) * FAST) / 1000;
        if (left <= 0) finish(); else onTick?.(left, sec);
      }, 100);
      if (this.aborted) finish();
    });
  }
}
