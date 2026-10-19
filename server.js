// 사내/폐쇄망용 서버: `node server.js` 한 줄로 실행. 외부 패키지 없음.
// 데이터는 data/wiki.json 에 저장되고, 같은 네트워크의 팀원은 http://<이 PC IP>:8080 으로 접속한다.
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const handler = require('./lib/handler');

const PORT = +process.env.PORT || 8080;
// 화면 파일만 내보낸다 (data/, lib/ 등 서버 파일은 노출하지 않음)
const STATIC = /^\/(index\.html|export\.js|vendor\/[\w.-]+\.js|vendor\/licenses\/[\w.-]+\.txt)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

http.createServer((req, res) => {
  let { pathname } = new URL(req.url, 'http://x');
  if (pathname === '/api/wiki') return handler(req, res);
  if (pathname === '/') pathname = '/index.html';
  if (STATIC.test(pathname)) {
    return fs.readFile(path.join(__dirname, pathname), (err, buf) => {
      if (err) { res.statusCode = 404; return res.end('Not found'); }
      res.setHeader('Content-Type', TYPES[path.extname(pathname)]);
      // 라이브러리 파일은 이름에 버전이 있어 오래 캐시해도 된다
      res.setHeader('Cache-Control', pathname.startsWith('/vendor/') ? 'public, max-age=604800' : 'no-store');
      res.end(buf);
    });
  }
  res.statusCode = 404;
  res.end('Not found');
}).listen(PORT, '0.0.0.0', () => {
  console.log('팀 위키 실행 중');
  console.log('  이 PC:  http://localhost:' + PORT);
  Object.values(os.networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal)
    .forEach(n => console.log('  팀원:   http://' + n.address + ':' + PORT));
});
