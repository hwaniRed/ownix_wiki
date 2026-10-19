// 저장소 선택: Redis 환경 변수가 있으면 Upstash Redis(Vercel), 없으면 로컬 JSON 파일(사내 서버).
const path = require('path');

let instance = null;

exports.getStore = function getStore() {
  if (instance) return instance;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    instance = require('./store-redis')(url, token);
  } else if (process.env.VERCEL) {
    // Vercel 함수의 디스크는 요청이 끝나면 사라지므로 파일 저장을 쓰면 데이터가 날아간다
    throw new Error('공유 저장소(Upstash Redis)가 연결되지 않았습니다. README의 배포 방법을 확인하세요.');
  } else {
    instance = require('./store-file')(process.env.WIKI_DATA || path.join(__dirname, '..', 'data', 'wiki.json'));
  }
  return instance;
};
