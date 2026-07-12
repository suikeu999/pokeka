const DB_NAME = "pokeca-record-note";
const DB_VERSION = 2;
const app = document.querySelector("#app");
const nav = document.querySelector(".bottom-nav");
const newTournamentButton = document.querySelector("#new-tournament");
const saveTournamentButton = document.querySelector("#save-tournament");

const db = {
  instance: null,
  async open() {
    if (this.instance) return this.instance;
    this.instance = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("tournaments")) database.createObjectStore("tournaments", { keyPath: "id" });
        if (!database.objectStoreNames.contains("decks")) database.createObjectStore("decks", { keyPath: "id" });
        if (!database.objectStoreNames.contains("opponents")) {
          const opponentStore = database.createObjectStore("opponents", { keyPath: "id" });
          if (request.oldVersion >= 1) {
            const existingRecords = request.transaction.objectStore("tournaments").getAll();
            existingRecords.onsuccess = () => {
              const names = new Set(existingRecords.result.flatMap((tournament) => (tournament.matches || []).map((match) => match.opponent?.trim()).filter(Boolean)));
              names.forEach((name) => opponentStore.put({ id: uuid(), name, createdAt: new Date().toISOString() }));
            };
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.instance;
  },
  async all(storeName) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async get(storeName, id) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async put(storeName, item) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readwrite").objectStore(storeName).put(item);
      request.onsuccess = () => resolve(item);
      request.onerror = () => reject(request.error);
    });
  },
  async remove(storeName, id) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(storeName, "readwrite").objectStore(storeName).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },
  async replaceAll({ tournaments, decks, opponents = [] }) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(["tournaments", "decks", "opponents"], "readwrite");
      ["tournaments", "decks", "opponents"].forEach((storeName) => {
        const store = transaction.objectStore(storeName);
        store.clear();
        (storeName === "tournaments" ? tournaments : storeName === "decks" ? decks : opponents).forEach((item) => store.put(item));
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }
};

const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const today = () => new Date().toISOString().slice(0, 10);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[char]);
const formatDate = (date) => date ? new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "short", day: "numeric" }).format(new Date(`${date}T00:00:00`)) : "日付未設定";
const dateParts = (date) => { const d = new Date(`${date || today()}T00:00:00`); return { month: `${d.getMonth() + 1}月`, day: d.getDate() }; };
const resultLabel = (result) => ({ win: "勝ち", loss: "負け", draw: "引き分け" }[result] || "未記録");
const typeLabel = (type) => ({ city: "シティリーグ", cl: "CL", gym: "ジムバトル", independent: "自主大会" }[type] || type || "大会");
const resultClass = (result) => result === "win" ? "result-win" : result === "loss" ? "result-loss" : "result-draw";
const flatMatches = (tournaments) => tournaments.flatMap((tournament) => (tournament.matches || []).map((match) => ({ ...match, tournament })));

function calculate(matches) {
  const wins = matches.filter((match) => match.result === "win").length;
  const losses = matches.filter((match) => match.result === "loss").length;
  const draws = matches.filter((match) => match.result === "draw").length;
  const decided = wins + losses;
  return { total: matches.length, wins, losses, draws, rate: decided ? Math.round((wins / decided) * 1000) / 10 : null };
}

function emptyState(title, message, actionText = "記録する") {
  return `<div class="empty card"><div class="empty-symbol">◌</div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><button class="button button-primary" data-action="new-tournament">${escapeHtml(actionText)}</button></div>`;
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function dataSet() {
  const [tournaments, decks, opponents] = await Promise.all([db.all("tournaments"), db.all("decks"), db.all("opponents")]);
  return {
    tournaments: tournaments.sort((a, b) => (b.date || "").localeCompare(a.date || "")),
    decks: decks.sort((a, b) => a.name.localeCompare(b.name, "ja")),
    opponents: opponents.sort((a, b) => a.name.localeCompare(b.name, "ja"))
  };
}

function updateNav(route) {
  const mainRoute = route.startsWith("tournament") ? "tournaments" : route || "home";
  nav.querySelectorAll("a").forEach((link) => link.classList.toggle("active", link.dataset.nav === mainRoute));
}

function updateHeaderActions(route) {
  saveTournamentButton.hidden = !route.startsWith("tournament/");
}

async function render() {
  const route = (location.hash.slice(1) || "home").split("?")[0];
  updateNav(route);
  updateHeaderActions(route);
  const data = await dataSet();
  if (route === "home") renderHome(data);
  else if (route === "tournaments") renderTournaments(data);
  else if (route === "tournament/new") renderTournamentForm(data);
  else if (route.startsWith("tournament/")) renderTournamentForm(data, route.split("/")[1]);
  else if (route === "analysis") renderAnalysis(data);
  else if (route === "settings") renderSettings(data);
  else location.hash = "home";
  app.focus({ preventScroll: true });
}

function renderHome({ tournaments }) {
  const matches = flatMatches(tournaments);
  const stats = calculate(matches);
  const latest = tournaments.slice(0, 4);
  const recentMatches = matches.sort((a, b) => (b.tournament.date || "").localeCompare(a.tournament.date || "")).slice(0, 5);
  app.innerHTML = `
    <section class="page-heading">
      <div><h1>戦績のダッシュボード</h1><p>大会結果を記録して、次の一戦に活かしましょう。</p></div>
      <button class="button button-primary" data-action="new-tournament">記録</button>
    </section>
    <section class="stats-grid" aria-label="成績の概要">
      <article class="card stat-card"><span class="stat-label">総対戦数</span><strong class="stat-value">${stats.total}</strong><span class="stat-sub">記録済み対戦</span></article>
      <article class="card stat-card"><span class="stat-label">勝率</span><strong class="stat-value">${stats.rate === null ? "—" : `${stats.rate}%`}</strong><span class="stat-sub">引き分けを除く</span></article>
      <article class="card stat-card"><span class="stat-label">勝敗</span><strong class="stat-value">${stats.wins}-${stats.losses}</strong><span class="stat-sub">引き分け ${stats.draws}</span></article>
      <article class="card stat-card"><span class="stat-label">参加大会数</span><strong class="stat-value">${tournaments.length}</strong><span class="stat-sub">シティ・CL・ジム・自主大会</span></article>
    </section>
    ${tournaments.length ? `<section class="home-grid">
      <article class="card section-card"><div class="section-title"><h2>最近の大会</h2><a class="section-link" href="#tournaments">すべて見る →</a></div>
        <div class="list">${latest.map(tournamentRow).join("")}</div>
      </article>
      <article class="card section-card"><div class="section-title"><h2>直近の対戦</h2></div>
        <div class="record-list">${recentMatches.length ? recentMatches.map((match) => `<div class="record-item"><div><strong>${escapeHtml(match.opponent || "相手デッキ未入力")}</strong><span>${formatDate(match.tournament.date)} · ${escapeHtml(match.tournament.name)}</span></div><b class="${resultClass(match.result)}">${resultLabel(match.result)}</b></div>`).join("") : "<p class=\"event-meta\">まだ対戦の記録がありません。</p>"}</div>
      </article>
    </section>` : emptyState("最初の大会を記録しましょう", "大会と対戦結果を保存すると、勝率や相性をあとから分析できます。")}`;
  bindCommonActions();
}

function tournamentRow(tournament) {
  const d = dateParts(tournament.date);
  const stats = calculate(tournament.matches || []);
  return `<a class="event-row" href="#tournament/${encodeURIComponent(tournament.id)}"><div class="event-date"><span>${d.month}</span><b>${d.day}</b></div><div><div class="event-name">${escapeHtml(tournament.name)}</div><div class="event-meta">${typeLabel(tournament.type)} · ${escapeHtml(tournament.deck || "デッキ未入力")}</div></div><div><span class="result-badge">${stats.total ? `${stats.wins}-${stats.losses}${stats.draws ? `-${stats.draws}` : ""}` : "記録なし"}</span></div></a>`;
}

function renderTournaments({ tournaments }) {
  app.innerHTML = `<section class="page-heading"><div><h1>大会記録</h1><p>大会ごとの結果と振り返りを管理します。</p></div><button class="button button-primary" data-action="new-tournament">記録</button></section>
    ${tournaments.length ? `<div class="toolbar"><input id="event-search" type="search" placeholder="大会名・デッキ名で検索" aria-label="大会を検索"></div><div class="tournament-list" id="tournament-list">${tournaments.map(tournamentCard).join("")}</div>` : emptyState("大会記録はまだありません", "右上のボタンから、最初の大会と対戦結果を追加できます。")}`;
  document.querySelector("#event-search")?.addEventListener("input", (event) => {
    const needle = event.target.value.trim().toLowerCase();
    document.querySelector("#tournament-list").innerHTML = tournaments.filter((item) => `${item.name} ${item.deck} ${typeLabel(item.type)}`.toLowerCase().includes(needle)).map(tournamentCard).join("") || `<div class="empty card"><p>条件に一致する大会はありません。</p></div>`;
  });
  bindCommonActions();
}

function tournamentCard(tournament) {
  const d = dateParts(tournament.date);
  const stats = calculate(tournament.matches || []);
  return `<a href="#tournament/${encodeURIComponent(tournament.id)}" class="card tournament-card"><div class="date-block"><span>${d.month}</span><b>${d.day}</b></div><div><h2>${escapeHtml(tournament.name)}</h2><p>${typeLabel(tournament.type)} · ${escapeHtml(tournament.deck || "デッキ未入力")} ${tournament.rank ? `· ${escapeHtml(tournament.rank)}` : ""}</p></div><div class="tournament-side"><span class="type-badge">${typeLabel(tournament.type)}</span><b class="${stats.wins >= stats.losses ? "result-win" : "result-loss"}">${stats.total ? `${stats.wins}勝 ${stats.losses}敗${stats.draws ? ` ${stats.draws}分` : ""}` : "対戦未記録"}</b></div></a>`;
}

function renderTournamentForm({ decks, tournaments, opponents: savedOpponents }, id) {
  const tournament = id ? tournaments.find((item) => item.id === id) : null;
  if (id && !tournament) { location.hash = "tournaments"; return; }
  const item = tournament || { id: uuid(), date: today(), type: "gym", name: "", deck: "", rank: "", notes: "", matches: [] };
  const opponents = savedOpponents.map((opponent) => opponent.name);
  app.innerHTML = `<section class="page-heading"><div><h1>${tournament ? "大会記録を編集" : "大会を記録"}</h1><p>結果の詳細は対戦ごとに追加できます。</p></div><a href="#tournaments" class="button">一覧に戻る</a></section>
    <form id="tournament-form" class="form-layout" novalidate>
      <section class="card form-card"><h2>大会情報</h2>
        <div class="field-grid">
          <div class="field"><label for="date">日付</label><input id="date" name="date" type="date" required value="${escapeHtml(item.date)}"></div>
          <div class="field"><label for="type">大会種別</label><select id="type" name="type"><option value="city" ${item.type === "city" ? "selected" : ""}>シティリーグ</option><option value="cl" ${item.type === "cl" ? "selected" : ""}>CL</option><option value="gym" ${item.type === "gym" ? "selected" : ""}>ジムバトル</option><option value="independent" ${item.type === "independent" ? "selected" : ""}>自主大会</option></select></div>
          <div class="field full"><label for="name">大会名</label><input id="name" name="name" required maxlength="100" placeholder="例：シティリーグ S4 東京" value="${escapeHtml(item.name)}"></div>
          <div class="field"><label for="deck">使用デッキ</label><input id="deck" name="deck" list="deck-options" maxlength="80" placeholder="例：サーナイトex" value="${escapeHtml(item.deck)}"><datalist id="deck-options">${decks.map((deck) => `<option value="${escapeHtml(deck.name)}"></option>`).join("")}</datalist></div>
          <div class="field"><label for="rank">最終順位（任意）</label><input id="rank" name="rank" maxlength="50" placeholder="例：ベスト8、12位" value="${escapeHtml(item.rank)}"></div>
          <div class="field full"><label for="notes">大会メモ（任意）</label><textarea id="notes" name="notes" placeholder="大会全体の振り返りなど">${escapeHtml(item.notes)}</textarea></div>
        </div>
        <div class="form-actions">${tournament ? '<button type="button" class="button button-danger" data-action="delete-tournament">この大会を削除</button>' : ""}<button type="submit" class="button button-primary">保存する</button></div>
      </section>
      <section class="card form-card"><div class="matches-head"><div><h2>対戦結果</h2><span class="event-meta">対戦後に必要な項目だけ入力できます。</span></div><button type="button" class="button button-small" id="add-match">＋ 対戦を追加</button></div><p id="match-error" class="form-error" role="alert" hidden></p><div id="match-list"></div><datalist id="opponent-options">${opponents.map((name) => `<option value="${escapeHtml(name)}"></option>`).join("")}</datalist></section>
    </form>`;
  const matchList = document.querySelector("#match-list");
  const addMatch = (match = {}) => {
    const number = matchList.children.length + 1;
    matchList.insertAdjacentHTML("beforeend", matchTemplate(match, number));
    bindMatchButtons();
  };
  (item.matches || []).forEach((match) => addMatch(match));
  document.querySelector("#add-match").addEventListener("click", () => addMatch());
  document.querySelector("#tournament-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const matches = [...matchList.querySelectorAll(".match-card")].map((card, index) => ({
      id: card.dataset.id || uuid(), round: index + 1,
      opponent: card.querySelector('[name="opponent"]').value.trim(), result: card.querySelector('[name="result"]').value,
      turn: card.querySelector('[name="turn"]').value, ownSides: numberOrBlank(card.querySelector('[name="ownSides"]').value), opponentSides: numberOrBlank(card.querySelector('[name="opponentSides"]').value), notes: card.querySelector('[name="matchNotes"]').value.trim()
    }));
    const invalidMatches = matches.map((match, index) => ({ match, index })).filter(({ match }) => {
      if (match.ownSides === "" || match.opponentSides === "") return false;
      return (match.result === "win" && match.ownSides >= match.opponentSides) || (match.result === "loss" && match.ownSides <= match.opponentSides);
    });
    document.querySelectorAll(".match-card").forEach((card) => card.classList.remove("has-error"));
    if (invalidMatches.length) {
      const matchesLabel = invalidMatches.map(({ index }) => `${index + 1}戦目`).join("、");
      const error = document.querySelector("#match-error");
      error.textContent = `${matchesLabel}：勝敗と残りサイド数が一致していません。勝ちなら自分の残りサイド数が少なく、負けなら相手の残りサイド数が少なくなるよう修正してください。`;
      error.hidden = false;
      invalidMatches.forEach(({ index }) => matchList.children[index].classList.add("has-error"));
      matchList.children[invalidMatches[0].index].scrollIntoView({ behavior: "smooth", block: "center" });
      matchList.children[invalidMatches[0].index].querySelector('[name="ownSides"]').focus({ preventScroll: true });
      return;
    }
    await db.put("tournaments", { id: item.id, date: data.get("date"), type: data.get("type"), name: data.get("name").trim(), deck: data.get("deck").trim(), rank: data.get("rank").trim(), notes: data.get("notes").trim(), matches, updatedAt: new Date().toISOString() });
    if (data.get("deck").trim()) await ensureDeck(data.get("deck").trim());
    await Promise.all(matches.filter((match) => match.opponent).map((match) => ensureOpponent(match.opponent)));
    showToast("大会記録を保存しました");
    location.hash = "tournaments";
  });
  document.querySelector('[data-action="delete-tournament"]')?.addEventListener("click", async () => {
    if (confirm(`「${item.name}」を削除しますか？この操作は元に戻せません。`)) { await db.remove("tournaments", item.id); showToast("大会記録を削除しました"); location.hash = "tournaments"; }
  });
}

function numberOrBlank(value) { return value === "" ? "" : Number(value); }

function matchTemplate(match, number) {
  return `<article class="match-card" data-id="${escapeHtml(match.id || uuid())}"><button type="button" class="button button-icon button-small remove-match" aria-label="この対戦を削除">×</button><p class="match-title">${number}戦目</p><div class="match-grid">
    <div class="field opponent"><label>相手デッキ</label><input name="opponent" maxlength="80" list="opponent-options" placeholder="自由入力" value="${escapeHtml(match.opponent)}"></div>
    <div class="field"><label>勝敗</label><select name="result"><option value="">未入力</option><option value="win" ${match.result === "win" ? "selected" : ""}>勝ち</option><option value="loss" ${match.result === "loss" ? "selected" : ""}>負け</option><option value="draw" ${match.result === "draw" ? "selected" : ""}>引き分け</option></select></div>
    <div class="field"><label>先攻／後攻</label><select name="turn"><option value="">未入力</option><option value="first" ${match.turn === "first" ? "selected" : ""}>先攻</option><option value="second" ${match.turn === "second" ? "selected" : ""}>後攻</option></select></div>
    <div class="field"><label>自分の残りサイド</label><input name="ownSides" type="number" inputmode="numeric" min="0" max="6" placeholder="0〜6" value="${match.ownSides ?? ""}"></div>
    <div class="field"><label>相手の残りサイド</label><input name="opponentSides" type="number" inputmode="numeric" min="0" max="6" placeholder="0〜6" value="${match.opponentSides ?? ""}"></div>
    <div class="field notes"><label>対戦の感想</label><textarea name="matchNotes" placeholder="良かった点、プレイミス、次回試したいことなど">${escapeHtml(match.notes)}</textarea></div>
  </div></article>`;
}

function bindMatchButtons() {
  document.querySelectorAll(".remove-match").forEach((button) => {
    button.onclick = () => { button.closest(".match-card").remove(); renumberMatches(); };
  });
}

function renumberMatches() {
  document.querySelectorAll(".match-card").forEach((card, index) => { card.querySelector(".match-title").textContent = `${index + 1}戦目`; });
}

function renderAnalysis({ tournaments }) {
  const matches = flatMatches(tournaments).filter((match) => match.result);
  const stats = calculate(matches);
  const groupBy = (key, fallback) => {
    const map = new Map();
    matches.forEach((match) => { const label = key(match) || fallback; if (!map.has(label)) map.set(label, []); map.get(label).push(match); });
    return [...map.entries()].map(([label, items]) => ({ label, ...calculate(items) })).sort((a, b) => b.total - a.total || b.rate - a.rate);
  };
  const matchups = groupBy((match) => match.opponent, "相手デッキ未入力");
  const decks = groupBy((match) => match.tournament.deck, "デッキ未入力");
  const turns = groupBy((match) => ({ first: "先攻", second: "後攻" }[match.turn]), "先後未入力");
  const sideDiffs = matches.filter((match) => typeof match.ownSides === "number" && typeof match.opponentSides === "number").map((match) => match.opponentSides - match.ownSides);
  const averageSide = sideDiffs.length ? (sideDiffs.reduce((a, b) => a + b, 0) / sideDiffs.length).toFixed(1) : "—";
  app.innerHTML = `<section class="page-heading"><div><h1>戦績分析</h1><p>記録された対戦から傾向を確認します。</p></div></section>
    ${matches.length ? `<section class="stats-grid"><article class="card stat-card"><span class="stat-label">総合勝率</span><strong class="stat-value">${stats.rate}%</strong><span class="stat-sub">${stats.wins}勝 ${stats.losses}敗</span></article><article class="card stat-card"><span class="stat-label">先攻勝率</span><strong class="stat-value">${metric(turns, "先攻")}</strong><span class="stat-sub">引き分けを除く</span></article><article class="card stat-card"><span class="stat-label">後攻勝率</span><strong class="stat-value">${metric(turns, "後攻")}</strong><span class="stat-sub">引き分けを除く</span></article><article class="card stat-card"><span class="stat-label">平均サイド差</span><strong class="stat-value">${averageSide}</strong><span class="stat-sub">相手残り − 自分残り</span></article></section>
    <section class="analysis-grid"><article class="card analysis-card"><h2>使用デッキ別の勝率</h2>${meters(decks)}</article><article class="card analysis-card"><h2>先攻・後攻別の勝率</h2>${meters(turns)}</article></section>
    <section class="card section-card" style="margin-top:18px"><div class="section-title"><h2>相手デッキ別の戦績</h2><span class="event-meta">同じ表記で集計されます</span></div><div class="table-wrap"><table><thead><tr><th>相手デッキ</th><th>対戦数</th><th>勝敗</th><th>勝率</th></tr></thead><tbody>${matchups.map((row) => `<tr><td>${escapeHtml(row.label)}</td><td>${row.total}</td><td>${row.wins}-${row.losses}${row.draws ? `-${row.draws}` : ""}</td><td class="${row.rate >= 50 ? "result-win" : "result-loss"}">${row.rate === null ? "—" : `${row.rate}%`}</td></tr>`).join("")}</tbody></table></div></section>` : emptyState("分析できる対戦記録がありません", "大会を記録し、対戦の勝敗を入力すると分析が表示されます。")}`;
  bindCommonActions();
}

function metric(rows, label) { const row = rows.find((item) => item.label === label); return row?.rate === null || !row ? "—" : `${row.rate}%`; }
function meters(rows) { return rows.length ? rows.slice(0, 6).map((row) => `<div class="meter-row"><span class="meter-label" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</span><span class="meter"><i style="width:${row.rate || 0}%"></i></span><b>${row.rate === null ? "—" : `${row.rate}%`}</b></div>`).join("") : `<p class="event-meta">まだデータがありません。</p>`; }

function renderSettings({ decks, opponents }) {
  app.innerHTML = `<section class="page-heading"><div><h1>設定とバックアップ</h1><p>デッキ名の管理と、端末移行のためのデータ保存を行えます。</p></div></section>
  <section class="settings-grid"><article class="card setting-card"><h2>使用デッキ</h2><p>大会入力時に候補として表示されます。新しいデッキ名は大会保存時にも自動追加されます。</p><form id="deck-form" class="inline-form"><input id="new-deck" maxlength="80" placeholder="例：ドラパルトex" aria-label="デッキ名"><button class="button button-primary">追加</button></form><div class="deck-list">${decks.length ? decks.map((deck) => `<span class="deck-chip">${escapeHtml(deck.name)}<button type="button" data-delete-deck="${escapeHtml(deck.id)}" aria-label="${escapeHtml(deck.name)}を削除">×</button></span>`).join("") : '<span class="event-meta">登録済みのデッキはありません。</span>'}</div></article>
  <article class="card setting-card"><h2>バックアップと復元</h2><p>JSONファイルとしてすべての大会・デッキ名を保存できます。機種変更時は、保存したファイルを新しい端末で読み込んでください。</p><div class="form-actions" style="justify-content:flex-start"><button class="button" id="export-data">JSONを書き出す</button><label class="button" for="import-file">JSONを読み込む</label><input id="import-file" type="file" accept="application/json,.json" hidden></div><div class="tip" style="margin-top:15px">読み込みを行うと、現在の端末内の記録はバックアップの内容に置き換わります。</div></article>
  <article class="card setting-card"><h2>相手デッキの入力候補</h2><p>相手デッキは自由入力です。ここで追加した名前と、対戦結果で入力した名前が候補になります。</p><form id="opponent-form" class="inline-form"><input id="new-opponent" maxlength="80" placeholder="例：サーナイトex" aria-label="相手デッキ名"><button class="button button-primary">追加</button></form><div class="deck-list">${opponents.length ? opponents.map((opponent) => `<span class="deck-chip">${escapeHtml(opponent.name)}<button type="button" data-delete-opponent="${escapeHtml(opponent.id)}" aria-label="${escapeHtml(opponent.name)}を削除">×</button></span>`).join("") : '<span class="event-meta">まだ入力候補はありません。</span>'}</div></article>
  <article class="card setting-card danger-zone"><h2>保存について</h2><p>記録はこのブラウザ内にだけ保存されます。知人とURLを共有しても、互いの記録は共有されません。定期的にJSONを書き出すことをおすすめします。</p><button class="button" id="request-persistence">端末への保存を強化</button></article></section>`;
  document.querySelector("#deck-form").addEventListener("submit", async (event) => { event.preventDefault(); const input = document.querySelector("#new-deck"); if (!input.value.trim()) return; await ensureDeck(input.value.trim()); showToast("デッキ名を追加しました"); render(); });
  document.querySelectorAll("[data-delete-deck]").forEach((button) => button.addEventListener("click", async () => { if (confirm("このデッキ名を候補から削除しますか？大会記録は削除されません。")) { await db.remove("decks", button.dataset.deleteDeck); showToast("デッキ名を削除しました"); render(); } }));
  document.querySelector("#opponent-form").addEventListener("submit", async (event) => { event.preventDefault(); const input = document.querySelector("#new-opponent"); if (!input.value.trim()) return; await ensureOpponent(input.value.trim()); showToast("相手デッキ候補を追加しました"); render(); });
  document.querySelectorAll("[data-delete-opponent]").forEach((button) => button.addEventListener("click", async () => { if (confirm("この相手デッキ名を候補から削除しますか？対戦結果の記録は削除されません。")) { await db.remove("opponents", button.dataset.deleteOpponent); showToast("相手デッキ候補を削除しました"); render(); } }));
  document.querySelector("#export-data").addEventListener("click", exportData);
  document.querySelector("#import-file").addEventListener("change", importData);
  document.querySelector("#request-persistence").addEventListener("click", requestPersistence);
}

async function ensureDeck(name) {
  const decks = await db.all("decks");
  if (!decks.some((deck) => deck.name.toLocaleLowerCase() === name.toLocaleLowerCase())) await db.put("decks", { id: uuid(), name, createdAt: new Date().toISOString() });
}

async function ensureOpponent(name) {
  const opponents = await db.all("opponents");
  if (!opponents.some((opponent) => opponent.name.toLocaleLowerCase() === name.toLocaleLowerCase())) await db.put("opponents", { id: uuid(), name, createdAt: new Date().toISOString() });
}

async function exportData() {
  const payload = { app: "pokeca-record-note", version: 2, exportedAt: new Date().toISOString(), tournaments: await db.all("tournaments"), decks: await db.all("decks"), opponents: await db.all("opponents") };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url; link.download = `pokeca-record-backup-${today()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("バックアップを作成しました");
}

async function importData(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (payload?.app !== "pokeca-record-note" || !Array.isArray(payload.tournaments) || !Array.isArray(payload.decks)) throw new Error("形式が正しくありません");
    if (!confirm(`「${file.name}」を読み込みますか？現在の${(await db.all("tournaments")).length}件の大会記録は置き換わります。`)) return;
    const opponents = Array.isArray(payload.opponents) ? payload.opponents : [...new Set(payload.tournaments.flatMap((tournament) => (tournament.matches || []).map((match) => match.opponent?.trim()).filter(Boolean)))].map((name) => ({ id: uuid(), name, createdAt: new Date().toISOString() }));
    await db.replaceAll({ ...payload, opponents }); showToast("バックアップを復元しました"); render();
  } catch (error) { showToast(`読み込めませんでした：${error.message}`); }
}

async function requestPersistence() {
  if (!navigator.storage?.persist) { showToast("このブラウザでは設定できません。バックアップをご利用ください。"); return; }
  const granted = await navigator.storage.persist();
  showToast(granted ? "ブラウザに保存を維持するよう依頼しました" : "許可されませんでした。定期バックアップをおすすめします。");
}

function bindCommonActions() { document.querySelectorAll('[data-action="new-tournament"]').forEach((button) => button.addEventListener("click", () => { location.hash = "tournament/new"; })); }

newTournamentButton.addEventListener("click", () => { location.hash = "tournament/new"; });
saveTournamentButton.addEventListener("click", () => document.querySelector("#tournament-form")?.requestSubmit());
window.addEventListener("hashchange", render);

async function initialize() {
  try {
    await db.open();
    if (navigator.storage?.persisted && !(await navigator.storage.persisted())) navigator.storage.persist();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
    await render();
  } catch (error) {
    app.innerHTML = `<div class="empty card"><h2>データベースを開けませんでした</h2><p>${escapeHtml(error.message)}。プライベートブラウズを終了するか、ブラウザのサイトデータ設定を確認してください。</p></div>`;
  }
}

initialize();
