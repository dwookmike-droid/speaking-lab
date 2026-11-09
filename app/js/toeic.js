// 토익스피킹 시험 진행 엔진. 시간·순서는 data.format(= schema/exam_formats.yaml)만 따라요.
import { beep, speak, startRecording, ttsWorking } from './media.js';
import { putAttempt, putRecording } from './store.js';

export function fillDirections(tpl, part) {
  return String(tpl || '')
    .replaceAll('{prep}', part.prep).replaceAll('{read}', part.read ?? '')
    .replaceAll('{speak}', part.speak?.[0] ?? '');
}

// attempt.next 번 문항부터 끝까지 진행해요. 중간에 runner.abort()가 오면 Aborted를 던져요.
export async function runToeic({ data, set, attempt, ui, runner }) {
  const byNum = new Map(set.items.map((it) => [it.num, it]));

  async function respond(item, prep, speakSec) {
    if (prep > 0) {
      if (prep >= 10) { ui.phase('prep_cue'); await speak('Begin preparing now.', runner); runner.check(); }
      ui.phase('prep', prep);
      await runner.wait(prep, ui.tick); runner.check();
    }
    ui.phase('beep');
    if (prep >= 10) { await speak('Begin speaking now.', runner); runner.check(); }
    await beep(); runner.check();
    ui.phase('speak', speakSec);
    const rec = startRecording();
    ui.recording(!!rec);
    await runner.wait(speakSec, ui.tick);
    const res = rec ? await rec.stop() : null;
    ui.recording(false);
    runner.check();                        // 그만두기로 끊긴 답변은 저장하지 않아요
    if (res) await putRecording(attempt.id, item.num, res);
    attempt.answered = [...new Set([...(attempt.answered || []), item.num])];
    attempt.next = item.num + 1;
    await putAttempt(attempt);
  }

  async function listen(text) {
    ui.phase('listen');
    await speak(text, runner); runner.check();
  }

  for (const part of data.format.parts) {
    const nums = part.items.filter((n) => n >= attempt.next);
    if (!nums.length) continue;
    const fresh = nums[0] === part.items[0];   // 파트 처음부터인지(이어하기면 안내를 건너뛰어요)
    const dir = data.directions[part.type] || {};

    if (fresh) {
      ui.part(part, { title: dir.title, en: fillDirections(dir.en, part), ko: fillDirections(dir.ko, part) });
      ui.phase('directions');
      await speak(fillDirections(dir.en, part), runner); runner.check();
    }

    const first = byNum.get(part.items[0]);
    if (part.type === 'respond_q' && fresh) {
      ui.item(first, { part, context: first.context, showQuestion: false });
      await listen(first.context);
    }
    if (part.type === 'info_based') {
      ui.item(first, { part, info: first.info, showQuestion: false });
      if (fresh) {
        ui.phase('read', part.read);
        await runner.wait(part.read, ui.tick); runner.check();
        await listen(first.caller_intro);
      }
    }

    for (const n of nums) {
      const item = byNum.get(n);
      const i = part.items.indexOf(n);
      const speakSec = part.speak[i];
      switch (part.type) {
        case 'read_aloud':
        case 'describe_photo':
          ui.item(item, { part });
          await respond(item, part.prep, speakSec);
          break;
        case 'respond_q':
          ui.item(item, { part, context: first.context, showQuestion: true });
          await listen(item.question);
          await respond(item, part.prep, speakSec);
          break;
        case 'info_based': {
          // 질문은 소리로만 나가요. 음성이 안 되는 브라우저에서만 글자로 보여 줘요.
          ui.item(item, { part, info: first.info, showQuestion: !ttsWorking() });
          const times = (i === part.items.length - 1 && part.repeat_last) || 1;
          for (let k = 0; k < times; k++) await listen(item.question);
          if (!ttsWorking()) ui.item(item, { part, info: first.info, showQuestion: true });
          await respond(item, part.prep, speakSec);
          break;
        }
        case 'opinion':
          ui.item(item, { part, showQuestion: true });
          await listen(item.question);
          await respond(item, part.prep, speakSec);
          break;
        default:
          throw new Error(`모르는 파트 유형: ${part.type}`);
      }
    }
  }
  attempt.finishedAt = new Date().toISOString();
  await putAttempt(attempt);
}
