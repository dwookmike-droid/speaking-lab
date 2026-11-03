// Supabase(R&R archive) 연결. SDK 없이 REST(GoTrue·PostgREST·Storage)를 직접 불러요 — rw-english와 같은 방식.
// 규칙은 supabase/001_speaking.sql(RLS)이 지켜요. 이 파일은 학생 자기 데이터만 다뤄요.
// ?sb=off 면 서버 없이(기기 안에서만), ?sb=http://localhost:8766 처럼 주면 그 주소로 붙어요(테스트용).
import { CONFIG } from '../config.js';

const params = new URLSearchParams(location.search);
const override = params.get('sb');
const URL_ = (override === 'off' ? '' : (override || CONFIG.SUPABASE_URL || '')).replace(/\/+$/, '');
const KEY = CONFIG.SUPABASE_KEY || '';
const SKEY = 'speakinglab.session';   // 'sl.'로 시작하면 clearAll()이 같이 지워요

export class CloudError extends Error {
  constructor(msg, status, body) { super(msg); this.status = status; this.body = body; }
}

const getS = () => { try { return JSON.parse(localStorage.getItem(SKEY)) || null; } catch { return null; } };
const setS = (s) => { try { s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY); } catch { /* 없음 */ } };
const store = (j) => {
  const s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000,
    uid: j.user?.id || getS()?.uid, login_id: j.login_id || getS()?.login_id };
  setS(s); return s;
};

export const loginEmail = (id) => `${String(id).trim().toLowerCase()}@${CONFIG.LOGIN_DOMAIN}`;
const password = (pin) => `${pin}${CONFIG.PIN_SUFFIX}`;
export const LOGIN_RE = /^[a-z0-9._-]{3,30}$/;
export const PIN_RE = /^\d{4,8}$/;

async function req(method, path, { body, headers = {}, auth = true, raw = false } = {}) {
  let s = auth ? await fresh() : null;
  if (auth && !s) throw new CloudError('로그인이 필요해요.', 401);
  let r;
  try {
    r = await fetch(`${URL_}${path}`, {
      method,
      headers: { apikey: KEY, Authorization: `Bearer ${s?.access_token || KEY}`,
        ...(body instanceof Blob ? {} : body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch { throw new CloudError('서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.', 0); }
  if (raw) return r;
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { j = text; }
  if (!r.ok) throw new CloudError(j?.message || j?.msg || j?.error_description || j?.error || `서버 오류 (${r.status})`, r.status, j);
  return j;
}

async function fresh() {
  const s = getS();
  if (!s) return null;
  if (s.expires_at - Date.now() > 60000 || !s.refresh_token) return s;
  try {
    const r = await fetch(`${URL_}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: s.refresh_token }),
    });
    const j = await r.json();
    if (j?.access_token) return store({ ...j, login_id: s.login_id });
    if (r.status === 400 || r.status === 401) { setS(null); return null; }   // 갱신 토큰이 죽었으면 다시 로그인
  } catch { /* 오프라인: 기존 토큰으로 시도 */ }
  return s;
}

export const cloud = {
  get enabled() { return !!(URL_ && KEY); },
  get uid() { return getS()?.uid || null; },
  get loginId() { return getS()?.login_id || null; },
  session: () => getS(),

  async signIn(loginId, pin) {
    const j = await req('POST', '/auth/v1/token?grant_type=password', { auth: false, body: { email: loginEmail(loginId), password: password(pin) } })
      .catch((e) => { throw e.status === 400 ? new CloudError('아이디나 PIN이 맞지 않아요.', 400) : e; });
    return store({ ...j, login_id: loginId.trim().toLowerCase() });
  },
  async signUp(loginId, pin) {
    const j = await req('POST', '/auth/v1/signup', { auth: false, body: { email: loginEmail(loginId), password: password(pin) } })
      .catch((e) => { throw /registered|exists/i.test(e.message) || e.status === 422 ? new CloudError('이미 있는 아이디예요. 로그인해 주세요.', 422) : e; });
    if (!j?.access_token) throw new CloudError('계정을 만들지 못했어요. 선생님께 알려 주세요.', 500, j);
    return store({ ...j, login_id: loginId.trim().toLowerCase() });
  },
  async claim(code, loginId) {
    return req('POST', '/rest/v1/rpc/speaking_claim', { body: { p_code: code, p_login_id: loginId } })
      .catch((e) => { throw new CloudError(/등록 코드|아이디/.test(e.message) ? e.message : '등록 코드를 확인하지 못했어요.', e.status); });
  },
  signOut() {
    const s = getS(); setS(null);
    if (s?.access_token) fetch(`${URL_}/auth/v1/logout`, { method: 'POST', keepalive: true, headers: { apikey: KEY, Authorization: `Bearer ${s.access_token}` } }).catch(() => {});
  },

  async me() {
    const uid = this.uid; if (!uid) return null;
    const rows = await req('GET', `/rest/v1/speaking_students?select=code,login_id,profile,consent,consent_history,withdrawn_at&id=eq.${uid}`);
    return rows?.[0] || null;
  },
  async saveProfile({ profile, consent, consent_history }) {
    await req('PATCH', `/rest/v1/speaking_students?id=eq.${this.uid}`, { body: { profile, consent, consent_history }, headers: { Prefer: 'return=minimal' } });
  },

  // 녹음 올리기 → 응시 기록 저장(제출). 같은 응시를 다시 보내면 덮어써요.
  async uploadAudio(path, blob) {
    await req('POST', `/storage/v1/object/${CONFIG.AUDIO_BUCKET}/${path}`, { body: blob, headers: { 'x-upsert': 'true', 'Content-Type': blob.type || 'audio/webm' } });
  },
  async saveAttempt(row) {
    const body = { ...row, student_id: this.uid };
    try {
      await req('POST', '/rest/v1/speaking_attempts', { body, headers: { Prefer: 'return=minimal' } });
    } catch (e) {
      if (e.status !== 409) throw e;
      const { id, student_id, ...upd } = body;                  // 이미 있으면 바꿀 수 있는 칸만 고쳐요
      await req('PATCH', `/rest/v1/speaking_attempts?id=eq.${encodeURIComponent(id)}`, { body: upd, headers: { Prefer: 'return=minimal' } });
    }
  },
  async feedbackList() {
    return req('GET', '/rest/v1/speaking_feedback?select=attempt_id,feedback,created_at,read_at');
  },
  async markRead(attemptId) {
    await req('PATCH', `/rest/v1/speaking_feedback?attempt_id=eq.${encodeURIComponent(attemptId)}`, { body: { read_at: new Date().toISOString() }, headers: { Prefer: 'return=minimal' } });
  },

  // 동의 철회: 내 녹음 파일 → 응시 기록·정보(서버 함수) 순서로 지워요.
  async withdraw() {
    const uid = this.uid;
    const list = (prefix) => req('POST', `/storage/v1/object/list/${CONFIG.AUDIO_BUCKET}`, { body: { prefix, limit: 1000, offset: 0 } });
    const paths = [];
    for (const dir of (await list(`${uid}/`)) || []) {
      for (const f of (await list(`${uid}/${dir.name}/`)) || []) paths.push(`${uid}/${dir.name}/${f.name}`);
    }
    if (paths.length) await req('DELETE', `/storage/v1/object/${CONFIG.AUDIO_BUCKET}`, { body: { prefixes: paths } });
    await req('POST', '/rest/v1/rpc/speaking_withdraw', { body: {} });
    return paths.length;
  },
};
