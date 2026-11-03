// OPIc 모의고사: 설문·자가평가로 문항을 조합하고(blueprint), 질문 듣기 → 녹음 → 다음 문제로 진행해요.
// 시간·구성은 data.format(= schema/exam_formats.yaml opic)만 따라요.
import { speak, startRecording, ttsWorking } from './media.js';
import { putAttempt, putRecording } from './store.js';
import { FAST } from './runner.js';
import { findQuestion, planRest, planRestCount } from './opic_plan.js';
export { bandOf, findQuestion, planExam, planFirst, planRest } from './opic_plan.js';

// ── 진행 ─────────────────────────────────────────
// ui: question(n, total, q, {showText}), phase(kind, sec?), tick(sec, total?), recording(on), replay(enabled), readjust() → 'easier'|'same'|'harder', clock(leftSec)
export async function runOpic({ data, attempt, ui, runner }) {
  const F = data.format;
  const deadline = () => attempt.deadline ? (new Date(attempt.deadline) - Date.now()) / 1000 : Infinity;
  if (!attempt.deadline) { attempt.deadline = new Date(Date.now() + (F.total_minutes * 60 * 1000) / FAST).toISOString(); await putAttempt(attempt); }

  const total = () => attempt.questions.length + (attempt.d ? 0 : planRestCount(data, attempt.plan));
  while (attempt.next <= attempt.questions.length || !attempt.d) {
    if (attempt.next > F.readjust_after && !attempt.d) {
      ui.phase('readjust');
      const choice = await ui.readjust(); runner.check();
      attempt.d = Math.min(F.self_assessment_levels, Math.max(1, attempt.plan.sa + (F.readjust_options[choice] ?? 0)));
      attempt.readjust = choice;
      const rest = planRest(data, attempt.plan, attempt.d);
      attempt.questions.push(...rest.map((q, i) => ({ ...q, num: attempt.questions.length + i + 1 })));
      await putAttempt(attempt);
      continue;
    }
    if (deadline() <= 0) break;
    const item = attempt.questions[attempt.next - 1];
    const q = findQuestion(data, item.qid);
    ui.question(item.num, total(), q, { showText: !ttsWorking() });
    ui.clock(deadline());
    ui.phase('listen');
    await speak(q.question, runner); runner.check();
    if (!ttsWorking()) ui.question(item.num, total(), q, { showText: true });

    // 5초 안에 다시 듣기 한 번
    let replayed = false;
    ui.replay(true, async () => {
      if (replayed) return; replayed = true; ui.replay(false);
      runner.skip();                               // 5초 대기를 끝내고 다시 들려줘요
    });
    ui.phase('replay_window', 5);
    await runner.wait(5, ui.tick); runner.check();
    if (replayed) { ui.phase('listen'); await speak(q.question, runner); runner.check(); }
    ui.replay(false);

    ui.phase('speak', F.max_speak);
    const rec = startRecording();
    ui.recording(!!rec);
    await runner.wait(Math.min(F.max_speak, Math.max(1, deadline() * FAST)), (left, tot) => { ui.tick(left, tot); ui.clock(deadline()); });
    const res = rec ? await rec.stop() : null;
    ui.recording(false);
    runner.check();
    if (res) await putRecording(attempt.id, item.num, res);
    attempt.answered = [...new Set([...(attempt.answered || []), item.num])];
    attempt.next = item.num + 1;
    await putAttempt(attempt);
  }
  attempt.finishedAt = new Date().toISOString();
  attempt.timedOut = deadline() <= 0;
  await putAttempt(attempt);
}
