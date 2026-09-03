<!-- 
  파일: GEMINI.md
  설명: social-persona 프로젝트 분석 보고서 및 작업 진행 상황 기록
-->

# social-persona 프로젝트 분석 보고서

## 1. 프로젝트 개요
`social-persona`는 SNS 링크(X/Twitter, Instagram, Threads, 블로그, RSS 등)를 입력받아 게시글을 수집·분석하고, 해당 작성자의 고유한 문체를 복제/모사하는 페르소나 에이전트 스킬(`SKILL.md` 등)을 자동 생성하는 Node.js 기반 CLI 도구입니다.

- **패키지명**: `social-persona` (v0.1.0)
- **런타임 환경**: Node.js 20+ (ES Module)
- **주요 언어**: TypeScript (엄격한 타입 체킹)
- **산출물 규격**: `~/.kiro/skills/` 규격 및 로컬 `out/<name>-persona/`

---

## 2. 핵심 파이프라인 아키텍처

```
[입력 URL / 파일]
       ↓
1. 감지 (Detect) : URL/핸들 정규화 및 플랫폼 판별 (X, Threads, Instagram, Blog, Manual)
       ↓
2. 수집 (Ingest) : 다단 폴백 전략을 통한 스크래핑 및 피드 파싱
   - Tier 1: 브라우저 TLS 지문 위장 (impit)
   - Tier 2: 공개 신디케이션 / RSS / JSON Feed
   - Tier 3: 리더 프록시 (Jina reader 등)
   - Tier 4: 헤드리스 브라우저 심층 스크롤 (playwright)
       ↓
3. 정제 (Filter & Dedupe) : 보일러플레이트, 로그인 벽, 코드 블록 제거 및 중복 제거
       ↓
4. 분석 (Analyze) : 결정론적 문체 통계 및 한국어 화법 분석 (API 키 없이 완전 동작)
   - 종결어미 기반 화법 분류 (합니다체, 해요체, 해체, 서술체, 명사 종결)
   - 문장/글 길이 통계, 리듬 변동성(burstiness), 구두점, 이모지/해시태그 통계
   - 형태소 분석기 없이 코퍼스 근거 기반 어간/조사 분리 및 시그니처 표현 추출
       ↓
5. 정성 합성 (Synthesize - 선택) : LLM (Anthropic / OpenAI)을 통한 정체성/말투 정성 서술 보강
       ↓
6. 생성 (Generate) : 최종 페르소나 산출물 생성
   - SKILL.md (프론트매터 + 문체 지표 + 원문 표본 + Do/Don't + 체크리스트)
   - persona.json (프로그래밍 재사용 데이터)
   - references/ (metrics.md, samples.md, posts.json)
```

---

## 3. 디렉토리 및 파일 구조 분석

- `src/`
  - `cli.ts`, `cli-args.ts`: CLI 인자 파싱 및 실행 진입점
  - `index.ts`: 파이프라인 통합 오케스트레이션 함수 (`run`)
  - `types.ts`: 전체 도메인 모델 및 인터페이스 정의
  - `ingest/` (데이터 수집 레이어)
    - `detect.ts`: URL 형태, 핸들, 도메인을 분석해 플랫폼/유형 매핑
    - `http.ts`, `impersonate.ts`: HTTP 통신 및 TLS ClientHello 지문 위장 요청 처리
    - `browser.ts`: Playwright 헤드리스 브라우저 폴백 스크립트
    - `rss.ts`, `html.ts`, `reader-timeline.ts`: RSS/Atom/JSONFeed 및 HTML 본문 파싱, 타임라인 앵커 추출
    - `adapters/`: 플랫폼별 수집기 (`blog.ts`, `x.ts`, `meta.ts`, `manual.ts`)
  - `analyze/` (문체 및 언어 분석 레이어)
    - `korean.ts`: 한국어 화법 및 종결 어미 분석, 격식도 산출, 자음/모음 이모티콘 검출
    - `stylometry.ts`: 글/문장 길이, 레이아웃, 구두점, 어휘 다양성(TTR), 빅램/트라이그램 등 통계 지표 계산
    - `stopwords.ts`: 한국어/영어 불용어, 접속사, 1인칭, 청유형 사전
    - `synthesize.ts`: 통계 기반 휴리스틱 합성 및 LLM 결과 병합
    - `llm.ts`: Claude Messages API / OpenAI Completions API 연동
  - `generate/` (산출물 생성 레이어)
    - `skill.ts`: 에이전트용 `SKILL.md` 렌더링
    - `references.ts`: `metrics.md`, `samples.md` 렌더링
    - `write.ts`: 파일시스템 쓰기 및 디렉토리 관리
  - `util/`: 로그(`log.ts`), 슬러그 변환(`slug.ts`), 통계 유틸(`stats.ts`), 텍스트 처리(`text.ts`)
- `tests/`
  - Vitest 기반 단위/통합 테스트 (160개 통과, 외부 네트워크 의존 테스트 10개 제외)

---

## 4. 주목할 만한 기술적 차별점

1. **TLS ClientHello 지문 위장 (`impit`)**:
   - Instagram/Threads와 같이 일반 Node `fetch`나 `curl`을 차단하는 환경에서 브라우저 수준의 TLS 핸드셰이크 지문을 위장하여 공개 프리페치 데이터를 성공적으로 획득.
2. **형태소 분석기 없는 경량 한국어 분석**:
   - 무거운 외부 C++ 바인딩이나 대용량 사전 없이, 코퍼스 내 등장 빈도와 조사 교차 출현 근거를 활용해 명사와 체언을 추출하는 독자적 휴리스틱 적용.
3. **결정론적 분석 최우선 설계**:
   - LLM API 키가 없어도 100% 동작하며, LLM이 있더라도 정량적 수치는 항상 결정론적 계산값을 신뢰하여 환각을 원천 차단.

---

## 5. 실행 및 사용 방법 가이드

### CLI 실행 방법
1. **개발 모드 즉시 실행**:
   ```bash
   npm run dev -- <링크...> [옵션]
   # 예: npm run dev -- https://velog.io/@velopert --dry-run
   ```
2. **빌드 후 글로벌 명령어 등록**:
   ```bash
   npm run build
   npm link
   social-persona <링크...> [옵션]
   ```

### 주요 입력 형태
- 블로그: `https://velog.io/@handle`, `https://brunch.co.kr/@@handle`
- X (트위터): `https://x.com/handle`, `x:@handle`
- Threads: `https://www.threads.com/@handle`, `threads:@handle`
- Instagram: `https://www.instagram.com/handle/`, `ig:handle`
- 로컬 파일: `--input ./sample.md`

### 유용한 CLI 옵션
- `--install`: 생성된 스킬을 `~/.kiro/skills/`에 직접 설치하여 AI 에이전트에서 즉시 사용 가능하도록 등록
- `--dry-run`: 실제 디스크 파일 쓰기 없이 수집 및 분석 결과만 터미널에 출력
- `--no-llm`: 외부 LLM API 키 없이 순수 통계 및 규칙 기반 분석으로만 스킬 생성
- `-v, --verbose`: 수집 단계별 상세 진단 로그 출력

---

## 6. 작업 진행 상황 기록
- [x] 프로젝트 디렉토리 및 파일 구조 분석 완료
- [x] 패키지 의존성 및 스크립트(`package.json`) 검토
- [x] 테스트 스위트 실행 확인 (160 passed, 10 skipped)
- [x] 수집, 분석, 합성, 생성 전 파이프라인 로직 파악
- [x] `GEMINI.md` 생성 및 프로젝트 분석 요약 보고서 작성
- [x] CLI 실행 방법 및 사용 가이드 `GEMINI.md`에 문서화

---

## 7. 실제 분석 수행 기록: @choi.openai (Threads)

- **대상 URL**: `https://www.threads.com/@choi.openai`
- **수집 방식**: TLS 지문 위장(`impit`)을 통해 60건 확보 → 45건 정제 완료 (12,960자)
- **분석 결과 요약**:
  - **페르소나 명칭**: `choi.openai` (스킬 슬러그: `choi-openai-persona`)
  - **기본 화법**: `합니다체 (격식 높임)` (비중 55%, 격식도 0.757)
  - **언어 비중**: 혼합형 (한국어 59%, 영어 30%)
  - **글 길이**: 중앙값 281자, 평균 286자 (짧고 밀도 높은 뉴스/브리핑 형식)
  - **문장 호흡**: 평균 48.5자, 글당 평균 5문장, 글당 줄바꿈 6.42회 (빈 줄 단락 73%)
  - **주요 토픽/키워드**: 모델, 메타, 에이전트, 설정, 가격, code, 작업, 성능, claude
  - **자주 쓰는 종결 표현**: `있습니다` (18회), `공개했습니다` (7회), `합니다` (7회), `밝혔습니다` (5회), `올랐습니다` (4회)
  - **특징 습관**: 이모지 사용률 24% (주로 🎉 🧵 ✌️ 👀), 해시태그 거의 미사용 (2%), 스레드 연재 번호 표기(`1/`, `7/` 등)
- **산출물 생성 위치**:
  - `out/choi-openai-persona/SKILL.md`
  - `out/choi-openai-persona/persona.json`
  - `out/choi-openai-persona/references/metrics.md`
  - `out/choi-openai-persona/references/samples.md`
  - `out/choi-openai-persona/references/posts.json`

---

## 8. GitHub Description 작성 기록
- **공백 포함 글자수**: 342자 (요청 350자 기준에 부합)
- **내용 요약**:
  - SNS(X, Threads, Instagram, 블로그) 링크 기반 글 수집 및 문체 모사 AI 에이전트 스킬(SKILL.md) 자동 생성
  - TLS 지문 위장(impit) 기반 차단 우회 수집
  - 형태소 분석기 없는 경량 한국어 종결어미·화법(격식도)·문체 통계 분석
  - LLM API 키 없이 100% 동작하는 결정론적 분석 우선 설계

---

## 9. Git 원격 저장소 연결 및 초기 푸시 기록
- **원격 저장소 URL**: `https://github.com/info-sum/social-persona.git`
- **브랜치**: `main`
- **특이사항**: `.gitignore`에 의해 `out/`(생성된 스킬 산출물) 및 `node_modules`, `dist`는 완벽히 제외됨.
- **초기 커밋 및 푸시 완료**.

---

## 10. README.md 수정 기록
- **작업 내용**: README.md 내 `insane-search` 관련 참조 문장 및 참고(Reference) 섹션 전체 삭제 완료.
