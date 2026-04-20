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
const callClaude = async (messages, system, max_tokens = 2000) => {
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(apiKey ? { "x-api-key": apiKey } : {}) },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens, system, messages }),
  });
  if (!res.ok) throw new Error("API Error");
  const data = await res.json();
  return data.content?.[0]?.text || "";
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
  const [market, setMarket] = useState("KR"); // KR | US
  const [form, setForm] = useState({
    // 방향성
    trend_long: "", trend_short: "",
    // 딛는자리
    support_price: "", support_fibo: "", support_touch: "",
    // 리스크
    risk_type: "", target1: "", stoploss: "",
    // 현재가
    current_price: "",
    // 추가 메모
    memo: "",
  });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

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
    } catch { setResult("분석 오류. 다시 시도해 주세요."); }
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

  const BRIEFING_SYSTEM = `당신은 AI반도체 섹터 전문 주식 분석가입니다.
MF(MoveFutures) 투자 기법을 기반으로 매일 아침 시황 브리핑을 제공합니다.
한국어로 명확하고 실용적인 분석을 해주세요.

분석 범위:
- 미국 AI반도체: NVDA, AMD, TSMC, ASML, AVGO, MU
- 한국 AI반도체: 삼성전자, SK하이닉스, 한미반도체, 리노공업, HPSP

포맷: 워드프레스 블로그 포스팅 형식 (HTML 헤딩 사용)`;

  const generate = async () => {
    setLoading(true); setBriefing(null);
    const marketText = market === "US" ? "미국 AI반도체" : market === "KR" ? "한국 AI반도체" : "미국 + 한국 AI반도체";
    const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", weekday: "long" });

    const prompt = `오늘(${today}) ${marketText} 섹터 시황 브리핑을 작성해주세요.

다음 구조로 작성:
1. 오늘의 핵심 요약 (3줄)
2. ${market !== "KR" ? "미국 AI반도체 시황 (NVDA·AMD·TSMC·ASML 중심)" : ""}
${market !== "US" ? "3. 한국 AI반도체 시황 (삼성전자·SK하이닉스·한미반도체 중심)" : ""}
4. MF 관점의 오늘 주목 포인트
5. 투자 시 주의사항

워드프레스 블로그 포스팅으로 바로 사용 가능한 형태로, 1200자 이상 작성해주세요.
(실제 데이터가 없으므로 일반적인 분석 관점과 섹터 동향을 기반으로 작성)`;

    try {
      const r = await callClaude([{ role: "user", content: prompt }], BRIEFING_SYSTEM, 2000);
      setBriefing(r);
    } catch { setBriefing("브리핑 생성 오류. 다시 시도해 주세요."); }
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
          width: "100%", padding: "14px 0", marginBottom: 14,
          background: !loading ? `linear-gradient(135deg, #004466, ${T.blue})` : T.border,
          border: "none", borderRadius: 12,
          color: !loading ? "#001122" : T.textDim,
          fontSize: 15, fontWeight: 800, cursor: !loading ? "pointer" : "not-allowed",
          fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>
          {loading
            ? <><div style={{ animation: "spin 1s linear infinite" }}><Ic n="spin" s={16} /></div>브리핑 생성 중...</>
            : <><Ic n="refresh" s={16} />오늘의 AI반도체 브리핑 생성</>
          }
        </button>

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
  const [postType, setPostType] = useState("watchlist"); // watchlist | sector | mf_signal
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [post, setPost] = useState(null);
  const [copied, setCopied] = useState(false);

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
MF 기준(방향성·딛는자리·리스크)으로 분석하고
투자 포인트 3가지와 주의사항을 포함해주세요.
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
      const r = await callClaude([{ role: "user", content: prompt }], POST_SYSTEM, 2000);
      setPost(r);
    } catch { setPost("포스팅 생성 오류. 다시 시도해 주세요."); }
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
// 탭4: 관심 종목 추적
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
      const r = await callClaude([{ role: "user", content: `${item.ticker} (${item.market === "KR" ? "한국" : "미국"}) 종목에 대해 AI반도체 투자자 관점에서 이번 주 주목 이유와 MF 매매 전략을 3가지로 간결하게 설명해주세요. 메모: ${item.memo || "없음"}` }],
        MF_SYSTEM, 600);
      setAiNote(r);
    } catch { setAiNote("AI 노트 로드 실패"); }
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
    { id: "mf", icon: <Ic n="mf" s={18} />, label: "MF 분석" },
    { id: "briefing", icon: <Ic n="chart" s={18} />, label: "시황" },
    { id: "posting", icon: <Ic n="post" s={18} />, label: "포스팅" },
    { id: "watchlist", icon: <Ic n="star" s={18} />, label: "관심종목" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100dvh", background: T.bg, fontFamily: "'Noto Sans KR', 'Apple SD Gothic Neo', monospace", color: T.text, overflow: "hidden" }}>
      {/* 헤더 */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "10px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, paddingTop: "calc(10px + env(safe-area-inset-top,0px))" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: T.green, letterSpacing: 2, lineHeight: 1, fontFamily: "monospace" }}>MF STOCK</div>
          <div style={{ fontSize: 8, color: T.textDim, letterSpacing: 2 }}>AI SEMICONDUCTOR AGENT</div>
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
        {tab === "mf" && <MFAnalysisTab />}
        {tab === "briefing" && <BriefingTab />}
        {tab === "posting" && <PostingTab />}
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
