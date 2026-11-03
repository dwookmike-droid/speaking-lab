// 테스트용 가짜 Supabase: 앱(cloud.js)과 선생님 도구(cloud_sync.py)가 쓰는 엔드포인트만 메모리로 흉내 내요.
// 권한은 "학생은 자기 것, 선생님은 전부"로 단순화했어요. 실제 규칙(RLS)은 tests/test_supabase_rls.py가 Postgres로 확인해요.
// 실행: node tests/mock_supabase.js [포트=8766]   (TEACHER_EMAIL / TEACHER_PASSWORD로 선생님 계정을 미리 만들어요)
const http = require('http'), crypto = require('crypto');
const PORT = Number(process.argv[2] || 8766);
const users = new Map();            // email → {id, password}
const tokens = new Map();           // token → uid
const teachers = new Set();
const T = { speaking_students: new Map(), speaking_invites: new Map(), speaking_attempts: new Map(), speaking_feedback: new Map() };
const PK = { speaking_students: 'id', speaking_invites: 'code', speaking_attempts: 'id', speaking_feedback: 'attempt_id' };
const objects = new Map();          // 'bucket/path' → {data, type}
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

function addUser(email, password) { const u = { id: uuid(), password }; users.set(email.toLowerCase(), u); return u; }
if (process.env.TEACHER_EMAIL) teachers.add(addUser(process.env.TEACHER_EMAIL, process.env.TEACHER_PASSWORD).id);
const session = (u) => { const t = crypto.randomBytes(16).toString('hex'); tokens.set(t, u.id); return { access_token: t, refresh_token: 'r' + t, expires_in: 3600, user: { id: u.id } }; };

const isTeacher = (uid) => teachers.has(uid);
const isStudent = (uid) => { const s = T.speaking_students.get(uid); return !!s && !s.withdrawn_at; };
// 행을 볼 수 있는지 (RLS select)
function visible(table, row, uid) {
  if (isTeacher(uid)) return true;
  if (table === 'speaking_students') return row.id === uid;
  if (table === 'speaking_attempts' || table === 'speaking_feedback') return row.student_id === uid;
  return false;   // invites
}
function parseFilters(q) {
  const f = [];
  for (const [k, v] of q) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    if (v.startsWith('eq.')) f.push((r) => String(r[k]) === decodeURIComponent(v.slice(3)));
    else if (v === 'is.null') f.push((r) => r[k] == null);
    else if (v === 'not.is.null') f.push((r) => r[k] != null);
  }
  return (r) => f.every((fn) => fn(r));
}
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' });
  res.end(body === undefined ? '' : Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const deny = (res, msg = 'new row violates row-level security policy') => send(res, 403, { message: msg, code: '42501' });

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const u = new URL(req.url, 'http://x');
  const json = () => { try { return JSON.parse(raw.toString() || 'null'); } catch { return null; } };
  const uid = tokens.get((req.headers.authorization || '').replace('Bearer ', '')) || null;
  const p = u.pathname;

  // ── 테스트 확인용 ──
  if (p === '/__dump') return send(res, 200, { users: [...users.keys()], tables: Object.fromEntries(Object.entries(T).map(([k, m]) => [k, [...m.values()]])), objects: [...objects.keys()] });

  // ── Auth ──
  if (p === '/auth/v1/signup') {
    const { email, password } = json() || {};
    if (users.has(email.toLowerCase())) return send(res, 422, { msg: 'User already registered' });
    if (!password || password.length < 6) return send(res, 422, { msg: 'Password should be at least 6 characters' });
    return send(res, 200, session(addUser(email, password)));
  }
  if (p === '/auth/v1/token') {
    if (u.searchParams.get('grant_type') === 'refresh_token') {
      const t = (json() || {}).refresh_token?.slice(1); const id = tokens.get(t);
      return id ? send(res, 200, session({ id })) : send(res, 400, { error_description: 'Invalid Refresh Token' });
    }
    const { email, password } = json() || {}; const usr = users.get(String(email).toLowerCase());
    return usr && usr.password === password ? send(res, 200, session(usr)) : send(res, 400, { error_description: 'Invalid login credentials' });
  }
  if (p === '/auth/v1/logout') return send(res, 204);

  if (!uid) return send(res, 401, { message: 'JWT required' });

  // ── RPC ──
  if (p === '/rest/v1/rpc/is_teacher') return send(res, 200, isTeacher(uid));
  if (p === '/rest/v1/rpc/speaking_claim') {
    const { p_code, p_login_id } = json() || {};
    if (T.speaking_students.has(uid)) return send(res, 200, T.speaking_students.get(uid).code);
    const email = [...users.entries()].find(([, x]) => x.id === uid)[0];
    if (email !== `${String(p_login_id).toLowerCase()}@speaking.local`) return deny(res, '아이디가 로그인 계정과 달라요');
    const inv = T.speaking_invites.get(String(p_code).toUpperCase());
    if (!inv || inv.used_at) return deny(res, '등록 코드가 맞지 않거나 이미 쓰였어요');
    T.speaking_students.set(uid, { id: uid, code: inv.student_code, login_id: p_login_id.toLowerCase(), profile: {}, consent: null, consent_history: [], withdrawn_at: null, ended_on: null, created_at: now() });
    Object.assign(inv, { used_by: uid, used_at: now() });
    return send(res, 200, inv.student_code);
  }
  if (p === '/rest/v1/rpc/speaking_withdraw') {
    if (!isStudent(uid)) return deny(res, 'Speaking Lab 학생이 아니에요');
    for (const [k, a] of T.speaking_attempts) if (a.student_id === uid) { T.speaking_attempts.delete(k); T.speaking_feedback.delete(k); }
    Object.assign(T.speaking_students.get(uid), { profile: {}, consent: null, withdrawn_at: now() });
    return send(res, 200, null);
  }

  // ── 표 ──
  const tm = p.match(/^\/rest\/v1\/(speaking_\w+)$/);
  if (tm && T[tm[1]]) {
    const table = tm[1], m = T[table], filt = parseFilters(u.searchParams);
    if (req.method === 'GET') {
      let rows = [...m.values()].filter((r) => visible(table, r, uid) && filt(r));
      if (u.searchParams.get('order')) rows.sort((a, b) => String(a[u.searchParams.get('order')]).localeCompare(String(b[u.searchParams.get('order')])));
      return send(res, 200, rows);
    }
    if (req.method === 'POST') {
      const b = json();
      if (table === 'speaking_invites' && !isTeacher(uid)) return deny(res);
      if (table === 'speaking_feedback' && !isTeacher(uid)) return deny(res);
      if (table === 'speaking_attempts' && !(b.student_id === uid && isStudent(uid))) return deny(res);
      if (m.has(b[PK[table]])) return send(res, 409, { message: 'duplicate key value violates unique constraint', code: '23505' });
      const row = { created_at: now(), ...b };
      if (table === 'speaking_feedback') row.student_id = T.speaking_attempts.get(b.attempt_id)?.student_id;
      m.set(b[PK[table]], row);
      return send(res, 201);
    }
    if (req.method === 'PATCH') {
      const b = json();
      for (const r of [...m.values()].filter((r) => visible(table, r, uid) && filt(r))) {
        if (!isTeacher(uid)) {
          if (table === 'speaking_attempts' && ('pulled_at' in b || 'id' in b || 'student_id' in b)) return deny(res, 'pulled_at은 선생님 도구만 바꿔요');
          if (table === 'speaking_feedback' && 'feedback' in b) return deny(res, '피드백 내용은 선생님만 바꿔요');
          if (table === 'speaking_students' && (r.withdrawn_at || 'code' in b || 'login_id' in b || 'ended_on' in b)) return deny(res);
        }
        Object.assign(r, b, { updated_at: now() });
      }
      return send(res, 204);
    }
    if (req.method === 'DELETE') {
      if (!isTeacher(uid)) return deny(res);
      for (const [k, r] of [...m.entries()]) if (filt(r)) {
        m.delete(k);
        if (table === 'speaking_students') for (const [ak, a] of [...T.speaking_attempts]) if (a.student_id === r.id) { T.speaking_attempts.delete(ak); T.speaking_feedback.delete(ak); }
      }
      return send(res, 204);
    }
  }

  // ── Storage ──
  const own = (path) => path.split('/')[0] === uid;
  let sm;
  if (req.method === 'POST' && (sm = p.match(/^\/storage\/v1\/object\/list\/([^/]+)$/))) {
    const { prefix } = json() || {};
    const names = new Map();
    for (const k of objects.keys()) {
      const [b, ...rest] = k.split('/'); const path = rest.join('/');
      if (b !== sm[1] || !path.startsWith(prefix) || !(own(path) || isTeacher(uid))) continue;
      const tail = path.slice(prefix.length).split('/');
      names.set(tail[0], tail.length > 1 ? { name: tail[0], id: null } : { name: tail[0], id: k });
    }
    return send(res, 200, [...names.values()]);
  }
  if (req.method === 'POST' && (sm = p.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/))) {
    const path = decodeURIComponent(sm[2]);
    if (!(own(path) && isStudent(uid))) return deny(res);
    if (objects.has(`${sm[1]}/${path}`) && req.headers['x-upsert'] !== 'true') return send(res, 409, { message: 'The resource already exists' });
    objects.set(`${sm[1]}/${path}`, { data: raw, type: req.headers['content-type'] });
    return send(res, 200, { Key: `${sm[1]}/${path}` });
  }
  if (req.method === 'GET' && (sm = p.match(/^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/))) {
    const path = decodeURIComponent(sm[2]), o = objects.get(`${sm[1]}/${path}`);
    if (!o || !(own(path) || isTeacher(uid))) return send(res, 404, { message: 'Object not found' });
    return send(res, 200, o.data, o.type);
  }
  if (req.method === 'DELETE' && (sm = p.match(/^\/storage\/v1\/object\/([^/]+)$/))) {
    const { prefixes } = json() || {};
    for (const path of prefixes || []) if (own(path) || isTeacher(uid)) objects.delete(`${sm[1]}/${path}`);
    return send(res, 200, []);
  }
  send(res, 404, { message: `mock: ${req.method} ${p} 없음` });
}).listen(PORT, () => console.log(`mock supabase :${PORT}`));
