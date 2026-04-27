import { useState, useRef, useEffect } from "react";

// ── 색상 (트레이딩 터미널 스타일) ───────────────────────────────
const T = {
  bg: "#0a0e0f", surface: "#111618", surface2: "#161d1f",
  border: "#1e2a2c", borderLight: "#263236",
  green: "#00d4aa", greenDim: "#00d4aa18", greenMid: "#00d4aa44",
  red: "#ff4d6a", redDim: "#ff4d6a18",
  gold: "#f0c040", goldDim: "#f0c04018",
  blue: "#4da6ff", blueDim: "#4da6ff18",
  text: "#e0ece8", textMuted: "#7a9a94", textDim: "#3a5a54",
  up: "#00d4aa", down: "#ff4d6a", neutral: "#f0c040",
};

// ── Claude API ────────────────────────────────────────────────
// 모델 분리: 정확도 중요(MF분석·차트) → Sonnet / 비용절감(시황·포스팅·테마) → Haiku
const SONNET = "claude-sonnet-4-5-20250929";  // 정밀 분석용
const HAIKU  = "claude-haiku-4-5-20251001";   // 비용 절감용 (약 1/10 가격)

const getHeaders = () => {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("API_KEY_MISSING");
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
};

// ── 당일 캐시 헬퍼 ─────────────────────────────────────────────
// 시황·포스팅·테마추천은 하루 1회만 API 호출, 이후엔 캐시에서 로드
const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
};
const cache = {
  get: (key) => {
    try {
      const item = JSON.parse(localStorage.getItem("mf_cache_" + key) || "null");
      if (!item) return null;
      if (item.date !== todayKey()) { localStorage.removeItem("mf_cache_" + key); return null; }
      return item.data;
    } catch { return null; }
  },
  set: (key, data) => {
    try { localStorage.setItem("mf_cache_" + key, JSON.stringify({ date: todayKey(), data })); } catch {}
  },
  clear: (key) => { try { localStorage.removeItem("mf_cache_" + key); } catch {} },
};

// 일반 호출 (Sonnet - MF분석·차트이미지용)
const callClaude = async (messages, system, max_tokens = 1500) => {
  const headers = getHeaders();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: SONNET, max_tokens, system, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
};

// Haiku 호출 (시황·포스팅·AI노트용 - 저렴)
const callHaiku = async (messages, system, max_tokens = 1500) => {
  const headers = getHeaders();
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: HAIKU, max_tokens, system, messages }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || "";
};

// 웹검색 포함 호출 (Haiku - 시황·포스팅·테마추천용)
const callClaudeWithSearch = async (messages, system, max_tokens = 2000) => {
  const headers = getHeaders();
  let currentMessages = [...messages];
  let iterations = 0;

  while (iterations < 5) {
    iterations++;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: HAIKU,
        max_tokens,
        system,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: currentMessages,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json();

    if (data.stop_reason === "end_turn") {
      const textBlock = data.content?.find(b => b.type === "text");
      return textBlock?.text || "";
    }
    if (data.stop_reason === "tool_use") {
      const toolUses = data.content.filter(b => b.type === "tool_use");
      const toolResults = toolUses.map(tu => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: "검색 완료. 결과를 바탕으로 계속하세요.",
      }));
      currentMessages = [
        ...currentMessages,
        { role: "assistant", content: data.content },
        { role: "user", content: toolResults },
      ];
      continue;
    }
    const textBlock = data.content?.find(b => b.type === "text");
    if (textBlock?.text) return textBlock.text;
    break;
  }
  throw new Error("웹 검색 응답 처리 실패");
};

// ── 차트 이미지 분석 함수 ──────────────────────────────────────
const analyzeChartImage = async (base64Image, mediaType, ticker, currentPrice) => {
  const headers = getHeaders();
  const prompt = `이 차트 이미지는 ${ticker || "종목"} 일봉 차트입니다.
현재가: ${currentPrice || "확인 필요"}원

MF(MoveFutures) 분석을 위해 차트에서 다음을 읽어주세요:

1. 장기 추세 (3~6개월): 고점·저점 방향, 이평선 배열 상태
2. 단기 추세 (최근 1~2주): 방향 및 상태
3. 최근 저점 가격 (가장 최근 눌린 가격)
4. 직전 고점 가격 (저점 이전 가장 높았던 가격)
5. 저점 지지 터치 횟수 (그 가격대에서 몇 번 반등했는지)
6. 최근 캔들 패턴 (오늘/최근 봉이 양봉인지 음봉인지, 반전갭·장악형 여부)
7. 1차 목표가 추정 (다음 저항선)
8. 손절선 추정 (저점 아래)

반드시 아래 JSON 형식으로만 답하세요. 다른 텍스트 없이 JSON만:
{
  "trend_long": "장기 추세 설명",
  "trend_short": "단기 추세 설명",
  "support_price": "저점 가격 (숫자만, 예: 165700)",
  "high_price": "고점 가격 (숫자만, 예: 228500)",
  "support_touch": "터치 횟수 (숫자만, 예: 2)",
  "risk_type": "타점 패턴 (상승 반전갭/상승 장악형/하락 반전갭/하락 장악형/타점 미형성 중 하나)",
  "target1": "1차 목표가 (숫자만)",
  "stoploss": "손절선 (숫자만)",
  "summary": "차트 전반적 특징 한 줄 요약"
}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
          { type: "text", text: prompt }
        ]
      }]
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  // JSON 파싱
  const clean = text.replace(/```json|```/g, "").trim();
  return JSON.parse(clean);
};

// ── MF 분석 시스템 프롬프트 ─────────────────────────────────────
const MF_SYSTEM = `당신은 MoveFutures(MF) 주식선물 분석 전문가입니다.
MF 교육 기준에 따라 분석합니다:

【MF 3단계 분석 기준】
STEP 1. 방향성 판단
- A등급: 장/단기 모두 상승추세 (이평선 정배열, 고점·저점 우상향)
- B등급: 단기만 상승추세
- C등급: 방향성 없음 → 진입 불가

STEP 2. 딛는자리 판단
- A등급: 적정성(피보나치 0~0.5구간) + 유효성(2회이상 터치) 모두 확인
- B등급: 적정성만 확인 (유효성 불확실)
- C등급: 둘 다 불확실 → 진입 불가
*적정성: 피보나치 조정대 0~0.5 안에 있는 딛는자리 여부
*유효성: 과거 형성이력 또는 RP에 있는 매물대 + 2회 이상 터치

STEP 3. 리스크 판단
- A등급: 모든 리스크 해소 (타점: 반전갭/장악형 출현)
- B등급: 1차 목표가까지 리스크 없으나 다른 리스크 존재
- C등급: 1차 목표가까지 리스크 존재 → 진입 불가

【타점 패턴】
- 상승 반전갭: 음봉의 50% 위에서 시가 시작
- 상승 장악형: 음봉을 완전히 감싸는 양봉으로 마감
- 하락 반전갭/장악형: 반대

【진입 가능 조건】
- AA급 이상: A-A-A 또는 A-A-B → 적극 진입
- BB급: B-B-B 또는 A-B-B → 소량 진입 고려
- CC급 이하: 진입 불가

한국어로 MF 기준에 충실하게 분석해주세요.`;

// ── 아이콘 ────────────────────────────────────────────────────
const Ic = ({ n, s = 16 }) => {
  const d = {
    chart: <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,
    search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
    post: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></>,
    mf: <><path d="M3 3h7v7H3z"/><path d="M14 3h7v7h-7z"/><path d="M3 14h7v7H3z"/><path d="M17.5 14L21 21H14Z"/></>,
    send: <><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></>,
    spin: <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>,
    copy: <><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>,
    check: <polyline points="20 6 9 17 4 12"/>,
    refresh: <><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></>,
    star: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>,
    flame: <><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></>,
    bell: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>,
    add: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></>,
  };
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{d[n]}</svg>;
};

// ── 하단 탭 ───────────────────────────────────────────────────
const BottomTab = ({ active, onClick, icon, label }) => (
  <button onClick={onClick} style={{
    flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    gap: 3, padding: "10px 0 8px", background: "transparent", border: "none",
    color: active ? T.green : T.textDim, cursor: "pointer", fontSize: 9,
    fontFamily: "inherit", fontWeight: active ? 700 : 400,
    borderTop: `2px solid ${active ? T.green : "transparent"}`, transition: "all .2s",
  }}>
    {icon}{label}
  </button>
);

// ══════════════════════════════════════════════════════════════
// 탭1: MF 분석
// ══════════════════════════════════════════════════════════════
const MFAnalysisTab = () => {
  const [ticker, setTicker] = useState("");
  const [market, setMarket] = useState("KR");
  const [form, setForm] = useState({
    trend_long: "", trend_short: "",
    support_price: "", support_fibo: "", support_touch: "",
    risk_type: "", target1: "", stoploss: "",
    current_price: "", memo: "",
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // ── 차트 이미지 자동 분석 ────────────────────────────────────
  const [chartImg, setChartImg] = useState(null);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgStatus, setImgStatus] = useState("");
  const fileRef = useRef(null);

  const calcFibo = (high, low, current) => {
    const range = high - low;
    if (range <= 0) return "";
    const ratio = (high - current) / range;
    if (ratio <= 0.382) return `${ratio.toFixed(3)} (0~0.382 구간 ✅)`;
    if (ratio <= 0.5)   return `${ratio.toFixed(3)} (0.382~0.5 구간 ✅)`;
    if (ratio <= 0.618) return `${ratio.toFixed(3)} (0.5~0.618 구간 ⚠️)`;
    return `${ratio.toFixed(3)} (0.618 초과 ❌)`;
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const base64 = ev.target.result.split(",")[1];
      const mediaType = file.type || "image/png";
      setChartImg({ base64, mediaType, preview: ev.target.result });
      setImgStatus("📷 이미지 준비 완료 — 아래 버튼을 눌러 자동 분석하세요");
    };
    reader.readAsDataURL(file);
  };

  const autoAnalyze = async () => {
    if (!chartImg) return;
    setImgLoading(true);
    setImgStatus("🔍 차트 분석 중... (10~20초 소요)");
    try {
      const parsed = await analyzeChartImage(
        chartImg.base64, chartImg.mediaType,
        ticker, form.current_price
      );
      const high = parseFloat(parsed.high_price);
      const low  = parseFloat(parsed.support_price);
      const cur  = parseFloat(form.current_price) || ((high + low) / 2);
      const fiboStr = (!isNaN(high) && !isNaN(low) && !isNaN(cur))
        ? calcFibo(high, low, cur) : "";
      setForm(prev => ({
        ...prev,
        trend_long:    parsed.trend_long    || prev.trend_long,
        trend_short:   parsed.trend_short   || prev.trend_short,
        support_price: parsed.support_price || prev.support_price,
        support_fibo:  fiboStr              || prev.support_fibo,
        support_touch: parsed.support_touch || prev.support_touch,
        risk_type:     parsed.risk_type     || prev.risk_type,
        target1:       parsed.target1       || prev.target1,
        stoploss:      parsed.stoploss      || prev.stoploss,
        memo:          parsed.summary ? `[차트 분석] ${parsed.summary}` : prev.memo,
      }));
      setImgStatus("✅ 자동 입력 완료! 내용 확인 후 수정하세요.");
    } catch(e) {
      setImgStatus(`❌ 분석 실패: ${e.message}`);
    }
    setImgLoading(false);
  };

  const analyze = async () => {
    if (!ticker) return;
    setLoading(true); setResult(null);
    const prompt = `
종목: ${ticker} (${market === "KR" ? "한국" : "미국"} 시장)
현재가: ${form.current_price || "미입력"}

【STEP 1 방향성 입력값】
- 장기 추세: ${form.trend_long || "미입력"}
- 단기 추세: ${form.trend_short || "미입력"}

【STEP 2 딛는자리 입력값】
- 지지 가격대: ${form.support_price || "미입력"}
- 피보나치 위치: ${form.support_fibo || "미입력"}
- 매물대 터치 횟수: ${form.support_touch || "미입력"}회

【STEP 3 리스크 입력값】
- 타점 패턴: ${form.risk_type || "미입력"}
- 1차 목표가: ${form.target1 || "미입력"}
- 손절선: ${form.stoploss || "미입력"}

추가 메모: ${form.memo || "없음"}

위 데이터를 바탕으로 MF 3단계 기준으로 분석해주세요.
각 STEP별 등급(A/B/C)을 판정하고, 최종 진입 가능 여부와 전략을 제시해주세요.
형식: STEP1 등급 판정 → STEP2 등급 판정 → STEP3 등급 판정 → 최종 전략`;

    try {
      const r = await callClaude([{ role: "user", content: prompt }], MF_SYSTEM, 1500);
      setResult(r);
    } catch(e) {
      const msg = e?.message || "알 수 없는 오류";
      if (msg === "API_KEY_MISSING") {
        setResult("❌ API 키 없음. Vercel 환경변수 VITE_ANTHROPIC_API_KEY 확인 필요.");
      } else {
        setResult("❌ 오류: " + msg);
      }
    }
    setLoading(false);
  };

  const copyResult = () => {
    if (!result) return;
    navigator.clipboard.writeText(`[MF 분석] ${ticker}\n\n${result}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const gradeColor = (text) => {
    if (!text) return T.textMuted;
    if (text.includes("A등급") || text.includes("AA") || text.includes("진입 가능")) return T.green;
    if (text.includes("B등급") || text.includes("BB") || text.includes("소량")) return T.gold;
    if (text.includes("C등급") || text.includes("불가")) return T.red;
    return T.text;
  };

  const US_TICKERS = ["NVDA", "AMD", "TSMC", "ASML", "AVGO", "QCOM", "INTC", "MU", "AMAT"];
  const KR_TICKERS = ["삼성전자", "SK하이닉스", "한미반도체", "리노공업", "HPSP", "이오테크닉스"];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

        {/* 차트 이미지 업로드 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: 1.2, marginBottom: 10 }}>📷 차트 이미지 자동 분석</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 10, lineHeight: 1.6 }}>
            영웅문 일봉 차트를 캡처해서 올리면<br/>
            STEP 1·2·3 입력값을 자동으로 채워드려요!
          </div>

          {/* 업로드 영역 */}
          <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display:"none" }}/>
          <button onClick={() => fileRef.current?.click()} style={{
            width: "100%", padding: "14px 0", marginBottom: 10,
            background: chartImg ? T.greenDim : "transparent",
            border: `2px dashed ${chartImg ? T.green : T.border}`,
            borderRadius: 10, color: chartImg ? T.green : T.textMuted,
            cursor: "pointer", fontSize: 13, fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {chartImg
              ? <><Ic n="check" s={16}/>차트 이미지 선택됨 (다시 선택하려면 클릭)</>
              : <><Ic n="chart" s={16}/>차트 이미지 선택 (캡처 파일 업로드)</>
            }
          </button>

          {/* 이미지 미리보기 */}
          {chartImg?.preview && (
            <div style={{ marginBottom: 10, borderRadius: 8, overflow: "hidden", border: `1px solid ${T.border}` }}>
              <img src={chartImg.preview} alt="차트" style={{ width: "100%", display: "block", maxHeight: 200, objectFit: "cover" }}/>
            </div>
          )}

          {/* 자동 분석 버튼 */}
          <button onClick={autoAnalyze} disabled={!chartImg || imgLoading} style={{
            width: "100%", padding: "12px 0",
            background: chartImg && !imgLoading ? `linear-gradient(135deg, #006644, ${T.green})` : T.border,
            border: "none", borderRadius: 10,
            color: chartImg && !imgLoading ? "#001a11" : T.textDim,
            fontSize: 14, fontWeight: 800, cursor: chartImg && !imgLoading ? "pointer" : "not-allowed",
            fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          }}>
            {imgLoading
              ? <><div style={{ animation:"spin 1s linear infinite" }}><Ic n="spin" s={15}/></div>차트 분석 중...</>
              : <><Ic n="search" s={15}/>차트 자동 분석 → 입력값 채우기</>
            }
          </button>

          {/* 상태 메시지 */}
          {imgStatus && (
            <div style={{
              marginTop: 10, padding: "9px 12px", borderRadius: 8, fontSize: 12,
              background: imgStatus.startsWith("✅") ? T.greenDim : imgStatus.startsWith("❌") ? T.redDim : T.blueDim,
              color: imgStatus.startsWith("✅") ? T.green : imgStatus.startsWith("❌") ? T.red : T.blue,
              border: `1px solid ${imgStatus.startsWith("✅") ? T.greenMid : imgStatus.startsWith("❌") ? T.red+"44" : T.blue+"44"}`,
              lineHeight: 1.6,
            }}>{imgStatus}</div>
          )}
        </div>

        {/* 종목 선택 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: 1.2, marginBottom: 10 }}>STEP 0 · 종목 입력</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            {["KR", "US"].map(m => (
              <button key={m} onClick={() => setMarket(m)} style={{
                flex: 1, padding: "8px 0", background: market === m ? T.greenDim : "transparent",
                border: `1px solid ${market === m ? T.green : T.border}`, borderRadius: 8,
                color: market === m ? T.green : T.textMuted, cursor: "pointer", fontSize: 12,
                fontFamily: "inherit", fontWeight: market === m ? 700 : 400,
              }}>
                {m === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"}
              </button>
            ))}
          </div>
          <input value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())}
            placeholder="종목명 입력 (예: NVDA, 삼성전자)"
            style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "10px 13px", fontSize: 14, outline: "none", fontFamily: "inherit", fontWeight: 600, letterSpacing: 0.5, boxSizing: "border-box" }}
          />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {(market === "US" ? US_TICKERS : KR_TICKERS).map(t => (
              <button key={t} onClick={() => setTicker(t)} style={{
                background: ticker === t ? T.greenDim : "transparent", border: `1px solid ${ticker === t ? T.green : T.border}`,
                borderRadius: 6, padding: "4px 9px", color: ticker === t ? T.green : T.textMuted,
                fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              }}>{t}</button>
            ))}
          </div>
        </div>

        {/* 현재가 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, letterSpacing: 1.2, marginBottom: 10 }}>현재가</div>
          <input value={form.current_price} onChange={e => setForm({ ...form, current_price: e.target.value })}
            placeholder="현재 주가 입력"
            style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.gold, padding: "10px 13px", fontSize: 16, fontWeight: 700, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
          />
        </div>

        {/* STEP 1 방향성 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: 1.2, marginBottom: 12 }}>STEP 1 · 방향성</div>
          {[
            { key: "trend_long", label: "장기 추세", placeholder: "예: 상승추세 (고점·저점 우상향, 이평선 정배열)" },
            { key: "trend_short", label: "단기 추세", placeholder: "예: 단기 조정 후 반등 시도" },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 5 }}>{f.label}</div>
              <input value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
              />
            </div>
          ))}
          {/* 빠른 선택 */}
          <div style={{ display: "flex", gap: 6 }}>
            {[["장단기 상승", "A"], ["단기만 상승", "B"], ["방향성 없음", "C"]].map(([label, grade]) => (
              <button key={grade} onClick={() => setForm({ ...form, trend_long: label, trend_short: label })} style={{
                flex: 1, padding: "6px 0", background: "transparent",
                border: `1px solid ${grade === "A" ? T.green : grade === "B" ? T.gold : T.red}`,
                borderRadius: 6, color: grade === "A" ? T.green : grade === "B" ? T.gold : T.red,
                fontSize: 11, cursor: "pointer", fontFamily: "inherit",
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* STEP 2 딛는자리 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: 1.2, marginBottom: 12 }}>STEP 2 · 딛는자리</div>
          {[
            { key: "support_price", label: "지지 가격대 (매물대)", placeholder: "예: 85,000원 / 850달러" },
            { key: "support_fibo", label: "피보나치 조정 위치", placeholder: "예: 0.382 / 0.5 구간" },
            { key: "support_touch", label: "매물대 터치 횟수", placeholder: "예: 3 (2회 이상이면 유효)" },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 5 }}>{f.label}</div>
              <input value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
              />
            </div>
          ))}
        </div>

        {/* STEP 3 리스크 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: 1.2, marginBottom: 12 }}>STEP 3 · 리스크 & 타점</div>
          <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 8 }}>타점 패턴 선택</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 12 }}>
            {["상승 반전갭", "상승 장악형", "하락 반전갭", "하락 장악형", "타점 미형성", "기타"].map(p => (
              <button key={p} onClick={() => setForm({ ...form, risk_type: p })} style={{
                padding: "8px 0", background: form.risk_type === p ? T.greenDim : "transparent",
                border: `1px solid ${form.risk_type === p ? T.green : T.border}`, borderRadius: 7,
                color: form.risk_type === p ? T.green : T.textMuted, fontSize: 12,
                cursor: "pointer", fontFamily: "inherit",
              }}>{p}</button>
            ))}
          </div>
          {[
            { key: "target1", label: "1차 목표가", placeholder: "예: 95,000원" },
            { key: "stoploss", label: "손절선", placeholder: "예: 82,000원 (매물대 이탈 기준)" },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 5 }}>{f.label}</div>
              <input value={form[f.key]} onChange={e => setForm({ ...form, [f.key]: e.target.value })}
                placeholder={f.placeholder}
                style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
              />
            </div>
          ))}
          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, color: T.textMuted, marginBottom: 5 }}>추가 메모</div>
            <textarea value={form.memo} onChange={e => setForm({ ...form, memo: e.target.value })}
              placeholder="기타 관찰 사항, RP 위치, 추세선 등..."
              rows={2}
              style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", resize: "none", boxSizing: "border-box" }}
            />
          </div>
        </div>

        {/* 분석 버튼 */}
        <button onClick={analyze} disabled={!ticker || loading} style={{
          width: "100%", padding: "14px 0", marginBottom: 14,
          background: ticker && !loading ? `linear-gradient(135deg, #006644, ${T.green})` : T.border,
          border: "none", borderRadius: 12,
          color: ticker && !loading ? "#001a11" : T.textDim,
          fontSize: 15, fontWeight: 800, cursor: ticker && !loading ? "pointer" : "not-allowed",
          fontFamily: "inherit", letterSpacing: 0.5,
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          {loading
            ? <><div style={{ animation: "spin 1s linear infinite" }}><Ic n="spin" s={16} /></div>MF 분석 중...</>
            : <><Ic n="mf" s={16} />MF 기준 분석 실행</>
          }
        </button>

        {/* 결과 */}
        {result && (
          <div style={{ background: T.surface, borderRadius: 12, padding: 16, border: `1px solid ${T.greenMid}`, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: T.green, fontWeight: 700 }}>📊 {ticker} MF 분석 결과</div>
              <button onClick={copyResult} style={{
                background: copied ? T.greenDim : "transparent", border: `1px solid ${T.border}`,
                borderRadius: 7, padding: "5px 10px", color: copied ? T.green : T.textMuted,
                cursor: "pointer", fontSize: 11, fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {copied ? <><Ic n="check" s={12} />복사됨</> : <><Ic n="copy" s={12} />복사</>}
              </button>
            </div>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{result}</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// 탭2: 시황 브리핑
// ══════════════════════════════════════════════════════════════
const BriefingTab = () => {
  const [loading, setLoading] = useState(false);
  const [briefing, setBriefing] = useState(null);
  const [market, setMarket] = useState("both");
  const [copied, setCopied] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  // 탭 열릴 때 캐시 확인
  useEffect(() => {
    const cached = cache.get("briefing_" + market);
    if (cached) { setBriefing(cached); setFromCache(true); }
    else { setFromCache(false); }
  }, [market]);

  const BRIEFING_SYSTEM = `당신은 AI반도체 섹터 전문 주식 분석가입니다.
MF(MoveFutures) 투자 기법을 기반으로 매일 아침 시황 브리핑을 제공합니다.

중요: 반드시 웹 검색을 통해 실제 최신 데이터(주가, 뉴스, 공시)를 수집한 후 분석하세요.
- 실제 주가와 등락률을 구체적으로 기재
- 검색한 뉴스 출처를 명시
- 추측이나 일반론 대신 검색된 실제 데이터 기반으로 작성

분석 범위:
- 미국 AI반도체: NVDA, AMD, TSMC, ASML, AVGO, MU
- 한국 AI반도체: 삼성전자, SK하이닉스, 한미반도체, 리노공업, HPSP

포맷: 워드프레스 블로그 포스팅 형식 (마크다운 헤딩 ## ### 사용)
길이: 1500자 이상`;

  const [searchStatus, setSearchStatus] = useState("");

  const generate = async () => {
    setLoading(true); setBriefing(null); setSearchStatus("🔍 최신 시황 검색 중...");
    const marketText = market === "US" ? "미국 AI반도체" : market === "KR" ? "한국 AI반도체" : "미국 + 한국 AI반도체";
    const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

    const prompt = `오늘(${today}) ${marketText} AI반도체 섹터 시황 브리핑을 작성해주세요.

웹 검색으로 다음 최신 정보를 먼저 수집하세요:
${market !== "KR" ? "- NVDA AMD TSMC ASML 최근 주가 등락률 뉴스" : ""}
${market !== "US" ? "- 삼성전자 SK하이닉스 한미반도체 최근 주가 뉴스" : ""}
- AI반도체 섹터 최신 이슈 동향
- 나스닥 필라델피아 반도체지수 최근 동향

검색한 실제 데이터를 바탕으로 아래 구조로 작성:

## 오늘의 핵심 요약
(검색된 실제 데이터 기반 3줄 요약)

${market !== "KR" ? "## 미국 AI반도체 시황\n(NVDA·AMD·TSMC·ASML 실제 주가·등락률·뉴스 포함)" : ""}

${market !== "US" ? "## 한국 AI반도체 시황\n(삼성전자·SK하이닉스·한미반도체 실제 주가·등락률·뉴스 포함)" : ""}

## MF 관점 오늘의 주목 포인트
(검색 데이터 기반 MF 분석)

## 투자 시 주의사항

- 실제 주가와 등락률을 구체적으로 기재하세요
- 검색한 뉴스는 출처(매체명)를 명시하세요
- 1500자 이상 작성하세요`;

    try {
      setSearchStatus("🌐 웹 검색으로 최신 데이터 수집 중... (30초 내외 소요)");
      const r = await callClaudeWithSearch([{ role: "user", content: prompt }], BRIEFING_SYSTEM, 4000);
      setBriefing(r);
      setSearchStatus("");
    } catch(e) {
      const msg = e?.message || "알 수 없는 오류";
      setBriefing(`❌ 오류: ${msg}\n\n확인사항:\n1. Vercel 환경변수 VITE_ANTHROPIC_API_KEY 설정 여부\n2. API 크레딧 잔액 (console.anthropic.com)`);
      setSearchStatus("");
    }
    setLoading(false);
  };

  const copy = () => {
    if (!briefing) return;
    navigator.clipboard.writeText(briefing);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

        {/* 설정 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: 1.2, marginBottom: 10 }}>시장 선택</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            {[["both", "🌐 전체"], ["US", "🇺🇸 미국"], ["KR", "🇰🇷 한국"]].map(([v, label]) => (
              <button key={v} onClick={() => setMarket(v)} style={{
                padding: "9px 0", background: market === v ? T.greenDim : "transparent",
                border: `1px solid ${market === v ? T.green : T.border}`, borderRadius: 8,
                color: market === v ? T.green : T.textMuted, fontSize: 12,
                cursor: "pointer", fontFamily: "inherit", fontWeight: market === v ? 700 : 400,
              }}>{label}</button>
            ))}
          </div>
        </div>

        {/* 오늘 날짜 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 3 }}>오늘 날짜</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
              {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: T.textMuted, marginBottom: 3 }}>포스팅 대상</div>
            <div style={{ fontSize: 12, color: T.green }}>원두웍스 웹진</div>
          </div>
        </div>

        {/* 생성 버튼 */}
        <button onClick={generate} disabled={loading} style={{
          width: "100%", padding: "14px 0", marginBottom: searchStatus ? 8 : 14,
          background: !loading ? `linear-gradient(135deg, #004466, ${T.blue})` : T.border,
          border: "none", borderRadius: 12,
          color: !loading ? "#001122" : T.textDim,
          fontSize: 15, fontWeight: 800, cursor: !loading ? "pointer" : "not-allowed",
          fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          {loading
            ? <><div style={{ animation: "spin 1s linear infinite" }}><Ic n="spin" s={16} /></div>검색 & 브리핑 생성 중...</>
            : <><Ic n="refresh" s={16} />오늘의 AI반도체 브리핑 생성 (실시간 검색)</>
          }
        </button>

        {/* 캐시 알림 */}
        {fromCache && briefing && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:T.goldDim, borderRadius:10, padding:"9px 13px", marginBottom:10, border:`1px solid ${T.gold}44` }}>
            <div style={{ fontSize:11, color:T.gold }}>💾 오늘 생성한 브리핑 (캐시)</div>
            <button onClick={() => { cache.clear("briefing_" + market); setBriefing(null); setFromCache(false); }}
              style={{ background:"transparent", border:`1px solid ${T.gold}44`, borderRadius:6, padding:"3px 8px", color:T.gold, cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>
              새로 생성
            </button>
          </div>
        )}

        {/* 검색 상태 표시 */}
        {searchStatus && (
          <div style={{ background: T.blueDim, borderRadius: 10, padding: "10px 14px", marginBottom: 14, border: `1px solid ${T.blue}44`, display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ animation: "spin 1s linear infinite", color: T.blue, flexShrink: 0 }}><Ic n="spin" s={14}/></div>
            <div style={{ fontSize: 12, color: T.blue }}>{searchStatus}</div>
          </div>
        )}

        {/* 결과 */}
        {briefing && (
          <div style={{ background: T.surface, borderRadius: 12, padding: 16, border: `1px solid ${T.border}`, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: T.blue, fontWeight: 700 }}>📰 시황 브리핑 (워드프레스 복사용)</div>
              <button onClick={copy} style={{
                background: copied ? T.blueDim : "transparent", border: `1px solid ${T.border}`,
                borderRadius: 7, padding: "5px 10px", color: copied ? T.blue : T.textMuted,
                cursor: "pointer", fontSize: 11, fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {copied ? <><Ic n="check" s={12} />복사됨</> : <><Ic n="copy" s={12} />전체 복사</>}
              </button>
            </div>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{briefing}</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// 탭3: 포스팅 생성기
// ══════════════════════════════════════════════════════════════
const PostingTab = () => {
  const [postType, setPostType] = useState("watchlist");
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [post, setPost] = useState(null);
  const [copied, setCopied] = useState(false);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    const cacheKey = "posting_" + postType + "_" + (ticker || "auto");
    const cached = cache.get(cacheKey);
    if (cached) { setPost(cached); setFromCache(true); }
    else { setPost(null); setFromCache(false); }
  }, [postType]);

  const POST_SYSTEM = `당신은 AI반도체 주식 블로그 전문 작가입니다.
원두웍스 웹진(워드프레스)에 올릴 포스팅을 작성합니다.
SEO 최적화된 제목, 소제목(H2/H3), 본문으로 구성하고
MF 투자 관점을 녹여주세요.
한국어로 작성. 1500자 이상.`;

  const generate = async () => {
    setLoading(true); setPost(null);
    let prompt = "";
    const today = new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric" });

    if (postType === "watchlist") {
      prompt = `${today} AI반도체 관심 종목 분석 포스팅을 작성해주세요.
종목: ${ticker || "NVDA, SK하이닉스"}

웹 검색으로 해당 종목의 최근 주가, 뉴스, 실적 정보를 먼저 수집하세요.
검색한 실제 데이터를 바탕으로 MF 기준(방향성·딛는자리·리스크)으로 분석하고
투자 포인트 3가지와 주의사항을 포함해주세요.
실제 주가와 뉴스 출처를 명시해주세요.
워드프레스 포스팅 형식으로 작성.`;
    } else if (postType === "sector") {
      prompt = `${today} AI반도체 섹터 심층 분석 포스팅을 작성해주세요.
주제: HBM, CoWoS, GB200, ASML EUV 중 하나 선택해서 심층 분석
- 기술 트렌드 설명
- 수혜 종목 (미국 + 한국)
- MF 관점의 매매 전략
- 향후 전망
워드프레스 포스팅 형식. 1800자 이상.`;
    } else {
      prompt = `${today} AI반도체 MF 매매 시그널 포스팅을 작성해주세요.
오늘 주목할 매매 신호가 나오는 종목을 가상으로 설정하고
MF 3단계 분석(방향성→딛는자리→리스크)을 포함한 포스팅 작성.
- STEP1 방향성 등급
- STEP2 딛는자리 등급  
- STEP3 리스크 등급
- 최종 진입 전략
워드프레스 포스팅 형식.`;
    }

    try {
      const r = await callClaudeWithSearch([{ role: "user", content: prompt }], POST_SYSTEM, 2000);
      setPost(r);
      cache.set("posting_" + postType + "_" + (ticker || "auto"), r);
      setFromCache(false);
    } catch(e) {
      const msg = e?.message || "알 수 없는 오류";
      setPost("❌ 오류: " + msg + (msg === "API_KEY_MISSING" ? " → Vercel 환경변수 확인 필요" : ""));
    }
    setLoading(false);
  };

  const copy = () => {
    if (!post) return;
    navigator.clipboard.writeText(post);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const postTypes = [
    { id: "watchlist", icon: "🔍", label: "관심종목 분석" },
    { id: "sector", icon: "💡", label: "섹터 심층분석" },
    { id: "mf_signal", icon: "📡", label: "MF 매매 시그널" },
  ];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

        {/* 포스팅 타입 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: 1.2, marginBottom: 10 }}>포스팅 종류</div>
          {postTypes.map(p => (
            <button key={p.id} onClick={() => setPostType(p.id)} style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%",
              padding: "11px 14px", marginBottom: 7,
              background: postType === p.id ? T.greenDim : "transparent",
              border: `1px solid ${postType === p.id ? T.green : T.border}`, borderRadius: 10,
              color: postType === p.id ? T.green : T.textMuted, cursor: "pointer",
              fontSize: 13, fontFamily: "inherit", textAlign: "left",
            }}>
              <span style={{ fontSize: 18 }}>{p.icon}</span>
              <span style={{ fontWeight: postType === p.id ? 700 : 400 }}>{p.label}</span>
              {postType === p.id && <span style={{ marginLeft: "auto", fontSize: 10 }}>선택됨 ✓</span>}
            </button>
          ))}
        </div>

        {/* 종목 입력 (관심종목 분석일 때만) */}
        {postType === "watchlist" && (
          <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 12, border: `1px solid ${T.border}` }}>
            <div style={{ fontSize: 10, color: T.textMuted, fontWeight: 700, letterSpacing: 1.2, marginBottom: 8 }}>분석 종목</div>
            <input value={ticker} onChange={e => setTicker(e.target.value)}
              placeholder="예: NVDA, SK하이닉스 (비워두면 자동 선택)"
              style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "10px 13px", fontSize: 13, outline: "none", fontFamily: "inherit", boxSizing: "border-box" }}
            />
          </div>
        )}

        {/* 캐시 알림 */}
        {fromCache && post && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:T.goldDim, borderRadius:10, padding:"9px 13px", marginBottom:10, border:`1px solid ${T.gold}44` }}>
            <div style={{ fontSize:11, color:T.gold }}>💾 오늘 생성한 포스팅 (캐시)</div>
            <button onClick={() => { cache.clear("posting_" + postType + "_" + (ticker||"auto")); setPost(null); setFromCache(false); }}
              style={{ background:"transparent", border:`1px solid ${T.gold}44`, borderRadius:6, padding:"3px 8px", color:T.gold, cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>
              새로 생성
            </button>
          </div>
        )}

        {/* 생성 버튼 */}
        <button onClick={generate} disabled={loading} style={{
          width: "100%", padding: "14px 0", marginBottom: 14,
          background: !loading ? `linear-gradient(135deg, #440066, #8844ff)` : T.border,
          border: "none", borderRadius: 12,
          color: !loading ? "#e8e0ff" : T.textDim,
          fontSize: 15, fontWeight: 800, cursor: !loading ? "pointer" : "not-allowed",
          fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          {loading
            ? <><div style={{ animation: "spin 1s linear infinite" }}><Ic n="spin" s={16} /></div>포스팅 작성 중...</>
            : <><Ic n="post" s={16} />워드프레스 포스팅 생성</>
          }
        </button>

        {/* 결과 */}
        {post && (
          <div style={{ background: T.surface, borderRadius: 12, padding: 16, border: `1px solid ${T.border}`, marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontSize: 12, color: "#8844ff", fontWeight: 700 }}>✍️ 생성된 포스팅</div>
              <button onClick={copy} style={{
                background: "transparent", border: `1px solid ${T.border}`,
                borderRadius: 7, padding: "5px 10px", color: copied ? T.green : T.textMuted,
                cursor: "pointer", fontSize: 11, fontFamily: "inherit",
                display: "flex", alignItems: "center", gap: 4,
              }}>
                {copied ? <><Ic n="check" s={12} />복사됨</> : <><Ic n="copy" s={12} />전체 복사</>}
              </button>
            </div>
            <div style={{ fontSize: 13, color: T.text, lineHeight: 1.9, whiteSpace: "pre-wrap" }}>{post}</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// 탭4: 테마 추천 (실시간 검색 기반)
// ══════════════════════════════════════════════════════════════
const ThemeRecommendTab = () => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);
  const [market, setMarket] = useState("KR");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [fromCache, setFromCache] = useState(false);

  useEffect(() => {
    const cached = cache.get("theme_" + market);
    if (cached) { setResult(cached.data); setLastUpdated(cached.time); setFromCache(true); }
    else { setResult(null); setFromCache(false); }
  }, [market]);

  const THEME_SYSTEM = `당신은 주식 투자 전문가입니다.
웹 검색으로 최신 주식 방송, 증권사 리포트, 뉴스를 수집하여 종목을 추천합니다.

절대 규칙: 응답은 반드시 순수한 JSON만 출력하세요.
- 설명 텍스트 금지
- 마크다운 코드블록(백틱) 금지
- JSON 앞뒤에 어떤 문자도 추가 금지
- 첫 글자는 반드시 { 이어야 합니다

출력할 JSON 구조:
{"date":"날짜","themes":[{"theme":"테마명","icon":"이모지","reason":"주목이유","source":"출처","stocks":[{"name":"종목명","code":"코드","reason":"선정이유","price_info":"주가정보","mf_point":"MF포인트","caution":"주의사항"}]}],"summary":"시장요약"}`;

  const generate = async () => {
    setLoading(true); setResult(null);
    const today = new Date().toLocaleDateString("ko-KR", { year:"numeric", month:"long", day:"numeric", weekday:"long" });
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("ko-KR", { month:"long", day:"numeric" });

    const prompt = `오늘(${today}) 장 마감 후 내일 아침 주목할 ${market === "KR" ? "한국" : "미국"} 주식 테마 3개와 테마별 종목 3개씩 추천해주세요.

먼저 웹 검색으로 다음을 수집하세요:
- "${yesterday} 주식 방송 추천 종목" 또는 "오늘 주식 방송 테마"
- "장 마감 후 주목 종목 ${yesterday}"
- "${market === "KR" ? "한국 코스피 코스닥" : "미국 나스닥 뉴욕증시"} 오늘 테마 종목"
- 증권사 데일리 리포트 또는 유튜브 주식 방송 내용
- 오늘 급등 테마 또는 내일 기대 테마

검색 결과를 바탕으로:
1. 오늘 방송/뉴스에서 실제로 언급된 테마 3개 선정
2. 각 테마별 대표 종목 3개 (방송/리포트 근거)
3. MF 투자 관점의 매매 포인트

JSON 형식으로만 응답하세요.`;

    try {
      const r = await callClaudeWithSearch(
        [{ role: "user", content: prompt }],
        THEME_SYSTEM, 4000
      );
      // JSON 추출 강화: { 로 시작해서 } 로 끝나는 부분만 파싱
      let clean = r.replace(/```json|```/g, "").trim();
      // 혹시 앞에 텍스트가 있으면 첫 { 부터 마지막 } 까지만 추출
      const jsonStart = clean.indexOf("{");
      const jsonEnd = clean.lastIndexOf("}");
      if (jsonStart !== -1 && jsonEnd !== -1) {
        clean = clean.slice(jsonStart, jsonEnd + 1);
      }
      try {
        const parsed = JSON.parse(clean);
        const timeStr = new Date().toLocaleTimeString("ko-KR");
        setResult(parsed);
        setLastUpdated(timeStr);
        setFromCache(false);
        cache.set("theme_" + market, { data: parsed, time: timeStr });
      } catch(parseErr) {
        // JSON 파싱 실패 시 원본 텍스트를 raw로 표시
        const timeStr2 = new Date().toLocaleTimeString("ko-KR");
        setResult({ raw: r, error: null });
        setLastUpdated(timeStr2);
        setFromCache(false);
      }
    } catch(e) {
      setResult({ error: e.message });
    }
    setLoading(false);
  };

  const copyAll = () => {
    if (!result) return;
    const nl = "\n";
    const text = result.themes?.map(t =>
      "[" + t.icon + " " + t.theme + "]" + nl +
      "근거: " + t.reason + nl +
      "출처: " + t.source + nl +
      t.stocks.map((s, i) =>
        (i+1) + ". " + s.name + " (" + s.code + ")" + nl +
        "   └ " + s.reason + nl +
        "   └ MF: " + s.mf_point + nl +
        "   └ ⚠️ " + s.caution
      ).join(nl)
    ).join(nl + nl) || "";
    navigator.clipboard.writeText(
      "[테마 추천 " + lastUpdated + "]" + nl + nl +
      text + nl + nl +
      "📊 " + (result.summary || "")
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const gradeColor = (g) => g === "A" ? T.green : g === "B" ? T.gold : T.red;

  return (
    <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div style={{ flex:1, overflowY:"auto", padding:14 }}>

        {/* 헤더 설명 */}
        <div style={{ background:T.surface, borderRadius:12, padding:14, marginBottom:12, border:`1px solid ${T.border}` }}>
          <div style={{ fontSize:10, color:T.green, fontWeight:700, letterSpacing:1.2, marginBottom:8 }}>📡 실시간 테마 추천</div>
          <div style={{ fontSize:12, color:T.textMuted, lineHeight:1.7 }}>
            주식 방송·뉴스·증권사 리포트를 실시간 검색해서<br/>
            내일 아침 주목할 테마 3개 + 종목 3개씩 추천해드려요.
          </div>
        </div>

        {/* 시장 선택 */}
        <div style={{ display:"flex", gap:8, marginBottom:12 }}>
          {[["KR","🇰🇷 한국"], ["US","🇺🇸 미국"]].map(([v, label]) => (
            <button key={v} onClick={() => setMarket(v)} style={{
              flex:1, padding:"10px 0",
              background: market===v ? T.greenDim : "transparent",
              border:`1px solid ${market===v ? T.green : T.border}`, borderRadius:10,
              color: market===v ? T.green : T.textMuted, fontSize:13,
              cursor:"pointer", fontFamily:"inherit", fontWeight: market===v ? 700 : 400,
            }}>{label}</button>
          ))}
        </div>

        {/* 생성 버튼 */}
        <button onClick={generate} disabled={loading} style={{
          width:"100%", padding:"14px 0", marginBottom:14,
          background: !loading ? `linear-gradient(135deg, #2a0066, #8844ff)` : T.border,
          border:"none", borderRadius:12,
          color: !loading ? "#f0e8ff" : T.textDim,
          fontSize:15, fontWeight:800, cursor:!loading?"pointer":"not-allowed",
          fontFamily:"inherit", display:"flex", alignItems:"center", justifyContent:"center", gap:8,
        }}>
          {loading
            ? <><div style={{ animation:"spin 1s linear infinite" }}><Ic n="spin" s={16}/></div>방송·뉴스 검색 중... (30~40초)</>
            : <><Ic n="flame" s={16}/>오늘 테마 추천 받기 (실시간 검색)</>
          }
        </button>

        {/* 캐시 알림 */}
        {fromCache && result && (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:T.goldDim, borderRadius:10, padding:"9px 13px", marginBottom:12, border:`1px solid ${T.gold}44` }}>
            <div style={{ fontSize:11, color:T.gold }}>💾 오늘 생성한 추천 (캐시) · {lastUpdated}</div>
            <button onClick={() => { cache.clear("theme_" + market); setResult(null); setFromCache(false); }}
              style={{ background:"transparent", border:`1px solid ${T.gold}44`, borderRadius:6, padding:"3px 8px", color:T.gold, cursor:"pointer", fontSize:10, fontFamily:"inherit" }}>
              새로 검색
            </button>
          </div>
        )}

        {/* 결과 */}
        {result && !result.error && (
          <div>
            {/* 헤더 */}
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div>
                <div style={{ fontSize:12, color:T.green, fontWeight:700 }}>📊 테마 추천 결과</div>
                {lastUpdated && <div style={{ fontSize:10, color:T.textDim, marginTop:2 }}>검색 완료: {lastUpdated}</div>}
              </div>
              <button onClick={copyAll} style={{
                background:copied?T.greenDim:"transparent", border:`1px solid ${T.border}`,
                borderRadius:7, padding:"5px 10px", color:copied?T.green:T.textMuted,
                cursor:"pointer", fontSize:11, fontFamily:"inherit",
                display:"flex", alignItems:"center", gap:4,
              }}>
                {copied ? <><Ic n="check" s={12}/>복사됨</> : <><Ic n="copy" s={12}/>전체 복사</>}
              </button>
            </div>

            {/* 요약 */}
            {result.summary && (
              <div style={{ background:T.surface, borderRadius:10, padding:"11px 14px", marginBottom:14, border:`1px solid ${T.border}` }}>
                <div style={{ fontSize:11, color:T.textMuted }}>📌 {result.summary}</div>
              </div>
            )}

            {/* 테마별 카드 */}
            {result.themes?.map((theme, ti) => (
              <div key={ti} style={{ background:T.surface, borderRadius:14, padding:16, marginBottom:14, border:`1px solid ${T.border}` }}>
                {/* 테마 헤더 */}
                <div style={{ marginBottom:12, paddingBottom:10, borderBottom:`1px solid ${T.border}` }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:4 }}>
                    <span style={{ fontSize:22 }}>{theme.icon}</span>
                    <div>
                      <div style={{ fontSize:15, fontWeight:800, color:T.text }}>{theme.theme}</div>
                      <div style={{ fontSize:10, color:T.green }}>출처: {theme.source}</div>
                    </div>
                    <div style={{ marginLeft:"auto", background:"#8844ff22", border:"1px solid #8844ff44", borderRadius:6, padding:"2px 8px", fontSize:10, color:"#bb88ff" }}>
                      테마 {ti+1}
                    </div>
                  </div>
                  <div style={{ fontSize:11, color:T.textMuted, lineHeight:1.6 }}>{theme.reason}</div>
                </div>

                {/* 종목 리스트 */}
                {theme.stocks?.map((stock, si) => (
                  <div key={si} style={{ marginBottom: si < theme.stocks.length-1 ? 10 : 0, background:T.surface2, borderRadius:10, padding:12, border:`1px solid ${T.borderLight}` }}>
                    <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                      <div style={{ width:22, height:22, borderRadius:6, background:"#8844ff22", border:"1px solid #8844ff44", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:800, color:"#bb88ff", flexShrink:0 }}>
                        {si+1}
                      </div>
                      <div style={{ flex:1 }}>
                        <span style={{ fontSize:14, fontWeight:800, color:T.text }}>{stock.name}</span>
                        <span style={{ fontSize:10, color:T.textDim, marginLeft:6, background:T.border, padding:"1px 5px", borderRadius:3 }}>{stock.code}</span>
                      </div>
                      {stock.price_info && (
                        <div style={{ fontSize:11, color:T.gold }}>{stock.price_info}</div>
                      )}
                    </div>
                    <div style={{ fontSize:11, color:T.textMuted, lineHeight:1.65, marginBottom:5 }}>
                      {stock.reason}
                    </div>
                    <div style={{ background:T.greenDim, borderRadius:6, padding:"5px 9px", marginBottom:5, fontSize:11, color:T.green }}>
                      📊 MF: {stock.mf_point}
                    </div>
                    <div style={{ background:T.redDim, borderRadius:6, padding:"5px 9px", fontSize:11, color:T.red }}>
                      ⚠️ {stock.caution}
                    </div>
                  </div>
                ))}
              </div>
            ))}

            {/* 면책 */}
            <div style={{ background:T.surface, borderRadius:10, padding:"10px 13px", marginBottom:20, border:`1px solid ${T.border}` }}>
              <div style={{ fontSize:10, color:T.textDim, lineHeight:1.7 }}>
                ※ 본 추천은 AI가 수집한 방송·뉴스 기반이며 실제 투자 판단은 본인 책임입니다.<br/>
                반드시 MF 3단계 분석 후 진입 여부를 결정하세요.
              </div>
            </div>
          </div>
        )}

        {/* raw 텍스트 표시 (JSON 파싱 실패 시) */}
        {result?.raw && !result?.themes && (
          <div style={{ background:T.surface, borderRadius:12, padding:16, border:`1px solid ${T.border}`, marginBottom:20 }}>
            <div style={{ fontSize:12, color:T.gold, fontWeight:700, marginBottom:10 }}>
              📋 AI 분석 결과 (텍스트 형식)
            </div>
            <div style={{ fontSize:12, color:T.text, lineHeight:1.8, whiteSpace:"pre-wrap" }}>
              {result.raw}
            </div>
          </div>
        )}
        {/* 오류 */}
        {result?.error && (
          <div style={{ background:T.redDim, borderRadius:10, padding:14, border:`1px solid ${T.red}44` }}>
            <div style={{ fontSize:12, color:T.red }}>❌ {result.error}</div>
          </div>
        )}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// 탭5: 관심 종목 추적
// ══════════════════════════════════════════════════════════════
const WatchlistTab = () => {
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("mf_watchlist") || "[]"); } catch { return []; }
  });
  const [newTicker, setNewTicker] = useState("");
  const [newMemo, setNewMemo] = useState("");
  const [newMarket, setNewMarket] = useState("KR");
  const [selected, setSelected] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState("");

  useEffect(() => {
    try { localStorage.setItem("mf_watchlist", JSON.stringify(watchlist)); } catch {}
  }, [watchlist]);

  const add = () => {
    if (!newTicker.trim()) return;
    const item = { id: Date.now(), ticker: newTicker.trim().toUpperCase(), market: newMarket, memo: newMemo, grade: "?", addedAt: new Date().toLocaleDateString("ko-KR") };
    setWatchlist([item, ...watchlist]);
    setNewTicker(""); setNewMemo("");
  };

  const remove = (id) => setWatchlist(watchlist.filter(w => w.id !== id));

  const updateGrade = (id, grade) => setWatchlist(watchlist.map(w => w.id === id ? { ...w, grade } : w));

  const getAiNote = async (item) => {
    setAiLoading(true); setAiNote("");
    try {
      const r = await callHaiku([{ role: "user", content: `${item.ticker} (${item.market === "KR" ? "한국" : "미국"}) 종목. 이번 주 주목 이유와 MF 매매 전략 3가지를 간결하게. 메모: ${item.memo || "없음"}` }],
        MF_SYSTEM, 500);
      setAiNote(r);
    } catch(e) { setAiNote("❌ AI 오류: " + (e?.message || "실패")); }
    setAiLoading(false);
  };

  const gradeColors = { A: T.green, B: T.gold, C: T.red, "?": T.textDim };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>

        {/* 종목 추가 */}
        <div style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 14, border: `1px solid ${T.border}` }}>
          <div style={{ fontSize: 10, color: T.green, fontWeight: 700, letterSpacing: 1.2, marginBottom: 10 }}>관심 종목 추가</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            {["KR", "US"].map(m => (
              <button key={m} onClick={() => setNewMarket(m)} style={{
                flex: 1, padding: "7px 0", background: newMarket === m ? T.greenDim : "transparent",
                border: `1px solid ${newMarket === m ? T.green : T.border}`, borderRadius: 7,
                color: newMarket === m ? T.green : T.textMuted, fontSize: 12,
                cursor: "pointer", fontFamily: "inherit",
              }}>{m === "KR" ? "🇰🇷 한국" : "🇺🇸 미국"}</button>
            ))}
          </div>
          <input value={newTicker} onChange={e => setNewTicker(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === "Enter" && add()}
            placeholder="종목명 입력"
            style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "9px 12px", fontSize: 14, fontWeight: 600, outline: "none", fontFamily: "inherit", marginBottom: 8, boxSizing: "border-box" }}
          />
          <input value={newMemo} onChange={e => setNewMemo(e.target.value)}
            placeholder="메모 (매물대, 주목 이유 등)"
            style={{ width: "100%", background: T.bg, border: `1px solid ${T.border}`, borderRadius: 8, color: T.text, padding: "9px 12px", fontSize: 13, outline: "none", fontFamily: "inherit", marginBottom: 10, boxSizing: "border-box" }}
          />
          <button onClick={add} disabled={!newTicker.trim()} style={{
            width: "100%", padding: "10px 0", background: newTicker.trim() ? T.greenDim : T.border,
            border: `1px solid ${newTicker.trim() ? T.green : T.border}`, borderRadius: 8,
            color: newTicker.trim() ? T.green : T.textDim, fontSize: 13, fontWeight: 700,
            cursor: newTicker.trim() ? "pointer" : "not-allowed", fontFamily: "inherit",
          }}>+ 관심 종목 추가</button>
        </div>

        {/* 워치리스트 */}
        {watchlist.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px 0", color: T.textDim, fontSize: 13 }}>
            관심 종목을 추가해보세요<br />
            <span style={{ fontSize: 11, marginTop: 6, display: "block" }}>NVDA, SK하이닉스 등</span>
          </div>
        ) : watchlist.map(item => (
          <div key={item.id} style={{ background: T.surface, borderRadius: 12, padding: 14, marginBottom: 10, border: `1px solid ${selected === item.id ? T.green + "55" : T.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: item.memo ? 8 : 0 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 800, color: T.text, letterSpacing: 0.5 }}>{item.ticker}</span>
                  <span style={{ fontSize: 10, color: T.textDim, background: T.border, padding: "2px 6px", borderRadius: 4 }}>{item.market}</span>
                  <span style={{ fontSize: 10, color: T.textDim }}>{item.addedAt}</span>
                </div>
                {item.memo && <div style={{ fontSize: 12, color: T.textMuted, marginTop: 3 }}>{item.memo}</div>}
              </div>
              {/* MF 등급 */}
              <div style={{ display: "flex", gap: 4 }}>
                {["A", "B", "C"].map(g => (
                  <button key={g} onClick={() => updateGrade(item.id, g)} style={{
                    width: 28, height: 28, borderRadius: 6,
                    background: item.grade === g ? gradeColors[g] + "33" : "transparent",
                    border: `1px solid ${item.grade === g ? gradeColors[g] : T.border}`,
                    color: item.grade === g ? gradeColors[g] : T.textDim,
                    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}>{g}</button>
                ))}
              </div>
              <button onClick={() => { setSelected(selected === item.id ? null : item.id); if (selected !== item.id) { setAiNote(""); getAiNote(item); } }}
                style={{ background: T.greenDim, border: `1px solid ${T.green}`, borderRadius: 7, padding: "5px 10px", color: T.green, cursor: "pointer", fontSize: 11, fontFamily: "inherit" }}>
                AI
              </button>
              <button onClick={() => remove(item.id)} style={{ background: "none", border: "none", color: T.textDim, cursor: "pointer", padding: 4, fontSize: 16 }}>×</button>
            </div>

            {selected === item.id && (
              <div style={{ marginTop: 10, background: T.bg, borderRadius: 8, padding: 12, border: `1px solid ${T.border}` }}>
                {aiLoading
                  ? <div style={{ fontSize: 12, color: T.textMuted, display: "flex", gap: 6, alignItems: "center" }}><div style={{ animation: "spin 1s linear infinite" }}><Ic n="spin" s={12} /></div>AI 분석 중...</div>
                  : <div style={{ fontSize: 12, color: T.text, lineHeight: 1.8, whiteSpace: "pre-wrap" }}>{aiNote}</div>
                }
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// ══════════════════════════════════════════════════════════════
// 메인 앱
// ══════════════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("mf");

  const tabs = [
    { id: "mf",        icon: <Ic n="mf"    s={18}/>, label: "MF 분석" },
    { id: "theme",     icon: <Ic n="flame" s={18}/>, label: "테마추천" },
    { id: "briefing",  icon: <Ic n="chart" s={18}/>, label: "시황" },
    { id: "posting",   icon: <Ic n="post"  s={18}/>, label: "포스팅" },
    { id: "watchlist", icon: <Ic n="star"  s={18}/>, label: "관심종목" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: T.bg, fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', monospace", color: T.text, overflow: "hidden" }}>
      {/* 헤더 */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, paddingTop: "calc(10px + env(safe-area-inset-top,0px))" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.green, letterSpacing: 2, lineHeight: 1, fontFamily: "monospace" }}>MF STOCK</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
            <div style={{ fontSize: 8, color: T.textDim, letterSpacing: 2 }}>AI SEMICONDUCTOR AGENT</div>
            <div style={{ background: T.greenDim, border: `1px solid ${T.green}44`, borderRadius: 3, padding: "1px 5px", fontSize: 8, color: T.green, fontFamily: "monospace", letterSpacing: 0.5 }}>v10</div>
            <div style={{ fontSize: 8, color: T.textDim }}>2026.04.27</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: T.textDim }}>
            {new Date().toLocaleDateString("ko-KR", { month: "short", day: "numeric", weekday: "short" })}
          </div>
          <div style={{ fontSize: 9, color: T.green }}>● LIVE</div>
        </div>
      </div>

      {/* 컨텐츠 */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "mf"        && <MFAnalysisTab />}
        {tab === "theme"     && <ThemeRecommendTab />}
        {tab === "briefing"  && <BriefingTab />}
        {tab === "posting"   && <PostingTab />}
        {tab === "watchlist" && <WatchlistTab />}
      </div>

      {/* 하단 탭바 */}
      <div style={{ background: T.surface, borderTop: `1px solid ${T.border}`, display: "flex", flexShrink: 0, paddingBottom: "env(safe-area-inset-bottom,0px)" }}>
        {tabs.map(t => <BottomTab key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} icon={t.icon} label={t.label} />)}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        * { -webkit-tap-highlight-color: transparent; box-sizing: border-box; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: #1e2a2c; border-radius: 2px; }
        input::placeholder, textarea::placeholder { color: #3a5a54; }
      `}</style>
    </div>
  );
}
