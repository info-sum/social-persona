/**
 * 내장 배경 코퍼스.
 * 외부 의존성 없이 "이 사람만 유독 자주 쓰는 표현"을 골라내기 위한 근사 장치다.
 * COMMON_* 에 든 단어는 흔한 말로 취급해 시그니처 후보에서 감점한다.
 */

export const KO_STOPWORDS = new Set([
  "그리고","그런데","그래서","하지만","그러나","또는","즉","및","등","또","더","좀","꼭","다시","아주","정말","진짜","너무",
  "이것","그것","저것","여기","거기","저기","이런","저런","그런","어떤","무슨","어느","누가","누구","언제","어디","왜","어떻게",
  "나는","내가","저는","제가","우리","저희","너는","네가","당신","그는","그녀","그들","사람","사람들",
  "있다","없다","하다","되다","이다","같다","보다","오다","가다","주다","받다","알다","모르다","생각","때문","경우","정도",
  "이제","오늘","어제","내일","지금","요즘","계속","항상","가끔","자주","다음","이번","저번","처음","마지막",
  "것","수","때","말","일","분","년","월","시","개","번","곳","점","중","안","밖","위","아래","앞","뒤","옆",
  "은","는","이","가","을","를","의","에","와","과","도","만","랑","께","야","아","어","네","요","죠",
  "그냥","막","되게","엄청","완전","약간","거의","조금","많이","잘","못","안","같이","함께","혼자",
  "합니다","했습니다","입니다","있습니다","없습니다","해요","했어요","이에요","예요","있어요","없어요",
  "한다","했다","이다","있다","없다","된다","했었다","할","한","하는","해서","하고","하면","해도","하지",
]);

export const EN_STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","than","so","because","as","of","at","by","for","with","about","into",
  "to","from","in","on","off","out","over","under","again","further","once","here","there","when","where","why","how",
  "all","any","both","each","few","more","most","other","some","such","no","nor","not","only","own","same","too","very",
  "i","me","my","myself","we","our","ours","you","your","yours","he","him","his","she","her","it","its","they","them",
  "this","that","these","those","am","is","are","was","were","be","been","being","have","has","had","having","do","does",
  "did","doing","would","should","could","will","can","just","dont","don't","now","get","got","really","like","one",
  "s","t","re","ve","ll","m","d","http","https","www","com",
  // 담화·빈출어: 토픽으로 올라오면 신호가 아니라 잡음이다
  "also","new","us","many","much","may","might","must","shall","what","who","whom","whose","which","while","whether",
  "well","way","ways","make","makes","made","making","use","uses","used","using","first","second","last","next",
  "see","seen","sees","need","needs","needed","want","wants","know","known","think","thought","thing","things",
  "time","times","work","works","working","people","person","lot","lots","going","goes","went","said","says","say",
  "back","even","still","take","takes","taken","give","gives","given","come","comes","came","look","looks","looking",
  "thanks","thank","please","sure","better","best","good","great","bad","right","wrong","yes","yeah","ok","okay",
  "via","etc","per","upon","within","without","across","along","around","behind","below","beyond","during","except",
  "inside","near","since","though","unless","until","thus","hence","however","therefore","indeed","perhaps","maybe",
  "actually","basically","literally","honestly","obviously","simply","always","never","often","sometimes","usually",
  "every","everything","everyone","something","someone","anything","anyone","nothing","nobody","another","between",
  "before","after","above","down","up","out","let","lets","put","two","three","four","five","already","enough","able",
  "part","parts","end","start","begin","find","found","help","helps","try","tried","trying","feel","feels","felt",
  "long","short","big","small","high","low","old","young","real","true","false","sort","kind","bit","far","less",
  "same","different","following","follow","follows","include","includes","including","instead","around","almost",
  "their","theirs","ours","yours","its","whose","itself","themselves","ourselves","yourself","everybody","anybody",
  "let's","lets","gonna","wanna","cant","cannot","won't","wont","isnt","arent","wasnt","werent","havent","hasnt",
]);

/** 흔한 한국어 어절 — 시그니처 판정 시 감점 대상 */
export const COMMON_KO = new Set([
  ...KO_STOPWORDS,
  "사실","결국","물론","특히","보통","역시","심지어","대신","오히려","반면","한편","우선","일단","아마","혹시","만약",
  "부분","방법","이유","문제","결과","상황","내용","이야기","시간","하루","마음","기분","느낌","생각들","순간",
  "좋다","좋은","좋아","싫다","크다","작다","많다","적다","높다","낮다","새로운","다른","비슷한","이런저런",
  "가장","제일","훨씬","점점","여전히","아직","벌써","이미","드디어","마침내","결코","전혀","별로",
  "말이","말은","것이","것을","것도","수가","수도","때는","때가","일이","일을","적이","적은",
]);

/** 접속·연결 표현 (문장 흐름 습관 파악용) */
export const CONNECTIVES = [
  "그리고","그런데","그래서","하지만","그러나","그러니까","그러면","그렇지만","그럼에도","따라서","즉","결국","다만",
  "물론","사실","오히려","반면","한편","게다가","더군다나","심지어","예를 들어","가령","말하자면","요컨대","정리하면",
  "however","but","and","so","because","therefore","although","meanwhile","besides","actually","basically","honestly",
];

/** 1인칭 표현 */
export const FIRST_PERSON = ["나는","내가","나도","나의","내","저는","제가","제","저도","우리","우리는","우리가","i","i'm","im","my","me","we","our"];

/** 청유·명령형 신호 */
export const IMPERATIVE_MARKERS = [
  "해보세요","해보자","하자","해봐","해봅시다","합시다","보세요","보자","봐요","주세요","주십시오","권한다","추천한다","추천해요",
  "try","let's","lets","check out","consider","remember","don't","do not","must","should",
];

/** 토픽으로 절대 올리지 않는 말 (접속사·담화표지) */
export const NEVER_TOPIC = new Set<string>([
  ...KO_STOPWORDS,
  ...EN_STOPWORDS,
  ...CONNECTIVES.map((c) => c.replace(/\s+/g, "")),
  "결국","사실","물론","특히","보통","역시","심지어","대신","오히려","반면","한편","우선","일단","아마","혹시","만약",
  "그거","이거","저거","뭔가","좀더","너무","진짜","완전","약간","거의",
]);

export function isStopword(token: string): boolean {
  return KO_STOPWORDS.has(token) || EN_STOPWORDS.has(token);
}

/** 활용형·기능어처럼 보이는 토큰은 토픽 후보에서 뺀다. (형태소 분석기 없이 쓰는 근사 규칙) */
const INFLECTION_TAIL = /(?:하다|되다|이다|있다|없다|같다|한|하는|했|됐|되는|인|일|할|하고|해서|하며|하지|스러|롭게)$/;
/** 조사가 덜 떨어진 흔적 */
const DANGLING_PARTICLE = /(?:은|는|을|를|의|와|과|도|만|서|고|며|나|든|랑|께|에|이|가|요|로|써|처럼|부터|까지)$/;

/** 완화 모드에서도 지켜야 하는 최소 조건 */
export function isJamoOnly(token: string): boolean {
  return /^[\u3131-\u318E]+$/.test(token);
}

export function isTopicAllowed(stem: string): boolean {
  if (stem.length < 2 || NEVER_TOPIC.has(stem) || isJamoOnly(stem)) return false;
  // 라틴 문자만으로 된 짧은 토큰은 대개 기능어다
  if (/^[a-z0-9'’-]+$/.test(stem) && stem.length < 3) return false;
  // 축약형(it's, don't)은 주제어가 아니다
  if (/^[a-z]+['’][a-z]+$/.test(stem)) return false;
  if (/^[\d.,]+$/.test(stem)) return false;
  return true;
}

export function isTopicCandidate(stem: string): boolean {
  if (!isTopicAllowed(stem)) return false;
  if (COMMON_KO.has(stem)) return false;
  if (INFLECTION_TAIL.test(stem)) return false;
  // 2음절 이하에서 조사가 남아 있으면 신뢰하기 어렵다
  if (stem.length <= 3 && DANGLING_PARTICLE.test(stem)) return false;
  return true;
}

/** 흔한 말일수록 낮은 가중치 */
export function raritySpecificity(token: string): number {
  if (isStopword(token)) return 0;
  if (COMMON_KO.has(token)) return 0.25;
  if (token.length <= 1) return 0;
  return 1;
}
