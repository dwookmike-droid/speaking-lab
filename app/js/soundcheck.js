// 시험 시작 전 소리·마이크 점검. 실제 시험처럼 소리를 들어 보고, 짧게 녹음해서 다시 들어 봐요.
import { hasMic, meter, openMic, speak, startRecording } from './media.js';
import { Runner } from './runner.js';

const SAMPLE = 'This is a sound check. If you can hear this clearly, your volume is fine.';
const SAY = 'My name is ... and I am ready to take the test.';
const REC_SEC = 5;

export const SOUNDCHECK_HTML = `
  <ol class="checklist">
    <li><b>이어폰</b>을 끼고 조용한 곳에서 해요. 실제 시험도 헤드셋을 쓰고 봐요.</li>
    <li>
      <b>소리 확인</b> · 안내 음성이 잘 들리는지 들어 봐요.
      <div class="mic"><button class="btn" id="hear">소리 들어 보기</button><span id="hearmsg" class="muted"></span></div>
    </li>
    <li>
      <b>마이크 확인</b> · 마이크를 켜고 말해 보세요. 막대가 움직이면 돼요.
      <div class="mic"><button class="btn" id="mic">마이크 켜기</button><div class="meter"><i id="lvl"></i></div><span id="micmsg" class="muted"></span></div>
    </li>
    <li>
      <b>녹음 확인</b> · ${REC_SEC}초 동안 <i>"${SAY}"</i>라고 말하면 바로 다시 들려줘요.
      <div class="mic"><button class="btn" id="rectest" disabled>녹음해 보기</button><span id="recmsg" class="muted"></span><audio id="playback" hidden></audio></div>
    </li>
  </ol>`;

// root 안의 SOUNDCHECK_HTML을 움직여요. 마이크가 켜지면 onReady(). 반환값: 멈추는 함수(시작할 때 불러요).
export function wireSoundCheck(root, onReady) {
  const $ = (s) => root.querySelector(s);
  let stopMeter = () => {}, busy = false;
  $('#hear').onclick = async () => {
    $('#hearmsg').textContent = '재생 중…';
    await speak(SAMPLE, new Runner());
    $('#hearmsg').textContent = '잘 안 들리면 기기 볼륨을 올려요.';
  };
  const enable = async () => {
    try {
      await openMic();
      $('#micmsg').textContent = '말해 보세요.';
      stopMeter();
      stopMeter = meter((v) => { const el = $('#lvl'); if (el) el.style.width = `${Math.min(100, v * 250)}%`; });
      $('#rectest').disabled = false;
      onReady();
    } catch {
      $('#micmsg').textContent = '마이크를 쓸 수 없어요. 브라우저 주소창의 마이크 권한을 확인해 주세요.';
    }
  };
  $('#mic').onclick = enable;
  if (hasMic()) enable();
  $('#rectest').onclick = async () => {
    if (busy) return; busy = true;
    const rec = startRecording();
    if (!rec) { $('#recmsg').textContent = '이 브라우저는 녹음을 못 해요.'; busy = false; return; }
    for (let s = REC_SEC; s > 0; s--) { $('#recmsg').textContent = `녹음 중… ${s}`; await new Promise((r) => setTimeout(r, 1000)); }
    const { blob } = await rec.stop();
    const a = $('#playback');
    if (!a) return;
    a.src = URL.createObjectURL(blob); a.hidden = false; a.controls = true;
    $('#recmsg').textContent = '다시 듣는 중이에요. 목소리가 또렷하면 준비 끝이에요.';
    a.play().catch(() => { $('#recmsg').textContent = '▶를 눌러 들어 보세요.'; });
    busy = false;
  };
  return () => stopMeter();
}
