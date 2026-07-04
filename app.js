/* ============================================================
   STATE
   ============================================================ */
const state = {
  user: null,
  view: "dashboard",
  product: null,
  scriptSteps: [],
  messages: [],
  history: [],
  stats: null,
  adminUsers: [],
  adminHistory: [],
  result: null,
  loadingChat: false,
  loadingAnalyze: false,
  loginError: "",
  loadingLogin: false,
  inputMode: "text",
  audioFile: null,
  charts: {},
};

/* ============================================================
   API HELPER
   ============================================================ */
async function api(method, url, body, isForm) {
  const opts = { method, headers: {} };
  if (body && !isForm) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  } else if (isForm) {
    opts.body = body;
  }
  const res = await fetch(url, opts);
  let data = {};
  try { data = await res.json(); } catch (e) {}
  if (!res.ok) throw new Error(data.error || `Xatolik (${res.status})`);
  return data;
}

function ikatSVG(color) {
  let s = "";
  for (let i = 0; i < 20; i++) {
    s += `<polyline points="${i*10},10 ${i*10+5},0 ${i*10+10},10" fill="none" stroke="${color}" stroke-width="1.4"/>`;
  }
  return s;
}
function scoreColor(v) { return v >= 75 ? "#2F6B4A" : v >= 45 ? "#C6992E" : "#8B2E2E"; }
function fmtDate(s) {
  try { return new Date(s.replace(" ", "T") + "Z").toLocaleString("uz-UZ"); } catch (e) { return s; }
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
}

/* ============================================================
   BOOTSTRAP
   ============================================================ */
async function boot() {
  try {
    const { user } = await api("GET", "/api/me");
    state.user = user;
  } catch (e) {
    state.user = null;
  }
  render();
}

/* ============================================================
   ROOT RENDER
   ============================================================ */
function render() {
  const root = document.getElementById("root");
  if (!state.user) {
    root.innerHTML = renderLogin();
    attachLoginHandlers();
    return;
  }
  root.innerHTML = renderShell();
  attachShellHandlers();
  renderView();
}

/* ============================================================
   LOGIN SCREEN
   ============================================================ */
function renderLogin() {
  return `
  <div class="login-wrap">
    <div class="login-card">
      <h1 class="serif">✦ SotuvAI</h1>
      <div class="sub">Sotuv menejeri yordamchisi — tizimga kiring</div>
      <form id="loginForm">
        <label>Login</label>
        <input type="text" id="loginUsername" autocomplete="username" required />
        <label>Parol</label>
        <input type="password" id="loginPassword" autocomplete="current-password" required />
        <button type="submit" class="btn-primary" ${state.loadingLogin ? "disabled" : ""}>
          ${state.loadingLogin ? "Tekshirilmoqda..." : "Kirish"}
        </button>
      </form>
      <div class="login-err">${state.loginError || ""}</div>
    </div>
  </div>`;
}

function attachLoginHandlers() {
  const form = document.getElementById("loginForm");
  form.onsubmit = async (e) => {
    e.preventDefault();
    const username = document.getElementById("loginUsername").value.trim();
    const password = document.getElementById("loginPassword").value;
    state.loadingLogin = true;
    state.loginError = "";
    render();
    try {
      const { user } = await api("POST", "/api/login", { username, password });
      state.user = user;
      state.view = "dashboard";
    } catch (err) {
      state.loginError = err.message;
    }
    state.loadingLogin = false;
    render();
  };
}

async function logout() {
  await api("POST", "/api/logout");
  state.user = null;
  state.view = "dashboard";
  render();
}

/* ============================================================
   APP SHELL (sidebar + main)
   ============================================================ */
function navItemsFor(role) {
  const common = [
    { id: "dashboard", label: "Bosh sahifa", icon: "📊" },
    { id: "chat", label: "Mahsulot AI", icon: "💬" },
    { id: "call", label: "Qo'ng'iroq tahlili", icon: "📞" },
  ];
  const adminOnly = [
    { id: "script", label: "Skript sozlamalari", icon: "📋" },
    { id: "users", label: "Foydalanuvchilar", icon: "👥" },
    { id: "adminHistory", label: "Barcha tarix", icon: "🗂️" },
  ];
  return role === "admin" ? [...common, ...adminOnly] : common;
}

function renderShell() {
  const items = navItemsFor(state.user.role);
  return `
  <div class="app">
    <div class="sidebar">
      <div class="brand">
        <div class="name">✦ SotuvAI</div>
        <div class="sub">Sotuv menejeri yordamchisi</div>
      </div>
      <svg class="ikat" viewBox="0 0 200 10" preserveAspectRatio="none">${ikatSVG("#C6992E")}</svg>
      <div class="nav">
        ${items.map(it => `
          <button data-view="${it.id}" class="${state.view===it.id?'active':''}">
            <span>${it.icon}</span><span class="lbl">${it.label}</span>
          </button>`).join("")}
      </div>
      <div class="foot">
        <div class="who">${esc(state.user.full_name || state.user.username)}</div>
        <div class="role">${state.user.role === "admin" ? "Administrator" : "Operator"}</div>
        <button id="changePwBtn" style="margin-top:6px;">🔒 Parolni almashtirish</button>
        <button id="logoutBtn">Chiqish</button>
      </div>
    </div>
    <div class="main" id="main"></div>
  </div>`;
}

function attachShellHandlers() {
  document.querySelectorAll(".nav button").forEach(b => {
    b.onclick = () => { state.view = b.dataset.view; state.result = null; render(); };
  });
  document.getElementById("logoutBtn").onclick = logout;
  document.getElementById("changePwBtn").onclick = openPasswordModal;
}

/* ============================================================
   O'Z PAROLINI ALMASHTIRISH (modal)
   ============================================================ */
function openPasswordModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.id = "pwOverlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="serif">Parolni almashtirish</h2>
      <div class="sub">Xavfsizlik uchun joriy parolingizni ham kiriting.</div>
      <label>Joriy parol</label>
      <input type="password" id="pw_current" />
      <label>Yangi parol</label>
      <input type="password" id="pw_new" />
      <label>Yangi parolni takrorlang</label>
      <input type="password" id="pw_confirm" />
      <div class="modal-actions">
        <button class="btn-outline" id="pw_cancel">Bekor qilish</button>
        <button class="btn-primary" id="pw_save">Saqlash</button>
      </div>
      <div class="modal-msg" id="pw_msg"></div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById("pw_cancel").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  document.getElementById("pw_save").onclick = async () => {
    const current = document.getElementById("pw_current").value;
    const next = document.getElementById("pw_new").value;
    const confirm = document.getElementById("pw_confirm").value;
    const msg = document.getElementById("pw_msg");
    if (!next || next.length < 4) { msg.textContent = "Yangi parol kamida 4 belgi bo'lsin"; msg.style.color = "var(--danger)"; return; }
    if (next !== confirm) { msg.textContent = "Parollar bir xil emas"; msg.style.color = "var(--danger)"; return; }
    msg.textContent = "Saqlanmoqda..."; msg.style.color = "var(--muted)";
    try {
      await api("PATCH", "/api/me/password", { currentPassword: current, newPassword: next });
      msg.textContent = "✔ Parol almashtirildi"; msg.style.color = "var(--success)";
      setTimeout(() => overlay.remove(), 900);
    } catch (e) {
      msg.textContent = e.message; msg.style.color = "var(--danger)";
    }
  };
}

/* ============================================================
   VIEW ROUTER
   ============================================================ */
async function renderView() {
  const main = document.getElementById("main");
  main.innerHTML = `<div class="page">Yuklanmoqda...</div>`;
  try {
    if (state.view === "dashboard") await loadAndRenderDashboard();
    else if (state.view === "chat") await loadAndRenderChat();
    else if (state.view === "call") await loadAndRenderCall();
    else if (state.view === "script") await loadAndRenderScript();
    else if (state.view === "users") await loadAndRenderUsers();
    else if (state.view === "adminHistory") await loadAndRenderAdminHistory();
  } catch (e) {
    main.innerHTML = `<div class="page"><div class="err">Yuklashda xatolik: ${esc(e.message)}</div></div>`;
  }
}

boot();

/* ============================================================
   DASHBOARD
   ============================================================ */
async function loadAndRenderDashboard() {
  const isAdmin = state.user.role === "admin";
  const url = isAdmin ? "/api/stats?all=1" : "/api/stats";
  const [statsRes, histRes] = await Promise.all([
    api("GET", url),
    api("GET", isAdmin ? "/api/admin/history" : "/api/history"),
  ]);
  state.stats = statsRes;
  state.history = isAdmin ? histRes.history : histRes.history;

  const t = state.stats.totals || {};
  const round = (v) => (v == null ? "—" : Math.round(v));
  const main = document.getElementById("main");
  main.innerHTML = `
  <div class="page">
    <h1>${isAdmin ? "Umumiy dashboard" : "Bosh sahifa"}</h1>
    <p class="desc">${isAdmin ? "Barcha operatorlar bo'yicha statistikasi." : "Sizning tahlillaringiz statistikasi."}</p>
    <svg class="ikat divider" viewBox="0 0 200 10" preserveAspectRatio="none">${ikatSVG("#C6992E")}</svg>

    <div class="stats">
      <div class="card"><div class="label">Tahlil qilingan qo'ng'iroqlar</div><div class="value" style="color:#0B1526">${t.count || 0}</div></div>
      <div class="card"><div class="label">O'rtacha halollik balli</div><div class="value" style="color:#C6992E">${round(t.avg_honesty)}</div></div>
      <div class="card"><div class="label">O'rtacha skript bajarilishi</div><div class="value" style="color:#2F6B4A">${t.avg_script!=null?round(t.avg_script)+"%":"—"}</div></div>
    </div>

    <div class="charts">
      <div class="chart-card">
        <div class="title">So'nggi 14 kunlik dinamika</div>
        <canvas id="trendChart" height="180"></canvas>
      </div>
      <div class="chart-card">
        <div class="title">O'rtacha ko'rsatkichlar (6 mezon)</div>
        <canvas id="radarChart" height="180"></canvas>
      </div>
    </div>

    <h2 class="serif" style="font-size:18px;margin-top:32px;">So'nggi tahlillar</h2>
    <div id="historyList">
      ${state.history.length === 0
        ? `<div class="empty">Hozircha tahlil yo'q. <a id="goCall">Birinchi qo'ng'iroqni tahlil qiling</a></div>`
        : state.history.slice(0, 8).map(h => `
          <div class="history-item" data-id="${h.id}">
            <div><div class="t">${esc(h.title || "Qo'ng'iroq")}${h.full_name ? " — " + esc(h.full_name) : ""}</div><div class="tm">${fmtDate(h.created_at)}</div></div>
            <div>
              <span style="color:#2F6B4A;margin-right:14px;">${h.script_completion}% skript</span>
              <span style="color:${scoreColor(h.honesty_score)}">${h.honesty_score} halollik</span>
            </div>
          </div>`).join("")
      }
    </div>
  </div>`;

  const goCall = document.getElementById("goCall");
  if (goCall) goCall.onclick = () => { state.view = "call"; render(); };
  document.querySelectorAll(".history-item").forEach(el => {
    el.onclick = () => openHistoryDetail(+el.dataset.id);
  });

  drawDashboardCharts();
}

function drawDashboardCharts() {
  if (state.charts.trend) state.charts.trend.destroy();
  if (state.charts.radar) state.charts.radar.destroy();

  const byDay = state.stats.byDay || [];
  const trendCtx = document.getElementById("trendChart");
  state.charts.trend = new Chart(trendCtx, {
    type: "line",
    data: {
      labels: byDay.map(d => d.day),
      datasets: [
        { label: "Halollik", data: byDay.map(d => Math.round(d.avg_honesty || 0)), borderColor: "#C6992E", backgroundColor: "#C6992E33", tension: .3 },
        { label: "Skript bajarilishi", data: byDay.map(d => Math.round(d.avg_script || 0)), borderColor: "#2F6B4A", backgroundColor: "#2F6B4A33", tension: .3 },
      ],
    },
    options: { responsive: true, scales: { y: { min: 0, max: 100 } }, plugins: { legend: { position: "bottom" } } },
  });

  const t = state.stats.totals || {};
  const radarCtx = document.getElementById("radarChart");
  state.charts.radar = new Chart(radarCtx, {
    type: "radar",
    data: {
      labels: ["Halollik", "Skript", "Ishonch", "Muloyimlik", "Bilim", "Yopish"],
      datasets: [{
        label: "O'rtacha",
        data: [t.avg_honesty, t.avg_script, t.avg_confidence, t.avg_politeness, t.avg_knowledge, t.avg_closing].map(v => Math.round(v || 0)),
        backgroundColor: "#C6992E33", borderColor: "#C6992E", pointBackgroundColor: "#0B1526",
      }],
    },
    options: { responsive: true, scales: { r: { min: 0, max: 100 } }, plugins: { legend: { display: false } } },
  });
}

async function openHistoryDetail(id) {
  try {
    const { call } = await api("GET", `/api/history/${id}`);
    state.result = call;
    state.view = "call";
    render();
  } catch (e) { alert(e.message); }
}

/* ============================================================
   CALL ANALYSIS
   ============================================================ */
async function loadAndRenderCall() {
  if (!state.scriptSteps.length) {
    const { scriptSteps } = await api("GET", "/api/script");
    state.scriptSteps = scriptSteps;
  }
  renderCallView();
}

function progressRingSVG(pct) {
  const r = 30, c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return `
  <div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 0;">
    <svg width="76" height="76" viewBox="0 0 76 76">
      <circle cx="38" cy="38" r="${r}" stroke="#EFE8D2" stroke-width="7" fill="none"/>
      <circle cx="38" cy="38" r="${r}" stroke="#C6992E" stroke-width="7" fill="none"
        stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
        transform="rotate(-90 38 38)" style="transition:stroke-dashoffset .3s linear"/>
      <text x="38" y="43" text-anchor="middle" font-size="15" font-weight="700" fill="#0B1526" font-family="Fraunces,serif">${pct}%</text>
    </svg>
    <div style="font-size:12px;color:var(--muted);">Tahlil qilinmoqda...</div>
  </div>`;
}

function startFakeProgress() {
  state.analyzeProgress = 3;
  if (state._progressTimer) clearInterval(state._progressTimer);
  state._progressTimer = setInterval(() => {
    // Sekinlashib boradi, 92% dan oshmaydi — haqiqiy tugash bilan almashtiriladi
    const step = state.analyzeProgress < 50 ? 6 : state.analyzeProgress < 80 ? 2 : 0.5;
    state.analyzeProgress = Math.min(92, state.analyzeProgress + step);
    const holder = document.getElementById("progressHolder");
    if (holder) holder.innerHTML = progressRingSVG(Math.round(state.analyzeProgress));
  }, 350);
}
function stopFakeProgress() {
  if (state._progressTimer) clearInterval(state._progressTimer);
  state._progressTimer = null;
  state.analyzeProgress = 0;
}

function renderCallView() {
  const main = document.getElementById("main");
  main.innerHTML = `
  <div class="page">
    <h1>Qo'ng'iroq tahlili</h1>
    <p class="desc">Qo'ng'iroq matnini yoki audio faylini yuklang — AI skript bo'yicha solishtirib, 6 mezon bo'yicha baholaydi.</p>
    <svg class="ikat divider" viewBox="0 0 200 10" preserveAspectRatio="none">${ikatSVG("#C6992E")}</svg>

    <div class="script-note">
      Skript bosqichlari (admin tomonidan belgilangan):
      <ol>${state.scriptSteps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
    </div>

    <div class="cols">
      <div>
        <div class="mode-toggle">
          <button class="mode-btn ${state.inputMode==='text'?'active':''}" data-mode="text">✎ Matn</button>
          <button class="mode-btn ${state.inputMode==='audio'?'active':''}" data-mode="audio">🎙 Audio fayl</button>
        </div>
        ${state.inputMode === "text" ? `
          <textarea class="transcript" id="transcript" rows="9" placeholder="Menejer: Assalomu alaykum...&#10;Mijoz: ..."></textarea>
        ` : `
          <div class="audio-drop" id="audioDrop">
            <input type="file" id="audioFile" accept="audio/*" style="display:none;" />
            ${state.audioFile
              ? `<div class="audio-picked">🎧 ${esc(state.audioFile.name)} <button id="removeAudio">✕</button></div>`
              : `<div class="audio-hint">Audio faylni tanlash uchun bosing<br><span>mp3, wav, m4a, ogg — 20MB gacha</span></div>`}
          </div>
          ${state.audioFile ? `<audio controls src="${state.audioUrl}" style="width:100%;margin-top:10px;"></audio>` : ""}
        `}
        <div id="progressHolder">
          ${state.loadingAnalyze
            ? progressRingSVG(Math.round(state.analyzeProgress || 0))
            : `<button class="btn-primary btn-analyze" id="analyzeBtn">📞 Tahlil qilish</button>`}
        </div>
        <div id="analyzeErr" class="err"></div>
      </div>
      <div id="resultCol">
        ${state.result ? renderResult(state.result) : `<div class="empty" style="height:100%;display:flex;align-items:center;justify-content:center;">Natija shu yerda ko'rinadi.</div>`}
      </div>
    </div>
  </div>`;
  attachCallHandlers();
}

const SCORE_LABELS = [
  ["honesty_score", "Halollik"],
  ["script_completion", "Skript bajarilishi"],
  ["confidence_score", "Ishonch"],
  ["politeness_score", "Muloyimlik"],
  ["product_knowledge_score", "Mahsulot bilimi"],
  ["closing_skill_score", "Yopish mahorati"],
];

function renderResult(r) {
  return `
    <div class="score-grid">
      ${SCORE_LABELS.map(([key, label]) => `
        <div class="score-item">
          <div class="lbl"><span>${label}</span><span>${r[key] ?? "—"}</span></div>
          <div class="score-bar"><div style="width:${r[key]||0}%;background:${scoreColor(r[key]||0)}"></div></div>
        </div>`).join("")}
    </div>

    <div class="result-card">
      <div class="title">Xulosa</div>
      <p style="font-size:14px;color:#4B4536;margin:0;">${esc(r.summary || "")}</p>
    </div>

    <div class="result-card">
      <div class="title">Skript bo'yicha bosqichlar</div>
      ${(r.steps||[]).map(s => `
        <div class="step-line">
          <span style="color:${s.completed?'#2F6B4A':'#8B2E2E'}">${s.completed?"✔":"✕"}</span>
          <div><div>${esc(s.step)}</div>${s.note?`<div style="font-size:12px;color:#8A8371;">${esc(s.note)}</div>`:""}</div>
        </div>`).join("")}
    </div>

    ${(r.issues && r.issues.length) ? `
    <div class="result-card">
      <div class="title">Aniqlangan xatolar</div>
      ${r.issues.map(iss => {
        const c = iss.severity==="yuqori"?"#8B2E2E":iss.severity==="o'rta"?"#C6992E":"#9AA3BD";
        return `<div class="issue" style="border-color:${c}">
          <div class="sev" style="color:${c}">⚠ ${esc(iss.severity||"")} darajali</div>
          <div class="quote">"${esc(iss.quote||"")}"</div>
          <div class="row"><b>Nima xato edi:</b> ${esc(iss.what_was_wrong||"")}</div>
          <div class="row"><b>Nega xato:</b> ${esc(iss.why_wrong||"")}</div>
          <div class="row"><b>To'g'ri versiyasi:</b> ${esc(iss.correct_version||"")}</div>
        </div>`;
      }).join("")}
    </div>` : ""}
  `;
}

function attachCallHandlers() {
  document.querySelectorAll(".mode-btn").forEach(btn => {
    btn.onclick = () => { state.inputMode = btn.dataset.mode; renderCallView(); };
  });

  const audioDrop = document.getElementById("audioDrop");
  const audioFileInput = document.getElementById("audioFile");
  if (audioDrop && audioFileInput) {
    audioDrop.onclick = (e) => { if (e.target.id !== "removeAudio") audioFileInput.click(); };
    audioFileInput.onchange = () => {
      if (audioFileInput.files[0]) {
        if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
        state.audioFile = audioFileInput.files[0];
        state.audioUrl = URL.createObjectURL(state.audioFile);
        renderCallView();
      }
    };
  }
  const removeAudio = document.getElementById("removeAudio");
  if (removeAudio) removeAudio.onclick = (e) => {
    e.stopPropagation();
    if (state.audioUrl) URL.revokeObjectURL(state.audioUrl);
    state.audioFile = null; state.audioUrl = null;
    renderCallView();
  };

  const transcriptEl = document.getElementById("transcript");
  const analyzeBtn = document.getElementById("analyzeBtn");
  if (!analyzeBtn) return;
  analyzeBtn.onclick = async () => {
    const errEl = document.getElementById("analyzeErr");
    errEl.textContent = "";
    if (state.inputMode === "text") {
      const t = transcriptEl.value.trim();
      if (!t || state.loadingAnalyze) return;
      state.loadingAnalyze = true; state.result = null; renderCallView(); startFakeProgress();
      try {
        const r = await api("POST", "/api/analyze", { transcript: t });
        state.result = r;
      } catch (e) {
        document.getElementById("analyzeErr").textContent = e.message;
      }
      stopFakeProgress(); state.loadingAnalyze = false; renderCallView();
    } else {
      if (!state.audioFile || state.loadingAnalyze) return;
      state.loadingAnalyze = true; state.result = null; renderCallView(); startFakeProgress();
      try {
        const form = new FormData();
        form.append("audio", state.audioFile);
        const r = await api("POST", "/api/analyze-audio", form, true);
        state.result = r;
      } catch (e) {
        document.getElementById("analyzeErr").textContent = e.message;
      }
      stopFakeProgress(); state.loadingAnalyze = false; renderCallView();
    }
  };
}
async function loadAndRenderChat() {
  const [{ product }, { messages }] = await Promise.all([
    api("GET", "/api/product"),
    api("GET", "/api/chat/history"),
  ]);
  state.product = product;
  state.messages = messages.map(m => ({ role: m.role, text: m.content }));
  renderChatView();
}

function renderChatView() {
  const main = document.getElementById("main");
  main.innerHTML = `
  <div class="page chat-wrap">
    <div class="chat-top">
      <div>
        <h1>Mahsulot AI</h1>
        <p class="desc">Operator savol beradi, AI mahsulot ma'lumoti asosida javob beradi — <b>${esc(state.product?.name || "")}</b>.</p>
      </div>
    </div>
    <svg class="ikat divider" viewBox="0 0 200 10" preserveAspectRatio="none">${ikatSVG("#C6992E")}</svg>
    <div class="messages" id="messages">
      ${state.messages.length === 0 ? `<div style="color:#8A8371;font-size:14px;">Masalan: "Bu mahsulotning narxi qancha va nima uchun boshqalardan farq qiladi?"</div>` : ""}
      ${state.messages.map(m => `<div class="msg ${m.role==='user'?'user':'ai'}">${esc(m.text)}</div>`).join("")}
      ${state.loadingChat ? `<div class="typing">yozmoqda...</div>` : ""}
    </div>
    <div class="chat-input">
      <input type="text" id="chatInput" placeholder="Savolingizni yozing..." />
      <button class="btn-send" id="sendChat">➤</button>
    </div>
  </div>`;

  const box = document.getElementById("messages");
  box.scrollTop = box.scrollHeight;

  const sendChat = document.getElementById("sendChat");
  const chatInput = document.getElementById("chatInput");
  const send = async () => {
    const val = chatInput.value.trim();
    if (!val || state.loadingChat) return;
    state.messages.push({ role: "user", text: val });
    chatInput.value = "";
    state.loadingChat = true;
    renderChatView();
    document.getElementById("chatInput").focus();
    try {
      const { reply } = await api("POST", "/api/chat", { message: val });
      state.messages.push({ role: "assistant", text: reply });
    } catch (e) {
      state.messages.push({ role: "assistant", text: "Xatolik: " + e.message });
    }
    state.loadingChat = false;
    renderChatView();
  };
  sendChat.onclick = send;
  chatInput.onkeydown = (e) => { if (e.key === "Enter") send(); };
  chatInput.focus();
}


/* ============================================================
   ADMIN: SCRIPT MANAGEMENT
   ============================================================ */
async function loadAndRenderScript() {
  const { scriptSteps } = await api("GET", "/api/admin/script");
  state.scriptSteps = scriptSteps;
  renderScriptView();
}

function renderScriptView() {
  const main = document.getElementById("main");
  main.innerHTML = `
  <div class="page">
    <h1>Skript sozlamalari</h1>
    <p class="desc">Qo'ng'iroq tahlilida AI shu bosqichlar bilan solishtiradi.</p>
    <svg class="ikat divider" viewBox="0 0 200 10" preserveAspectRatio="none">${ikatSVG("#C6992E")}</svg>
    <div style="max-width:560px;margin-top:20px;">
      <div id="stepsList">
        ${state.scriptSteps.map((s,i)=>`<div class="step-row"><span>${i+1}. ${esc(s)}</span><button data-i="${i}" class="rmStep">✕</button></div>`).join("")}
      </div>
      <div class="add-step">
        <input type="text" id="newStep" placeholder="Yangi bosqich qo'shish..." />
        <button id="addStep">+</button>
      </div>
      <button class="btn-primary" id="saveScript">Saqlash</button>
      <div id="scriptMsg" style="font-size:13px;margin-top:8px;"></div>
    </div>
  </div>`;

  document.querySelectorAll(".rmStep").forEach(btn => {
    btn.onclick = () => { state.scriptSteps.splice(+btn.dataset.i, 1); renderScriptView(); };
  });
  const addStep = document.getElementById("addStep");
  const newStep = document.getElementById("newStep");
  const add = () => { if (newStep.value.trim()) { state.scriptSteps.push(newStep.value.trim()); renderScriptView(); } };
  addStep.onclick = add;
  newStep.onkeydown = (e) => { if (e.key === "Enter") add(); };

  document.getElementById("saveScript").onclick = async () => {
    const msg = document.getElementById("scriptMsg");
    try {
      await api("PUT", "/api/admin/script", { scriptSteps: state.scriptSteps });
      msg.textContent = "✔ Saqlandi";
      msg.style.color = "var(--success)";
    } catch (e) {
      msg.textContent = "Xatolik: " + e.message;
      msg.style.color = "var(--danger)";
    }
  };
}

/* ============================================================
   ADMIN: USER MANAGEMENT
   ============================================================ */
async function loadAndRenderUsers() {
  const { users } = await api("GET", "/api/admin/users");
  state.adminUsers = users;
  const main = document.getElementById("main");
  main.innerHTML = `
  <div class="page">
    <h1>Foydalanuvchilar</h1>
    <p class="desc">Operatorlar va administratorlarni boshqaring.</p>
    <svg class="ikat divider" viewBox="0 0 200 10" preserveAspectRatio="none">${ikatSVG("#C6992E")}</svg>
    <table>
      <tr><th>Ism</th><th>Login</th><th>Rol</th><th>Holat</th><th></th></tr>
      ${state.adminUsers.map(u => `
        <tr>
          <td>${esc(u.full_name)}</td>
          <td>${esc(u.username)}</td>
          <td><span class="pill ${u.role}">${u.role==='admin'?'Administrator':'Operator'}</span></td>
          <td>${u.active ? '<span class="pill operator">Faol</span>' : '<span class="pill inactive">O\'chirilgan</span>'}</td>
          <td>
            <button class="btn-outline resetPw" data-id="${u.id}" data-name="${esc(u.full_name)}">Parol</button>
            <button class="btn-outline toggleActive" data-id="${u.id}" data-active="${u.active}">${u.active?'O\'chirish':'Yoqish'}</button>
            <button class="btn-danger delUser" data-id="${u.id}">O'chirish</button>
          </td>
        </tr>`).join("")}
    </table>

    <div class="add-user-form">
      <input type="text" id="nu_name" placeholder="To'liq ism" />
      <input type="text" id="nu_username" placeholder="Login" />
      <input type="password" id="nu_password" placeholder="Parol (kamida 4 belgi)" />
      <select id="nu_role">
        <option value="operator">Operator</option>
        <option value="admin">Administrator</option>
      </select>
      <button class="btn-primary" id="addUserBtn">Qo'shish</button>
    </div>
    <div id="usersMsg" style="font-size:13px;margin-top:8px;"></div>
  </div>`;

  document.querySelectorAll(".resetPw").forEach(btn => {
    btn.onclick = () => openResetPasswordModal(btn.dataset.id, btn.dataset.name);
  });
  document.querySelectorAll(".toggleActive").forEach(btn => {
    btn.onclick = async () => {
      await api("PATCH", `/api/admin/users/${btn.dataset.id}/active`, { active: btn.dataset.active !== "1" });
      loadAndRenderUsers();
    };
  });
  document.querySelectorAll(".delUser").forEach(btn => {
    btn.onclick = async () => {
      if (!confirm("Ushbu foydalanuvchini o'chirmoqchimisiz?")) return;
      try { await api("DELETE", `/api/admin/users/${btn.dataset.id}`); loadAndRenderUsers(); }
      catch (e) { alert(e.message); }
    };
  });
  document.getElementById("addUserBtn").onclick = async () => {
    const msg = document.getElementById("usersMsg");
    try {
      await api("POST", "/api/admin/users", {
        full_name: document.getElementById("nu_name").value,
        username: document.getElementById("nu_username").value,
        password: document.getElementById("nu_password").value,
        role: document.getElementById("nu_role").value,
      });
      loadAndRenderUsers();
    } catch (e) {
      msg.textContent = "Xatolik: " + e.message;
      msg.style.color = "var(--danger)";
    }
  };
}

/* ============================================================
   ADMIN: FOYDALANUVCHI PAROLINI ALMASHTIRISH (modal)
   ============================================================ */
function openResetPasswordModal(userId, userName) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-box">
      <h2 class="serif">Parolni almashtirish</h2>
      <div class="sub">${esc(userName)} uchun yangi parol o'rnatiladi.</div>
      <label>Yangi parol</label>
      <input type="password" id="rp_new" />
      <label>Yangi parolni takrorlang</label>
      <input type="password" id="rp_confirm" />
      <div class="modal-actions">
        <button class="btn-outline" id="rp_cancel">Bekor qilish</button>
        <button class="btn-primary" id="rp_save">Saqlash</button>
      </div>
      <div class="modal-msg" id="rp_msg"></div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("rp_cancel").onclick = () => overlay.remove();
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  document.getElementById("rp_save").onclick = async () => {
    const next = document.getElementById("rp_new").value;
    const confirm = document.getElementById("rp_confirm").value;
    const msg = document.getElementById("rp_msg");
    if (!next || next.length < 4) { msg.textContent = "Parol kamida 4 belgi bo'lsin"; msg.style.color = "var(--danger)"; return; }
    if (next !== confirm) { msg.textContent = "Parollar bir xil emas"; msg.style.color = "var(--danger)"; return; }
    msg.textContent = "Saqlanmoqda..."; msg.style.color = "var(--muted)";
    try {
      await api("PATCH", `/api/admin/users/${userId}/password`, { password: next });
      msg.textContent = "✔ Parol almashtirildi"; msg.style.color = "var(--success)";
      setTimeout(() => overlay.remove(), 900);
    } catch (e) {
      msg.textContent = e.message; msg.style.color = "var(--danger)";
    }
  };
}

/* ============================================================
   ADMIN: ALL HISTORY
   ============================================================ */
async function loadAndRenderAdminHistory() {
  const { history } = await api("GET", "/api/admin/history");
  state.adminHistory = history;
  const main = document.getElementById("main");
  main.innerHTML = `
  <div class="page">
    <h1>Barcha tarix</h1>
    <p class="desc">Barcha operatorlarning barcha tahlillari.</p>
    <svg class="ikat divider" viewBox="0 0 200 10" preserveAspectRatio="none">${ikatSVG("#C6992E")}</svg>
    <div id="allHistoryList">
      ${state.adminHistory.length === 0
        ? `<div class="empty">Hozircha tahlil yo'q.</div>`
        : state.adminHistory.map(h => `
          <div class="history-item" data-id="${h.id}">
            <div><div class="t">${esc(h.full_name)} — ${esc(h.title || "Qo'ng'iroq")}</div><div class="tm">${fmtDate(h.created_at)}</div></div>
            <div>
              <span style="color:#2F6B4A;margin-right:14px;">${h.script_completion}% skript</span>
              <span style="color:${scoreColor(h.honesty_score)}">${h.honesty_score} halollik</span>
            </div>
          </div>`).join("")}
    </div>
  </div>`;
  document.querySelectorAll(".history-item").forEach(el => {
    el.onclick = () => openHistoryDetail(+el.dataset.id);
  });
}
