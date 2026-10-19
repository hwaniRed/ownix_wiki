# 팀 위키

설치 없이 브라우저로 함께 쓰는 팀 위키입니다. 외부 npm 패키지를 쓰지 않습니다.

- 페이지 트리, 마크다운, `[[위키 링크]]`, 백링크, 검색, 할 일 체크
- **팀 공유**: 저장하면 4초 안에 모든 팀원 화면에 반영, 문서 단위 편집 잠금, 접속자 표시, 충돌 경고
- **파일로 저장**: 페이지를 Word(.docx), Excel(.xlsx), PowerPoint(.pptx), Markdown(.md)으로 내보내기
- 서버 없이 `index.html`만 열면 이 브라우저에만 저장하는 **개인 모드**로 동작

## 구성

| 파일 | 역할 |
|---|---|
| `index.html` | 화면 전체 (HTML/CSS/JS 한 파일) |
| `api/wiki.js` | Vercel 서버리스 함수 (`/api/wiki`) |
| `lib/handler.js` | API 로직: 조회, 저장, 삭제, 잠금, 가져오기 |
| `lib/store-redis.js` | Vercel용 저장소 (Upstash Redis REST) |
| `lib/store-file.js` | 사내 서버용 저장소 (`data/wiki.json`) |
| `server.js` | 사내/폐쇄망용 서버 (`node server.js`) |
| `export.js` | 페이지 → .docx / .xlsx / .pptx 변환 |
| `vendor/` | 변환 라이브러리 (CDN 없이 포함, 처음 내보낼 때만 불러옴) |

### 포함된 라이브러리

| 라이브러리 | 버전 | 용도 | 라이선스 |
|---|---|---|---|
| [docx](https://github.com/dolanmiu/docx) | 9.12.0 | Word | MIT |
| [SheetJS CE](https://sheetjs.com) | 0.20.3 | Excel | Apache-2.0 |
| [PptxGenJS](https://github.com/gitbrent/PptxGenJS) | 4.0.1 | PowerPoint | MIT |

라이선스 원문은 `vendor/licenses/`에 있습니다.

### 내보내기 형식별 내용

- **Word**: 제목, 본문 서식, 목록(번호/글머리/할 일), 표, 인용, 코드 블록을 그대로 옮깁니다.
- **Excel**: 페이지 안의 표 하나를 시트 하나로, 할 일 목록을 "할 일" 시트로 만들고 마지막에 "문서 정보" 시트를 붙입니다. 숫자는 숫자 셀로 들어갑니다.
- **PowerPoint**: 표지 다음에 `#`, `##` 제목마다 슬라이드를 만듭니다. 내용이나 표가 넘치면 "(계속)" 슬라이드로 나눕니다.

## 1. Vercel에 배포

Vercel 함수는 디스크에 쓴 파일이 유지되지 않으므로 Upstash Redis를 저장소로 씁니다.

1. 이 폴더를 GitHub 저장소에 올리고 Vercel에서 **Add New → Project**로 가져옵니다. Framework Preset은 **Other**로 두고, 빌드 설정은 비워 둡니다.
2. 프로젝트의 **Storage** 탭에서 **Upstash (Redis)** 를 만들고 이 프로젝트에 연결합니다. 환경 변수(`KV_REST_API_URL`, `KV_REST_API_TOKEN`)가 자동으로 등록됩니다.
   - Upstash 콘솔에서 직접 만들었다면 `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`을 환경 변수로 넣어도 됩니다.
3. 환경 변수를 넣은 뒤 **Redeploy** 합니다.
4. 접속해서 왼쪽 아래에 🟢 **팀 공유 모드**가 보이면 성공입니다. 저장소가 연결되지 않았으면 개인 모드로 실행되고, 화면 아래에 원인이 표시됩니다.

## 2. 사내/폐쇄망 서버에서 실행

Node.js 18 이상만 있으면 됩니다. `npm install`은 필요 없습니다.

```bash
node server.js
```

- 접속 주소: `http://localhost:8080`. 팀원 접속 주소는 실행 시 콘솔에 표시됩니다.
- 데이터: `data/wiki.json` (이 파일만 백업하면 됩니다)
- 포트 변경: `PORT=9000 node server.js`

## 참고

- 같은 문서는 한 번에 한 명만 편집합니다. 편집 잠금은 편집 중인 브라우저가 15초마다 연장하고, 창을 닫으면 45초 뒤 자동으로 풀립니다.
- 로그인 기능이 없습니다. 공개 URL에는 업무 문서를 올리지 마세요.
- 공유 모드는 4초마다 서버에 변경 여부를 묻습니다. 탭이 백그라운드로 가면 멈춥니다.
