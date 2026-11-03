// 선생님께 보내기(제출 꾸러미) · 피드백 불러오기. 형식은 schema/FEEDBACK.md.
import { makeZip } from './zip.js';
import { getAttempt, getProfile, getRecording, getSetting, listAttempts, putAttempt } from './store.js';
import { cloud } from './cloud.js';

const EXT = (mime = '') => (mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm');
const pad = (n) => String(n).padStart(2, '0');
const asciiTag = (email) => (email || 'student').split('@')[0].replace(/[^a-z0-9._-]/gi, '') || 'student';

export async function buildSubmission(attemptId, set) {
  const [attempt, profile] = await Promise.all([getAttempt(attemptId), getProfile()]);
  if (!attempt || !profile) throw new Error('응시 기록이나 학생 정보를 찾지 못했어요.');
  const files = [], items = [];
  for (const it of set.items) {
    const rec = await getRecording(attempt.id, it.num).catch(() => null);
    if (!rec?.blob?.size) continue;
    const file = `audio/q${pad(it.num)}.${EXT(rec.blob.type)}`;
    files.push({ name: file, data: rec.blob });
    items.push({ num: it.num, file, mime: rec.blob.type, ms: rec.ms, ...(it.qid ? { qid: it.qid, type: it.type } : {}) });
  }
  if (!items.length) throw new Error('보낼 녹음이 없어요.');
  const manifest = {
    type: 'speaking_submission', version: 1, created_at: new Date().toISOString(),
    student: { name: profile.name, email: profile.email, phone: profile.phone, under14: profile.under14, exams: profile.exams, targets: profile.targets },
    consent: profile.consent, consent_history: profile.consent_history || [], guardian: profile.guardian || null,
    attempt: {
      id: attempt.id, exam: attempt.exam, set_id: attempt.setId,
      target: getSetting(`target.${attempt.exam}`, attempt.target),
      started_at: attempt.startedAt, finished_at: attempt.finishedAt, no_mic: !!attempt.noMic,
      ...(attempt.exam === 'opic' ? { self_assessment: attempt.plan?.sa, readjust: attempt.readjust || null, difficulty: attempt.d, survey_topics: attempt.plan?.survey_topics } : {}),
    },
    items,
  };
  const blob = await makeZip([{ name: 'manifest.json', data: JSON.stringify(manifest, null, 1) }, ...files]);
  const name = `speaking-lab_${asciiTag(profile.email)}_${attempt.setId}_${attempt.id}.zip`;
  return { blob, name, count: items.length, attempt };
}

// 휴대폰이면 공유창(카톡 등)으로, 안 되면 내려받기로.
export async function shareOrDownload(blob, name) {
  const file = new File([blob], name, { type: 'application/zip' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Speaking Lab 녹음 제출' }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'canceled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  return 'downloaded';
}

export async function markSubmitted(attempt) {
  attempt.submittedAt = new Date().toISOString();
  await putAttempt(attempt);
}

// feedback.json 확인 → 해당 응시 기록에 붙여요. 붙인 응시 ID를 돌려줘요.
export async function importFeedback(file) {
  let fb;
  try { fb = JSON.parse(await file.text()); } catch { throw new Error('피드백 파일을 읽지 못했어요. 선생님이 보낸 .json 파일인지 확인해 주세요.'); }
  if (fb?.type !== 'speaking_feedback' || fb.version !== 1 || !Array.isArray(fb.items)) throw new Error('Speaking Lab 피드백 파일이 아니에요.');
  const attempt = await getAttempt(fb.attempt_id);
  if (!attempt) throw new Error('이 피드백에 맞는 응시 기록이 이 기기에 없어요. 응시한 기기에서 불러와 주세요.');
  if (attempt.setId !== fb.set_id) throw new Error('피드백의 세트가 응시 기록과 달라요.');
  attempt.feedback = { ...fb, imported_at: new Date().toISOString() };
  await putAttempt(attempt);
  return attempt.id;
}

// ── 서버 모드: 녹음을 Supabase에 올리고 응시 기록을 남겨요 ──────────────
export async function cloudSubmit(attemptId, set, onProgress = () => {}) {
  const attempt = await getAttempt(attemptId);
  if (!attempt) throw new Error('응시 기록을 찾지 못했어요.');
  const recs = [];
  for (const it of set.items) {
    const rec = await getRecording(attempt.id, it.num).catch(() => null);
    if (rec?.blob?.size) recs.push({ it, rec });
  }
  if (!recs.length) throw new Error('보낼 녹음이 없어요.');
  const items = [];
  for (const [i, { it, rec }] of recs.entries()) {
    const file = `audio/q${pad(it.num)}.${EXT(rec.blob.type)}`;
    onProgress(i, recs.length);
    await cloud.uploadAudio(`${cloud.uid}/${attempt.id}/${file.slice(6)}`, rec.blob);
    items.push({ num: it.num, file, mime: rec.blob.type, ms: rec.ms, ...(it.qid ? { qid: it.qid, type: it.type } : {}) });
  }
  onProgress(recs.length, recs.length);
  const meta = attempt.exam === 'opic'
    ? { self_assessment: attempt.plan?.sa, readjust: attempt.readjust || null, difficulty: attempt.d, survey_topics: attempt.plan?.survey_topics, no_mic: !!attempt.noMic }
    : { no_mic: !!attempt.noMic };
  const now = new Date().toISOString();
  await cloud.saveAttempt({
    id: attempt.id, exam: attempt.exam, set_id: attempt.setId, target: getSetting(`target.${attempt.exam}`, attempt.target),
    meta, items, started_at: attempt.startedAt, finished_at: attempt.finishedAt, submitted_at: now,
  });
  attempt.submittedAt = now;
  await putAttempt(attempt);
  return { count: items.length, attempt };
}

// 서버에 도착한 피드백을 기기의 응시 기록에 붙여요. 새로 붙은 수를 돌려줘요.
export async function syncFeedback() {
  if (!cloud.enabled || !cloud.session()) return 0;
  const rows = await cloud.feedbackList();
  let n = 0;
  for (const r of rows || []) {
    const a = await getAttempt(r.attempt_id);
    if (!a || a.feedback?.created_at === r.feedback?.created_at) continue;
    a.feedback = { ...r.feedback, imported_at: new Date().toISOString(), cloud: true, read_at: r.read_at };
    await putAttempt(a); n++;
  }
  return n;
}
