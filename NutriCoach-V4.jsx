import { useState, useEffect, useRef, useCallback } from "react";

// ─── THEME ───────────────────────────────────────────────────────────────────
const T = {
  bg: "#080808", card: "#0f0f0f", card2: "#141414",
  border: "#1c1c1c", border2: "#242424",
  accent: "#c8f547", accentDark: "#8aaa28",
  blue: "#4da6ff", orange: "#ff8c3d", red: "#ff4d6d",
  purple: "#b06bff", teal: "#3dffd4",
  text: "#f2f2f2", muted: "#555", muted2: "#333",
  white: "#fff",
};

const font = "'DM Mono', 'Courier New', monospace";
const fontSans = "'Syne', 'Helvetica Neue', sans-serif";

// ─── CLAUDE API ───────────────────────────────────────────────────────────────
async function claude(messages, system, maxTokens = 1000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: maxTokens, system, messages }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`API ${res.status}`);
    const d = await res.json();
    return d.content?.[0]?.text || "";
  } catch (e) {
    if (e.name === "AbortError") return "__TIMEOUT__";
    return "__ERROR__";
  }
}

// Safe JSON parse with fallback
function safeJSON(text, fallback) {
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch { return fallback; }
}

// ─── STORAGE ──────────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().split("T")[0];

async function load(key) {
  try { const r = await window.storage.get(key); return r ? JSON.parse(r.value) : null; }
  catch { return null; }
}
async function save(key, val) {
  try { await window.storage.set(key, JSON.stringify(val)); } catch {}
}

// ─── CALCULATIONS ─────────────────────────────────────────────────────────────
function calcTDEE(profile) {
  const { age, weight, height, gender, activity } = profile;
  const w = parseFloat(weight), h = parseFloat(height), a = parseFloat(age);
  let bmr = gender === "male"
    ? 10 * w + 6.25 * h - 5 * a + 5
    : 10 * w + 6.25 * h - 5 * a - 161;
  const mult = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, veryactive: 1.9 };
  const tdee = Math.round(bmr * (mult[activity] || 1.55));
  const goal = profile.goal === "lose" ? tdee - 500 : profile.goal === "gain" ? tdee + 300 : tdee;
  return {
    tdee, goal,
    protein: Math.round(w * 2),
    fat: Math.round((goal * 0.25) / 9),
    carbs: Math.round((goal - w * 2 * 4 - (goal * 0.25)) / 4),
  };
}

// ─── STREAK HELPERS ───────────────────────────────────────────────────────────
function calcStreak(logs) {
  let streak = 0;
  const d = new Date();
  // Check if today already logged; if so start from today, otherwise from yesterday
  const todayKey = d.toISOString().split("T")[0];
  const hasToday = (logs[todayKey] || []).length > 0;
  if (!hasToday) d.setDate(d.getDate() - 1);

  while (true) {
    const key = d.toISOString().split("T")[0];
    if ((logs[key] || []).length > 0) {
      streak++;
      d.setDate(d.getDate() - 1);
    } else break;
  }
  return streak;
}

function getLast7DaysCompliance(logs, profile) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().split("T")[0];
    const meals = logs[key] || [];
    const kcal = meals.reduce((s, m) => s + m.kcal, 0);
    const logged = meals.length > 0;
    const onTarget = logged && kcal >= profile.goal * 0.8 && kcal <= profile.goal * 1.15;
    return { key, day: d.toLocaleDateString("en", { weekday: "short" })[0], logged, onTarget, kcal };
  });
}

// ─── SHARED COMPONENTS ────────────────────────────────────────────────────────
const Btn = ({ children, onClick, variant = "accent", style = {}, disabled }) => {
  const bg = variant === "accent" ? T.accent : variant === "ghost" ? "transparent" : T.card2;
  const color = variant === "accent" ? "#000" : T.text;
  const border = variant === "ghost" ? `1px solid ${T.border}` : "none";
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: bg, color, border, borderRadius: 14,
      padding: "13px 22px", fontFamily: fontSans, fontWeight: 800,
      fontSize: 14, cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1, transition: "all 0.15s", ...style,
    }}>{children}</button>
  );
};

const Card = ({ children, style = {} }) => (
  <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 20, padding: 20, ...style }}>
    {children}
  </div>
);

const Label = ({ children }) => (
  <div style={{ fontFamily: font, fontSize: 10, color: T.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>
    {children}
  </div>
);

const Input = ({ value, onChange, onKeyDown, placeholder, type = "text", style = {} }) => (
  <input
    type={type} value={value} onChange={onChange} onKeyDown={onKeyDown} placeholder={placeholder}
    style={{
      background: T.card2, border: `1px solid ${T.border}`, borderRadius: 12,
      padding: "12px 16px", color: T.text, fontFamily: fontSans, fontSize: 14,
      outline: "none", width: "100%", boxSizing: "border-box", ...style,
    }}
  />
);

function Ring({ value, max, size = 120, stroke = 10, color = T.accent, label, sublabel }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(Math.max(value / max, 0), 1);
  return (
    <div style={{ position: "relative", width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ position: "absolute", top: 0, left: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={T.muted2} strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${pct * circ} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(.4,0,.2,1)" }}
        />
      </svg>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontFamily: font, fontSize: size > 100 ? 22 : 14, fontWeight: 700, color: T.text }}>{label}</div>
        {sublabel && <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>{sublabel}</div>}
      </div>
    </div>
  );
}

// ─── ONBOARDING ───────────────────────────────────────────────────────────────
function Onboarding({ onDone }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ name: "", age: "", weight: "", height: "", gender: "male", goal: "lose", activity: "moderate" });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const steps = [
    { title: "What's your name?", field: "name", type: "text", placeholder: "Your name..." },
    { title: "How old are you?", field: "age", type: "number", placeholder: "Age in years" },
    { title: "Your weight (kg)", field: "weight", type: "number", placeholder: "e.g. 70" },
    { title: "Your height (cm)", field: "height", type: "number", placeholder: "e.g. 175" },
  ];

  const isValid = () => {
    if (step < steps.length) return form[steps[step].field]?.toString().trim().length > 0;
    return true;
  };

  const next = () => {
    if (step < steps.length - 1) { setStep(p => p + 1); return; }
    if (step === steps.length - 1) { setStep(p => p + 1); return; }
    if (step === steps.length) { setStep(p => p + 1); return; }
    if (step === steps.length + 1) { setStep(p => p + 1); return; }
    const macros = calcTDEE(form);
    const profile = { ...form, ...macros, createdAt: today() };
    save("profile", profile);
    onDone(profile);
  };

  const totalSteps = steps.length + 3;
  const progress = ((step + 1) / totalSteps) * 100;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", flexDirection: "column", padding: "0 24px", maxWidth: 420, margin: "0 auto" }}>
      <div style={{ height: 3, background: T.muted2, marginTop: 0 }}>
        <div style={{ height: "100%", width: `${progress}%`, background: T.accent, transition: "width 0.4s ease" }} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingBottom: 60 }}>
        <div style={{ marginBottom: 48 }}>
          <div style={{ fontFamily: font, fontSize: 11, color: T.accent, letterSpacing: 4, marginBottom: 6 }}>NUTRICOACH</div>
          <div style={{ width: 40, height: 3, background: T.accent, borderRadius: 2 }} />
        </div>

        {step < steps.length && (
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 30, fontWeight: 900, color: T.text, marginBottom: 32, lineHeight: 1.1 }}>
              {steps[step].title}
            </div>
            <Input value={form[steps[step].field]} onChange={e => set(steps[step].field, e.target.value)}
              placeholder={steps[step].placeholder} type={steps[step].type} />
          </div>
        )}

        {step === steps.length && (
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 30, fontWeight: 900, color: T.text, marginBottom: 32, lineHeight: 1.1 }}>Your gender</div>
            {["male", "female"].map(g => (
              <div key={g} onClick={() => set("gender", g)} style={{
                background: form.gender === g ? T.accent : T.card2,
                color: form.gender === g ? "#000" : T.muted,
                border: `1px solid ${form.gender === g ? T.accent : T.border}`,
                borderRadius: 14, padding: "16px 20px", marginBottom: 12,
                fontFamily: fontSans, fontWeight: 700, fontSize: 15,
                cursor: "pointer", textTransform: "capitalize", transition: "all 0.2s",
              }}>{g === "male" ? "👨 Male" : "👩 Female"}</div>
            ))}
          </div>
        )}

        {step === steps.length + 1 && (
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 30, fontWeight: 900, color: T.text, marginBottom: 32, lineHeight: 1.1 }}>Your goal</div>
            {[{ k: "lose", label: "🔥 Lose fat", desc: "500 kcal deficit" }, { k: "maintain", label: "⚖️ Maintain weight", desc: "Eat at TDEE" }, { k: "gain", label: "💪 Build muscle", desc: "300 kcal surplus" }].map(g => (
              <div key={g.k} onClick={() => set("goal", g.k)} style={{
                background: form.goal === g.k ? T.accent : T.card2,
                color: form.goal === g.k ? "#000" : T.text,
                border: `1px solid ${form.goal === g.k ? T.accent : T.border}`,
                borderRadius: 14, padding: "16px 20px", marginBottom: 12,
                cursor: "pointer", transition: "all 0.2s",
              }}>
                <div style={{ fontFamily: fontSans, fontWeight: 700, fontSize: 15 }}>{g.label}</div>
                <div style={{ fontFamily: font, fontSize: 11, color: form.goal === g.k ? "#333" : T.muted, marginTop: 2 }}>{g.desc}</div>
              </div>
            ))}
          </div>
        )}

        {step === steps.length + 2 && (
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 30, fontWeight: 900, color: T.text, marginBottom: 32, lineHeight: 1.1 }}>Activity level</div>
            {[
              { k: "sedentary", label: "🪑 Sedentary", desc: "Desk job, no exercise" },
              { k: "light", label: "🚶 Light", desc: "1-3 days/week" },
              { k: "moderate", label: "🏃 Moderate", desc: "3-5 days/week" },
              { k: "active", label: "🏋️ Active", desc: "6-7 days/week" },
              { k: "veryactive", label: "⚡ Very Active", desc: "2x/day training" },
            ].map(g => (
              <div key={g.k} onClick={() => set("activity", g.k)} style={{
                background: form.activity === g.k ? T.accent : T.card2,
                color: form.activity === g.k ? "#000" : T.text,
                border: `1px solid ${form.activity === g.k ? T.accent : T.border}`,
                borderRadius: 14, padding: "14px 18px", marginBottom: 10,
                cursor: "pointer", transition: "all 0.2s",
              }}>
                <div style={{ fontFamily: fontSans, fontWeight: 700, fontSize: 14 }}>{g.label}</div>
                <div style={{ fontFamily: font, fontSize: 10, color: form.activity === g.k ? "#333" : T.muted, marginTop: 2 }}>{g.desc}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ paddingBottom: 40 }}>
        <Btn onClick={next} disabled={!isValid()} style={{ width: "100%" }}>
          {step < totalSteps - 1 ? "Continue →" : "Let's Go 🚀"}
        </Btn>
      </div>
    </div>
  );
}

// ─── STREAK WIDGET ────────────────────────────────────────────────────────────
function StreakWidget({ logs, profile }) {
  const streak = calcStreak(logs);
  const compliance = getLast7DaysCompliance(logs, profile);
  const hasToday = (logs[today()] || []).length > 0;

  const flameColor = streak === 0 ? T.muted : streak >= 7 ? T.orange : streak >= 3 ? "#ffcc44" : T.accent;

  return (
    <Card style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            fontSize: 36,
            filter: streak === 0 ? "grayscale(1) opacity(0.4)" : "none",
            animation: streak >= 3 ? "flame 1.5s ease-in-out infinite" : "none",
          }}>🔥</div>
          <div>
            <div style={{ fontFamily: fontSans, fontSize: 28, fontWeight: 900, color: flameColor, lineHeight: 1 }}>
              {streak}
            </div>
            <div style={{ fontFamily: font, fontSize: 10, color: T.muted, letterSpacing: 1 }}>
              {streak === 1 ? "DAY STREAK" : "DAY STREAK"}
            </div>
          </div>
        </div>

        {/* 7-day dots */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {compliance.map((d, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%",
                background: d.onTarget ? T.accent : d.logged ? T.orange : T.muted2,
                border: d.key === today() ? `2px solid ${T.white}` : "2px solid transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 12,
                transition: "all 0.3s",
              }}>
                {d.onTarget ? "✓" : d.logged ? "~" : ""}
              </div>
              <div style={{ fontFamily: font, fontSize: 8, color: d.key === today() ? T.accent : T.muted }}>{d.day}</div>
            </div>
          ))}
        </div>
      </div>

      {!hasToday && streak > 0 && (
        <div style={{
          marginTop: 12, padding: "8px 12px", background: "rgba(200,245,71,0.08)",
          borderRadius: 10, border: `1px solid rgba(200,245,71,0.2)`,
          fontFamily: font, fontSize: 11, color: T.accent,
        }}>
          ⚡ Log a meal today to keep your streak alive!
        </div>
      )}
      {streak === 0 && (
        <div style={{
          marginTop: 12, fontFamily: font, fontSize: 11, color: T.muted,
        }}>
          Log your first meal to start a streak!
        </div>
      )}
    </Card>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function Dashboard({ profile, logs, water, onAddMeal, onPhotoLog, onNav }) {
  const todayLogs = logs[today()] || [];
  const eaten = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  todayLogs.forEach(m => { eaten.kcal += m.kcal; eaten.protein += m.protein; eaten.carbs += m.carbs; eaten.fat += m.fat; });

  const remaining = profile.goal - eaten.kcal;
  const todayWater = water[today()] || 0;
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const macros = [
    { label: "Protein", value: eaten.protein, max: profile.protein, color: T.blue },
    { label: "Carbs", value: eaten.carbs, max: profile.carbs, color: T.accent },
    { label: "Fat", value: eaten.fat, max: profile.fat, color: T.orange },
  ];

  const streak = calcStreak(logs);
  const noMealsToday = todayLogs.length === 0;
  const streakAtRisk = streak > 0 && noMealsToday && hour >= 12;
  const highlyOver = eaten.kcal > profile.goal * 1.2 && eaten.kcal > 0;
  const proteinBehind = eaten.protein < profile.protein * 0.3 && hour >= 18;

  // Determine the most urgent alert
  let urgentAlert = null;
  if (streakAtRisk) urgentAlert = { msg: `🔥 ${streak}-day streak at risk — log a meal to keep it alive`, color: T.orange };
  else if (noMealsToday && hour >= 14) urgentAlert = { msg: "⏰ No meals logged yet today — start tracking!", color: T.red };
  else if (highlyOver) urgentAlert = { msg: `⚠️ ${eaten.kcal - profile.goal} kcal over goal — consider a lighter dinner`, color: T.orange };
  else if (proteinBehind) urgentAlert = { msg: `🥩 Only ${eaten.protein}g protein so far — ${profile.protein - eaten.protein}g left to hit your target`, color: T.blue };

  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: font, fontSize: 10, color: T.muted, letterSpacing: 3 }}>{greeting.toUpperCase()}</div>
          <div style={{ fontFamily: fontSans, fontSize: 26, fontWeight: 900, color: T.text, marginTop: 2 }}>{profile.name} 👋</div>
        </div>
        <div onClick={() => onNav("profile")} style={{
          width: 44, height: 44, borderRadius: "50%", background: T.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: fontSans, fontWeight: 900, fontSize: 18, color: "#000", cursor: "pointer",
        }}>{profile.name?.[0]?.toUpperCase()}</div>
      </div>

      {/* ── PRIORITY: Urgent Alert Banner ── */}
      {urgentAlert && (
        <div style={{
          background: urgentAlert.color + "18",
          border: `1px solid ${urgentAlert.color}55`,
          borderRadius: 14, padding: "12px 16px",
          fontFamily: font, fontSize: 12, color: urgentAlert.color, lineHeight: 1.5,
        }}>{urgentAlert.msg}</div>
      )}

      {/* Streak Widget */}
      <StreakWidget logs={logs} profile={profile} />

      {/* Calorie Card */}
      <Card style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <Ring value={eaten.kcal} max={profile.goal} size={110} stroke={10}
          color={eaten.kcal > profile.goal ? T.orange : T.accent}
          label={eaten.kcal} sublabel="eaten" />
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: font, fontSize: 10, color: T.muted, letterSpacing: 2, marginBottom: 8 }}>DAILY CALORIES</div>
          <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: remaining < 0 ? T.orange : T.text }}>
            {remaining < 0 ? `+${Math.abs(remaining)}` : remaining}
          </div>
          <div style={{ fontFamily: font, fontSize: 11, color: T.muted }}>
            {remaining < 0 ? "over goal" : "kcal remaining"}
          </div>
          <div style={{ marginTop: 12, height: 4, background: T.muted2, borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4,
              width: `${Math.min((eaten.kcal / profile.goal) * 100, 100)}%`,
              background: eaten.kcal > profile.goal ? T.orange : T.accent,
              transition: "width 0.8s ease",
            }} />
          </div>
          <div style={{ fontFamily: font, fontSize: 10, color: T.muted, marginTop: 6 }}>Goal: {profile.goal} kcal</div>
        </div>
      </Card>

      {/* Macros */}
      <Card>
        <Label>Macros Today</Label>
        <div style={{ display: "flex", justifyContent: "space-around", gap: 8 }}>
          {macros.map(m => (
            <div key={m.label} style={{ textAlign: "center" }}>
              <Ring value={m.value} max={m.max} size={72} stroke={6} color={m.color} label={`${m.value}g`} />
              <div style={{ fontFamily: font, fontSize: 10, color: T.muted, marginTop: 4 }}>{m.label}</div>
              <div style={{ fontFamily: font, fontSize: 9, color: T.muted2, marginTop: 1 }}>/ {m.max}g</div>
            </div>
          ))}
        </div>
      </Card>

      {/* Today's Meals — shown early so coach sees them */}
      {todayLogs.length > 0 ? (
        <Card>
          <Label>Today's Meals</Label>
          {todayLogs.map((m, i) => (
            <div key={i} style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "11px 0", borderBottom: i < todayLogs.length - 1 ? `1px solid ${T.border}` : "none",
            }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontFamily: fontSans, fontWeight: 600, fontSize: 14, color: T.text }}>{m.name}</div>
                  {m.fromPhoto && <div style={{ fontFamily: font, fontSize: 9, color: T.accent, background: `${T.accent}22`, borderRadius: 6, padding: "2px 6px" }}>📷 AI</div>}
                </div>
                <div style={{ fontFamily: font, fontSize: 10, color: T.muted, marginTop: 2 }}>
                  {m.time} · P:{m.protein}g C:{m.carbs}g F:{m.fat}g
                </div>
              </div>
              <div style={{ fontFamily: font, fontSize: 15, fontWeight: 700, color: T.accent }}>{m.kcal}</div>
            </div>
          ))}
        </Card>
      ) : (
        /* Fix 9: Meaningful empty state */
        <Card style={{ borderColor: T.border, borderStyle: "dashed" }}>
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>🍽️</div>
            <div style={{ fontFamily: fontSans, fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 4 }}>Nothing logged yet</div>
            <div style={{ fontFamily: font, fontSize: 11, color: T.muted, marginBottom: 16, lineHeight: 1.6 }}>
              Log your first meal to start tracking.<br/>AI estimates macros automatically.
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <Btn onClick={onAddMeal} style={{ padding: "10px 18px", fontSize: 13 }}>+ Type Meal</Btn>
              <Btn onClick={onPhotoLog} variant="ghost" style={{ padding: "10px 18px", fontSize: 13 }}>📷 Photo</Btn>
            </div>
          </div>
        </Card>
      )}

      {/* Water & Quick Stats */}
      <div style={{ display: "flex", gap: 12 }}>
        <Card style={{ flex: 1, padding: 16 }}>
          <Label>Water</Label>
          <div style={{ fontFamily: fontSans, fontSize: 24, fontWeight: 900, color: T.blue }}>{todayWater}</div>
          <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>glasses today</div>
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <Btn onClick={() => onNav("water-add")} variant="ghost" style={{ flex: 1, padding: "8px", fontSize: 18 }}>+</Btn>
          </div>
        </Card>
        <Card style={{ flex: 1, padding: 16 }}>
          <Label>Meals Logged</Label>
          <div style={{ fontFamily: fontSans, fontSize: 24, fontWeight: 900, color: T.accent }}>{todayLogs.length}</div>
          <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>today</div>
          <Btn onClick={onAddMeal} style={{ width: "100%", marginTop: 12, padding: "8px", fontSize: 12 }}>+ Log Meal</Btn>
        </Card>
      </div>

      {/* Photo Log CTA */}
      <div onClick={onPhotoLog} style={{
        background: "linear-gradient(135deg, #141414 0%, #1a1a0a 100%)",
        border: `1px solid ${T.accent}33`,
        borderRadius: 20, padding: "16px 20px",
        display: "flex", alignItems: "center", gap: 16,
        cursor: "pointer", transition: "all 0.2s",
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, background: T.accent,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, flexShrink: 0,
        }}>📷</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: fontSans, fontWeight: 800, fontSize: 15, color: T.text }}>Snap to Log</div>
          <div style={{ fontFamily: font, fontSize: 11, color: T.muted, marginTop: 2 }}>Take a photo — AI estimates macros instantly</div>
        </div>
        <div style={{ color: T.accent, fontSize: 20 }}>→</div>
      </div>

      {/* Quick Actions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {[
          { icon: "📊", label: "Weekly Stats", screen: "week" },
          { icon: "🤖", label: "AI Analysis", screen: "analysis" },
          { icon: "💬", label: "AI Chat", screen: "chat" },
          { icon: "📈", label: "Progress", screen: "progress" },
        ].map(a => (
          <Card key={a.screen} style={{ padding: 16, cursor: "pointer", transition: "all 0.2s" }}
            onClick={() => onNav(a.screen)}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>{a.icon}</div>
            <div style={{ fontFamily: fontSans, fontWeight: 700, fontSize: 13, color: T.text }}>{a.label}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── ADD MEAL ─────────────────────────────────────────────────────────────────
function AddMeal({ profile, onSave, onBack }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [qty, setQty] = useState("1");
  const [mealType, setMealType] = useState("Lunch");

  const analyze = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setError(null);
    const text = await claude(
      [{ role: "user", content: `Food: "${query}", quantity multiplier: ${qty || 1}` }],
      `You are a precise nutrition database. Estimate macros for the given food and quantity. Account for typical Indian/Asian preparations (oils, ghee, coconut) when relevant. Return ONLY valid JSON, no markdown, no explanation:\n{"name":"<concise dish name>","kcal":<integer>,"kcalMin":<integer, -10% estimate>,"kcalMax":<integer, +15% estimate>,"protein":<integer>,"carbs":<integer>,"fat":<integer>,"fiber":<integer>,"confidence":"<low|medium|high>"}`
    );
    if (text === "__TIMEOUT__" || text === "__ERROR__") {
      setError("Couldn't reach AI — check your connection and try again.");
    } else {
      const parsed = safeJSON(text, null);
      if (parsed && parsed.kcal > 0) setResult(parsed);
      else setError("Couldn't parse the meal. Try being more specific, e.g. '2 rotis with 1 cup dal'.");
    }
    setLoading(false);
  };

  const saveMeal = () => {
    if (!result) return;
    const now = new Date();
    onSave({ ...result, mealType, time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
  };

  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={onBack} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
        <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: T.text }}>Log Meal</div>
      </div>

      <Card>
        <Label>Meal Type</Label>
        <div style={{ display: "flex", gap: 8 }}>
          {["Breakfast", "Lunch", "Dinner", "Snack"].map(t => (
            <div key={t} onClick={() => setMealType(t)} style={{
              flex: 1, background: mealType === t ? T.accent : T.card2,
              color: mealType === t ? "#000" : T.muted,
              borderRadius: 10, padding: "8px 4px", textAlign: "center",
              fontFamily: font, fontSize: 10, cursor: "pointer", transition: "all 0.2s",
            }}>{t}</div>
          ))}
        </div>
      </Card>

      <Card>
        <Label>What did you eat?</Label>
        <Input value={query} onChange={e => setQuery(e.target.value)}
          placeholder="e.g. 2 roti with dal, masala oats..."
          onKeyDown={e => e.key === "Enter" && analyze()} />
        <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
          <Input value={qty} onChange={e => setQty(e.target.value)} type="number"
            placeholder="Qty" style={{ width: 80, flex: "none" }} />
          <Btn onClick={analyze} disabled={loading || !query.trim()} style={{ flex: 1 }}>
            {loading ? "Analyzing..." : "Analyze 🔍"}
          </Btn>
        </div>
      </Card>

      {/* Fix 15: Friendly error state */}
      {error && (
        <Card style={{ borderColor: T.red + "55" }}>
          <div style={{ fontFamily: font, fontSize: 12, color: T.red, lineHeight: 1.6 }}>⚠️ {error}</div>
        </Card>
      )}

      {result && (
        <Card style={{ borderColor: T.accent }}>
          <Label>AI Estimated Nutrition</Label>
          <div style={{ fontFamily: fontSans, fontSize: 18, fontWeight: 800, color: T.text, marginBottom: 4 }}>{result.name}</div>

          {/* Fix 4: Show calorie range when confidence isn't high */}
          {result.confidence !== "high" && result.kcalMin && result.kcalMax && (
            <div style={{
              fontFamily: font, fontSize: 11, color: T.orange, marginBottom: 12,
              background: T.orange + "15", borderRadius: 8, padding: "6px 10px",
            }}>
              Estimated range: {result.kcalMin}–{result.kcalMax} kcal · {result.confidence} confidence — edit if needed
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { l: "Calories", v: result.kcal, u: "kcal", c: T.accent },
              { l: "Protein", v: result.protein, u: "g", c: T.blue },
              { l: "Carbs", v: result.carbs, u: "g", c: T.teal },
              { l: "Fat", v: result.fat, u: "g", c: T.orange },
            ].map(s => (
              <div key={s.l} style={{ background: T.card2, borderRadius: 12, padding: 14 }}>
                <div style={{ fontFamily: font, fontSize: 9, color: T.muted, letterSpacing: 2 }}>{s.l.toUpperCase()}</div>
                <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: s.c, marginTop: 4 }}>
                  {s.v}<span style={{ fontSize: 12, color: T.muted }}>{s.u}</span>
                </div>
              </div>
            ))}
          </div>
          <Btn onClick={saveMeal} style={{ width: "100%", marginTop: 16 }}>Add to Log ✓</Btn>
        </Card>
      )}

      {!result && !loading && !error && (
        <div style={{ textAlign: "center", padding: "40px 0", color: T.muted, fontFamily: font, fontSize: 13 }}>
          Type any food and hit Analyze — AI estimates the macros automatically
        </div>
      )}
    </div>
  );
}

// ─── PHOTO FOOD LOGGING ───────────────────────────────────────────────────────
function PhotoLog({ profile, onSave, onBack }) {
  const [phase, setPhase] = useState("capture"); // capture | analyzing | result | confirm
  const [imageData, setImageData] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mealType, setMealType] = useState("Lunch");
  const [editMode, setEditMode] = useState(false);
  const [editVals, setEditVals] = useState({});
  const fileRef = useRef(null);

  const handleImage = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Preview
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target.result;
      setImagePreview(dataUrl);
      const base64 = dataUrl.split(",")[1];
      setImageData(base64);
      setPhase("analyzing");
      setLoading(true);

      try {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "claude-sonnet-4-20250514",
            max_tokens: 1000,
            system: `You are a nutrition AI specializing in estimating macros from food photos — including Indian, Asian, and home-cooked meals with mixed dishes, oils, and unclear portions. Be conservative with estimates when uncertain. Return ONLY valid JSON, no markdown, no explanation.`,
            messages: [{
              role: "user",
              content: [
                {
                  type: "image",
                  source: { type: "base64", media_type: file.type || "image/jpeg", data: base64 }
                },
                {
                  type: "text",
                  text: `Identify all food items visible. Estimate nutrition for the full plate/portion shown. For mixed dishes or home-cooked food, account for oils, ghee, and typical preparation methods. Provide a realistic calorie range (±15%). Return ONLY this JSON:\n{"name":"<dish name>","description":"<what you see>","kcal":<midpoint estimate>,"kcalMin":<conservative low estimate>,"kcalMax":<generous high estimate>,"protein":<integer>,"carbs":<integer>,"fat":<integer>,"fiber":<integer>,"items":["<item1>","<item2>"],"confidence":"<low|medium|high>","portionNote":"<any note about portion uncertainty, or empty string>"}`
                }
              ]
            }]
          })
        });
        const d = await res.json();
        const text = d.content?.[0]?.text || "";
        const parsed = safeJSON(text, null);
        if (parsed && parsed.kcal > 0) {
          setResult(parsed);
          setEditVals({ kcal: parsed.kcal, protein: parsed.protein, carbs: parsed.carbs, fat: parsed.fat });
          setPhase("result");
        } else {
          throw new Error("parse_failed");
        }
      } catch (err) {
        setResult({ name: "Could not identify", description: "Image analysis failed. You can enter values manually.", kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, items: [], confidence: "low", kcalMin: 0, kcalMax: 0, portionNote: "" });
        setEditVals({ kcal: 0, protein: 0, carbs: 0, fat: 0 });
        setEditMode(true); // Auto-open edit mode on failure
        setPhase("result");
      }
      setLoading(false);
    };
    reader.readAsDataURL(file);
  };

  const saveMeal = () => {
    const vals = editMode ? editVals : result;
    const now = new Date();
    onSave({
      name: result.name,
      kcal: parseInt(vals.kcal) || 0,
      protein: parseInt(vals.protein) || 0,
      carbs: parseInt(vals.carbs) || 0,
      fat: parseInt(vals.fat) || 0,
      fiber: result.fiber || 0,
      mealType,
      fromPhoto: true,
      time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    });
  };

  const confidenceColor = result?.confidence === "high" ? T.accent : result?.confidence === "medium" ? T.orange : T.red;

  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={onBack} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
        <div>
          <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: T.text }}>📷 Snap to Log</div>
          <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>AI estimates macros from your photo</div>
        </div>
      </div>

      {/* Meal Type */}
      <Card>
        <Label>Meal Type</Label>
        <div style={{ display: "flex", gap: 8 }}>
          {["Breakfast", "Lunch", "Dinner", "Snack"].map(t => (
            <div key={t} onClick={() => setMealType(t)} style={{
              flex: 1, background: mealType === t ? T.accent : T.card2,
              color: mealType === t ? "#000" : T.muted,
              borderRadius: 10, padding: "8px 4px", textAlign: "center",
              fontFamily: font, fontSize: 10, cursor: "pointer", transition: "all 0.2s",
            }}>{t}</div>
          ))}
        </div>
      </Card>

      {/* Capture Phase */}
      {phase === "capture" && (
        <>
          <div
            onClick={() => fileRef.current?.click()}
            style={{
              border: `2px dashed ${T.accent}66`,
              borderRadius: 20, padding: "48px 20px",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 16,
              cursor: "pointer", background: `${T.accent}05`,
              transition: "all 0.2s",
            }}
          >
            <div style={{ fontSize: 52 }}>📷</div>
            <div style={{ fontFamily: fontSans, fontSize: 18, fontWeight: 800, color: T.text }}>Take a Photo</div>
            <div style={{ fontFamily: font, fontSize: 12, color: T.muted, textAlign: "center", lineHeight: 1.6 }}>
              Snap your meal or upload from gallery.<br />AI will identify food and estimate macros.
            </div>
            <div style={{
              background: T.accent, color: "#000", borderRadius: 12,
              padding: "10px 24px", fontFamily: fontSans, fontWeight: 800, fontSize: 14,
            }}>Choose Photo →</div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleImage}
            style={{ display: "none" }}
          />
          <div style={{ fontFamily: font, fontSize: 11, color: T.muted, textAlign: "center", lineHeight: 1.8 }}>
            Works best with clear, well-lit photos.<br />
            AI estimates are approximate — you can edit values before saving.
          </div>
        </>
      )}

      {/* Analyzing Phase */}
      {phase === "analyzing" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {imagePreview && (
            <div style={{ borderRadius: 20, overflow: "hidden", maxHeight: 240, position: "relative" }}>
              <img src={imagePreview} alt="meal" style={{ width: "100%", height: 240, objectFit: "cover" }} />
              <div style={{
                position: "absolute", inset: 0,
                background: "rgba(0,0,0,0.6)",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12,
              }}>
                <div style={{ fontSize: 36, animation: "spin 1.5s linear infinite" }}>🔍</div>
                <div style={{ fontFamily: fontSans, fontWeight: 800, fontSize: 16, color: T.white }}>Analyzing your meal...</div>
                <div style={{ fontFamily: font, fontSize: 12, color: T.muted }}>AI is identifying food items</div>
              </div>
            </div>
          )}
          <Card>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[100, 70, 85, 55, 90].map((w, i) => (
                <div key={i} style={{
                  height: 10, background: T.muted2, borderRadius: 6,
                  width: `${w}%`, animation: `shimmer 1.2s ${i * 0.15}s infinite alternate`,
                }} />
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* Result Phase */}
      {phase === "result" && result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Photo preview */}
          {imagePreview && (
            <div style={{ borderRadius: 20, overflow: "hidden", maxHeight: 200 }}>
              <img src={imagePreview} alt="meal" style={{ width: "100%", height: 200, objectFit: "cover" }} />
            </div>
          )}

          {/* AI Result */}
          <Card style={{ borderColor: T.accent + "44" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: fontSans, fontSize: 18, fontWeight: 800, color: T.text }}>{result.name}</div>
                <div style={{ fontFamily: font, fontSize: 11, color: T.muted, marginTop: 4 }}>{result.description}</div>
              </div>
              <div style={{
                background: confidenceColor + "22", borderRadius: 8, padding: "4px 10px",
                fontFamily: font, fontSize: 9, color: confidenceColor, letterSpacing: 1,
                border: `1px solid ${confidenceColor}44`,
              }}>
                {result.confidence?.toUpperCase()} CONF
              </div>
            </div>

          {/* Fix 4: Calorie range for low/medium confidence */}
            {result.confidence !== "high" && result.kcalMin > 0 && result.kcalMax > 0 && (
              <div style={{
                marginBottom: 12, padding: "8px 12px",
                background: T.orange + "15", borderRadius: 10,
                border: `1px solid ${T.orange}33`,
                fontFamily: font, fontSize: 11, color: T.orange, lineHeight: 1.6,
              }}>
                Estimated range: {result.kcalMin}–{result.kcalMax} kcal
                {result.portionNote ? ` · ${result.portionNote}` : ""}<br />
                <span style={{ color: T.muted }}>Edit values below if you know the exact portion.</span>
              </div>
            )}
              <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {result.items.map((item, i) => (
                  <div key={i} style={{
                    background: T.card2, borderRadius: 8, padding: "4px 10px",
                    fontFamily: font, fontSize: 10, color: T.muted,
                    border: `1px solid ${T.border}`,
                  }}>{item}</div>
                ))}
              </div>
            )}

            {/* Macro grid - editable or display */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[
                { l: "Calories", k: "kcal", u: "kcal", c: T.accent, v: editMode ? editVals.kcal : result.kcal },
                { l: "Protein", k: "protein", u: "g", c: T.blue, v: editMode ? editVals.protein : result.protein },
                { l: "Carbs", k: "carbs", u: "g", c: T.teal, v: editMode ? editVals.carbs : result.carbs },
                { l: "Fat", k: "fat", u: "g", c: T.orange, v: editMode ? editVals.fat : result.fat },
              ].map(s => (
                <div key={s.l} style={{ background: T.card2, borderRadius: 12, padding: 12 }}>
                  <div style={{ fontFamily: font, fontSize: 9, color: T.muted, letterSpacing: 2, marginBottom: 4 }}>{s.l.toUpperCase()}</div>
                  {editMode ? (
                    <input
                      type="number"
                      value={editVals[s.k]}
                      onChange={e => setEditVals(p => ({ ...p, [s.k]: e.target.value }))}
                      style={{
                        background: "transparent", border: `1px solid ${s.c}66`,
                        borderRadius: 8, padding: "4px 8px",
                        color: s.c, fontFamily: fontSans, fontWeight: 900, fontSize: 20,
                        width: "100%", outline: "none", boxSizing: "border-box",
                      }}
                    />
                  ) : (
                    <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: s.c }}>
                      {s.v}<span style={{ fontSize: 11, color: T.muted }}>{s.u}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <Btn
                onClick={() => setEditMode(p => !p)}
                variant="ghost"
                style={{ flex: 1, fontSize: 13 }}
              >
                {editMode ? "✓ Done" : "✏️ Edit"}
              </Btn>
              <Btn
                onClick={() => { setPhase("capture"); setImagePreview(null); setResult(null); }}
                variant="ghost"
                style={{ flex: 1, fontSize: 13 }}
              >
                🔄 Retake
              </Btn>
            </div>
          </Card>

          <Btn onClick={saveMeal} style={{ width: "100%" }}>Add to Log ✓</Btn>
        </div>
      )}
    </div>
  );
}

// ─── COACH INTELLIGENCE HELPERS ──────────────────────────────────────────────
function weeklyData(client) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().split("T")[0];
    const meals = client.logs[key] || [];
    const kcal = meals.reduce((s, m) => s + m.kcal, 0);
    const protein = meals.reduce((s, m) => s + m.protein, 0);
    const logged = meals.length > 0;
    const onTarget = logged && kcal >= client.goalKcal * 0.85 && kcal <= client.goalKcal * 1.15;
    const proteinMet = logged && protein >= client.protein * 0.85;
    const dayOfWeek = d.getDay();
    return {
      day: d.toLocaleDateString("en", { weekday: "short" })[0],
      key, kcal, protein, logged, onTarget, proteinMet,
      isWeekend: dayOfWeek === 0 || dayOfWeek === 6,
    };
  });
}

function getClientRisk(client) {
  const days = weeklyData(client);
  const loggedDays = days.filter(d => d.logged).length;
  const compliancePct = (loggedDays / 7) * 100;
  const streak = calcStreak(client.logs);
  const todayLogged = (client.logs[today()] || []).length > 0;
  const loggedDaysWithData = days.filter(d => d.kcal > 0);
  const avgProtein = loggedDaysWithData.length
    ? loggedDaysWithData.reduce((s, d) => s + d.protein, 0) / loggedDaysWithData.length
    : 0;
  const proteinPct = client.protein > 0 ? (avgProtein / client.protein) * 100 : 100;
  const last2Missed = days.slice(-2).every(d => !d.logged);

  if (compliancePct < 43 || (streak === 0 && last2Missed)) {
    return { tier: "red", label: "High Risk", emoji: "🔴", color: "#ff4d6d" };
  }
  if (compliancePct < 72 || proteinPct < 70 || !todayLogged) {
    return { tier: "yellow", label: "Needs Attention", emoji: "🟡", color: "#ffcc44" };
  }
  return { tier: "green", label: "On Track", emoji: "🟢", color: "#3dffd4" };
}

function getClientTags(client) {
  const days = weeklyData(client);
  const loggedDays = days.filter(d => d.logged);
  const compliancePct = (loggedDays.length / 7) * 100;
  const streak = calcStreak(client.logs);
  const todayLogged = (client.logs[today()] || []).length > 0;
  const avgProtein = loggedDays.length
    ? loggedDays.reduce((s, d) => s + d.protein, 0) / loggedDays.length
    : 0;

  // Weekend overeating detection
  const weekendDays = days.filter(d => d.isWeekend && d.logged);
  const weekdayDays = days.filter(d => !d.isWeekend && d.logged);
  const avgWeekendKcal = weekendDays.length
    ? weekendDays.reduce((s, d) => s + d.kcal, 0) / weekendDays.length : 0;
  const avgWeekdayKcal = weekdayDays.length
    ? weekdayDays.reduce((s, d) => s + d.kcal, 0) / weekdayDays.length : 0;
  const isWeekendOvereater = avgWeekendKcal > client.goalKcal * 1.15 && avgWeekendKcal > avgWeekdayKcal * 1.2;

  const tags = [];
  if (compliancePct >= 85) tags.push({ label: "⚡ High Compliance", color: T.teal, bg: T.teal + "22" });
  if (streak >= 7) tags.push({ label: `🔥 ${streak}-Day Streak`, color: T.orange, bg: T.orange + "22" });
  if (avgProtein < client.protein * 0.75 && loggedDays.length > 0) tags.push({ label: "🥩 Low Protein", color: T.orange, bg: T.orange + "22" });
  if (!todayLogged) tags.push({ label: "⏰ Not Logged Today", color: T.red, bg: T.red + "22" });
  if (isWeekendOvereater) tags.push({ label: "🍕 Weekend Overeater", color: T.purple, bg: T.purple + "22" });
  if (compliancePct < 43) tags.push({ label: "⚠️ At Risk", color: T.red, bg: T.red + "22" });
  return tags;
}

function buildClientSummary(client) {
  const days = weeklyData(client);
  const loggedDays = days.filter(d => d.logged);
  const avgKcal = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.kcal, 0) / loggedDays.length) : 0;
  const avgProtein = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / loggedDays.length) : 0;
  const compliancePct = Math.round((loggedDays.length / 7) * 100);
  const streak = calcStreak(client.logs);
  const risk = getClientRisk(client);
  const tags = getClientTags(client).map(t => t.label).join(", ");
  return `${client.name} (${client.goal === "lose" ? "fat loss" : client.goal === "gain" ? "muscle gain" : "maintenance"}, target ${client.goalKcal}kcal/${client.protein}g protein): Risk=${risk.label}, Compliance=${compliancePct}%, Streak=${streak}days, AvgKcal=${avgKcal}, AvgProtein=${avgProtein}g, Tags=[${tags || "none"}]`;
}

// ─── COACH DASHBOARD ──────────────────────────────────────────────────────────
// Simulates multiple clients for demo purposes
const DEMO_CLIENTS = [
  {
    id: "c1", name: "Sarah Chen", goal: "lose", goalKcal: 1650, protein: 130,
    weight: 68, targetWeight: 62, age: 28, gender: "female",
    avatar: "S", streak: 12,
    logs: (() => {
      const l = {};
      const meals = [
        [{ name: "Oatmeal + banana", kcal: 380, protein: 12, carbs: 68, fat: 6 }, { name: "Chicken salad", kcal: 520, protein: 45, carbs: 22, fat: 18 }, { name: "Salmon + rice", kcal: 620, protein: 48, carbs: 55, fat: 14 }],
        [{ name: "Greek yogurt parfait", kcal: 320, protein: 18, carbs: 44, fat: 8 }, { name: "Turkey wrap", kcal: 480, protein: 38, carbs: 42, fat: 12 }, { name: "Stir fry veg", kcal: 380, protein: 22, carbs: 48, fat: 8 }],
        [{ name: "Eggs + toast", kcal: 420, protein: 24, carbs: 36, fat: 18 }, { name: "Quinoa bowl", kcal: 540, protein: 28, carbs: 62, fat: 16 }],
        [{ name: "Smoothie bowl", kcal: 360, protein: 16, carbs: 52, fat: 10 }, { name: "Grilled chicken", kcal: 480, protein: 52, carbs: 18, fat: 14 }, { name: "Cottage cheese", kcal: 180, protein: 24, carbs: 8, fat: 4 }, { name: "Pizza slice x2", kcal: 560, protein: 22, carbs: 70, fat: 22 }],
        [],
        [{ name: "Protein pancakes", kcal: 440, protein: 32, carbs: 48, fat: 12 }, { name: "Beef bowl", kcal: 620, protein: 44, carbs: 58, fat: 18 }],
        [{ name: "Avocado toast", kcal: 380, protein: 14, carbs: 42, fat: 18 }, { name: "Lentil soup", kcal: 320, protein: 18, carbs: 52, fat: 6 }, { name: "Chicken breast", kcal: 280, protein: 52, carbs: 2, fat: 6 }],
      ];
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        l[d.toISOString().split("T")[0]] = meals[i] || [];
      }
      return l;
    })(),
    weights: { [(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split("T")[0]; })()]: 68.4, [today()]: 67.8 },
    note: "Great consistency this week! Needs to watch weekend calories.",
  },
  {
    id: "c2", name: "Marcus Webb", goal: "gain", goalKcal: 2800, protein: 180,
    weight: 74, targetWeight: 82, age: 24, gender: "male",
    avatar: "M", streak: 4,
    logs: (() => {
      const l = {};
      const meals = [
        [{ name: "Eggs + oats", kcal: 580, protein: 38, carbs: 72, fat: 16 }, { name: "Protein shake", kcal: 320, protein: 42, carbs: 28, fat: 6 }, { name: "Pasta bolognese", kcal: 780, protein: 48, carbs: 92, fat: 18 }],
        [{ name: "Bagel + eggs", kcal: 520, protein: 28, carbs: 66, fat: 12 }, { name: "Rice + chicken", kcal: 640, protein: 52, carbs: 72, fat: 10 }, { name: "Beef steak + potato", kcal: 820, protein: 58, carbs: 62, fat: 24 }],
        [{ name: "Pancakes + syrup", kcal: 680, protein: 18, carbs: 118, fat: 16 }],
        [{ name: "Overnight oats", kcal: 480, protein: 22, carbs: 74, fat: 12 }, { name: "Tuna sandwich", kcal: 420, protein: 38, carbs: 48, fat: 8 }, { name: "Mass gainer shake", kcal: 720, protein: 52, carbs: 108, fat: 10 }, { name: "Chicken + veg", kcal: 540, protein: 48, carbs: 28, fat: 16 }],
        [{ name: "French toast", kcal: 620, protein: 24, carbs: 84, fat: 18 }, { name: "Burger + fries", kcal: 980, protein: 44, carbs: 102, fat: 42 }, { name: "Protein bar", kcal: 220, protein: 20, carbs: 24, fat: 8 }],
        [],
        [{ name: "Eggs benedict", kcal: 680, protein: 32, carbs: 52, fat: 32 }, { name: "Chicken rice bowl", kcal: 620, protein: 48, carbs: 68, fat: 14 }, { name: "Greek yogurt", kcal: 180, protein: 20, carbs: 16, fat: 4 }],
      ];
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        l[d.toISOString().split("T")[0]] = meals[i] || [];
      }
      return l;
    })(),
    weights: { [(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split("T")[0]; })()]: 73.8, [today()]: 74.3 },
    note: "Undereating on rest days. Needs more consistent protein.",
  },
  {
    id: "c3", name: "Priya Sharma", goal: "maintain", goalKcal: 1900, protein: 120,
    weight: 62, targetWeight: 62, age: 31, gender: "female",
    avatar: "P", streak: 21,
    logs: (() => {
      const l = {};
      const meals = [
        [{ name: "Dal + rice", kcal: 480, protein: 18, carbs: 82, fat: 8 }, { name: "Paneer tikka", kcal: 420, protein: 28, carbs: 18, fat: 24 }, { name: "Roti + sabzi", kcal: 380, protein: 12, carbs: 62, fat: 8 }],
        [{ name: "Idli sambar", kcal: 320, protein: 12, carbs: 58, fat: 4 }, { name: "Curd rice", kcal: 360, protein: 10, carbs: 68, fat: 6 }, { name: "Mixed veg curry", kcal: 380, protein: 8, carbs: 52, fat: 14 }, { name: "Protein shake", kcal: 280, protein: 32, carbs: 22, fat: 4 }],
        [{ name: "Upma", kcal: 340, protein: 8, carbs: 58, fat: 8 }, { name: "Chicken biryani", kcal: 620, protein: 38, carbs: 78, fat: 18 }, { name: "Raita", kcal: 80, protein: 4, carbs: 10, fat: 2 }],
        [{ name: "Poha", kcal: 280, protein: 6, carbs: 52, fat: 6 }, { name: "Dal tadka", kcal: 320, protein: 16, carbs: 48, fat: 8 }, { name: "Tandoori chicken", kcal: 480, protein: 52, carbs: 12, fat: 18 }, { name: "Jeera rice", kcal: 360, protein: 6, carbs: 72, fat: 6 }],
        [{ name: "Dosa + chutney", kcal: 380, protein: 8, carbs: 68, fat: 10 }, { name: "Rajma chawal", kcal: 560, protein: 22, carbs: 92, fat: 10 }, { name: "Fruit salad", kcal: 160, protein: 2, carbs: 38, fat: 1 }],
        [{ name: "Paratha", kcal: 440, protein: 10, carbs: 62, fat: 16 }, { name: "Palak paneer", kcal: 480, protein: 22, carbs: 24, fat: 28 }, { name: "Lassi", kcal: 200, protein: 8, carbs: 28, fat: 6 }],
        [{ name: "Oats porridge", kcal: 320, protein: 12, carbs: 58, fat: 6 }, { name: "Grilled fish", kcal: 380, protein: 48, carbs: 8, fat: 14 }, { name: "Brown rice + dal", kcal: 480, protein: 18, carbs: 82, fat: 6 }],
      ];
      for (let i = 0; i < 7; i++) {
        const d = new Date(); d.setDate(d.getDate() - (6 - i));
        l[d.toISOString().split("T")[0]] = meals[i] || [];
      }
      return l;
    })(),
    weights: { [(() => { const d = new Date(); d.setDate(d.getDate() - 6); return d.toISOString().split("T")[0]; })()]: 62.0, [today()]: 61.8 },
    note: "Model client. Excellent compliance. Recommend increasing protein target.",
  },
];

function CoachDashboard({ coachProfile, onBack }) {
  // Compute before useState so initial tab value is correct
  const allClients = [...DEMO_CLIENTS].sort((a, b) => {
    const order = { red: 0, yellow: 1, green: 2 };
    return order[getClientRisk(a).tier] - order[getClientRisk(b).tier];
  });
  const initRiskCounts = allClients.reduce((acc, c) => {
    const r = getClientRisk(c).tier;
    acc[r] = (acc[r] || 0) + 1;
    return acc;
  }, {});

  const [selected, setSelected] = useState(null);
  const [aiNote, setAiNote] = useState("");
  const [generating, setGenerating] = useState(false);
  const [checkinNote, setCheckinNote] = useState("");
  const [checkinGenerating, setCheckinGenerating] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [messageLoading, setMessageLoading] = useState(false);
  const [messageType, setMessageType] = useState(null);
  const [copiedMessage, setCopiedMessage] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandResponse, setCommandResponse] = useState("");
  const [commandLoading, setCommandLoading] = useState(false);
  const [activeTab, setActiveTab] = useState(initRiskCounts.red > 0 ? "alerts" : "clients");

  const generateClientNote = async (client) => {
    setGenerating(true);
    setAiNote("");
    const days = weeklyData(client).map(d =>
      `${d.day}: ${d.logged ? `${d.kcal}kcal / ${d.protein}g protein` : "MISSED"}`
    ).join("\n");
    const loggedDays = weeklyData(client).filter(d => d.logged);
    const compliancePct = Math.round((loggedDays.length / 7) * 100);
    const avgKcal = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.kcal, 0) / loggedDays.length) : 0;
    const avgProtein = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / loggedDays.length) : 0;
    const note = await claude(
      [{ role: "user", content: "Generate weekly check-in." }],
      `You are a direct, data-driven nutrition coach. Be specific — name exact numbers, not vague observations.\n\nClient: ${client.name} | Goal: ${client.goal === "lose" ? "fat loss" : client.goal === "gain" ? "muscle gain" : "maintenance"} | Target: ${client.goalKcal}kcal/${client.protein}g protein\n\nThis week: ${compliancePct}% compliance (${loggedDays.length}/7 days logged) | Avg: ${avgKcal}kcal / ${avgProtein}g protein\n\nDay-by-day:\n${days}\n\nWrite a concise check-in with EXACTLY these sections (2 bullets each max, be direct):\n🏆 WINS\n⚠️ ISSUES\n🔄 ADJUSTMENTS\n🎯 NEXT WEEK FOCUS`,
      600
    );
    if (note === "__ERROR__" || note === "__TIMEOUT__") {
      setAiNote("⚠️ Could not generate note — try again.");
    } else {
      setAiNote(note);
    }
    setGenerating(false);
  };

  const generateMessage = async (client, type) => {
    setMessageLoading(true);
    setMessageType(type);
    setAiMessage("");
    const risk = getClientRisk(client);
    const days = weeklyData(client);
    const streak = calcStreak(client.logs);
    const loggedDays = days.filter(d => d.logged);
    const compliancePct = Math.round((loggedDays.length / 7) * 100);
    const avgProtein = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / loggedDays.length) : 0;

    const prompt = type === "motivate"
      ? `Write a short (3 sentences), warm coach message to ${client.name}. Data: ${streak}-day streak, ${compliancePct}% compliance, avg protein ${avgProtein}g vs ${client.protein}g target. Reference one specific win using actual numbers. No generic phrases like "keep it up". Sign off naturally.`
      : `Write a short (3 sentences) follow-up to ${client.name} who has ${compliancePct}% compliance this week (risk: ${risk.label}). Acknowledge it without being preachy. Ask one specific question. Give one concrete tip (e.g. specific food swap, meal prep idea). Sound like a real coach, not an app.`;

    const msg = await claude(
      [{ role: "user", content: prompt }],
      "You are a professional nutrition coach. Be warm, specific, and human. No emojis at start. No AI-speak.",
      350
    );
    if (msg === "__ERROR__" || msg === "__TIMEOUT__") {
      setAiMessage("⚠️ Couldn't generate message — try again.");
    } else {
      setAiMessage(msg);
    }
    setMessageLoading(false);
  };

  const runCommandCenter = async () => {
    if (!commandQuery.trim() || commandLoading) return;
    setCommandLoading(true);
    setCommandResponse("");
    const summaries = allClients.map(buildClientSummary).join("\n");
    const response = await claude(
      [{ role: "user", content: commandQuery }],
      `You are a coaching AI with real-time client data. Answer directly with specific numbers — no hedging, no generic advice.\n\nClient data:\n${summaries}\n\nBe concise. Name specific clients. Use their actual metrics.`,
      600
    );
    if (response === "__ERROR__" || response === "__TIMEOUT__") {
      setCommandResponse("⚠️ AI unavailable — check your connection and try again.");
    } else {
      setCommandResponse(response);
    }
    setCommandLoading(false);
  };

  // Aggregate stats
  const avgCompliance = allClients.reduce((sum, c) => {
    const days = weeklyData(c);
    return sum + (days.filter(d => d.logged).length / 7) * 100;
  }, 0) / allClients.length;

  const riskCounts = initRiskCounts; // already computed above

  const smartAlerts = allClients.flatMap(c => {
    const msgs = [];
    const risk = getClientRisk(c);
    const tags = getClientTags(c);
    const todayMeals = c.logs[today()] || [];
    if (todayMeals.length === 0) msgs.push({ client: c.name, msg: "No meals logged today", color: T.orange, icon: "📵" });
    if (risk.tier === "red") msgs.push({ client: c.name, msg: `${risk.emoji} High risk — ${Math.round((weeklyData(c).filter(d => d.logged).length / 7) * 100)}% compliance`, color: T.red, icon: "🚨" });
    const lowProtein = tags.find(t => t.label.includes("Low Protein"));
    if (lowProtein) msgs.push({ client: c.name, msg: "Consistently missing protein targets", color: T.orange, icon: "🥩" });
    return msgs;
  });

  // ── Client Detail View ─────────────────────────────────────────────────────
  if (selected) {
    const c = selected;
    const days = weeklyData(c);
    const loggedDays = days.filter(d => d.logged);
    const avgKcal = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.kcal, 0) / loggedDays.length) : 0;
    const avgProtein = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / loggedDays.length) : 0;
    const streak = calcStreak(c.logs);
    const complianceDays = loggedDays.length;
    const risk = getClientRisk(c);
    const tags = getClientTags(c);

    return (
      <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div onClick={() => { setSelected(null); setAiNote(""); setAiMessage(""); setMessageType(null); }} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: fontSans, fontSize: 20, fontWeight: 900, color: T.text }}>{c.name}</div>
            <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>
              {c.goal === "lose" ? "🔥 Fat Loss" : c.goal === "gain" ? "💪 Muscle Gain" : "⚖️ Maintenance"} · {c.goalKcal} kcal/day
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
              background: risk.color + "22", border: `1px solid ${risk.color}44`,
              borderRadius: 8, padding: "4px 10px",
              fontFamily: font, fontSize: 10, color: risk.color, letterSpacing: 1,
            }}>{risk.emoji} {risk.label}</div>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", background: T.purple,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: fontSans, fontWeight: 900, fontSize: 16, color: T.white,
            }}>{c.avatar}</div>
          </div>
        </div>

        {/* Smart Tags */}
        {tags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {tags.map((t, i) => (
              <div key={i} style={{
                background: t.bg, border: `1px solid ${t.color}44`,
                borderRadius: 20, padding: "4px 10px",
                fontFamily: font, fontSize: 10, color: t.color,
              }}>{t.label}</div>
            ))}
          </div>
        )}

        {/* Stats row */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[
            { l: "Streak", v: streak, u: "🔥", c: streak > 7 ? T.orange : T.accent },
            { l: "Compliance", v: `${complianceDays}/7`, u: "days", c: complianceDays >= 6 ? T.accent : complianceDays >= 4 ? T.orange : T.red },
            { l: "Avg Kcal", v: avgKcal || "—", u: avgKcal ? "kcal" : "", c: T.blue },
          ].map(s => (
            <Card key={s.l} style={{ padding: 14, textAlign: "center" }}>
              <div style={{ fontFamily: font, fontSize: 8, color: T.muted, letterSpacing: 1, marginBottom: 6 }}>{s.l.toUpperCase()}</div>
              <div style={{ fontFamily: fontSans, fontSize: 20, fontWeight: 900, color: s.c }}>{s.v}<span style={{ fontSize: 11, color: T.muted }}> {s.u}</span></div>
            </Card>
          ))}
        </div>

        {/* Compliance Heatmap */}
        <Card>
          <Label>Compliance Heatmap — 7 Days</Label>
          <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 6, alignItems: "center" }}>
            {/* Row: Calories */}
            <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>Calories</div>
            <div style={{ display: "flex", gap: 4 }}>
              {days.map((d, i) => {
                const bg = !d.logged ? T.muted2
                  : d.onTarget ? T.accent
                  : d.kcal > c.goalKcal * 1.15 ? T.orange
                  : T.red;
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                    <div style={{
                      width: "100%", height: 28, borderRadius: 6, background: bg,
                      border: d.key === today() ? `2px solid ${T.white}` : "2px solid transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10,
                    }}>
                      {d.logged ? (d.onTarget ? "✓" : d.kcal > c.goalKcal * 1.15 ? "↑" : "↓") : ""}
                    </div>
                    <div style={{ fontFamily: font, fontSize: 8, color: d.key === today() ? T.accent : T.muted }}>{d.day}</div>
                  </div>
                );
              })}
            </div>
            {/* Row: Protein */}
            <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>Protein</div>
            <div style={{ display: "flex", gap: 4 }}>
              {days.map((d, i) => {
                const bg = !d.logged ? T.muted2 : d.proteinMet ? T.blue : T.red + "cc";
                return (
                  <div key={i} style={{ flex: 1 }}>
                    <div style={{
                      width: "100%", height: 28, borderRadius: 6, background: bg,
                      border: d.key === today() ? `2px solid ${T.white}` : "2px solid transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10,
                    }}>
                      {d.logged ? (d.proteinMet ? "✓" : "✗") : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 10, fontFamily: font, fontSize: 9, color: T.muted, flexWrap: "wrap" }}>
            <span style={{ color: T.accent }}>■ On Target</span>
            <span style={{ color: T.orange }}>■ Over</span>
            <span style={{ color: T.red }}>■ Under/Missed</span>
            <span style={{ color: T.blue }}>■ Protein Met</span>
          </div>
        </Card>

        {/* Protein tracking */}
        <Card>
          <Label>Avg Protein vs Target</Label>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <Ring value={avgProtein} max={c.protein} size={80} stroke={7}
              color={avgProtein >= c.protein * 0.85 ? T.blue : T.red} label={`${avgProtein}g`} />
            <div>
              <div style={{ fontFamily: fontSans, fontSize: 16, fontWeight: 700, color: avgProtein >= c.protein ? T.blue : T.orange }}>
                {avgProtein >= c.protein ? "✓ On Target" : avgProtein > 0 ? `${c.protein - avgProtein}g below target` : "No data yet"}
              </div>
              <div style={{ fontFamily: font, fontSize: 11, color: T.muted, marginTop: 4 }}>Target: {c.protein}g/day</div>
            </div>
          </div>
        </Card>

        {/* AI-Assisted Messaging */}
        <Card style={{ borderColor: T.teal + "33" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <Label>AI-Assisted Messaging</Label>
            <div style={{ fontFamily: font, fontSize: 9, color: T.teal, background: T.teal + "22", borderRadius: 6, padding: "3px 8px" }}>AI</div>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: aiMessage ? 14 : 0 }}>
            <Btn
              onClick={() => generateMessage(c, "motivate")}
              disabled={messageLoading}
              style={{ flex: 1, fontSize: 12, padding: "10px 8px", background: T.teal, color: "#000" }}
            >
              {messageLoading && messageType === "motivate" ? "Writing..." : "💬 Motivate"}
            </Btn>
            <Btn
              onClick={() => generateMessage(c, "followup")}
              disabled={messageLoading}
              style={{ flex: 1, fontSize: 12, padding: "10px 8px", background: T.card2, color: T.text, border: `1px solid ${T.border}` }}
            >
              {messageLoading && messageType === "followup" ? "Writing..." : "📩 Follow-up"}
            </Btn>
          </div>
          {messageLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[100, 80, 60].map((w, i) => (
                <div key={i} style={{ height: 9, background: T.muted2, borderRadius: 4, width: `${w}%`, animation: `shimmer 1.2s ${i * 0.2}s infinite alternate` }} />
              ))}
            </div>
          )}
          {aiMessage && !messageLoading && (
            <div>
              <div style={{
                background: T.card2, borderRadius: 12, padding: "14px 16px",
                fontFamily: fontSans, fontSize: 13, lineHeight: 1.7, color: T.text,
                border: `1px solid ${T.border}`, marginBottom: 10,
              }}>{aiMessage}</div>
              <Btn
                onClick={() => { navigator.clipboard?.writeText(aiMessage); setCopiedMessage(true); setTimeout(() => setCopiedMessage(false), 2000); }}
                variant="ghost" style={{ width: "100%", fontSize: 12 }}
              >
                {copiedMessage ? "✓ Copied!" : "📋 Copy Message"}
              </Btn>
            </div>
          )}
        </Card>

        {/* Weekly AI Check-In Note */}
        <Card style={{ borderColor: T.purple + "44" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <Label>Weekly Check-In Generator</Label>
            <div style={{ fontFamily: font, fontSize: 9, color: T.purple, background: T.purple + "22", borderRadius: 6, padding: "3px 8px" }}>AI</div>
          </div>
          {!aiNote && !generating && (
            <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
              <Btn onClick={() => generateClientNote(c)} style={{ background: T.purple, color: T.white, fontSize: 13, width: "100%" }}>
                Generate Weekly Review →
              </Btn>
              <div style={{ fontFamily: font, fontSize: 10, color: T.muted, marginTop: 8 }}>Wins · Issues · Adjustments · Patterns · Focus</div>
            </div>
          )}
          {generating && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[100, 75, 90, 60, 80].map((w, i) => (
                <div key={i} style={{ height: 10, background: T.muted2, borderRadius: 4, width: `${w}%`, animation: `shimmer 1.2s ${i * 0.15}s infinite alternate` }} />
              ))}
            </div>
          )}
          {aiNote && !generating && (
            <>
              <div style={{ fontFamily: fontSans, fontSize: 13, lineHeight: 1.8, color: T.text, whiteSpace: "pre-wrap" }}>{aiNote}</div>
              <Btn onClick={() => { setAiNote(""); generateClientNote(c); }} variant="ghost" style={{ width: "100%", marginTop: 12, fontSize: 12 }}>↺ Regenerate</Btn>
            </>
          )}
        </Card>

        {/* Today's Meals */}
        <Card>
          <Label>Today's Meals</Label>
          {(c.logs[today()] || []).length === 0 ? (
            <div style={{ fontFamily: font, fontSize: 12, color: T.muted, padding: "12px 0" }}>No meals logged today</div>
          ) : (
            (c.logs[today()] || []).map((m, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: i < (c.logs[today()]?.length || 0) - 1 ? `1px solid ${T.border}` : "none" }}>
                <div style={{ fontFamily: fontSans, fontSize: 13, color: T.text }}>{m.name}</div>
                <div style={{ fontFamily: font, fontSize: 12, color: T.accent }}>{m.kcal} kcal</div>
              </div>
            ))
          )}
        </Card>
      </div>
    );
  }

  // ── Main Dashboard View ────────────────────────────────────────────────────
  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={onBack} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: T.text }}>Coach Dashboard</div>
          <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>{allClients.length} active clients</div>
        </div>
        <div style={{
          background: T.purple + "22", border: `1px solid ${T.purple}44`,
          borderRadius: 10, padding: "6px 12px",
          fontFamily: font, fontSize: 10, color: T.purple, letterSpacing: 1,
        }}>COACH</div>
      </div>

      {/* Aggregate stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {[
          { l: "Clients", v: allClients.length, c: T.accent },
          { l: "Compliance", v: `${Math.round(avgCompliance)}%`, c: avgCompliance >= 70 ? T.accent : T.orange },
          { l: "🔴 High Risk", v: riskCounts.red || 0, c: T.red },
          { l: "Alerts", v: smartAlerts.length, c: smartAlerts.length > 0 ? T.orange : T.accent },
        ].map(s => (
          <Card key={s.l} style={{ padding: 12, textAlign: "center" }}>
            <div style={{ fontFamily: font, fontSize: 7, color: T.muted, letterSpacing: 1, marginBottom: 5 }}>{s.l.toUpperCase()}</div>
            <div style={{ fontFamily: fontSans, fontSize: 20, fontWeight: 900, color: s.c }}>{s.v}</div>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, background: T.card2, borderRadius: 12, padding: 4 }}>
        {[["clients", "👥 Clients"], ["alerts", "🚨 Alerts"], ["command", "🤖 AI Query"]].map(([id, label]) => (
          <div key={id} onClick={() => setActiveTab(id)} style={{
            flex: 1, textAlign: "center", padding: "8px 4px",
            borderRadius: 10, cursor: "pointer",
            background: activeTab === id ? T.card : "transparent",
            fontFamily: font, fontSize: 11, color: activeTab === id ? T.accent : T.muted,
            transition: "all 0.2s",
          }}>{label}</div>
        ))}
      </div>

      {/* Tab: Clients */}
      {activeTab === "clients" && allClients.map(c => {
        const days = weeklyData(c);
        const risk = getClientRisk(c);
        const tags = getClientTags(c);
        const compliancePct = Math.round((days.filter(d => d.logged).length / 7) * 100);
        const streak = calcStreak(c.logs);
        const todayKcal = (c.logs[today()] || []).reduce((s, m) => s + m.kcal, 0);

        return (
          <div
            key={c.id}
            onClick={() => { setSelected(c); setAiNote(""); setAiMessage(""); setMessageType(null); }}
            style={{
              background: T.card, border: `1px solid ${risk.tier === "red" ? T.red + "44" : risk.tier === "yellow" ? T.orange + "33" : T.border}`,
              borderRadius: 20, padding: 18,
              cursor: "pointer", transition: "all 0.2s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 10 }}>
              <div style={{
                width: 46, height: 46, borderRadius: "50%",
                background: c.goal === "lose" ? T.red + "88" : c.goal === "gain" ? T.blue + "88" : T.teal + "88",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: fontSans, fontWeight: 900, fontSize: 20, color: T.white,
                flexShrink: 0,
              }}>{c.avatar}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: fontSans, fontSize: 16, fontWeight: 800, color: T.text }}>{c.name}</div>
                <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>
                  {c.goal === "lose" ? "🔥 Fat Loss" : c.goal === "gain" ? "💪 Muscle Gain" : "⚖️ Maintenance"}
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <div style={{
                  background: risk.color + "22", border: `1px solid ${risk.color}44`,
                  borderRadius: 8, padding: "3px 8px",
                  fontFamily: font, fontSize: 9, color: risk.color,
                }}>{risk.emoji} {risk.label}</div>
                <div style={{ fontFamily: fontSans, fontSize: 15, fontWeight: 900, color: streak > 0 ? T.orange : T.muted }}>
                  {streak > 0 ? `🔥${streak}` : "–"}
                </div>
              </div>
            </div>

            {/* Smart Tags */}
            {tags.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: 10 }}>
                {tags.slice(0, 3).map((t, i) => (
                  <div key={i} style={{
                    background: t.bg, borderRadius: 20, padding: "3px 8px",
                    fontFamily: font, fontSize: 9, color: t.color,
                  }}>{t.label}</div>
                ))}
              </div>
            )}

            {/* Mini compliance dots */}
            <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
              {days.map((d, i) => (
                <div key={i} style={{
                  flex: 1, height: 5, borderRadius: 3,
                  background: d.logged ? (d.onTarget ? T.accent : T.orange) : T.muted2,
                  border: d.key === today() ? `1px solid ${T.white}` : "none",
                }} />
              ))}
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <div style={{ fontFamily: font, fontSize: 11, color: T.muted }}>
                Compliance: <span style={{ color: compliancePct >= 70 ? T.accent : compliancePct >= 43 ? T.orange : T.red }}>{compliancePct}%</span>
              </div>
              <div style={{ fontFamily: font, fontSize: 11, color: T.muted }}>
                Today: <span style={{ color: todayKcal > 0 ? T.text : T.red }}>{todayKcal > 0 ? `${todayKcal} kcal` : "Not logged"}</span>
              </div>
            </div>
          </div>
        );
      })}

      {/* Tab: Alerts */}
      {activeTab === "alerts" && (
        <Card style={{ borderColor: smartAlerts.length > 0 ? T.red + "33" : T.border }}>
          <Label>⚠️ Smart Alerts ({smartAlerts.length})</Label>
          {smartAlerts.length === 0 ? (
            <div style={{ fontFamily: font, fontSize: 12, color: T.accent, padding: "12px 0" }}>🟢 All clients on track!</div>
          ) : smartAlerts.map((a, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 0", borderBottom: i < smartAlerts.length - 1 ? `1px solid ${T.border}` : "none",
            }}>
              <div style={{ fontSize: 18, flexShrink: 0 }}>{a.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: fontSans, fontSize: 13, fontWeight: 700, color: T.text }}>{a.client}</div>
                <div style={{ fontFamily: font, fontSize: 11, color: a.color }}>{a.msg}</div>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Tab: AI Command Center */}
      {activeTab === "command" && (
        <Card style={{ borderColor: T.purple + "44" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Label>AI Coach Command Center</Label>
            <div style={{ fontFamily: font, fontSize: 9, color: T.purple, background: T.purple + "22", borderRadius: 6, padding: "3px 8px" }}>AI</div>
          </div>
          <div style={{ fontFamily: font, fontSize: 11, color: T.muted, marginBottom: 14 }}>
            Ask anything about your clients — AI has access to all their data.
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {[
              "Which clients are struggling most?",
              "Who missed protein goals this week?",
              "Summarize all high-risk clients",
              "Who needs a check-in today?",
            ].map(q => (
              <div key={q} onClick={() => setCommandQuery(q)} style={{
                background: T.card2, border: `1px solid ${T.border}`, borderRadius: 10,
                padding: "6px 10px", fontFamily: font, fontSize: 10, color: T.muted,
                cursor: "pointer",
              }}>{q}</div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: commandResponse ? 14 : 0 }}>
            <input
              value={commandQuery}
              onChange={e => setCommandQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && runCommandCenter()}
              placeholder="Ask about your clients..."
              style={{
                flex: 1, background: T.card2, border: `1px solid ${T.border}`, borderRadius: 12,
                padding: "12px 16px", color: T.text, fontFamily: fontSans, fontSize: 14,
                outline: "none", boxSizing: "border-box",
              }}
            />
            <button onClick={runCommandCenter} disabled={commandLoading || !commandQuery.trim()} style={{
              background: T.purple, color: T.white, border: "none", borderRadius: "50%",
              width: 46, height: 46, flexShrink: 0, fontSize: 18, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              opacity: commandLoading || !commandQuery.trim() ? 0.5 : 1,
            }}>→</button>
          </div>
          {commandLoading && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[100, 80, 90, 65].map((w, i) => (
                <div key={i} style={{ height: 9, background: T.muted2, borderRadius: 4, width: `${w}%`, animation: `shimmer 1.2s ${i * 0.15}s infinite alternate` }} />
              ))}
            </div>
          )}
          {commandResponse && !commandLoading && (
            <div style={{
              background: T.card2, borderRadius: 12, padding: "14px 16px",
              fontFamily: fontSans, fontSize: 13, lineHeight: 1.7, color: T.text,
              border: `1px solid ${T.purple}33`, whiteSpace: "pre-wrap",
            }}>{commandResponse}</div>
          )}
        </Card>
      )}

      <div style={{
        padding: "14px", borderRadius: 14,
        border: `1px dashed ${T.muted2}`,
        fontFamily: font, fontSize: 11, color: T.muted, textAlign: "center",
      }}>
        Demo data — invite real clients to see their live data
      </div>
    </div>
  );
}

// ─── WEEKLY STATS ─────────────────────────────────────────────────────────────
function WeeklyStats({ profile, logs, onNav }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().split("T")[0];
    const meals = logs[key] || [];
    const kcal = meals.reduce((s, m) => s + m.kcal, 0);
    return { day: d.toLocaleDateString("en", { weekday: "short" }), key, kcal, meals: meals.length };
  });

  const loggedDays = days.filter(d => d.meals > 0);
  const avg = loggedDays.length ? Math.round(loggedDays.reduce((s, d) => s + d.kcal, 0) / loggedDays.length) : 0;
  const maxKcal = Math.max(...days.map(d => d.kcal), profile.goal * 1.2);
  const overDays = days.filter(d => d.kcal > profile.goal && d.kcal > 0).length;
  const underDays = days.filter(d => d.kcal < profile.goal * 0.7 && d.kcal > 0).length;
  const compliancePct = Math.round((loggedDays.length / 7) * 100);

  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={() => onNav("home")} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
        <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: T.text }}>This Week</div>
      </div>

      {/* Fix 9: empty state */}
      {loggedDays.length === 0 ? (
        <Card style={{ borderStyle: "dashed" }}>
          <div style={{ textAlign: "center", padding: "24px 0" }}>
            <div style={{ fontSize: 36, marginBottom: 8 }}>📊</div>
            <div style={{ fontFamily: fontSans, fontWeight: 700, fontSize: 15, color: T.text, marginBottom: 6 }}>No data yet this week</div>
            <div style={{ fontFamily: font, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
              Log meals on the Home tab to see your weekly stats and trends here.
            </div>
          </div>
        </Card>
      ) : (
        <>
          {/* Compliance banner */}
          <div style={{
            background: compliancePct >= 70 ? T.accent + "18" : T.orange + "18",
            border: `1px solid ${compliancePct >= 70 ? T.accent : T.orange}44`,
            borderRadius: 12, padding: "10px 16px",
            fontFamily: font, fontSize: 12,
            color: compliancePct >= 70 ? T.accent : T.orange,
          }}>
            {compliancePct >= 70 ? "✅" : "⚠️"} {loggedDays.length}/7 days logged — {compliancePct}% weekly compliance
          </div>

          <Card>
            <Label>Daily Calories (7 days)</Label>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 120, marginBottom: 8 }}>
              {days.map((d, i) => {
                const h = d.kcal > 0 ? Math.max((d.kcal / maxKcal) * 100, 4) : 4;
                const over = d.kcal > profile.goal;
                const isToday = d.key === today();
                return (
                  <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                    {d.kcal > 0 && <div style={{ fontFamily: font, fontSize: 8, color: over ? T.orange : T.muted }}>{d.kcal}</div>}
                    <div style={{
                      width: "100%", height: `${h}%`, minHeight: 4,
                      background: d.kcal === 0 ? T.muted2 : over ? T.orange : T.accent,
                      borderRadius: "6px 6px 0 0",
                      border: isToday ? `1px solid ${T.white}` : "none",
                      transition: "height 1s ease",
                    }} />
                    <div style={{ fontFamily: font, fontSize: 9, color: isToday ? T.accent : T.muted }}>{d.day}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontFamily: font, fontSize: 10, color: T.muted, borderTop: `1px dashed ${T.muted2}`, paddingTop: 8 }}>
              Goal: {profile.goal} kcal/day
            </div>
          </Card>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {[
              { label: "Avg Daily", value: avg, unit: "kcal", color: T.accent },
              { label: "Days Over", value: overDays, unit: "days", color: overDays > 2 ? T.orange : T.muted },
              { label: "Days Under", value: underDays, unit: "days", color: underDays > 2 ? T.red : T.muted },
              { label: "Total Logged", value: loggedDays.reduce((s, d) => s + d.meals, 0), unit: "meals", color: T.blue },
            ].map(s => (
              <Card key={s.label} style={{ padding: 16 }}>
                <div style={{ fontFamily: font, fontSize: 9, color: T.muted, letterSpacing: 2, marginBottom: 6 }}>{s.label.toUpperCase()}</div>
                <div style={{ fontFamily: fontSans, fontSize: 26, fontWeight: 900, color: s.color }}>
                  {s.value}<span style={{ fontSize: 12, color: T.muted }}> {s.unit}</span>
                </div>
              </Card>
            ))}
          </div>
        </>
      )}

      <Btn onClick={() => onNav("analysis")} style={{ width: "100%" }}>Get AI Analysis of This Week →</Btn>
    </div>
  );
}

// ─── AI ANALYSIS ──────────────────────────────────────────────────────────────
function AIAnalysis({ profile, logs, onNav }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const generate = async () => {
    setLoading(true);
    setError(null);
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (6 - i));
      const key = d.toISOString().split("T")[0];
      const meals = logs[key] || [];
      const kcal = meals.reduce((s, m) => s + m.kcal, 0);
      const protein = meals.reduce((s, m) => s + m.protein, 0);
      const names = meals.map(m => m.name).join(", ");
      return `${d.toLocaleDateString("en", { weekday: "short" })}: ${meals.length > 0 ? `${kcal}kcal / ${protein}g protein (${names})` : "Not logged"}`;
    });

    const loggedCount = days.filter(d => !d.includes("Not logged")).length;

    // Fix 9: Graceful empty state
    if (loggedCount === 0) {
      setAnalysis("📋 No meals logged this week yet.\n\nLog at least 1–2 meals to get a meaningful AI analysis. The more days you track, the better the feedback.");
      setLoading(false);
      return;
    }

    const text = await claude(
      [{ role: "user", content: "Analyze my week." }],
      `You are NutriCoach AI — a direct, data-focused nutrition coach. Speak in specifics, not generalities.\n\nProfile: Goal=${profile.goal}kcal/day | Protein=${profile.protein}g | Objective=${profile.goal === "lose" ? "fat loss" : profile.goal === "gain" ? "muscle gain" : "maintenance"}\n\nWeek (${loggedCount}/7 days logged):\n${days.join("\n")}\n\nWrite a short analysis with these sections:\n✅ WINS — cite actual numbers\n⚠️ ISSUES — be specific, not vague\n🔄 BETTER SWAPS — concrete food alternatives\n🎯 ONE PRIORITY — single most impactful change\n\nIf days are missing, address the logging gap directly. Keep each section to 2 bullets max.`,
      900
    );
    if (text === "__ERROR__" || text === "__TIMEOUT__") {
      setError("Couldn't reach AI — check your connection and try again.");
    } else {
      setAnalysis(text);
    }
    setLoading(false);
  };

  useEffect(() => { generate(); }, []);

  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={() => onNav("home")} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
        <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: T.text }}>AI Analysis</div>
      </div>

      <Card style={{ borderColor: T.accent }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <Label>Weekly Report</Label>
          <div style={{ fontFamily: font, fontSize: 10, color: T.muted }}>{new Date().toLocaleDateString()}</div>
        </div>

        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[100, 85, 70, 90, 60, 80].map((w, i) => (
              <div key={i} style={{
                height: 12, background: T.muted2, borderRadius: 6,
                width: `${w}%`, animation: `shimmer 1.5s ${i * 0.1}s infinite alternate`,
              }} />
            ))}
            <div style={{ fontFamily: font, fontSize: 12, color: T.muted, marginTop: 8, textAlign: "center" }}>
              🤖 Analyzing your week...
            </div>
          </div>
        )}

        {/* Fix 15: Friendly error state */}
        {error && !loading && (
          <div style={{ fontFamily: font, fontSize: 12, color: T.red, lineHeight: 1.6 }}>⚠️ {error}</div>
        )}

        {analysis && !loading && (
          <div style={{ fontFamily: fontSans, fontSize: 14, lineHeight: 1.8, color: T.text, whiteSpace: "pre-wrap" }}>
            {analysis}
          </div>
        )}
      </Card>

      <Btn onClick={generate} variant="ghost" style={{ width: "100%" }} disabled={loading}>
        {loading ? "Generating..." : "↺ Regenerate"}
      </Btn>
    </div>
  );
}

// ─── AI CHAT ──────────────────────────────────────────────────────────────────
function AIChat({ profile, logs, onNav }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const chatEnd = useRef(null);

  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const todayLogs = logs[today()] || [];
  const eaten = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  todayLogs.forEach(m => { eaten.kcal += m.kcal; eaten.protein += m.protein; eaten.carbs += m.carbs; eaten.fat += m.fat; });

  const send = async (text) => {
    const msg = text || input.trim();
    if (!msg || loading) return;
    setInput("");
    const userMsg = { role: "user", content: msg };
    setMessages(p => [...p, userMsg]);
    setLoading(true);

    const mealCtx = todayLogs.map(m => `${m.name}: ${m.kcal}kcal P:${m.protein}g C:${m.carbs}g F:${m.fat}g`).join("\n") || "Nothing logged yet";
    const reply = await claude(
      [...messages, userMsg],
      `You are NutriCoach AI — a direct, knowledgeable nutrition coach. Never say "It seems like" or "you may want to consider". Use specific numbers. Keep replies to 3-4 sentences unless the user asks for detail.\n\nClient: ${profile.name} | Goal: ${profile.goal}kcal/day (${profile.goal === "lose" ? "fat loss" : profile.goal === "gain" ? "muscle gain" : "maintenance"}) | Protein target: ${profile.protein}g | Weight: ${profile.weight}kg\n\nToday: ${eaten.kcal}kcal eaten (${Math.abs(profile.goal - eaten.kcal)}kcal ${profile.goal - eaten.kcal >= 0 ? "remaining" : "over goal"}) | Protein: ${eaten.protein}g / ${profile.protein}g\nMeals:\n${mealCtx}`
    );
    if (reply === "__ERROR__" || reply === "__TIMEOUT__") {
      setMessages(p => [...p, { role: "assistant", content: "⚠️ Couldn't reach AI right now — try again in a moment." }]);
    } else {
      setMessages(p => [...p, { role: "assistant", content: reply }]);
    }
    setLoading(false);
  };

  const suggestions = ["What should I eat for dinner?", "Am I hitting my protein today?", "Give me a healthy snack idea", "How can I improve my diet?"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 64px)" }}>
      <div style={{ padding: "20px 20px 12px", borderBottom: `1px solid ${T.border}`, display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={() => onNav("home")} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
        <div>
          <div style={{ fontFamily: fontSans, fontSize: 18, fontWeight: 900, color: T.text }}>NutriCoach AI</div>
          <div style={{ fontFamily: font, fontSize: 10, color: T.accent }}>● Aware of your food today</div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "32px 0" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🥗</div>
            <div style={{ fontFamily: fontSans, fontSize: 16, fontWeight: 700, color: T.text, marginBottom: 6 }}>Hey {profile.name}!</div>
            <div style={{ fontFamily: font, fontSize: 12, color: T.muted, marginBottom: 24 }}>
              I know you've had {eaten.kcal} kcal today.<br />Ask me anything about your nutrition.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {suggestions.map(s => (
                <div key={s} onClick={() => send(s)} style={{
                  background: T.card2, border: `1px solid ${T.border}`, borderRadius: 12,
                  padding: "12px 16px", fontFamily: font, fontSize: 12, color: T.muted,
                  cursor: "pointer", textAlign: "left", transition: "all 0.2s",
                }}>{s}</div>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            {m.role === "assistant" && (
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, marginRight: 8, flexShrink: 0, alignSelf: "flex-end" }}>🤖</div>
            )}
            <div style={{
              maxWidth: "78%",
              background: m.role === "user" ? T.accent : T.card2,
              color: m.role === "user" ? "#000" : T.text,
              borderRadius: m.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
              padding: "12px 16px", fontFamily: fontSans, fontSize: 14, lineHeight: 1.6,
              border: m.role === "assistant" ? `1px solid ${T.border}` : "none",
            }}>{m.content}</div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: "50%", background: T.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🤖</div>
            <div style={{ background: T.card2, borderRadius: "18px 18px 18px 4px", padding: "14px 18px", display: "flex", gap: 5, border: `1px solid ${T.border}` }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: "50%", background: T.accent, animation: `bounce 0.8s ${i * 0.15}s infinite` }} />)}
            </div>
          </div>
        )}
        <div ref={chatEnd} />
      </div>

      <div style={{ padding: "12px 20px 20px", borderTop: `1px solid ${T.border}`, background: T.bg, display: "flex", gap: 10 }}>
        <Input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Ask about your nutrition..."
          style={{ borderRadius: 20 }} />
        <button onClick={() => send()} disabled={loading || !input.trim()} style={{
          background: T.accent, color: "#000", border: "none", borderRadius: "50%",
          width: 46, height: 46, flexShrink: 0, fontSize: 18, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>→</button>
      </div>
    </div>
  );
}

// ─── PROGRESS ─────────────────────────────────────────────────────────────────
function Progress({ profile, weights, onAddWeight, onNav }) {
  const entries = Object.entries(weights).sort(([a], [b]) => a.localeCompare(b)).slice(-14);
  const latest = entries[entries.length - 1]?.[1] || profile.weight;
  const first = entries[0]?.[1] || profile.weight;
  const change = (latest - first).toFixed(1);
  const maxW = Math.max(...entries.map(e => e[1])) + 1;
  const minW = Math.min(...entries.map(e => e[1])) - 1;

  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={() => onNav("home")} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
        <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: T.text }}>Progress</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        {[
          { l: "Current", v: latest, u: "kg", c: T.accent },
          { l: "Starting", v: parseFloat(profile.weight), u: "kg", c: T.muted },
          { l: "Change", v: change > 0 ? `+${change}` : change, u: "kg", c: parseFloat(change) < 0 ? T.teal : T.orange },
        ].map(s => (
          <Card key={s.l} style={{ padding: 14 }}>
            <div style={{ fontFamily: font, fontSize: 8, color: T.muted, letterSpacing: 2, marginBottom: 6 }}>{s.l.toUpperCase()}</div>
            <div style={{ fontFamily: fontSans, fontSize: 20, fontWeight: 900, color: s.c }}>{s.v}<span style={{ fontSize: 10 }}>{s.u}</span></div>
          </Card>
        ))}
      </div>

      <Card>
        <Label>Weight Trend</Label>
        {entries.length < 2 ? (
          <div style={{ textAlign: "center", padding: "30px 0" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>⚖️</div>
            <div style={{ fontFamily: fontSans, fontWeight: 700, fontSize: 14, color: T.text, marginBottom: 4 }}>
              {entries.length === 0 ? "No weight data yet" : "Log one more weigh-in to see your trend"}
            </div>
            <div style={{ fontFamily: font, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
              Weigh yourself at the same time each morning for the most accurate trend.
            </div>
          </div>
        ) : (
          <svg width="100%" height="100" viewBox={`0 0 ${entries.length * 40} 100`} preserveAspectRatio="none">
            <polyline
              points={entries.map((e, i) => {
                const x = i * 40 + 20;
                const y = 90 - ((e[1] - minW) / (maxW - minW)) * 80;
                return `${x},${y}`;
              }).join(" ")}
              fill="none" stroke={T.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
            />
            {entries.map((e, i) => {
              const x = i * 40 + 20;
              const y = 90 - ((e[1] - minW) / (maxW - minW)) * 80;
              return <circle key={i} cx={x} cy={y} r={4} fill={T.accent} />;
            })}
          </svg>
        )}
      </Card>

      <Btn onClick={onAddWeight} style={{ width: "100%" }}>+ Log Today's Weight</Btn>

      {entries.length > 0 && (
        <Card>
          <Label>Weight History</Label>
          {entries.slice(-7).reverse().map(([date, w], i) => (
            <div key={date} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: i < 6 ? `1px solid ${T.border}` : "none" }}>
              <span style={{ fontFamily: font, fontSize: 12, color: T.muted }}>{new Date(date).toLocaleDateString("en", { month: "short", day: "numeric" })}</span>
              <span style={{ fontFamily: fontSans, fontWeight: 700, fontSize: 14, color: T.accent }}>{w} kg</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ─── PROFILE ──────────────────────────────────────────────────────────────────
function ProfileScreen({ profile, onNav, onReset, onCoachMode }) {
  const macros = calcTDEE(profile);
  return (
    <div style={{ padding: "24px 20px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <div onClick={() => onNav("home")} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>←</div>
        <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: T.text }}>Profile</div>
      </div>

      <Card style={{ textAlign: "center", padding: "30px 20px" }}>
        <div style={{
          width: 72, height: 72, borderRadius: "50%", background: T.accent,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: fontSans, fontWeight: 900, fontSize: 32, color: "#000",
          margin: "0 auto 16px",
        }}>{profile.name?.[0]?.toUpperCase()}</div>
        <div style={{ fontFamily: fontSans, fontSize: 22, fontWeight: 900, color: T.text }}>{profile.name}</div>
        <div style={{ fontFamily: font, fontSize: 11, color: T.muted, marginTop: 4 }}>
          {profile.gender} · {profile.age} yrs · {profile.weight} kg · {profile.height} cm
        </div>
      </Card>

      <Card>
        <Label>Daily Targets</Label>
        {[
          { l: "Calorie Goal", v: `${macros.goal} kcal`, c: T.accent },
          { l: "Protein", v: `${macros.protein}g`, c: T.blue },
          { l: "Carbs", v: `${macros.carbs}g`, c: T.teal },
          { l: "Fat", v: `${macros.fat}g`, c: T.orange },
          { l: "TDEE (maintenance)", v: `${macros.tdee} kcal`, c: T.muted },
        ].map((r, i) => (
          <div key={r.l} style={{ display: "flex", justifyContent: "space-between", padding: "11px 0", borderBottom: i < 4 ? `1px solid ${T.border}` : "none" }}>
            <span style={{ fontFamily: font, fontSize: 12, color: T.muted }}>{r.l}</span>
            <span style={{ fontFamily: fontSans, fontWeight: 700, fontSize: 14, color: r.c }}>{r.v}</span>
          </div>
        ))}
      </Card>

      <Card>
        <Label>Goal</Label>
        <div style={{ fontFamily: fontSans, fontSize: 16, fontWeight: 700, color: T.text, textTransform: "capitalize" }}>
          {profile.goal === "lose" ? "🔥 Fat Loss" : profile.goal === "gain" ? "💪 Muscle Gain" : "⚖️ Maintenance"}
        </div>
        <div style={{ fontFamily: font, fontSize: 11, color: T.muted, marginTop: 4, textTransform: "capitalize" }}>
          Activity: {profile.activity}
        </div>
      </Card>

      {/* Coach Mode CTA */}
      <div onClick={onCoachMode} style={{
        background: `linear-gradient(135deg, ${T.purple}22 0%, ${T.purple}08 100%)`,
        border: `1px solid ${T.purple}44`,
        borderRadius: 20, padding: "18px 20px",
        cursor: "pointer", display: "flex", alignItems: "center", gap: 14,
      }}>
        <div style={{ fontSize: 32 }}>👨‍💼</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: fontSans, fontWeight: 800, fontSize: 15, color: T.text }}>Coach Dashboard</div>
          <div style={{ fontFamily: font, fontSize: 11, color: T.muted, marginTop: 3 }}>View all client data, compliance & AI notes</div>
        </div>
        <div style={{ color: T.purple, fontSize: 18 }}>→</div>
      </div>

      <Btn onClick={onReset} variant="ghost" style={{ width: "100%", color: T.red, borderColor: T.red }}>
        Reset & Start Over
      </Btn>
    </div>
  );
}

// ─── BOTTOM NAV ───────────────────────────────────────────────────────────────
function BottomNav({ current, onNav }) {
  const items = [
    { id: "home", icon: "🏠", label: "Home" },
    { id: "week", icon: "📊", label: "Week" },
    { id: "chat", icon: "💬", label: "AI Chat" },
    { id: "progress", icon: "📈", label: "Progress" },
    { id: "profile", icon: "👤", label: "Profile" },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)",
      width: "100%", maxWidth: 420, background: T.bg,
      borderTop: `1px solid ${T.border}`, display: "flex", padding: "8px 0 16px",
      zIndex: 100,
    }}>
      {items.map(item => (
        <div key={item.id} onClick={() => onNav(item.id)} style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
          cursor: "pointer", opacity: current === item.id ? 1 : 0.4,
          transition: "opacity 0.2s",
        }}>
          <div style={{ fontSize: 20 }}>{item.icon}</div>
          <div style={{ fontFamily: font, fontSize: 9, color: current === item.id ? T.accent : T.muted, letterSpacing: 0.5 }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
}

// ─── MODAL ────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: T.card, borderRadius: "24px 24px 0 0", width: "100%", maxWidth: 420, padding: 24, maxHeight: "80vh", overflowY: "auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <div style={{ fontFamily: fontSans, fontWeight: 800, fontSize: 18, color: T.text }}>{title}</div>
          <div onClick={onClose} style={{ cursor: "pointer", color: T.muted, fontSize: 22 }}>✕</div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState(null);
  const [screen, setScreen] = useState("home");
  const [logs, setLogs] = useState({});
  const [weights, setWeights] = useState({});
  const [water, setWater] = useState({});
  const [modal, setModal] = useState(null);
  const [weightInput, setWeightInput] = useState("");

  useEffect(() => {
    (async () => {
      const [p, l, w, wt] = await Promise.all([load("profile"), load("logs"), load("weights"), load("water")]);
      if (p) setProfile(p);
      if (l) setLogs(l);
      if (w) setWeights(w);
      if (wt) setWater(wt);
      setReady(true);
    })();
  }, []);

  const addMeal = (meal) => {
    const key = today();
    const updated = { ...logs, [key]: [...(logs[key] || []), meal] };
    setLogs(updated);
    save("logs", updated);
    setScreen("home");
  };

  const addWeight = (w) => {
    const updated = { ...weights, [today()]: parseFloat(w) };
    setWeights(updated);
    save("weights", updated);
  };

  const addWater = () => {
    const key = today();
    const updated = { ...water, [key]: (water[key] || 0) + 1 };
    setWater(updated);
    save("water", updated);
  };

  const onDone = (p) => { setProfile(p); setScreen("home"); };

  const reset = () => {
    save("profile", null); setProfile(null);
    save("logs", {}); setLogs({});
    save("weights", {}); setWeights({});
    save("water", {}); setWater({});
    setScreen("home");
  };

  const nav = (s) => {
    if (s === "water-add") { addWater(); return; }
    setScreen(s);
  };

  if (!ready) return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontFamily: font, color: T.accent, fontSize: 13, letterSpacing: 3 }}>LOADING...</div>
    </div>
  );

  if (!profile) return <Onboarding onDone={onDone} />;

  const showNav = ["home", "week", "chat", "progress", "profile"].includes(screen);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, maxWidth: 420, margin: "0 auto", paddingBottom: showNav ? 80 : 0 }}>
      {screen === "home" && <Dashboard profile={profile} logs={logs} water={water} onAddMeal={() => setScreen("add-meal")} onPhotoLog={() => setScreen("photo-log")} onNav={nav} />}
      {screen === "add-meal" && <AddMeal profile={profile} onSave={addMeal} onBack={() => setScreen("home")} />}
      {screen === "photo-log" && <PhotoLog profile={profile} onSave={addMeal} onBack={() => setScreen("home")} />}
      {screen === "week" && <WeeklyStats profile={profile} logs={logs} onNav={nav} />}
      {screen === "analysis" && <AIAnalysis profile={profile} logs={logs} onNav={nav} />}
      {screen === "chat" && <AIChat profile={profile} logs={logs} onNav={nav} />}
      {screen === "progress" && <Progress profile={profile} weights={weights} onAddWeight={() => setModal("weight")} onNav={nav} />}
      {screen === "profile" && <ProfileScreen profile={profile} onNav={nav} onReset={reset} onCoachMode={() => setScreen("coach")} />}
      {screen === "coach" && <CoachDashboard coachProfile={profile} onBack={() => setScreen("profile")} />}

      {showNav && <BottomNav current={screen} onNav={nav} />}

      {modal === "weight" && (
        <Modal title="Log Weight" onClose={() => setModal(null)}>
          <Input value={weightInput} onChange={e => setWeightInput(e.target.value)} placeholder="Your weight in kg..." type="number" />
          <Btn onClick={() => { if (weightInput) { addWeight(weightInput); setWeightInput(""); setModal(null); } }}
            style={{ width: "100%", marginTop: 16 }}>Save →</Btn>
        </Modal>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
        @keyframes shimmer { from{opacity:0.3} to{opacity:0.7} }
        @keyframes flame { 0%,100%{transform:scale(1) rotate(-2deg)} 50%{transform:scale(1.08) rotate(2deg)} }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent; }
        body { background: #080808; }
        input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
        input::placeholder { color: #333; }
        ::-webkit-scrollbar { display: none; }
      `}</style>
    </div>
  );
}
