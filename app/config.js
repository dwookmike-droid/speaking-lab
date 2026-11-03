// 배포 설정. 비워 두면 서버 없이 기기 안에서만 동작해요(제출은 zip 파일로).
// publishable(anon) 키는 브라우저에 실려도 되는 키예요. 데이터는 supabase/001_speaking.sql의 규칙(RLS)이 지켜요.
export const CONFIG = {
  SUPABASE_URL: 'https://abaakjkidxsnfigqfcbx.supabase.co',     // R&R archive
  SUPABASE_KEY: 'sb_publishable_v1VeCcFo-iQzeP4tpug0ew_AIkyzaSI',
  LOGIN_DOMAIN: 'speaking.local',                               // 아이디 → <아이디>@speaking.local (메일을 보내지 않아요)
  PIN_SUFFIX: '-spk',                                           // Supabase 비밀번호 최소 6자 때문에 PIN 뒤에 붙여요
  AUDIO_BUCKET: 'speaking-audio',
};
