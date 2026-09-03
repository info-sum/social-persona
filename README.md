# social-persona

SNS 링크를 넣으면 게시글을 수집·분석해서 **그 사람의 문체로 글을 쓰기 위한 에이전트 스킬(`SKILL.md`)** 을 만들어 주는 CLI입니다.

```bash
social-persona https://velog.io/@handle x:@handle --install
```

결과물은 `~/.kiro/skills/` 규격의 스킬 디렉토리입니다. 설치하면 그 다음 세션부터 "이 사람 말투로 써 줘"가 됩니다.

---

## 무엇을 만드는가

```
out/<name>-persona/
├── SKILL.md                 에이전트가 읽는 페르소나 명세 (프론트매터 + 지시문)
├── persona.json             모든 분석 결과 (프로그램에서 재사용)
└── references/
    ├── metrics.md           전체 문체 지표를 펼친 표
    ├── samples.md           수집한 원문 전체
    └── posts.json           원문 구조화 데이터
```

`SKILL.md`에는 이런 것들이 들어갑니다.

- **측정된 문체 지표** — 글 길이 중앙값, 문장 길이, 글당 문장 수, 리듬 변동성, 줄바꿈 빈도
- **한국어 화법 판정** — 합니다체 / 해요체 / 반말 / 서술체(-다) / 명사 종결 비중과 격식도(0~1)
- **자주 쓰는 종결 표현** — `같아요`, `했습니다`, `~인 것 같다` 처럼 실제 관찰된 어미
- **표기 습관** — 이모지·해시태그·물결표·줄임표·`ㅋㅋ`·초성체 사용률
- **글 구조 골격** — 관찰된 첫 문장 / 마지막 문장 패턴에서 뽑은 재사용 가능한 틀
- **반드시 할 것 / 하지 말 것** — 위 수치에서 유도한 지시문
- **원문 표본** — 지표보다 원문이 우선이라는 전제로 대표 글 6편
- **출력 전 체크리스트** — 생성한 글을 스스로 검증하는 항목
- **경계** — 사칭 금지, PII 금지, 없는 사실 생성 금지

---

## 설치

```bash
git clone <repo> && cd social--persona
npm install
npm run build
npm link          # social-persona 명령 등록 (선택)
```

`npm install`이 설치하는 **선택적 의존성** 두 개가 Instagram·Threads 수집을 담당합니다.

| 패키지 | 역할 | 없으면 |
| --- | --- | --- |
| `impit` | 브라우저 TLS 지문으로 요청 (1순위) | Instagram/Threads 거의 수집 불가 |
| `playwright` | 헤드리스 브라우저 (심층 스크롤) | Threads 수집량 감소 |

`playwright`는 브라우저 바이너리를 따로 받아야 합니다.

```bash
npx playwright install chromium
```

둘 다 없어도 블로그·X는 정상 동작합니다.

---

## 왜 Instagram이 열리는가 — TLS 지문

Instagram·Threads는 **User-Agent가 아니라 TLS ClientHello 지문으로** 클라이언트를 가릅니다. 같은 URL에 같은 Chrome UA를 붙여도 응답이 다릅니다.

| 요청 방식 | 응답 | 캡션 |
| --- | --- | --- |
| Node `fetch` / plain `curl` (Chrome UA) | 619 KB — 빈 JS 셸 | 0건 |
| 브라우저 TLS 지문 (`impit`) | 844 KB — 프리페치 JSON 포함 | **12건** |

쿠키 워밍이나 referer 체인 때문이 아닙니다. 지문 위장만 끄고 쿠키 워밍을 해도 캡션은 0건입니다. 그래서 예전에 필요했던 헤드리스 브라우저가 필요 없어집니다.

```
Instagram 프로필 @nasa    브라우저 순회: 10건 / 60초  →  TLS 지문: 20건 / 15초
Threads 프로필 @zuck      브라우저 스크롤: 40건 / 17초 →  TLS 지문: 19건 / 11초
```

이 접근은 [insane-search](https://github.com/fivetaku/insane-search)의 Phase 0→3 에스컬레이션에서 가져왔습니다. 그 프로젝트는 Threads **영상 포스트**의 서명 CDN URL 추출에 curl_cffi 지문을 쓰는데, 같은 원리가 **텍스트 캡션**에도 통한다는 것을 확인해 Node 쪽 구현(`impit`)으로 옮겼습니다. Instagram은 원래 대상에 없던 플랫폼입니다.

**경계는 그대로입니다.** 이건 공개 페이지를 읽는 수단이지 인증 우회가 아닙니다. 비공개 계정과 로그인 벽은 지문을 바꿔도 열리지 않고, 그 경우 실패를 그대로 보고합니다.

---

## 사용법

```bash
social-persona <링크...> [옵션]
```

### 링크 형태

| 입력 | 인식 |
| --- | --- |
| `https://x.com/handle` | X 프로필 |
| `https://x.com/handle/status/123` | X 개별 글 |
| `https://www.threads.com/@handle` | Threads 프로필 |
| `https://www.instagram.com/handle/` | Instagram 프로필 |
| `https://www.instagram.com/p/XXXX/` | Instagram 개별 글 |
| `https://velog.io/@handle` | 블로그 (RSS 자동 탐색) |
| `https://example.com/feed.xml` | RSS / Atom / JSON Feed |
| `x:@handle`, `threads:@handle`, `ig:handle` | 축약 표기 |
| 그 외 도메인 | 블로그로 폴백 (피드 탐색 → 본문 추출) |

여러 개를 한 번에 넣으면 합쳐서 하나의 페르소나를 만듭니다.

### 옵션

| 옵션 | 설명 |
| --- | --- |
| `-o, --out <dir>` | 출력 디렉토리 (기본 `./out`) |
| `-n, --name <name>` | 페르소나 이름 지정 (기본: 글 작성자에서 추론) |
| `-l, --limit <n>` | 소스별 수집 상한 (기본 60) |
| `-i, --input <file>` | 수동 입력 파일. 여러 번 지정 가능 |
| `--from <file>` | 링크 목록 파일 (한 줄에 하나, `#` 주석 허용) |
| `--no-llm` | LLM 합성 없이 결정론적 분석만 |
| `--no-impersonate` | TLS 지문 위장 끄기 (Instagram/Threads 수집률 급락) |
| `--no-browser` | 헤드리스 브라우저 전략 끄기 |
| `--install` | `~/.kiro/skills` 에 바로 설치 |
| `--json` | `persona.json` 을 stdout으로 출력 |
| `--dry-run` | 파일을 쓰지 않고 요약만 |
| `--force` | 표본이 부족해도 진행 |
| `-v, --verbose` | 어떤 전략이 성공/실패했는지 전부 출력 |

### 예시

```bash
# 블로그 하나
social-persona https://velog.io/@velopert --out ./out

# X + Threads 를 합쳐서 스킬로 바로 설치
social-persona x:@handle threads:@handle --limit 100 --install

# 수집이 막히면 직접 붙여넣기
social-persona --input ./my-posts.md --name "나" --no-llm

# 뭐가 실패했는지 보기
social-persona https://www.instagram.com/nasa/ -v --dry-run
```

---

## 동작 방식

```
링크 → 플랫폼 감지 → 수집(어댑터별 다단 전략) → 정규화·중복제거
     → 결정론적 문체 분석 → (선택) LLM 정성 합성 → SKILL.md 생성
```

### 1. 수집 — 플랫폼별 전략

수집은 **여러 전략을 순서대로 시도하고 가장 많이 건진 결과를 채택**합니다. `-v`로 전 과정을 볼 수 있습니다.

| 플랫폼 | 전략 순서 |
| --- | --- |
| **블로그** | 페이지에 선언된 피드 → 플랫폼별 관례 피드(`rss.blog.naver.com/{id}.xml`, `api.velog.io/rss/@{id}`, `brunch.co.kr/rss/@@{id}`, `medium.com/feed/@{id}`, `/rss`, `/feed.xml` …) → 개별 글 본문 추출 → 내부 링크 크롤 → 리더 프록시 |
| **X** | 개별 글: `cdn.syndication.twimg.com/tweet-result` · 프로필: `syndication.twitter.com` 위젯 타임라인(`__NEXT_DATA__`) → 리더 프록시 |
| **Threads** | **TLS 지문 위장**(프로필 임베드 JSON + `/post/{code}` 순회) → 평범한 HTML → 리더 프록시 → 헤드리스 브라우저(GraphQL 응답 채굴 + 스크롤) |
| **Instagram** | **TLS 지문 위장**(프로필 임베드 JSON + `/p/{code}` 순회) → 평범한 HTML → 리더 프록시 → 헤드리스 브라우저 |
| **수동** | `.md`/`.txt`/`.json` 파싱 |

블로그·X 경로도 차단당하면(403/429/Cloudflare 챌린지) 자동으로 TLS 지문 위장으로 한 번 더 시도합니다.

품질 장치:

- **개수보다 정확도** — 작성자·시각 앵커에 실패한 블록은 점수를 1/4로 깎습니다. "정확한 캡션 1건"이 "출처 불명 10블록"을 이깁니다. 개별 글 URL이면 1건만 정확히 얻고 멈춥니다.
- **로그인 벽·오류 상용구 필터** — "this page isn't available", "Log in to see more", "페이지를 사용할 수 없습니다" 같은 문구를 게시글로 오인하지 않습니다.
- **타임라인 앵커 파서** — 리더/DOM 텍스트에서 `작성자 → 시각 → 본문 → 참여수치` 패턴을 앵커로 삼아 UI 문구와 남의 댓글을 걷어냅니다.
- **코드 블록 제거** — 개발 블로그의 `<pre>`/```` ``` ````는 `[코드]`로 치환합니다. 코드는 문체 신호가 아닙니다.
- **표본 하한** — 3건 / 300자 미만이면 스킬을 만들지 않고 실패시킵니다(`--force`로 무시 가능). 로그인 벽 텍스트로 엉뚱한 페르소나가 나오는 걸 막습니다.

### 2. 분석 — 결정론적 (API 키 없이 완전 동작)

한국어 문체를 다루는 부분이 핵심입니다.

- **화법 분류** — 종결 어미 표층형을 보고 합니다체/해요체/해체/서술체/명사 종결로 나눕니다. `아니다`를 `~니다`(합니다체)로 오인하지 않는 예외 처리를 포함합니다.
- **격식도** — 화법 분포에 가중치를 곱한 0~1 점수.
- **경량 스테밍** — 조사 목록으로 어간을 분리합니다.
- **명사 추정** — 형태소 분석기 없이 토픽을 뽑기 위해 두 가지 근거를 씁니다. (1) 해시태그는 작성자가 직접 붙인 주제 라벨, (2) **조사가 붙어 등장한 어간은 체언일 가능성이 높다**. 다만 1음절 조사를 무턱대고 떼면 `올가을 → 올가`처럼 명사가 깨지므로, 그 어간이 코퍼스에서 조사 없이도 등장했거나 두 종류 이상의 조사와 함께 등장했을 때만 분리합니다. 활용형(`좋았어요`, `굴렀다`)이 토픽으로 올라오는 걸 막습니다.
- **자기 언급 제거** — 자기 핸들·이름은 소재에서 뺍니다.
- **시그니처 표현** — 내장 배경 코퍼스(흔한 말 목록) 대비 희소하면서 여러 글에 반복되는 어휘.
- 그 외: 문장 길이 분포와 변동성(장·단문 교차 여부), 레이아웃(줄바꿈·빈 줄·불릿·한 줄 글), 구두점 1000자당 빈도, 이모지/해시태그/멘션/링크, 첫·마지막 문장 패턴, 1인칭·청유형 비율, 게시 시간대.

영어 글이면 한국어 화법 항목은 "판정 불가"로 두고 관련 지시문을 생략합니다.

### 3. LLM 합성 — 선택

`ANTHROPIC_API_KEY` 또는 `OPENAI_API_KEY`가 있으면 정량 지표 + 원문 표본을 함께 넘겨 정성적 서술(정체성 한 줄, 태도, 습관)을 받습니다.

**정량 지시문은 항상 결정론적 분석 쪽을 신뢰합니다.** LLM은 숫자를 덮어쓰지 못하고, 서술만 얹습니다. 호출이 실패하거나 JSON이 깨져도 파이프라인은 결정론적 결과로 완주합니다.

| 환경변수 | 용도 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic Messages API 사용 |
| `OPENAI_API_KEY` | OpenAI 호환 `chat/completions` 사용 |
| `OPENAI_BASE_URL` / `ANTHROPIC_BASE_URL` | 엔드포인트 override (로컬 모델 등) |
| `SOCIAL_PERSONA_MODEL` | 모델 이름 override |
| `JINA_API_KEY` | r.jina.ai 리더 프록시 인증(선택, 레이트리밋 완화) |

---

## 수동 입력 형식

수집이 막히는 계정(비공개, 로그인 벽)은 직접 붙여넣는 게 가장 확실합니다.

**`.md` / `.txt`** — `---` 로 글을 구분합니다. 구분선이 없으면 빈 줄 두 개를 경계로 봅니다.

```markdown
오늘 새벽 세 시에 깼다.
창밖이 아직 파랬다.

--- @2025-05-05 ---

배포를 세 번 굴렀다. 세 번 다 롤백했다.
문제는 캐시였다. 늘 캐시다.
```

**`.json`**

```json
[
  { "text": "오늘 새벽 세 시에 깼다.", "createdAt": "2025-05-05", "likes": 12 },
  { "text": "배포를 세 번 굴렀다.", "platform": "x" }
]
```

`text` / `content` / `caption` 중 아무 키나 쓸 수 있고, `{ "posts": [...] }` 형태도 읽습니다.

---

## 라이브러리로 쓰기

```ts
import { run, analyzeStyle, renderSkillMarkdown } from "social-persona";

// 전체 파이프라인
const result = await run(["https://velog.io/@handle"], {
  outDir: "./out",
  useLlm: false,
  write: true,
});
console.log(result.persona.style.korean.dominantSpeechLevel);

// 분석만
const style = analyzeStyle(posts);
const md = renderSkillMarkdown(persona);
```

---

## 개발

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest (160 유닛 테스트)
npm run verify        # typecheck + test
npm run build         # dist 생성
npm run dev -- --help # tsx 로 바로 실행

# 실제 네트워크를 타는 통합 테스트 (외부 사이트 상태 의존)
RUN_NETWORK_TESTS=1 npx vitest run tests/network.test.ts
```

---

## 한계

- **Instagram·Threads는 `impit` 없이는 사실상 불가능합니다.** 평범한 fetch에는 서버가 빈 JS 셸만 줍니다. 브라우저 TLS 지문이 있으면 프로필 첫 페이지의 공개 캡션이 열립니다.
- **비공개 계정과 로그인 벽은 열리지 않습니다.** 지문을 바꿔도 인증은 우회되지 않고, 그 경우 상용구를 걸러낸 뒤 실패로 보고합니다.
- **Threads는 첫 페이지 분량까지만** 지문 경로로 얻습니다(수십 건이 아니라 십여 건). 더 필요하면 헤드리스 브라우저의 스크롤 경로를 씁니다.
- **X 위젯 타임라인은 IP 단위 레이트리밋(429)** 이 있습니다. 몇 분 뒤 재시도하면 대체로 풀립니다. 재시도와 백오프는 내장되어 있습니다.
- **한국어 형태소 분석기를 쓰지 않습니다.** 조사 분리는 코퍼스 근거 기반 근사입니다. 근거가 없으면 원형을 지키는 쪽을 택하므로, 토픽에 활용형이 남는 경우가 있습니다.
- **표본이 작으면 지표를 믿을 수 없습니다.** 15건 미만이면 `SKILL.md`에 그 경고가 함께 들어갑니다.
- 비공개·삭제된 글은 수집되지 않습니다.

## 윤리

문체 재현 도구입니다. 본인 문체를 재사용하거나 명시적 동의를 받은 경우에만 쓰세요. 생성되는 `SKILL.md`에는 사칭 금지·PII 금지·없는 사실 생성 금지 조항이 항상 포함됩니다.

수집은 공개 페이지만 대상으로 합니다. 인증을 우회하지 않고, 자격증명을 저장·전송하지 않습니다. 대상 사이트의 이용약관·`robots.txt`·레이트리밋과 관련 법령을 지키는 책임은 사용자에게 있습니다.

## 참고

TLS 지문 에스컬레이션 접근은 [insane-search](https://github.com/fivetaku/insane-search) (MIT)에서 가져왔습니다.

## 라이선스

MIT
