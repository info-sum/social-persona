/** CLI 인자 파싱. 테스트에서 단독으로 쓰기 위해 실행 코드와 분리했다. */

export interface CliArgs {
  inputs: string[];
  outDir: string;
  name?: string;
  limit: number;
  useLlm: boolean;
  useBrowser: boolean;
  useImpersonate: boolean;
  install: boolean;
  json: boolean;
  dryRun: boolean;
  verbose: boolean;
  inputFiles: string[];
  fromFiles: string[];
  force: boolean;
  help: boolean;
}

export const HELP = `social-persona — SNS 링크에서 페르소나 스킬(SKILL.md)을 만든다

사용법
  social-persona <링크...> [옵션]

링크 형태
  https://x.com/handle                 X 프로필
  https://x.com/handle/status/123      X 개별 글
  https://www.threads.com/@handle      Threads 프로필
  https://www.instagram.com/nasa/      Instagram 프로필
  https://www.instagram.com/p/XXXX/    Instagram 개별 글
  https://velog.io/@handle             블로그 (RSS 자동 탐색)
  https://example.com/feed.xml         RSS/Atom/JSON 피드
  x:@handle  /  threads:@handle        축약 표기

옵션
  -o, --out <dir>       출력 디렉토리 (기본 ./out)
  -n, --name <name>     페르소나 이름 지정 (기본: 글 작성자에서 추론)
  -l, --limit <n>       소스별 수집 상한 (기본 60)
  -i, --input <file>    수동 입력 파일 (.txt/.md/.json). 여러 번 지정 가능
      --from <file>     링크 목록 파일 (한 줄에 하나)
      --no-llm          LLM 합성 없이 결정론적 분석만
      --no-impersonate  TLS 지문 위장 끄기 (Instagram/Threads 수집률 급락)
      --no-browser      헤드리스 브라우저 전략 끄기
      --install         ~/.kiro/skills 에 바로 설치
      --json            persona.json 을 stdout으로 출력
      --dry-run         파일을 쓰지 않고 요약만 보여준다
      --force           표본이 부족해도 진행 (결과 신뢰도 낮음)
  -v, --verbose         진단 로그 상세 출력
  -h, --help            이 도움말

수동 입력 형식
  .txt/.md : 빈 줄 2개 또는 '---' 로 글을 구분. '--- @2024-05-01 ---' 처럼 날짜 지정 가능
  .json    : [{ "text": "...", "createdAt": "2024-05-01", "likes": 12 }, ...]

환경변수
  ANTHROPIC_API_KEY / OPENAI_API_KEY   LLM 합성 활성화
  SOCIAL_PERSONA_MODEL                 모델 이름 override
  JINA_API_KEY                         r.jina.ai 리더 프록시 인증(선택)

예시
  social-persona https://velog.io/@handle --out ./out
  social-persona x:@handle threads:@handle --limit 100 --install
  social-persona --input ./my-posts.md --name "나" --no-llm
`;

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    inputs: [],
    outDir: "./out",
    limit: 60,
    useLlm: true,
    useBrowser: true,
    useImpersonate: true,
    install: false,
    json: false,
    dryRun: false,
    verbose: false,
    inputFiles: [],
    fromFiles: [],
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith("-")) throw new Error(`${a} 옵션에 값이 필요합니다.`);
      i += 1;
      return v;
    };
    switch (a) {
      case "-h":
      case "--help":
        args.help = true;
        break;
      case "-o":
      case "--out":
        args.outDir = next();
        break;
      case "-n":
      case "--name":
        args.name = next();
        break;
      case "-l":
      case "--limit": {
        const n = Number(next());
        if (!Number.isFinite(n) || n <= 0) throw new Error("--limit 은 양의 정수여야 합니다.");
        args.limit = Math.floor(n);
        break;
      }
      case "-i":
      case "--input":
        args.inputFiles.push(next());
        break;
      case "--from":
        args.fromFiles.push(next());
        break;
      case "--no-llm":
        args.useLlm = false;
        break;
      case "--llm":
        args.useLlm = true;
        break;
      case "--no-browser":
        args.useBrowser = false;
        break;
      case "--browser":
        args.useBrowser = true;
        break;
      case "--no-impersonate":
        args.useImpersonate = false;
        break;
      case "--impersonate":
        args.useImpersonate = true;
        break;
      case "--install":
        args.install = true;
        break;
      case "--json":
        args.json = true;
        break;
      case "--dry-run":
        args.dryRun = true;
        break;
      case "--force":
        args.force = true;
        break;
      case "-v":
      case "--verbose":
        args.verbose = true;
        break;
      default:
        if (a.startsWith("-")) throw new Error(`알 수 없는 옵션: ${a}`);
        args.inputs.push(a);
    }
  }
  return args;
}
