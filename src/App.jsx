import { useState, useEffect, useCallback } from "react";

// ── CONFIG ────────────────────────────────────────────────────────────────────
const SHEET_ID = "1WV3HAGrVYKNw4XoAHyMdfGBT08M9WuqiDlfEw5hwYB4";
const sheetUrl = (name) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(name)}`;

// Touch sequence definition
const TOUCH_SEQUENCE = [
  { touch: 1, day: 0,  channel: "LinkedIn", objective: "Send connection request referencing a specific trigger or shared context" },
  { touch: 2, day: 3,  channel: "Content",  objective: "Publish market intelligence relevant to their sector — visibility not direct message" },
  { touch: 3, day: 5,  channel: "Email",    objective: "Insight-led outreach with a specific subject line tied to the trigger" },
  { touch: 4, day: 8,  channel: "LinkedIn", objective: "Comment thoughtfully on something they have published — add genuine perspective" },
  { touch: 5, day: 10, channel: "Phone",    objective: "Brief trigger-led call referencing the email — one question, two-minute ask" },
  { touch: 6, day: 14, channel: "Loom",     objective: "90-second personalised video — one sector insight, one direct question" },
  { touch: 7, day: 18, channel: "Email",    objective: "Follow-up to the video — new data point, low-commitment next step" },
  { touch: 8, day: 25, channel: "Phone",    objective: "Final call — reference the full journey, ask directly for 20 minutes" },
];

const CHANNEL_ICONS = {
  LinkedIn: "🔗", Email: "✉️", Phone: "📞", Loom: "🎥", Content: "📢"
};

// ── CSV PARSER ────────────────────────────────────────────────────────────────
const parseCSV = (text) => {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, "").trim());
  return lines.slice(1).map(line => {
    const values = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { values.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    values.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (values[i] || "").replace(/^"|"$/g, "").trim(); });
    return obj;
  }).filter(r => Object.values(r).some(v => v));
};

const fetchSheet = async (name) => {
  try {
    const res = await fetch(sheetUrl(name));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCSV(await res.text());
  } catch (e) {
    console.warn(`Sheet "${name}":`, e.message);
    return [];
  }
};

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => {
  const diff = new Date(b) - new Date(a);
  return Math.round(diff / (1000 * 60 * 60 * 24));
};
const isInWindow = (dateStr, windowDays) => {
  if (!dateStr) return false;
  const diff = daysBetween(today(), dateStr);
  return diff >= 0 && diff <= windowDays;
};
const isOverdue = (dateStr) => {
  if (!dateStr) return false;
  return daysBetween(today(), dateStr) < 0;
};
const formatDate = (dateStr) => {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

// ── SCORING ───────────────────────────────────────────────────────────────────
const TRIGGER_WEIGHTS = {
  "New Senior AI Hire": 4, "Strategic Partnership": 4, "Platform Rollout": 3,
  "Adoption Gap Signal": 3, "Leadership Departure": 4, "Funding / Restructure": 3,
  "Regulatory Change": 2, "Job Posting": 2, "Competitor Move": 2, "Other": 1, "": 0
};
const TIER_WEIGHTS = { "Critical": 4, "High": 3, "Medium": 2, "Low": 1 };
const WARMTH_WEIGHTS = { "Active": 4, "Warm": 3, "Connected": 2, "Aware": 1, "Cold": 0 };
const THREE_COND_WEIGHTS = { "Ready": 4, "Preparation": 2, "Monitor": 1 };

const scoreContact = (contact, firms) => {
  const firm = firms.find(f => f["Firm Name"] === contact["Firm"]) || {};
  const tierScore = TIER_WEIGHTS[firm["Priority Tier"]] || 1;
  const warmthScore = WARMTH_WEIGHTS[contact["Relationship Warmth"]] || 0;
  const triggerScore = TRIGGER_WEIGHTS[contact["Trigger Type"]] || 0;
  const condScore = THREE_COND_WEIGHTS[firm["Three Condition Score"]] || 1;
  return (tierScore * 1.5) + (triggerScore * 1.5) + (warmthScore * 1) + (condScore * 1);
};

// ── PROCESS LAYER LOGIC ───────────────────────────────────────────────────────
const getNextTouch = (contact) => {
  const touchNum = parseInt(contact["Current Touch"]) || 0;
  if (touchNum >= 8) return null;
  return TOUCH_SEQUENCE[touchNum] || null;
};

const computeSpotlight = (contacts, firms, window) => {
  const windowDays = window === "today" ? 0 : window === "week" ? 7 : 30;
  const t = today();
  const results = [];

  contacts.forEach(c => {
    if (c["Contact Type"] !== "Client Target") return;
    const status = c["Process Status"] || "Not Started";
    if (["Closed", "Wrong Contact"].includes(status)) return;

    const touchDue = c["Touch Due Date"];
    const seqStart = c["Sequence Start Date"];

    // Active in sequence — check if touch is due in window
    if (status === "Active in Sequence" && touchDue) {
      const daysUntil = daysBetween(t, touchDue);
      if (daysUntil >= 0 && daysUntil <= windowDays) {
        results.push({ ...c, _daysUntil: daysUntil, _type: "due", _firm: firms.find(f => f["Firm Name"] === c["Firm"]) || {} });
      } else if (isOverdue(touchDue)) {
        results.push({ ...c, _daysUntil: daysUntil, _type: "overdue", _firm: firms.find(f => f["Firm Name"] === c["Firm"]) || {} });
      }
    }

    // Response received — needs action
    if (c["Response Received"] === "Yes" && !c["Last Outcome"]) {
      results.push({ ...c, _daysUntil: -99, _type: "response", _firm: firms.find(f => f["Firm Name"] === c["Firm"]) || {} });
    }

    // Not started but firm is Ready — suggest starting
    if (status === "Not Started" && window !== "today") {
      const firm = firms.find(f => f["Firm Name"] === c["Firm"]) || {};
      if (firm["Three Condition Score"] === "Ready") {
        results.push({ ...c, _daysUntil: 999, _type: "suggested", _firm: firm });
      }
    }
  });

  // Sort: responses first, then overdue, then by score
  results.sort((a, b) => {
    const typeOrder = { response: 0, overdue: 1, due: 2, suggested: 3 };
    if (typeOrder[a._type] !== typeOrder[b._type]) return typeOrder[a._type] - typeOrder[b._type];
    return scoreContact(b, firms) - scoreContact(a, firms);
  });

  return results;
};

// ── GROW SUGGESTIONS ──────────────────────────────────────────────────────────
const getGrowSuggestions = (contacts, firms) => {
  return contacts
    .filter(c => {
      if (c["Contact Type"] !== "Client Target") return false;
      if (["Active in Sequence", "Conversation Open", "Closed", "Wrong Contact"].includes(c["Process Status"])) return false;
      const firm = firms.find(f => f["Firm Name"] === c["Firm"]);
      return firm && ["Ready", "Preparation"].includes(firm["Three Condition Score"]);
    })
    .map(c => ({ ...c, _score: scoreContact(c, firms), _firm: firms.find(f => f["Firm Name"] === c["Firm"]) || {} }))
    .sort((a, b) => b._score - a._score)
    .slice(0, 5);
};

// ── STYLES ────────────────────────────────────────────────────────────────────
const S = {
  // Layout
  app: { minHeight: "100vh", background: "#0F1923", color: "#E8E4DC", fontFamily: "'DM Sans', 'Segoe UI', sans-serif", fontSize: 14 },
  sidebar: { width: 220, minHeight: "100vh", background: "#0A1018", borderRight: "1px solid #1E2D3D", display: "flex", flexDirection: "column", position: "fixed", left: 0, top: 0, bottom: 0, zIndex: 10 },
  main: { marginLeft: 220, minHeight: "100vh", display: "flex", flexDirection: "column" },
  topbar: { background: "#0A1018", borderBottom: "1px solid #1E2D3D", padding: "12px 24px", display: "flex", alignItems: "center", gap: 12, position: "sticky", top: 0, zIndex: 5 },
  content: { padding: "24px", flex: 1 },

  // Nav
  logo: { padding: "20px 16px 12px", borderBottom: "1px solid #1E2D3D" },
  logoText: { fontSize: 16, fontWeight: 700, color: "#E8E4DC", letterSpacing: 2 },
  logoSub: { fontSize: 10, color: "#4A6274", letterSpacing: 3, marginTop: 2, textTransform: "uppercase" },
  navSection: { padding: "12px 8px 4px", fontSize: 10, color: "#4A6274", letterSpacing: 2, textTransform: "uppercase", fontWeight: 600 },
  navItem: (active) => ({ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: active ? 600 : 400, color: active ? "#E8E4DC" : "#7A94A6", background: active ? "#1E2D3D" : "transparent", margin: "1px 8px", transition: "all 0.15s", borderLeft: active ? "2px solid #C2502A" : "2px solid transparent" }),
  navBadge: (color) => ({ marginLeft: "auto", background: color || "#C2502A", color: "#fff", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }),

  // Cards
  card: { background: "#111E29", border: "1px solid #1E2D3D", borderRadius: 10, padding: "16px 20px", marginBottom: 12 },
  cardHeader: { display: "flex", alignItems: "center", gap: 8, marginBottom: 12 },

  // Spotlight cards
  spotlightCard: (type) => ({
    background: type === "response" ? "#1A1E12" : type === "overdue" ? "#1C1410" : type === "suggested" ? "#0F1A2A" : "#111E29",
    border: `1px solid ${type === "response" ? "#4A6B1A" : type === "overdue" ? "#6B3A1A" : type === "suggested" ? "#1E3A5C" : "#1E2D3D"}`,
    borderLeft: `3px solid ${type === "response" ? "#7AB83A" : type === "overdue" ? "#C2502A" : type === "suggested" ? "#3A7AB8" : "#4A6274"}`,
    borderRadius: 10, padding: "14px 18px", marginBottom: 10, transition: "all 0.15s"
  }),

  // Badges
  badge: (color) => ({ display: "inline-flex", alignItems: "center", fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "2px 8px", borderRadius: 4, textTransform: "uppercase", background: color + "22", color: color, border: `1px solid ${color}44` }),
  pill: (bg, text) => ({ background: bg, color: text || "#fff", fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 12, display: "inline-block" }),

  // Buttons
  btn: (variant) => {
    const variants = {
      primary: { background: "#C2502A", color: "#fff", border: "none", padding: "7px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer" },
      secondary: { background: "transparent", color: "#7A94A6", border: "1px solid #2A3D4D", padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer" },
      ghost: { background: "transparent", color: "#4A6274", border: "none", padding: "4px 8px", borderRadius: 4, fontSize: 11, cursor: "pointer" },
      success: { background: "#1A4A1A", color: "#7AB83A", border: "1px solid #2A6B2A", padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer" },
      danger: { background: "transparent", color: "#C25050", border: "1px solid #4D2020", padding: "6px 14px", borderRadius: 6, fontSize: 12, cursor: "pointer" },
    };
    return variants[variant] || variants.secondary;
  },

  // Text
  h1: { fontSize: 22, fontWeight: 700, color: "#E8E4DC", marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: 600, color: "#E8E4DC", marginBottom: 12 },
  h3: { fontSize: 13, fontWeight: 600, color: "#C2D4E0" },
  label: { fontSize: 11, color: "#4A6274", fontWeight: 500, textTransform: "uppercase", letterSpacing: 0.5 },
  value: { fontSize: 13, color: "#C2D4E0" },
  muted: { fontSize: 12, color: "#4A6274" },

  // Inputs
  input: { background: "#0A1018", border: "1px solid #2A3D4D", borderRadius: 6, padding: "8px 12px", color: "#E8E4DC", fontSize: 13, outline: "none", width: "100%" },
  select: { background: "#0A1018", border: "1px solid #2A3D4D", borderRadius: 6, padding: "7px 12px", color: "#E8E4DC", fontSize: 12, outline: "none", cursor: "pointer" },

  // Tables
  table: { width: "100%", borderCollapse: "collapse" },
  th: { fontSize: 10, fontWeight: 600, color: "#4A6274", textTransform: "uppercase", letterSpacing: 0.5, padding: "8px 12px", borderBottom: "1px solid #1E2D3D", textAlign: "left" },
  td: { padding: "10px 12px", borderBottom: "1px solid #131F2B", fontSize: 12, color: "#C2D4E0", verticalAlign: "middle" },

  // Grid
  grid2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  grid3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 },
  flex: { display: "flex", alignItems: "center" },
  flexBetween: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  gap4: { gap: 4 }, gap8: { gap: 8 }, gap12: { gap: 12 }, gap16: { gap: 16 },

  // Stat
  statCard: { background: "#111E29", border: "1px solid #1E2D3D", borderRadius: 10, padding: "16px 20px" },
  statNum: { fontSize: 28, fontWeight: 700, color: "#E8E4DC" },
  statLabel: { fontSize: 11, color: "#4A6274", marginTop: 2 },
};

// ── COLOUR HELPERS ────────────────────────────────────────────────────────────
const tierColor = (t) => ({ Critical: "#C2502A", High: "#E8A020", Medium: "#4A8AB8", Low: "#4A6274" }[t] || "#4A6274");
const warmthColor = (w) => ({ Active: "#7AB83A", Warm: "#B8A83A", Connected: "#3A7AB8", Aware: "#7A4AB8", Cold: "#4A6274" }[w] || "#4A6274");
const condColor = (c) => ({ Ready: "#7AB83A", Preparation: "#E8A020", Monitor: "#4A6274" }[c] || "#4A6274");
const channelColor = (ch) => ({ LinkedIn: "#0A66C2", Email: "#E8A020", Phone: "#7AB83A", Loom: "#C2502A", Content: "#7A4AB8" }[ch] || "#4A6274");

// ── MODAL ─────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "#111E29", border: "1px solid #2A3D4D", borderRadius: 12, padding: 24, width: 480, maxWidth: "90vw", maxHeight: "85vh", overflowY: "auto" }}>
        <div style={{ ...S.flexBetween, marginBottom: 16 }}>
          <div style={S.h2}>{title}</div>
          <button onClick={onClose} style={{ ...S.btn("ghost"), fontSize: 18 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── OUTCOME MODAL ─────────────────────────────────────────────────────────────
function OutcomeModal({ contact, onSave, onClose }) {
  const [moved, setMoved] = useState("");
  const [timing, setTiming] = useState("");
  const [rightContact, setRightContact] = useState("");
  const [nextState, setNextState] = useState("");
  const [reenterDate, setReenterDate] = useState("");
  const [note, setNote] = useState("");

  const canSave = nextState;

  return (
    <Modal title="Log Outcome" onClose={onClose}>
      <div style={{ ...S.card, marginBottom: 12, background: "#0A1018" }}>
        <div style={S.h3}>{contact["Full Name"]}</div>
        <div style={S.muted}>{contact["Role Title"]} · {contact["Firm"]}</div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ ...S.label, marginBottom: 6 }}>Did this move the conversation forward?</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Yes", "No", "Too early to say"].map(o => (
            <button key={o} onClick={() => setMoved(o)} style={{ ...S.btn(moved === o ? "primary" : "secondary"), fontSize: 11 }}>{o}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ ...S.label, marginBottom: 6 }}>Is the timing still real?</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Yes", "Weak", "Unclear"].map(o => (
            <button key={o} onClick={() => setTiming(o)} style={{ ...S.btn(timing === o ? "primary" : "secondary"), fontSize: 11 }}>{o}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ ...S.label, marginBottom: 6 }}>Is this the right contact?</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Yes", "No — need to escalate", "Unsure"].map(o => (
            <button key={o} onClick={() => setRightContact(o)} style={{ ...S.btn(rightContact === o ? "primary" : "secondary"), fontSize: 11 }}>{o}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <div style={{ ...S.label, marginBottom: 6 }}>Next state *</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {["Push", "Watch", "Pause", "Switch Contact", "Stop"].map(o => (
            <button key={o} onClick={() => setNextState(o)} style={{ ...S.btn(nextState === o ? "primary" : "secondary"), fontSize: 11 }}>{o}</button>
          ))}
        </div>
      </div>

      {nextState === "Pause" && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ ...S.label, marginBottom: 6 }}>Re-enter date</div>
          <input type="date" value={reenterDate} onChange={e => setReenterDate(e.target.value)} style={{ ...S.input, width: "auto" }} />
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={{ ...S.label, marginBottom: 6 }}>Note (optional)</div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Why this state call was made..." style={S.input} />
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={S.btn("secondary")}>Cancel</button>
        <button onClick={() => canSave && onSave({ moved, timing, rightContact, nextState, reenterDate, note })} style={{ ...S.btn("primary"), opacity: canSave ? 1 : 0.4 }}>Save outcome</button>
      </div>
    </Modal>
  );
}

// ── START SEQUENCE MODAL ──────────────────────────────────────────────────────
function StartSequenceModal({ contact, firm, onSave, onClose }) {
  const [triggerType, setTriggerType] = useState(contact["Trigger Type"] || "");
  const triggers = ["New Senior AI Hire", "Strategic Partnership", "Platform Rollout", "Adoption Gap Signal", "Leadership Departure", "Funding / Restructure", "Regulatory Change", "Job Posting", "Competitor Move", "Other"];

  return (
    <Modal title="Start Sequence" onClose={onClose}>
      <div style={{ ...S.card, marginBottom: 16, background: "#0A1018" }}>
        <div style={S.h3}>{contact["Full Name"]}</div>
        <div style={S.muted}>{contact["Role Title"]} · {contact["Firm"]}</div>
        {firm["Three Condition Score"] && <div style={{ marginTop: 8 }}><span style={S.badge(condColor(firm["Three Condition Score"]))}>{firm["Three Condition Score"]}</span></div>}
      </div>

      {firm["AI Signal"] && (
        <div style={{ ...S.card, background: "#0A1018", marginBottom: 16 }}>
          <div style={{ ...S.label, marginBottom: 4 }}>Firm signal</div>
          <div style={{ fontSize: 12, color: "#C2D4E0" }}>{firm["AI Signal"]}</div>
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <div style={{ ...S.label, marginBottom: 8 }}>What trigger is starting this outreach?</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {triggers.map(t => (
            <button key={t} onClick={() => setTriggerType(t)} style={{ ...S.btn(triggerType === t ? "primary" : "secondary"), fontSize: 11, marginBottom: 4 }}>{t}</button>
          ))}
        </div>
      </div>

      <div style={{ background: "#0A1018", borderRadius: 8, padding: 12, marginBottom: 20 }}>
        <div style={{ ...S.label, marginBottom: 8 }}>First touch</div>
        <div style={{ ...S.flex, ...S.gap8 }}>
          <span style={{ fontSize: 16 }}>{CHANNEL_ICONS.LinkedIn}</span>
          <div>
            <div style={{ fontSize: 12, color: "#E8E4DC", fontWeight: 600 }}>LinkedIn — Today</div>
            <div style={{ fontSize: 11, color: "#7A94A6" }}>Send connection request referencing a specific trigger or shared context</div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={S.btn("secondary")}>Cancel</button>
        <button onClick={() => onSave({ triggerType, startDate: today() })} style={S.btn("primary")}>Start sequence</button>
      </div>
    </Modal>
  );
}

// ── SPOTLIGHT CARD ────────────────────────────────────────────────────────────
function SpotlightCard({ contact, firms, onAction, onStart }) {
  const type = contact._type;
  const firm = contact._firm;
  const touchNum = parseInt(contact["Current Touch"]) || 0;
  const nextTouch = type === "due" || type === "overdue" ? TOUCH_SEQUENCE[touchNum] : null;
  const typeLabels = { response: "RESPONSE", overdue: "OVERDUE", due: "DUE", suggested: "SUGGESTED" };
  const typeColors = { response: "#7AB83A", overdue: "#C2502A", due: "#E8A020", suggested: "#3A7AB8" };

  return (
    <div style={S.spotlightCard(type)}>
      <div style={S.flexBetween}>
        <div style={{ ...S.flex, ...S.gap8 }}>
          <span style={S.badge(typeColors[type])}>{typeLabels[type]}</span>
          {firm["Priority Tier"] && <span style={S.badge(tierColor(firm["Priority Tier"]))}>{firm["Priority Tier"]}</span>}
          {type === "due" && contact["Touch Due Date"] && (
            <span style={{ ...S.muted, fontSize: 11 }}>Due {formatDate(contact["Touch Due Date"])}</span>
          )}
          {type === "overdue" && contact["Touch Due Date"] && (
            <span style={{ fontSize: 11, color: "#C2502A" }}>Overdue since {formatDate(contact["Touch Due Date"])}</span>
          )}
        </div>
        {contact["LinkedIn URL"] && (
          <a href={contact["LinkedIn URL"]} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#3A7AB8", textDecoration: "none" }}>LinkedIn ↗</a>
        )}
      </div>

      <div style={{ marginTop: 10, marginBottom: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600, color: "#E8E4DC" }}>{contact["Full Name"]}</div>
        <div style={{ fontSize: 12, color: "#7A94A6", marginTop: 2 }}>{contact["Role Title"]} · {contact["Firm"]}</div>
      </div>

      {firm["AI Signal"] && (
        <div style={{ fontSize: 11, color: "#7A94A6", marginBottom: 8, paddingLeft: 8, borderLeft: "2px solid #2A3D4D" }}>
          <span style={{ color: "#4A6274" }}>Signal: </span>{firm["AI Signal"]}
        </div>
      )}

      {type === "response" && (
        <div style={{ background: "#1A2A0A", border: "1px solid #2A4A1A", borderRadius: 6, padding: "8px 12px", marginBottom: 10, fontSize: 12, color: "#7AB83A" }}>
          ✓ Response received — log outcome to advance or close
        </div>
      )}

      {nextTouch && (type === "due" || type === "overdue") && (
        <div style={{ background: "#0A1018", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          <div style={{ ...S.flex, ...S.gap8 }}>
            <span style={{ color: channelColor(nextTouch.channel), fontSize: 15 }}>{CHANNEL_ICONS[nextTouch.channel]}</span>
            <div style={{ flex: 1 }}>
              <div style={{ ...S.flex, ...S.gap8 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: channelColor(nextTouch.channel) }}>{nextTouch.channel}</span>
                <span style={{ ...S.muted, fontSize: 10 }}>Touch {touchNum + 1} of 8</span>
              </div>
              <div style={{ fontSize: 11, color: "#7A94A6", marginTop: 2 }}>{nextTouch.objective}</div>
            </div>
          </div>
        </div>
      )}

      {type === "suggested" && (
        <div style={{ background: "#0A1218", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: "#3A7AB8" }}>
            🎯 Firm is <strong>{firm["Three Condition Score"]}</strong> — {firm["Key Gap"] ? `Gap: ${firm["Key Gap"]}` : "ready to approach"}
          </div>
          {contact["Trigger Type"] && <div style={{ fontSize: 11, color: "#4A6274", marginTop: 4 }}>Trigger: {contact["Trigger Type"]}</div>}
        </div>
      )}

      <div style={{ ...S.flex, gap: 8, marginTop: 10 }}>
        {type === "suggested" && (
          <button onClick={() => onStart(contact)} style={S.btn("primary")}>Start sequence</button>
        )}
        {(type === "due" || type === "overdue") && (
          <>
            <button onClick={() => onAction(contact, "done")} style={S.btn("success")}>✓ Done — no response</button>
            <button onClick={() => onAction(contact, "response")} style={S.btn("primary")}>Response received</button>
          </>
        )}
        {type === "response" && (
          <button onClick={() => onAction(contact, "response")} style={S.btn("primary")}>Log outcome</button>
        )}
        <button onClick={() => onAction(contact, "pause")} style={S.btn("ghost")}>Pause</button>
      </div>
    </div>
  );
}

// ── SPOTLIGHT VIEW ────────────────────────────────────────────────────────────
function SpotlightView({ contacts, firms, signals, onUpdate }) {
  const [window, setWindow] = useState("today");
  const [actionContact, setActionContact] = useState(null);
  const [startContact, setStartContact] = useState(null);
  const [actionType, setActionType] = useState(null);
  const [localContacts, setLocalContacts] = useState(contacts);

  useEffect(() => { setLocalContacts(contacts); }, [contacts]);

  const spotlight = computeSpotlight(localContacts, firms, window);
  const grow = window !== "today" ? [] : getGrowSuggestions(localContacts, firms);

  const handleAction = (contact, type) => {
    setActionContact(contact);
    setActionType(type);
  };

  const handleStart = (contact) => {
    setStartContact(contact);
  };

  const handleDone = (contact) => {
    const touchNum = parseInt(contact["Current Touch"]) || 0;
    const nextTouchIdx = touchNum; // 0-indexed
    const currentTouchDef = TOUCH_SEQUENCE[nextTouchIdx];
    const nextTouchDef = TOUCH_SEQUENCE[nextTouchIdx + 1];

    const updated = localContacts.map(c => {
      if (c["Contact ID"] !== contact["Contact ID"]) return c;
      if (touchNum >= 8) {
        return { ...c, "Process Status": "Paused", "Notes": (c["Notes"] || "") + " [Sequence complete — awaiting decision]" };
      }
      const newTouchNum = touchNum + 1;
      const newDueDate = nextTouchDef ? addDays(today(), nextTouchDef.day - (currentTouchDef?.day || 0)) : "";
      return { ...c, "Current Touch": String(newTouchNum), "Touch Due Date": newDueDate, "Process Status": "Active in Sequence" };
    });
    setLocalContacts(updated);
    onUpdate(updated);
  };

  const handleSaveOutcome = (outcome) => {
    const stateMap = { "Push": "Active in Sequence", "Watch": "Paused", "Pause": "Paused", "Switch Contact": "Wrong Contact", "Stop": "Closed" };
    const updated = localContacts.map(c => {
      if (c["Contact ID"] !== actionContact["Contact ID"]) return c;
      return {
        ...c,
        "Response Received": "Yes",
        "Last Outcome": outcome.nextState === "Push" ? "Conversation Open" : outcome.nextState,
        "Process Status": stateMap[outcome.nextState] || c["Process Status"],
        "Re-enter Date": outcome.reenterDate || "",
        "Notes": outcome.note ? ((c["Notes"] || "") + " | " + outcome.note) : c["Notes"],
      };
    });
    setLocalContacts(updated);
    onUpdate(updated);
    setActionContact(null);
    setActionType(null);
  };

  const handleSaveStart = ({ triggerType, startDate }) => {
    const updated = localContacts.map(c => {
      if (c["Contact ID"] !== startContact["Contact ID"]) return c;
      return {
        ...c,
        "Process Status": "Active in Sequence",
        "Current Touch": "1",
        "Sequence Start Date": startDate,
        "Touch Due Date": startDate,
        "Trigger Type": triggerType || c["Trigger Type"],
      };
    });
    setLocalContacts(updated);
    onUpdate(updated);
    setStartContact(null);
  };

  const handleCardAction = (contact, type) => {
    if (type === "done") { handleDone(contact); return; }
    handleAction(contact, type);
  };

  // Stats
  const activeInSeq = localContacts.filter(c => c["Process Status"] === "Active in Sequence").length;
  const dueToday = computeSpotlight(localContacts, firms, "today").filter(c => c._type === "due" || c._type === "overdue").length;
  const readyFirms = firms.filter(f => f["Three Condition Score"] === "Ready").length;
  const responsesPending = localContacts.filter(c => c["Response Received"] === "Yes" && !c["Last Outcome"]).length;

  return (
    <div>
      {/* Header */}
      <div style={{ ...S.flexBetween, marginBottom: 20 }}>
        <div>
          <div style={S.h1}>Spotlight</div>
          <div style={S.muted}>Contact process layer — what needs doing and when</div>
        </div>
        <div style={{ ...S.flex, gap: 6 }}>
          {["today", "week", "month"].map(w => (
            <button key={w} onClick={() => setWindow(w)} style={{ ...S.btn(window === w ? "primary" : "secondary"), textTransform: "capitalize", fontSize: 12 }}>
              {w === "today" ? "Today" : w === "week" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {/* Stats row */}
      <div style={{ ...S.grid3, marginBottom: 20 }}>
        <div style={S.statCard}>
          <div style={S.statNum}>{dueToday}</div>
          <div style={S.statLabel}>Due today</div>
        </div>
        <div style={S.statCard}>
          <div style={{ ...S.statNum, color: "#7AB83A" }}>{activeInSeq}</div>
          <div style={S.statLabel}>Active in sequence</div>
        </div>
        <div style={S.statCard}>
          <div style={{ ...S.statNum, color: "#E8A020" }}>{readyFirms}</div>
          <div style={S.statLabel}>Firms ready to approach</div>
        </div>
      </div>

      {responsesPending > 0 && (
        <div style={{ background: "#1A2A0A", border: "1px solid #2A4A1A", borderRadius: 8, padding: "10px 16px", marginBottom: 16, ...S.flex, gap: 10 }}>
          <span style={{ color: "#7AB83A", fontSize: 16 }}>✓</span>
          <span style={{ fontSize: 13, color: "#7AB83A" }}>{responsesPending} response{responsesPending > 1 ? "s" : ""} waiting to be logged</span>
        </div>
      )}

      {/* Spotlight list */}
      {spotlight.length === 0 ? (
        <div style={{ ...S.card, textAlign: "center", padding: "40px 24px" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
          <div style={{ fontSize: 15, color: "#C2D4E0", marginBottom: 6 }}>
            {window === "today" ? "Nothing due today." : `Nothing due this ${window}.`}
          </div>
          <div style={S.muted}>
            {window === "today" ? "Check this week's view to plan ahead, or add a contact to sequence below." : "All sequences are on track."}
          </div>
        </div>
      ) : (
        <div>
          {spotlight.filter(c => c._type === "response").length > 0 && (
            <div style={{ ...S.label, marginBottom: 8 }}>Responses to action</div>
          )}
          {spotlight.filter(c => c._type === "response").map(c => (
            <SpotlightCard key={c["Contact ID"]} contact={c} firms={firms} onAction={handleCardAction} onStart={handleStart} />
          ))}

          {spotlight.filter(c => c._type === "overdue").length > 0 && (
            <div style={{ ...S.label, marginBottom: 8, marginTop: 16 }}>Overdue</div>
          )}
          {spotlight.filter(c => c._type === "overdue").map(c => (
            <SpotlightCard key={c["Contact ID"]} contact={c} firms={firms} onAction={handleCardAction} onStart={handleStart} />
          ))}

          {spotlight.filter(c => c._type === "due").length > 0 && (
            <div style={{ ...S.label, marginBottom: 8, marginTop: 16 }}>Due {window === "today" ? "today" : `this ${window}`}</div>
          )}
          {spotlight.filter(c => c._type === "due").map(c => (
            <SpotlightCard key={c["Contact ID"]} contact={c} firms={firms} onAction={handleCardAction} onStart={handleStart} />
          ))}
        </div>
      )}

      {/* Grow suggestions */}
      {window === "today" && grow.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <div style={{ ...S.flexBetween, marginBottom: 12 }}>
            <div>
              <div style={S.h2}>Focus & Grow</div>
              <div style={S.muted}>High-priority contacts not yet in sequence</div>
            </div>
          </div>
          {grow.map(c => (
            <SpotlightCard key={c["Contact ID"]} contact={{ ...c, _type: "suggested" }} firms={firms} onAction={handleCardAction} onStart={handleStart} />
          ))}
        </div>
      )}

      {/* Week/month suggested */}
      {window !== "today" && spotlight.filter(c => c._type === "suggested").length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...S.label, marginBottom: 8 }}>Suggested to add to sequence</div>
          {spotlight.filter(c => c._type === "suggested").map(c => (
            <SpotlightCard key={c["Contact ID"]} contact={c} firms={firms} onAction={handleCardAction} onStart={handleStart} />
          ))}
        </div>
      )}

      {/* Modals */}
      {actionContact && (actionType === "response" || actionType === "pause") && (
        <OutcomeModal contact={actionContact} onSave={handleSaveOutcome} onClose={() => { setActionContact(null); setActionType(null); }} />
      )}
      {startContact && (
        <StartSequenceModal contact={startContact} firm={firms.find(f => f["Firm Name"] === startContact["Firm"]) || {}} onSave={handleSaveStart} onClose={() => setStartContact(null)} />
      )}
    </div>
  );
}

// ── FIRMS VIEW ────────────────────────────────────────────────────────────────
function FirmsView({ firms, contacts, signals }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = firms.filter(f => {
    if (filter !== "all" && f["Three Condition Score"] !== filter) return false;
    if (search && !f["Firm Name"].toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div>
      <div style={{ ...S.flexBetween, marginBottom: 20 }}>
        <div>
          <div style={S.h1}>Firms</div>
          <div style={S.muted}>{firms.length} firms · company-level intelligence</div>
        </div>
      </div>

      <div style={{ ...S.flex, gap: 10, marginBottom: 16 }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search firms..." style={{ ...S.input, width: 200 }} />
        {["all", "Ready", "Preparation", "Monitor"].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{ ...S.btn(filter === f ? "primary" : "secondary"), fontSize: 11, textTransform: f === "all" ? "capitalize" : "none" }}>
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      <div>
        {filtered.map(firm => {
          const firmContacts = contacts.filter(c => c["Firm"] === firm["Firm Name"] && c["Contact Type"] === "Client Target");
          const activeContacts = firmContacts.filter(c => c["Process Status"] === "Active in Sequence");
          const firmSignals = signals.filter(s => s["Firm"] === firm["Firm Name"]);

          return (
            <div key={firm["Firm ID"]} style={{ ...S.card, marginBottom: 10 }}>
              <div style={S.flexBetween}>
                <div style={{ flex: 1 }}>
                  <div style={{ ...S.flex, gap: 10, marginBottom: 6 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: "#E8E4DC" }}>{firm["Firm Name"]}</div>
                    {firm["Three Condition Score"] && <span style={S.badge(condColor(firm["Three Condition Score"]))}>{firm["Three Condition Score"]}</span>}
                    {firm["Priority Tier"] && <span style={S.badge(tierColor(firm["Priority Tier"]))}>{firm["Priority Tier"]}</span>}
                    {firm["ICP Fit"] && <span style={{ ...S.badge(firm["ICP Fit"] === "Strong" ? "#7AB83A" : "#E8A020") }}>{firm["ICP Fit"]}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "#7A94A6", marginBottom: 6 }}>{firm["Firm Type"]} · {firm["AI Posture"]} · {firm["Key Gap"]}</div>
                  {firm["AI Signal"] && <div style={{ fontSize: 11, color: "#4A6274" }}>{firm["AI Signal"]}</div>}
                </div>
                <div style={{ textAlign: "right", marginLeft: 16 }}>
                  <div style={{ fontSize: 11, color: "#4A6274" }}>{firmContacts.length} contact{firmContacts.length !== 1 ? "s" : ""}</div>
                  {activeContacts.length > 0 && <div style={{ fontSize: 11, color: "#7AB83A" }}>{activeContacts.length} in sequence</div>}
                  {firmSignals.length > 0 && <div style={{ fontSize: 11, color: "#E8A020" }}>{firmSignals.length} signal{firmSignals.length !== 1 ? "s" : ""}</div>}
                </div>
              </div>
              {firm["Notes"] && <div style={{ fontSize: 11, color: "#4A6274", marginTop: 6, paddingTop: 6, borderTop: "1px solid #1E2D3D" }}>{firm["Notes"]}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── CONTACTS VIEW ─────────────────────────────────────────────────────────────
function ContactsView({ contacts, firms }) {
  const [typeFilter, setTypeFilter] = useState("Client Target");
  const [warmthFilter, setWarmthFilter] = useState("all");
  const [search, setSearch] = useState("");

  const filtered = contacts.filter(c => {
    if (typeFilter !== "all" && c["Contact Type"] !== typeFilter) return false;
    if (warmthFilter !== "all" && c["Relationship Warmth"] !== warmthFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return c["Full Name"]?.toLowerCase().includes(q) || c["Firm"]?.toLowerCase().includes(q) || c["Role Title"]?.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      <div style={{ ...S.flexBetween, marginBottom: 20 }}>
        <div>
          <div style={S.h1}>Contacts</div>
          <div style={S.muted}>{contacts.length} total · {contacts.filter(c => c["Contact Type"] === "Client Target").length} client targets</div>
        </div>
      </div>

      <div style={{ ...S.flex, gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, firm, role..." style={{ ...S.input, width: 220 }} />
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} style={S.select}>
          <option value="all">All types</option>
          <option>Client Target</option>
          <option>Candidate</option>
          <option>Vendor</option>
          <option>Monitor</option>
        </select>
        <select value={warmthFilter} onChange={e => setWarmthFilter(e.target.value)} style={S.select}>
          <option value="all">All warmth</option>
          <option>Active</option>
          <option>Warm</option>
          <option>Connected</option>
          <option>Aware</option>
          <option>Cold</option>
        </select>
      </div>

      <div style={{ ...S.muted, marginBottom: 10 }}>{filtered.length} contacts</div>

      <table style={S.table}>
        <thead>
          <tr>
            {["Name", "Firm", "Role", "Type", "Warmth", "Status", "Touch", "Due"].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map(c => (
            <tr key={c["Contact ID"]} style={{ cursor: "default" }}>
              <td style={S.td}>
                <div style={{ fontWeight: 600, color: "#E8E4DC", fontSize: 12 }}>{c["Full Name"]}</div>
                {c["LinkedIn URL"] && <a href={c["LinkedIn URL"]} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: "#3A7AB8", textDecoration: "none" }}>LinkedIn ↗</a>}
              </td>
              <td style={S.td}>{c["Firm"]}</td>
              <td style={{ ...S.td, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c["Role Title"]}</td>
              <td style={S.td}><span style={S.badge(c["Contact Type"] === "Client Target" ? "#C2502A" : c["Contact Type"] === "Candidate" ? "#7AB83A" : c["Contact Type"] === "Vendor" ? "#3A7AB8" : "#4A6274")}>{c["Contact Type"]}</span></td>
              <td style={S.td}><span style={S.badge(warmthColor(c["Relationship Warmth"]))}>{c["Relationship Warmth"]}</span></td>
              <td style={S.td}><span style={{ fontSize: 11, color: c["Process Status"] === "Active in Sequence" ? "#7AB83A" : c["Process Status"] === "Conversation Open" ? "#E8A020" : "#4A6274" }}>{c["Process Status"] || "Not Started"}</span></td>
              <td style={S.td}>{c["Current Touch"] ? `${c["Current Touch"]}/8` : "—"}</td>
              <td style={S.td}>{c["Touch Due Date"] ? formatDate(c["Touch Due Date"]) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── SIGNALS VIEW ──────────────────────────────────────────────────────────────
function SignalsView({ signals, firms }) {
  const [strengthFilter, setStrengthFilter] = useState("all");

  const filtered = signals.filter(s => strengthFilter === "all" || s["Trigger Strength"] === strengthFilter);

  const strengthColor = (s) => ({ "Very High": "#C2502A", "High": "#E8A020", "Medium": "#3A7AB8", "Low": "#4A6274" }[s] || "#4A6274");

  return (
    <div>
      <div style={{ ...S.flexBetween, marginBottom: 20 }}>
        <div>
          <div style={S.h1}>Signals</div>
          <div style={S.muted}>{signals.length} signals · intelligence log</div>
        </div>
      </div>

      <div style={{ ...S.flex, gap: 8, marginBottom: 16 }}>
        {["all", "Very High", "High", "Medium", "Low"].map(f => (
          <button key={f} onClick={() => setStrengthFilter(f)} style={{ ...S.btn(strengthFilter === f ? "primary" : "secondary"), fontSize: 11 }}>
            {f === "all" ? "All" : f}
          </button>
        ))}
      </div>

      {filtered.map(s => (
        <div key={s["Signal ID"]} style={S.card}>
          <div style={S.flexBetween}>
            <div style={{ ...S.flex, gap: 8 }}>
              <span style={S.badge(strengthColor(s["Trigger Strength"]))}>{s["Trigger Strength"]}</span>
              <span style={{ ...S.badge("#4A6274"), fontSize: 10 }}>{s["Signal Type"]}</span>
              <span style={{ ...S.muted, fontSize: 11 }}>{s["Signal Source"]}</span>
            </div>
            <div style={{ ...S.flex, gap: 8 }}>
              <span style={{ fontSize: 11, color: "#4A6274" }}>{formatDate(s["Signal Date"])}</span>
              <span style={{ ...S.badge(s["Cost of Standing Still Changed?"] === "Yes" ? "#C2502A" : "#4A6274"), fontSize: 10 }}>
                {s["Cost of Standing Still Changed?"] === "Yes" ? "Cost changed" : "Monitor"}
              </span>
            </div>
          </div>
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#E8E4DC" }}>{s["Firm"]}</div>
            <div style={{ fontSize: 12, color: "#7A94A6", marginTop: 4 }}>{s["Signal Detail"]}</div>
          </div>
          {s["Action Taken"] === "Yes" && <div style={{ fontSize: 11, color: "#7AB83A", marginTop: 6 }}>✓ Action taken</div>}
        </div>
      ))}
    </div>
  );
}

// ── DAILY BRIEF ───────────────────────────────────────────────────────────────
function DailyBriefView({ contacts, firms, signals }) {
  const todaySpotlight = computeSpotlight(contacts, firms, "today");
  const readyFirms = firms.filter(f => f["Three Condition Score"] === "Ready");
  const recentSignals = signals.filter(s => {
    if (!s["Signal Date"]) return false;
    const days = daysBetween(s["Signal Date"], today());
    return days >= 0 && days <= 30;
  }).sort((a, b) => new Date(b["Signal Date"]) - new Date(a["Signal Date"])).slice(0, 5);
  const activeContacts = contacts.filter(c => c["Process Status"] === "Active in Sequence");
  const responses = contacts.filter(c => c["Response Received"] === "Yes" && !c["Last Outcome"]);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <div style={S.h1}>Daily Brief</div>
        <div style={S.muted}>{new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</div>
      </div>

      {/* Summary */}
      <div style={{ background: "#0A1018", border: "1px solid #1E2D3D", borderLeft: "3px solid #C2502A", borderRadius: 8, padding: "14px 18px", marginBottom: 24 }}>
        <div style={{ fontSize: 14, color: "#C2D4E0", lineHeight: 1.6 }}>
          {responses.length > 0 && <span style={{ color: "#7AB83A" }}>⚡ {responses.length} response{responses.length > 1 ? "s" : ""} waiting to be logged. </span>}
          {todaySpotlight.filter(c => c._type === "due" || c._type === "overdue").length > 0
            ? <span>{todaySpotlight.filter(c => c._type === "due" || c._type === "overdue").length} touch{todaySpotlight.filter(c => c._type === "due" || c._type === "overdue").length > 1 ? "es" : ""} due today. </span>
            : <span style={{ color: "#7AB83A" }}>No touches due today. </span>}
          {readyFirms.length > 0 && <span style={{ color: "#E8A020" }}>{readyFirms.length} firm{readyFirms.length > 1 ? "s" : ""} ready to approach. </span>}
          {activeContacts.length} contact{activeContacts.length !== 1 ? "s" : ""} active in sequence.
        </div>
      </div>

      <div style={S.grid2}>
        {/* Today's actions */}
        <div>
          <div style={{ ...S.h2, marginBottom: 12 }}>Today's Actions</div>
          {todaySpotlight.length === 0 ? (
            <div style={{ ...S.card, color: "#4A6274", fontSize: 13, textAlign: "center", padding: 20 }}>Nothing due today ✓</div>
          ) : (
            todaySpotlight.slice(0, 4).map(c => {
              const touchNum = parseInt(c["Current Touch"]) || 0;
              const touch = TOUCH_SEQUENCE[touchNum];
              return (
                <div key={c["Contact ID"]} style={{ ...S.card, marginBottom: 8, padding: "12px 16px" }}>
                  <div style={{ ...S.flex, gap: 8, marginBottom: 4 }}>
                    <span style={S.badge(c._type === "response" ? "#7AB83A" : c._type === "overdue" ? "#C2502A" : "#E8A020")}>{c._type}</span>
                    {firms.find(f => f["Firm Name"] === c["Firm"])?.["Priority Tier"] && (
                      <span style={S.badge(tierColor(firms.find(f => f["Firm Name"] === c["Firm"])["Priority Tier"]))}>{firms.find(f => f["Firm Name"] === c["Firm"])["Priority Tier"]}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#E8E4DC" }}>{c["Full Name"]}</div>
                  <div style={{ fontSize: 11, color: "#7A94A6" }}>{c["Firm"]}</div>
                  {touch && <div style={{ fontSize: 11, color: channelColor(touch.channel), marginTop: 4 }}>{CHANNEL_ICONS[touch.channel]} {touch.channel} — {touch.objective.slice(0, 60)}...</div>}
                </div>
              );
            })
          )}
        </div>

        {/* Recent signals */}
        <div>
          <div style={{ ...S.h2, marginBottom: 12 }}>Recent Signals</div>
          {recentSignals.length === 0 ? (
            <div style={{ ...S.card, color: "#4A6274", fontSize: 13, textAlign: "center", padding: 20 }}>No signals in last 30 days</div>
          ) : (
            recentSignals.map(s => (
              <div key={s["Signal ID"]} style={{ ...S.card, marginBottom: 8, padding: "12px 16px" }}>
                <div style={{ ...S.flex, gap: 6, marginBottom: 4 }}>
                  <span style={S.badge(s["Trigger Strength"] === "Very High" ? "#C2502A" : s["Trigger Strength"] === "High" ? "#E8A020" : "#3A7AB8")}>{s["Trigger Strength"]}</span>
                  <span style={{ fontSize: 10, color: "#4A6274" }}>{formatDate(s["Signal Date"])}</span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#E8E4DC" }}>{s["Firm"]}</div>
                <div style={{ fontSize: 11, color: "#7A94A6", marginTop: 2 }}>{s["Signal Detail"]?.slice(0, 100)}{s["Signal Detail"]?.length > 100 ? "…" : ""}</div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Ready firms */}
      {readyFirms.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div style={{ ...S.h2, marginBottom: 12 }}>Firms Ready to Approach</div>
          <div style={S.grid2}>
            {readyFirms.map(f => {
              const firmContacts = contacts.filter(c => c["Firm"] === f["Firm Name"] && c["Contact Type"] === "Client Target");
              const inSeq = firmContacts.filter(c => c["Process Status"] === "Active in Sequence");
              return (
                <div key={f["Firm ID"]} style={{ ...S.card, padding: "12px 16px" }}>
                  <div style={{ ...S.flex, gap: 6, marginBottom: 6 }}>
                    <span style={S.badge(tierColor(f["Priority Tier"]))}>{f["Priority Tier"]}</span>
                    <span style={S.badge("#7AB83A")}>Ready</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#E8E4DC" }}>{f["Firm Name"]}</div>
                  <div style={{ fontSize: 11, color: "#7A94A6", marginTop: 2 }}>{f["Key Gap"]} gap · {f["AI Posture"]}</div>
                  <div style={{ fontSize: 11, color: "#4A6274", marginTop: 4 }}>{firmContacts.length} contact{firmContacts.length !== 1 ? "s" : ""}{inSeq.length > 0 ? ` · ${inSeq.length} in sequence` : " · none in sequence"}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [view, setView] = useState("brief");
  const [contacts, setContacts] = useState([]);
  const [firms, setFirms] = useState([]);
  const [signals, setSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastSync, setLastSync] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [contactRows, firmRows, signalRows] = await Promise.all([
        fetchSheet("Contacts"),
        fetchSheet("Firms"),
        fetchSheet("Signals"),
      ]);
      // Filter out header/note rows
      const validContacts = contactRows.filter(r => r["Contact ID"] && r["Contact ID"].startsWith("C"));
      const validFirms = firmRows.filter(r => r["Firm ID"] && r["Firm ID"].startsWith("F"));
      const validSignals = signalRows.filter(r => r["Signal ID"] && r["Signal ID"].startsWith("S"));
      setContacts(validContacts);
      setFirms(validFirms);
      setSignals(validSignals);
      setLastSync(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setError("Could not load data from Google Sheets. Check the sheet is publicly accessible.");
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleUpdate = (updatedContacts) => {
    setContacts(updatedContacts);
  };

  // Nav counts
  const dueCount = contacts.length > 0 ? computeSpotlight(contacts, firms, "today").filter(c => c._type === "due" || c._type === "overdue" || c._type === "response").length : 0;
  const readyCount = firms.filter(f => f["Three Condition Score"] === "Ready").length;

  const navItems = [
    { id: "brief", label: "Daily Brief", icon: "◈" },
    { id: "spotlight", label: "Spotlight", icon: "◎", badge: dueCount > 0 ? dueCount : null },
    { id: "firms", label: "Firms", icon: "⬡", badge: readyCount > 0 ? readyCount : null, badgeColor: "#3A7AB8" },
    { id: "contacts", label: "Contacts", icon: "◉" },
    { id: "signals", label: "Signals", icon: "⚡" },
  ];

  return (
    <div style={S.app}>
      {/* Sidebar */}
      <div style={S.sidebar}>
        <div style={S.logo}>
          <div style={S.logoText}>ZENTIER</div>
          <div style={S.logoSub}>Legal AI Recruitment</div>
        </div>

        <div style={{ flex: 1, overflowY: "auto", paddingTop: 8 }}>
          <div style={S.navSection}>Workspace</div>
          {navItems.map(item => (
            <div key={item.id} style={S.navItem(view === item.id)} onClick={() => setView(item.id)}>
              <span style={{ fontSize: 14 }}>{item.icon}</span>
              <span>{item.label}</span>
              {item.badge && <span style={S.navBadge(item.badgeColor)}>{item.badge}</span>}
            </div>
          ))}
        </div>

        {/* Sync status */}
        <div style={{ padding: "12px 16px", borderTop: "1px solid #1E2D3D" }}>
          <div style={{ fontSize: 10, color: "#4A6274", marginBottom: 4 }}>{lastSync ? `Synced ${lastSync}` : "Not synced"}</div>
          <button onClick={loadData} style={{ ...S.btn("ghost"), fontSize: 10, padding: "3px 8px", width: "100%", textAlign: "center" }}>
            {loading ? "Loading…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {/* Main */}
      <div style={S.main}>
        {/* Topbar */}
        <div style={S.topbar}>
          <div style={{ fontSize: 13, color: "#4A6274", flex: 1 }}>
            {contacts.length > 0 && `${contacts.length} contacts · ${firms.length} firms · ${signals.length} signals`}
          </div>
          {error && <div style={{ fontSize: 12, color: "#C25050" }}>⚠ {error}</div>}
        </div>

        {/* Content */}
        <div style={S.content}>
          {loading ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "50vh", flexDirection: "column", gap: 16 }}>
              <div style={{ width: 32, height: 32, border: "2px solid #1E2D3D", borderTop: "2px solid #C2502A", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <div style={S.muted}>Loading from database…</div>
              <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            </div>
          ) : (
            <>
              {view === "brief" && <DailyBriefView contacts={contacts} firms={firms} signals={signals} />}
              {view === "spotlight" && <SpotlightView contacts={contacts} firms={firms} signals={signals} onUpdate={handleUpdate} />}
              {view === "firms" && <FirmsView firms={firms} contacts={contacts} signals={signals} />}
              {view === "contacts" && <ContactsView contacts={contacts} firms={firms} />}
              {view === "signals" && <SignalsView signals={signals} firms={firms} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
