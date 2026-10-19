// 위키 API: GET 은 변경 확인(폴링), POST 는 저장/삭제/잠금 등 동작을 처리한다.
// Vercel 함수(api/wiki.js)와 사내용 로컬 서버(server.js)가 이 핸들러를 함께 쓴다.
const { getStore } = require('./store');

const LOCK_TTL = 45000;    // 편집 잠금 유지 시간. 편집 중인 브라우저가 15초마다 연장한다.
const ONLINE_TTL = 20000;  // 이 시간 안에 폴링한 사용자를 "접속 중"으로 본다.
const MAX_BODY = 300000;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

function send(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  // Vercel 은 req.body 를 미리 파싱해 주고, 로컬 서버는 스트림을 직접 읽는다.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString('utf8') || '{}');
    return req.body || {};
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8');
  return s ? JSON.parse(s) : {};
}

function who(req, body) {
  let name = body && body.name;
  if (!name) { try { name = decodeURIComponent(req.headers['x-wiki-name'] || ''); } catch (e) { name = ''; } }
  return {
    client: String((body && body.client) || req.headers['x-wiki-client'] || '').slice(0, 40),
    name: String(name || '익명').slice(0, 30)
  };
}

function cleanPage(p) {
  if (!p || typeof p !== 'object' || !ID.test(String(p.id || ''))) return null;
  const body = String(p.body || '');
  if (body.length > MAX_BODY) return null;
  return {
    id: String(p.id),
    parent: p.parent && ID.test(String(p.parent)) ? String(p.parent) : null,
    title: String(p.title || '').slice(0, 200),
    body,
    created: +p.created || Date.now(),
    updated: +p.updated || Date.now(),
    updatedBy: String(p.updatedBy || '').slice(0, 30),
    version: +p.version || 0
  };
}

function cleanPages(obj) {
  const out = {};
  if (!obj || typeof obj !== 'object') return out;
  Object.keys(obj).slice(0, 5000).forEach(k => { const p = cleanPage(obj[k]); if (p) out[p.id] = p; });
  return out;
}

function lockedByOther(lock, client, now) {
  return lock && lock.exp > now && lock.client !== client ? lock : null;
}

module.exports = async function handler(req, res) {
  try {
    const store = getStore();
    const now = Date.now();

    if (req.method === 'GET') {
      const u = who(req);
      const since = +new URL(req.url, 'http://x').searchParams.get('since');
      const s = await store.snapshot(u.client, { name: u.name, exp: now + ONLINE_TTL });
      const locks = {}, users = [], expiredLocks = [], expiredUsers = [];
      Object.keys(s.locks).forEach(id => {
        const l = s.locks[id];
        if (l.exp > now) locks[id] = { name: l.name, mine: l.client === u.client };
        else expiredLocks.push(id);
      });
      Object.keys(s.presence).forEach(c => {
        if (s.presence[c].exp > now) users.push(s.presence[c].name);
        else expiredUsers.push(c);
      });
      if (expiredLocks.length || expiredUsers.length) await store.prune(expiredLocks, expiredUsers);
      const out = { rev: s.rev, seeded: s.seeded, locks, users };
      if (s.rev !== since) out.pages = await store.getPages();
      return send(res, 200, out);
    }

    if (req.method !== 'POST') return send(res, 405, { error: '지원하지 않는 요청입니다' });
    const b = await readBody(req);
    const u = who(req, b);
    const id = String(b.id || '');

    switch (b.action) {
      case 'save': {
        const p = cleanPage(b.page);
        if (!p) return send(res, 400, { error: '잘못된 페이지 데이터입니다' });
        const { page: cur, lock } = await store.getPageAndLock(p.id);
        const l = lockedByOther(lock, u.client, now);
        if (l) return send(res, 200, { locked: true, by: l.name });
        // 내가 마지막으로 받은 버전과 서버 버전이 다르면 그 사이 누군가 저장한 것
        if (cur && !b.force && (+b.base || 0) !== (cur.version || 0)) return send(res, 200, { conflict: true, page: cur });
        p.version = (cur ? cur.version || 0 : 0) + 1;
        p.updated = now;
        p.updatedBy = u.name;
        if (cur) p.created = cur.created;
        const rev = await store.putPage(p);
        return send(res, 200, { ok: true, page: p, rev });
      }
      case 'delete': {
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).filter(x => ID.test(x));
        const locks = await store.getLocks();
        for (const x of ids) {
          const l = lockedByOther(locks[x], u.client, now);
          if (l) return send(res, 200, { locked: true, by: l.name });
        }
        const rev = await store.delPages(ids);
        return send(res, 200, { ok: true, rev });
      }
      case 'lock': {
        if (!ID.test(id)) return send(res, 400, { error: '잘못된 페이지 ID입니다' });
        const locks = await store.getLocks();
        const l = lockedByOther(locks[id], u.client, now);
        if (l) return send(res, 200, { ok: false, by: l.name });
        await store.setLock(id, { client: u.client, name: u.name, exp: now + LOCK_TTL });
        return send(res, 200, { ok: true });
      }
      case 'unlock': {
        const locks = await store.getLocks();
        if (locks[id] && locks[id].client === u.client) await store.delLock(id);
        return send(res, 200, { ok: true });
      }
      case 'seed': {
        // 처음 한 번만 예시 문서를 채운다 (동시에 여러 명이 접속해도 한 번만 실행)
        const seeded = await store.seedOnce(cleanPages(b.pages));
        return send(res, 200, { ok: true, seeded });
      }
      case 'import': {
        const pages = cleanPages(b.pages);
        if (!Object.keys(pages).length) return send(res, 400, { error: '가져올 페이지가 없습니다' });
        const rev = await store.replaceAll(pages);
        return send(res, 200, { ok: true, rev });
      }
      default:
        return send(res, 400, { error: '알 수 없는 동작입니다' });
    }
  } catch (e) {
    return send(res, 500, { error: String((e && e.message) || e) });
  }
};
