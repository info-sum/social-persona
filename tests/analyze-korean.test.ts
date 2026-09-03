import { describe, expect, it } from "vitest";
import {
  buildStemIndex,
  classifySpeechLevel,
  endingForms,
  finalEojeol,
  koreanMarkers,
  resolveEnding,
  stripParticles,
  stripParticlesWithEvidence,
  trailingEojeols,
} from "../src/analyze/korean.js";
import { percentDistribution } from "../src/util/stats.js";
import { romanizeHangul, skillName, slugify } from "../src/util/slug.js";
import { splitSentences, strip, tokenizeWords } from "../src/util/text.js";

describe("percentDistribution", () => {
  it("반올림해도 합이 정확히 100이다", () => {
    expect(percentDistribution([0.765, 0.235])).toEqual([77, 23]);
    expect(percentDistribution([1 / 3, 1 / 3, 1 / 3]).reduce((a, b) => a + b, 0)).toBe(100);
    expect(percentDistribution([0.1, 0.2, 0.3, 0.4]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("전부 0이면 0을 돌려준다", () => {
    expect(percentDistribution([0, 0])).toEqual([0, 0]);
  });
});

describe("classifySpeechLevel", () => {
  it("합니다체", () => {
    expect(classifySpeechLevel("안녕하세요, 오늘 배포를 마쳤습니다.")).toBe("hapsyo");
    expect(classifySpeechLevel("이게 정답입니다")).toBe("hapsyo");
    expect(classifySpeechLevel("괜찮으십니까?")).toBe("hapsyo");
  });

  it("해요체", () => {
    expect(classifySpeechLevel("오늘 카페 다녀왔어요")).toBe("haeyo");
    expect(classifySpeechLevel("이게 더 예쁜 것 같아요~")).toBe("haeyo");
    expect(classifySpeechLevel("그렇죠?")).toBe("haeyo");
  });

  it("서술체(-다)", () => {
    expect(classifySpeechLevel("오늘 새벽 세 시에 깼다.")).toBe("seosul");
    expect(classifySpeechLevel("좋은 설계는 미래의 나에게 주는 여유다")).toBe("seosul");
  });

  it("반말", () => {
    expect(classifySpeechLevel("이거 진짜 웃기잖아")).toBe("hae");
    expect(classifySpeechLevel("나도 그렇게 생각해")).toBe("hae");
  });

  it("'아니다'는 합니다체로 오인하지 않는다", () => {
    expect(classifySpeechLevel("그건 사실이 아니다")).toBe("seosul");
  });

  it("한글이 없으면 other", () => {
    expect(classifySpeechLevel("This is english.")).toBe("other");
    expect(classifySpeechLevel("😀😀")).toBe("other");
  });

  it("이모지가 붙어도 어미를 찾아낸다", () => {
    expect(classifySpeechLevel("햇살이 좋았어요☀️")).toBe("haeyo");
  });
});

describe("resolveEnding — 후치 부사·감탄사 대응", () => {
  it("어미 뒤에 부사가 붙어도 어미를 찾아낸다", () => {
    const r = resolveEnding("이게 다예요~ 생각보다 쉬워요 진짜루");
    expect(r?.level).toBe("haeyo");
    expect(r?.eojeol).toBe("쉬워요");
    expect(r?.offset).toBe(1);
  });

  it("자음 웃음 뒤에서도 어미를 찾아낸다", () => {
    expect(classifySpeechLevel("진짜 좋았어요 ㅎㅎ")).toBe("haeyo");
    expect(classifySpeechLevel("오늘 배포했다 진짜")).toBe("seosul");
  });

  it("두 어절 이상 거슬러 올라가지 않는다", () => {
    // 어미가 뒤에서 세 번째면 판정하지 않는다 (과잉 추론 방지)
    expect(classifySpeechLevel("쉬워요 진짜 완전")).toBe("other");
  });
});

describe("endingForms — 종결어미가 아닌 말을 걸러낸다", () => {
  it("나열형 절의 마지막 명사를 종결 표현으로 쓰지 않는다", () => {
    expect(classifySpeechLevel("마늘 많이, 오일 넉넉히, 면수 조금.")).toBe("other");
    expect(endingForms("마늘 많이, 오일 넉넉히, 면수 조금.")).toBeUndefined();
  });

  it("판정 가능한 문장은 어미를 돌려준다", () => {
    expect(endingForms("오늘은 배포를 했습니다.")).toEqual({ surface: "했습니다", short: "니다" });
  });

  it("한글 없는 문장은 undefined", () => {
    expect(endingForms("hello world")).toBeUndefined();
  });
});

describe("finalEojeol / trailingEojeols", () => {
  it("문장 끝 부호와 이모지를 걷어낸다", () => {
    expect(finalEojeol("정말 좋았어요!!! 😊")).toBe("좋았어요");
  });

  it("뒤에서부터 어절을 돌려준다", () => {
    expect(trailingEojeols("가 나 다 라", 3)).toEqual(["라", "다", "나"]);
  });
});

describe("koreanMarkers", () => {
  it("자음 웃음과 울음, 초성체를 센다", () => {
    const m = koreanMarkers("이거 진짜 웃기다 ㅋㅋㅋ 아 근데 슬퍼 ㅠㅠ ㅇㅈ");
    expect(m.laughter).toBe(1);
    expect(m.crying).toBe(1);
    expect(m.chosung).toBeGreaterThanOrEqual(1);
  });

  it("ㅋㅋ/ㅎㅎ 를 초성체로 이중 집계하지 않는다", () => {
    const m = koreanMarkers("진짜 귀여웠어요 ㅎㅎ 좋아요 ㅋㅋ");
    expect(m.laughter).toBe(2);
    expect(m.chosung).toBe(0);
  });
});

describe("stripParticles", () => {
  it("조사를 떼어낸다", () => {
    expect(stripParticles("코드가")).toBe("코드");
    expect(stripParticles("설계는")).toBe("설계");
    expect(stripParticles("사장님이")).toBe("사장님");
  });

  it("2음절 이하로 줄어들면 그대로 둔다", () => {
    expect(stripParticles("나는")).toBe("나는");
  });

  it("한글이 아니면 건드리지 않는다", () => {
    expect(stripParticles("typescript")).toBe("typescript");
  });

  it("'요'는 조사로 떼지 않는다 (해요체 어간을 망가뜨린다)", () => {
    expect(stripParticles("주세요")).toBe("주세요");
    expect(stripParticles("있어요")).toBe("있어요");
    expect(stripParticles("좋았어요")).toBe("좋았어요");
  });
});

describe("stripParticlesWithEvidence — 근거 기반 스테밍", () => {
  it("여러 조사와 함께 등장한 어간만 분리한다", () => {
    const index = buildStemIndex(["서울의", "서울을", "서울에", "코드가", "코드를"]);
    expect(stripParticlesWithEvidence("서울의", index)).toEqual({ stem: "서울", stripped: true });
    expect(stripParticlesWithEvidence("코드가", index)).toEqual({ stem: "코드", stripped: true });
  });

  it("근거가 없으면 원형을 지킨다 (올가을 → 올가 방지)", () => {
    const index = buildStemIndex(["올가을", "날씨가", "날씨는"]);
    expect(stripParticlesWithEvidence("올가을", index)).toEqual({ stem: "올가을", stripped: false });
  });

  it("어간이 조사 없이도 등장했다면 분리한다", () => {
    const index = buildStemIndex(["코드", "코드가"]);
    expect(stripParticlesWithEvidence("코드가", index)).toEqual({ stem: "코드", stripped: true });
  });

  it("긴 조사를 먼저 시도한다", () => {
    const index = buildStemIndex(["회사에서", "회사", "회사가"]);
    expect(stripParticlesWithEvidence("회사에서", index).stem).toBe("회사");
  });
});

describe("splitSentences", () => {
  it("줄바꿈과 종결부호로 자른다", () => {
    const s = splitSentences("첫 문장이다. 두 번째!\n세 번째?");
    expect(s).toEqual(["첫 문장이다.", "두 번째!", "세 번째?"]);
  });

  it("소수점에서 자르지 않는다", () => {
    expect(splitSentences("버전 3.5가 나왔다.")).toEqual(["버전 3.5가 나왔다."]);
  });
});

describe("strip", () => {
  it("URL·멘션·해시태그·이모지를 분리한다", () => {
    const r = strip("좋은 글 https://a.co/b @friend 확인 #추천 🎉");
    expect(r.urls).toHaveLength(1);
    expect(r.mentions).toEqual(["friend"]);
    expect(r.hashtags).toEqual(["추천"]);
    expect(r.emojis).toEqual(["🎉"]);
    expect(r.clean).not.toContain("http");
    expect(r.clean).toContain("좋은 글");
  });

  it("코드 자리표시자를 어휘에서 제거한다", () => {
    const r = strip("이렇게 쓴다.\n[코드]\n결과는 이렇다.");
    expect(r.clean).not.toContain("코드");
    expect(r.clean).toContain("이렇게 쓴다");
  });
});

describe("tokenizeWords", () => {
  it("주변 구두점을 떼고 소문자화한다", () => {
    expect(tokenizeWords("Hello, World! 좋다.")).toEqual(["hello", "world", "좋다"]);
  });
});

describe("romanizeHangul / slugify", () => {
  it("한글을 로마자로 옮긴다", () => {
    expect(romanizeHangul("밤코딩")).toBe("bamkoding");
    expect(romanizeHangul("소연")).toBe("soyeon");
    expect(romanizeHangul("한국어")).toBe("hangukeo");
  });

  it("슬러그는 소문자 영숫자와 하이픈만 남긴다", () => {
    expect(slugify("밤코딩 @개발자!")).toBe("bamkoding-gaebalja");
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("빈 결과는 폴백을 쓴다", () => {
    expect(slugify("!!!", "fallback")).toBe("fallback");
  });

  it("스킬 이름은 -persona 접미사를 한 번만 붙인다", () => {
    expect(skillName("밤코딩", "sns")).toBe("bamkoding-persona");
    expect(skillName("my-persona", "sns")).toBe("my-persona");
  });
});
