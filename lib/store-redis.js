// Upstash Redis REST API 저장소. npm 패키지 없이 fetch 만 사용한다.
// wiki:pages(해시: id → 페이지 JSON), wiki:rev(변경 번호), wiki:locks, wiki:online, wiki:seeded
module.exports = function redisStore(url, token) {
  url = url.replace(/\/$/, '');
  const headers = { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
  const K = { pages: 'wiki:pages', rev: 'wiki:rev', locks: 'wiki:locks', online: 'wiki:online', seeded: 'wiki:seeded' };

  async function pipe(cmds) {
    const r = await fetch(url + '/pipeline', { method: 'POST', headers, body: JSON.stringify(cmds) });
    if (!r.ok) throw new Error('Redis 오류 ' + r.status + ': ' + (await r.text()).slice(0, 200));
    return (await r.json()).map(x => {
      if (x.error) throw new Error('Redis: ' + x.error);
      return x.result;
    });
  }
  function hash(arr) {
    const o = {};
    for (let i = 0; arr && i < arr.length; i += 2) { try { o[arr[i]] = JSON.parse(arr[i + 1]); } catch (e) {} }
    return o;
  }

  const store = {
    async snapshot(client, presence) {
      const cmds = client ? [['HSET', K.online, client, JSON.stringify(presence)]] : [];
      const o = cmds.length;
      cmds.push(['GET', K.rev], ['GET', K.seeded], ['HGETALL', K.locks], ['HGETALL', K.online]);
      const r = await pipe(cmds);
      return { rev: +r[o] || 0, seeded: !!r[o + 1], locks: hash(r[o + 2]), presence: hash(r[o + 3]) };
    },
    async getPages() {
      return hash((await pipe([['HGETALL', K.pages]]))[0]);
    },
    async getPageAndLock(id) {
      const [p, l] = await pipe([['HGET', K.pages, id], ['HGET', K.locks, id]]);
      return { page: p ? JSON.parse(p) : null, lock: l ? JSON.parse(l) : null };
    },
    async getLocks() {
      return hash((await pipe([['HGETALL', K.locks]]))[0]);
    },
    async putPage(p) {
      return (await pipe([['HSET', K.pages, p.id, JSON.stringify(p)], ['INCR', K.rev]]))[1];
    },
    async delPages(ids) {
      if (!ids.length) return +(await pipe([['GET', K.rev]]))[0] || 0;
      return (await pipe([['HDEL', K.pages, ...ids], ['HDEL', K.locks, ...ids], ['INCR', K.rev]]))[2];
    },
    async setLock(id, lock) {
      await pipe([['HSET', K.locks, id, JSON.stringify(lock)]]);
    },
    async delLock(id) {
      await pipe([['HDEL', K.locks, id]]);
    },
    async prune(lockIds, onlineIds) {
      const cmds = [];
      if (lockIds.length) cmds.push(['HDEL', K.locks, ...lockIds]);
      if (onlineIds.length) cmds.push(['HDEL', K.online, ...onlineIds]);
      if (cmds.length) await pipe(cmds);
    },
    async seedOnce(pages) {
      const [ok] = await pipe([['SET', K.seeded, '1', 'NX']]);
      if (ok !== 'OK') return false;
      await store.replaceAll(pages);
      return true;
    },
    async replaceAll(pages) {
      const flat = [];
      Object.keys(pages).forEach(id => flat.push(id, JSON.stringify(pages[id])));
      const cmds = [['DEL', K.pages]];
      if (flat.length) cmds.push(['HSET', K.pages, ...flat]);
      cmds.push(['SET', K.seeded, '1'], ['INCR', K.rev]);
      const r = await pipe(cmds);
      return r[r.length - 1];
    }
  };
  return store;
};
