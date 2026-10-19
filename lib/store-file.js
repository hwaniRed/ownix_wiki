// 로컬 JSON 파일 저장소 (사내/폐쇄망 서버용). DB 없이 data/wiki.json 한 파일에 저장한다.
// 서버 프로세스 하나가 메모리에 들고 있다가 바뀔 때마다 파일에 쓴다. 잠금과 접속자 정보는 메모리에만 둔다.
const fs = require('fs');
const path = require('path');

module.exports = function fileStore(file) {
  let d = { rev: 0, seeded: false, pages: {} };
  try { d = Object.assign(d, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (e) {}
  const locks = {}, online = {};
  const clone = o => JSON.parse(JSON.stringify(o));

  function write() {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.tmp', JSON.stringify(d, null, 1));
    fs.renameSync(file + '.tmp', file);  // 쓰는 도중 꺼져도 파일이 깨지지 않게
  }

  return {
    async snapshot(client, presence) {
      if (client) online[client] = presence;
      return { rev: d.rev, seeded: d.seeded, locks: clone(locks), presence: clone(online) };
    },
    async getPages() { return clone(d.pages); },
    async getPageAndLock(id) {
      return { page: d.pages[id] ? clone(d.pages[id]) : null, lock: locks[id] || null };
    },
    async getLocks() { return clone(locks); },
    async putPage(p) { d.pages[p.id] = p; d.rev++; write(); return d.rev; },
    async delPages(ids) {
      ids.forEach(id => { delete d.pages[id]; delete locks[id]; });
      d.rev++; write(); return d.rev;
    },
    async setLock(id, lock) { locks[id] = lock; },
    async delLock(id) { delete locks[id]; },
    async prune(lockIds, onlineIds) {
      lockIds.forEach(k => delete locks[k]);
      onlineIds.forEach(k => delete online[k]);
    },
    async seedOnce(pages) {
      if (d.seeded) return false;
      d.seeded = true; d.pages = pages; d.rev++; write();
      return true;
    },
    async replaceAll(pages) { d.pages = pages; d.seeded = true; d.rev++; write(); return d.rev; }
  };
};
