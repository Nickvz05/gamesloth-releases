"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const icons = {
    "arrow-right": '<path d="M5 12h14m-6-6 6 6-6 6"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
    sparkles: '<path d="m12 3 2.8 6.2L21 12l-6.2 2.8L12 21l-2.8-6.2L3 12l6.2-2.8L12 3ZM20 2v4m-2-2h4"/>',
    award: '<circle cx="12" cy="8" r="5"/><path d="M8.5 12 7 21l5-3 5 3-1.5-9"/>',
    settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="3" fill="currentColor" stroke="none"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a18 18 0 0 1 0 18 18 18 0 0 1 0-18Z"/>',
    external: '<path d="M15 3h6v6m0-6-10 10M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m-6 5h11"/>',
    refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3m-1 9A8 8 0 0 1 5 15"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="10.5" cy="10.5" r="7.5"/><path d="m16 16 5 5"/>',
    "chevron-left": '<path d="m15 6-6 6 6 6"/>',
    "chevron-right": '<path d="m9 6 6 6-6 6"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    x: '<path d="m6 6 12 12M6 18 18 6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'
  };
  const icon = name => '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (icons[name] || icons.info) + '</svg>';
  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
  const names = {FREE:"Free", SLOTH_PLUS:"Sloth+", SLOTH_PRO:"Sloth Pro"};
  const planName = value => names[value] || "Free";
  const planClass = value => value === "SLOTH_PRO" ? "pro" : value === "SLOTH_PLUS" ? "plus" : "";
  const number = value => Number(value || 0).toLocaleString("en-GB");
  const timestamp = value => value ? (Number.isFinite(Number(value)) ? Number(value) : Date.parse(value)) : 0;
  const date = (value, full = false) => {
    const ms = timestamp(value);
    if (!ms || !Number.isFinite(ms)) return "—";
    return new Date(ms).toLocaleString("en-GB", full ? {day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"} : {day:"numeric",month:"short",year:"numeric"});
  };
  const DAY = 86400000;
  const state = {token:"", session:0, data:null, accounts:[], grants:[], founding:null, status:"pending", view:"accounts", page:1, pageSize:20, selected:null, busy:false, confirm:null, toastTimer:null};
  const views = {
    accounts: ["Tester accounts", "Review sign-ups, approve testers and manage account access."],
    creators: ["Creator access", "Manage complimentary plans, expiry dates and private notes."],
    founding: ["Founding 50", "Track the first 50 successful squad hosts and their two-year Sloth+ reward."],
    settings: ["Release settings", "Manage account approval and the size of your alpha release."]
  };

  document.querySelectorAll("[data-icon]").forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  document.querySelectorAll("[data-view]").forEach(el => { el.setAttribute("aria-label", views[el.dataset.view][0]); el.title = views[el.dataset.view][0]; });

  function notify(message, error = false) {
    clearTimeout(state.toastTimer);
    $("toastText").textContent = message;
    $("toast").classList.toggle("error", error);
    $("toast").hidden = false;
    state.toastTimer = setTimeout(() => { $("toast").hidden = true; }, error ? 14000 : 7000);
  }
  function inlineError(id, message) { $(id).textContent = message || ""; $(id).hidden = !message; }
  function syncBusy() {
    document.querySelectorAll("[data-action], [data-close], #refresh, #openGrant, #saveSettings, #grantAccess, #confirmAction, #disconnect").forEach(el => { el.disabled = state.busy; });
    $("foundingToggle").disabled = state.busy || !!state.founding?.finished;
    $("workspace").setAttribute("aria-busy", String(state.busy));
  }
  function setBusy(busy) { state.busy = busy; syncBusy(); }
  function disconnect(message = "") {
    state.session++;
    state.token = "";
    state.data = null; state.accounts = []; state.grants = []; state.founding = null; state.selected = null; state.confirm = null;
    state.status = "pending"; state.page = 1;
    $("token").value = "";
    document.querySelectorAll("dialog[open]").forEach(el => el.close());
    ["accountRows","grantRows","foundingRows","accountDetails","metrics"].forEach(id => { $(id).replaceChildren(); });
    $("recoveryUrl").value = ""; $("grantForm").reset();
    ["confirmText","confirmTitle","linkExpiry","copyStatus","notice","toastText"].forEach(id => { $(id).textContent = ""; });
    ["accountError","grantError","confirmError"].forEach(id => inlineError(id, ""));
    ["search","creatorSearch"].forEach(id => { $(id).value = ""; });
    ["planFilter","emailFilter","grantFilter"].forEach(id => { $(id).value = "all"; });
    $("sort").value = "newest";
    $("workspace").hidden = true; $("login").hidden = false; $("toast").hidden = true;
    $("notice").hidden = true;
    inlineError("loginError", message);
    setBusy(false);
    $("token").focus();
  }
  async function api(path, method = "GET", body) {
    const requestSession = state.session;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    let response;
    try {
      response = await fetch(path, {method, headers:{"Content-Type":"application/json", "X-Alpha-Admin-Token":state.token}, body:body === undefined ? undefined : JSON.stringify(body), cache:"no-store", signal:controller.signal});
      const raw = await response.text();
      if (requestSession !== state.session) throw new Error("This session has ended.");
      if (response.status === 401) { disconnect("Your admin token was not accepted. Please reconnect."); throw new Error("Your admin token was not accepted."); }
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { throw new Error("The server returned an unreadable response (HTTP " + response.status + ")."); }
      if (!response.ok || data.ok === false) throw new Error(data.message || "Request failed (HTTP " + response.status + ").");
      return data;
    } catch (error) {
      if (error.name === "AbortError") throw new Error(method === "POST" ? "The request timed out. Refresh to check whether the change was saved before trying again." : "The server took too long to respond. Please try refreshing.");
      throw error;
    } finally { clearTimeout(timer); }
  }

  function countTotal() { const s = state.data.summary; return Number(s.pendingCount || 0) + Number(s.testerCount || 0) + Number(s.rejectedCount || 0); }
  function limited() { return state.accounts.length < countTotal(); }
  function activeGrant(item) { return !!item.complimentaryActive && (!item.complimentaryExpiresAt || timestamp(item.complimentaryExpiresAt) > Date.now()); }
  function ingest(data) {
    if (!data.summary || !Array.isArray(data.pendingAccounts) || !Array.isArray(data.approvedTesters) || !Array.isArray(data.rejectedAccounts)) throw new Error("The server did not return the expected account overview.");
    state.data = data;
    const accounts = new Map();
    [[data.pendingAccounts,"pending"],[data.approvedTesters,"approved"],[data.rejectedAccounts,"rejected"]].forEach(([items,status]) => items.forEach(item => accounts.set(String(item.id), {...item, status})));
    state.accounts = [...accounts.values()];
    state.grants = Array.isArray(data.creatorGrants) ? data.creatorGrants : state.accounts.filter(a => a.complimentaryPlan);
    state.founding = data.founding50 && typeof data.founding50 === "object" ? data.founding50 : {enabled:false,active:false,finished:false,limit:50,claimed:0,remaining:50,winners:[]};
    renderSummary(); renderAccounts(); renderGrants(); renderFounding(); renderSettings();
    if (state.selected && $("accountDialog").open) renderDetails(state.selected);
    $("lastUpdated").textContent = "Updated " + new Date().toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"});
    $("notice").hidden = true;
    syncBusy();
  }
  async function refresh() {
    if (state.busy || !state.token) return;
    setBusy(true);
    const session = state.session;
    try { ingest(await api("/api/admin/alpha/summary")); notify("Overview refreshed."); }
    catch (error) { if (session === state.session) { $("notice").textContent = "Could not refresh. The overview may be out of date. " + error.message; $("notice").hidden = false; notify(error.message, true); } }
    finally { setBusy(false); }
  }
  async function perform(path, body, options = {}) {
    if (state.busy) return;
    setBusy(true);
    const session = state.session;
    if (options.errorId) inlineError(options.errorId, "");
    inlineError("accountError", "");
    let saved = false;
    try {
      const data = await api(path, "POST", body);
      saved = true;
      if (options.close) $(options.close).close();
      if (options.after) options.after(data);
      const message = data.message || options.message || "Change saved.";
      if (options.reload !== false) {
        try { ingest(await api("/api/admin/alpha/summary")); }
        catch (error) {
          if (session === state.session) {
            $("notice").textContent = "Your change was saved, but the overview could not refresh. Refresh before making another change. " + error.message;
            $("notice").hidden = false;
            if ($("accountDialog").open) inlineError("accountError", "Your change was saved, but the overview could not refresh. Close these details and refresh before making another change.");
            notify("Change saved. The overview could not refresh.", true);
          }
          return;
        }
      }
      if (session === state.session) notify(message);
    } catch (error) {
      if (session === state.session) {
        const message = (saved ? "Change saved, but the display could not update. " : "") + error.message;
        if (options.errorId && $(options.errorId).closest("dialog").open) inlineError(options.errorId, message);
        else if ($("accountDialog").open) { inlineError("accountError", message); $("accountError").scrollIntoView?.({block:"nearest"}); }
        else notify(message, true);
      }
    } finally { setBusy(false); }
  }
  function renderSummary() {
    const s = state.data.summary;
    const total = countTotal();
    const active = state.grants.filter(activeGrant).length;
    const mode = s.approvalRequired ? "Closed Alpha" : "Open Beta";
    const founding = state.founding || {claimed:0,remaining:50,limit:50,active:false,finished:false};
    const metrics = [
      ["Pending review", number(s.pendingCount), Number(s.pendingCount) ? "Ready for your review" : "You’re all caught up", "clock"],
      ["Approved testers", number(s.testerCount), s.approvalRequired ? "of " + number(s.testerLimit) + " available places" : "Open registration", "users"],
      ["Creator grants", number(active), limited() ? "Active · loaded accounts only" : "Active complimentary plans", "sparkles"],
      ["Founding 50", number(founding.claimed) + " / " + number(founding.limit), founding.finished ? "All spots claimed" : founding.active ? number(founding.remaining) + " spots left" : "Reward paused", "award"]
    ];
    $("metrics").innerHTML = metrics.map(([label,value,foot,symbol]) => '<div class="metric"><div class="metric-top"><span>' + esc(label) + '</span><span class="metric-icon">' + icon(symbol) + '</span></div><strong class="metric-value">' + esc(value) + '</strong><div class="metric-foot"><span class="dot"></span>' + esc(foot) + '</div></div>').join("");
    $("navPending").textContent = number(s.pendingCount);
    $("navFounding").textContent = number(founding.claimed) + "/" + number(founding.limit);
    $("pendingCount").textContent = number(s.pendingCount); $("approvedCount").textContent = number(s.testerCount); $("rejectedCount").textContent = number(s.rejectedCount); $("allCount").textContent = number(total);
    $("accountsTotal").textContent = number(total) + " total accounts";
    $("version").textContent = state.data.version ? "v" + state.data.version : "Alpha";
    $("sideMode").textContent = mode;
    $("sideCapacity").textContent = s.approvalRequired ? number(s.testerCount) + " / " + number(s.testerLimit) + " testers approved" : "New accounts get immediate access";
    $("sideBar").style.width = s.approvalRequired ? Math.min(100, Number(s.testerCount) / Math.max(1, Number(s.testerLimit)) * 100) + "%" : "100%";
    $("resultLimit").hidden = !limited();
    $("resultLimit").textContent = "The server returned " + number(state.accounts.length) + " of " + number(total) + " accounts. Search, filters and creator grants cover these loaded accounts; the status counts above show all accounts.";
  }
  function initials(item) { return (String(item.displayName || item.handle || "?").trim().split(/\s+/).map(s => Array.from(s)[0]).slice(0,2).join("") || "?").toUpperCase(); }
  function avatar(item) { const tone = Array.from(String(item.id)).reduce((a,ch) => a + ch.charCodeAt(0), 0) % 5; return '<span class="avatar tone-' + tone + '" aria-hidden="true">' + esc(initials(item)) + '</span>'; }
  function player(item) { return '<div class="player">' + avatar(item) + '<div class="player-copy"><span class="player-name">' + esc(item.displayName || item.handle) + '</span><div class="player-meta"><i class="email-dot ' + (item.emailVerified ? "" : "unverified") + '" title="' + (item.emailVerified ? "Email verified" : "Email unverified") + '"></i><span class="sr-only">' + (item.emailVerified ? "Email verified. " : "Email unverified. ") + '</span><span>@' + esc(item.handle) + '</span></div></div></div>'; }
  function statusBadge(status) { const label = status === "approved" ? "Approved" : status === "rejected" ? "Rejected" : "Pending"; return '<span class="badge dot ' + (status === "approved" ? "approved" : status === "rejected" ? "rejected" : "pending") + '">' + label + '</span>'; }
  function planBadge(plan) { return '<span class="badge ' + planClass(plan) + '">' + esc(planName(plan)) + '</span>'; }
  function actionButton(action, item, label, cls = "secondary") { return '<button class="button small ' + cls + '" data-action="' + action + '" data-id="' + esc(item.id) + '" aria-label="' + esc(label + " for @" + item.handle) + '">' + esc(label) + '</button>'; }
  function empty(target, title, message, symbol) { $(target).hidden = false; $(target).innerHTML = '<span class="empty-icon">' + icon(symbol) + '</span><strong>' + esc(title) + '</strong><p>' + esc(message) + '</p>'; }
  function renderAccounts() {
    const query = $("search").value.trim().toLowerCase();
    const plan = $("planFilter").value, email = $("emailFilter").value;
    const filtered = state.accounts.filter(a => (state.status === "all" || a.status === state.status) && (plan === "all" || (a.effectivePlan || "FREE") === plan) && (email === "all" || !!a.emailVerified === (email === "verified")) && (!query || [a.displayName,a.handle,"@" + a.handle,a.email].join(" ").toLowerCase().includes(query)));
    filtered.sort((a,b) => $("sort").value === "name" ? String(a.displayName || a.handle).localeCompare(String(b.displayName || b.handle)) : ($("sort").value === "oldest" ? 1 : -1) * (timestamp(a.createdAt) - timestamp(b.createdAt)));
    const pages = Math.max(1, Math.ceil(filtered.length / state.pageSize));
    state.page = Math.max(1, Math.min(state.page, pages));
    const start = (state.page - 1) * state.pageSize;
    $("accountRows").innerHTML = filtered.slice(start, start + state.pageSize).map(item => '<tr><td>' + player(item) + '</td><td>' + statusBadge(item.status) + '</td><td>' + planBadge(item.effectivePlan) + (item.founding50Position ? '<span class="plan-sub">Founding 50 #' + esc(item.founding50Position) + '</span>' : activeGrant(item) ? '<span class="plan-sub">Complimentary access</span>' : '') + '</td><td class="date-cell">' + esc(date(item.createdAt)) + '<small>' + esc(new Date(timestamp(item.createdAt)).toLocaleTimeString("en-GB", {hour:"2-digit",minute:"2-digit"})) + '</small></td><td><div class="row-actions">' + (item.status === "pending" ? actionButton("approve",item,"Approve","primary") : '') + actionButton("details",item,"Details") + '</div></td></tr>').join("");
    $("accountEmpty").hidden = !!filtered.length;
    if (!filtered.length) {
      const hasFilters = query || plan !== "all" || email !== "all";
      empty("accountEmpty", hasFilters ? "No matching players" : state.status === "pending" ? "You’re all caught up." : "No accounts here yet", hasFilters ? "Try a different search or clear the plan and email filters." : state.status === "pending" ? "New sign-ups waiting for approval will appear here." : "Accounts with this access status will appear here.", hasFilters ? "search" : "check");
    }
    document.querySelectorAll("[data-status]").forEach(el => { const selected = el.dataset.status === state.status; el.classList.toggle("active", selected); el.setAttribute("aria-pressed", String(selected)); });
    $("resultCount").textContent = filtered.length ? "Showing " + number(start + 1) + "–" + number(Math.min(start + state.pageSize, filtered.length)) + " of " + number(filtered.length) + " accounts" : "0 accounts";
    $("pageCount").textContent = "Page " + state.page + " of " + pages;
    $("prevPage").disabled = state.page <= 1; $("nextPage").disabled = state.page >= pages;
    syncBusy();
  }
  function expiryMarkup(item) {
    const active = activeGrant(item), expiry = timestamp(item.complimentaryExpiresAt);
    const days = expiry ? Math.max(0, Math.ceil((expiry - Date.now()) / DAY)) : null;
    return '<span class="expiry ' + (!active ? 'ended' : days !== null && days <= 7 ? 'soon' : '') + '">' + (expiry ? esc(date(expiry)) : "Until revoked") + '<small>' + (!active ? "Expired" : days === null ? "No expiry date" : days + (days === 1 ? " day remaining" : " days remaining")) + '</small></span>';
  }
  function renderGrants() {
    const query = $("creatorSearch").value.trim().toLowerCase(), filter = $("grantFilter").value;
    const grants = state.grants.filter(a => {
      const active = activeGrant(a), expires = timestamp(a.complimentaryExpiresAt);
      return (filter === "all" || (filter === "active" && active) || (filter === "expired" && !active) || (filter === "expiring" && active && expires && expires <= Date.now() + 7 * DAY)) && (!query || [a.handle,"@" + a.handle,a.displayName,a.email,a.complimentaryNote].join(" ").toLowerCase().includes(query));
    });
    $("grantRows").innerHTML = grants.map(item => '<tr><td>' + player(item) + '</td><td>' + planBadge(item.complimentaryPlan) + '<span class="plan-sub">Effective: ' + esc(planName(item.effectivePlan)) + '</span></td><td>' + expiryMarkup(item) + '</td><td class="grant-note">' + esc(item.complimentaryNote || "—") + '</td><td><div class="row-actions">' + actionButton("edit-grant",item,"Edit") + actionButton("revoke-grant",item,"Revoke","quiet") + '</div></td></tr>').join("");
    $("grantEmpty").hidden = !!grants.length;
    if (!grants.length) empty("grantEmpty", query || filter !== "all" ? "No matching grants" : "No creator grants yet.", query || filter !== "all" ? "Try another search or choose All grants." : "Grant Sloth+ or Sloth Pro to an existing account using the button above.", "sparkles");
    $("grantTotal").textContent = number(state.grants.length) + (limited() ? " loaded grants" : " grants");
    $("grantResultCount").textContent = "Showing " + number(grants.length) + " of " + number(state.grants.length) + " grants" + (limited() ? " · Loaded accounts only; the server returned a limited account list." : "");
    syncBusy();
  }
  function renderFounding() {
    const f = state.founding || {enabled:false,active:false,finished:false,limit:50,claimed:0,remaining:50,winners:[]};
    const winners = Array.isArray(f.winners) ? f.winners : [];
    $("foundingCount").textContent = number(f.claimed) + " / " + number(f.limit);
    $("foundingRemaining").textContent = f.finished ? "All spots claimed" : number(f.remaining) + (Number(f.remaining) === 1 ? " spot left" : " spots left");
    $("foundingBar").style.width = Math.min(100, Number(f.claimed) / Math.max(1, Number(f.limit)) * 100) + "%";
    $("foundingTotal").textContent = number(f.claimed) + " claimed";
    $("foundingStatus").textContent = f.finished ? "Complete" : f.active ? "Active" : "Paused";
    $("foundingStatus").className = "badge " + (f.finished ? "plus" : f.active ? "approved" : "pending");
    $("foundingToggle").textContent = f.enabled ? "Pause reward" : "Resume reward";
    $("foundingToggle").disabled = state.busy || !!f.finished;
    $("foundingRows").innerHTML = winners.map(item => '<tr><td class="founding-position">#' + esc(item.position) + '</td><td><div class="player">' + avatar(item) + '<div class="player-copy"><span class="player-name">' + esc(item.displayName || item.handle) + '</span><div class="player-meta"><span>@' + esc(item.handle) + '</span></div></div></div></td><td class="date-cell">' + esc(date(item.claimedAt)) + '<small>' + esc(date(item.claimedAt,true).split(',').pop()?.trim() || "") + '</small></td><td><span class="badge">' + esc(item.povCount) + ' POVs</span></td><td>' + esc(date(item.expiresAt)) + '</td></tr>').join("");
    $("foundingEmpty").hidden = !!winners.length;
    if (!winners.length) empty("foundingEmpty", "No Founding 50 claims yet", "The first successful hosted Sloth Sync Moment with at least two POVs will take spot #1.", "award");
    $("foundingFoot").textContent = f.finished ? "Founding 50 is complete. Existing rewards remain active until their individual expiry dates." : f.active ? "New qualifying Moments can still claim a spot automatically." : "The reward is paused. Successful Moments will not claim a spot until you resume it.";
    syncBusy();
  }

  function showView(view) {
    if (!views[view]) return;
    state.view = view;
    Object.keys(views).forEach(name => { $(name + "View").hidden = name !== view; });
    document.querySelectorAll("[data-view]").forEach(el => { const active = el.dataset.view === view; el.classList.toggle("active", active); if (active) el.setAttribute("aria-current", "page"); else el.removeAttribute("aria-current"); });
    $("pageTitle").textContent = $("breadcrumb").textContent = views[view][0];
    $("pageDescription").textContent = views[view][1];
    $("openGrant").hidden = !["accounts","creators"].includes(view);
    if (view === "founding") renderFounding();
  }
  function renderSettings() {
    const s = state.data.summary;
    $("accessMode").value = s.approvalRequired ? "closed_alpha" : "open_beta";
    $("testerLimit").value = s.testerLimit;
    $("savedMode").textContent = s.approvalRequired ? "Closed Alpha" : "Open Beta";
    $("savedMode").className = "badge " + (s.approvalRequired ? "pending" : "approved");
    $("settingsStatus").textContent = "Changes apply when you save.";
    $("capacitySummary").innerHTML = '<strong>' + esc(number(s.testerCount)) + ' approved testers</strong><p>' + (s.approvalRequired ? esc(number(s.spotsRemaining)) + ' places still available in this release.' : 'New accounts can join without manual approval.') + '</p>';
    modeHelp();
  }
  function modeHelp() {
    const closed = $("accessMode").value === "closed_alpha";
    $("testerLimit").disabled = !closed;
    $("modeHelp").textContent = closed ? "New accounts wait for your approval. Only approved accounts can sign in." : "All currently pending accounts will be approved when you save. Future accounts get access immediately.";
    $("limitHelp").textContent = closed ? "The maximum number of accounts you can approve during Closed Alpha." : "The tester limit is not enforced during Open Beta. Your saved limit is kept for Closed Alpha.";
  }
  function findAccount(id) { return state.accounts.find(a => String(a.id) === String(id)) || state.grants.find(a => String(a.id) === String(id)); }
  function renderDetails(id) {
    const item = findAccount(id);
    if (!item) { $("accountDialog").close(); state.selected = null; return; }
    state.selected = String(id);
    let access = item.status === "approved" ? actionButton("reject",item,"Revoke alpha access","danger") : actionButton("approve",item,"Approve account","primary") + actionButton("quick-pro",item,"Approve + Pro 90d");
    if (item.status === "pending") access += actionButton("reject",item,"Reject account","quiet");
    const grantActions = actionButton("edit-grant",item,item.complimentaryPlan ? "Edit creator access" : "Grant creator access", "secondary") + (item.complimentaryPlan ? actionButton("revoke-grant",item,"Revoke comp plan","quiet") : item.status === "approved" ? actionButton("quick-pro",item,"Give Pro 90d","quiet") : "");
    const foundingBadge = item.founding50Position ? '<span class="badge plus">Founding 50 #' + esc(item.founding50Position) + '</span>' : '';
    const foundingDetail = item.founding50Position ? '<section class="detail-section"><h3>Founding 50</h3><dl class="detail-list"><dt>Position</dt><dd>#' + esc(item.founding50Position) + '</dd><dt>Claimed</dt><dd>' + esc(date(item.founding50ClaimedAt,true)) + '</dd><dt>Sloth+ until</dt><dd>' + esc(date(item.founding50ExpiresAt)) + '</dd><dt>Qualifying POVs</dt><dd>' + esc(item.founding50PovCount) + '</dd></dl><p class="detail-help">This reward is separate from paid billing and creator access.</p></section>' : '';
    $("accountDetails").innerHTML = '<div class="detail-identity">' + avatar(item) + '<h2 id="accountTitle">' + esc(item.displayName || item.handle) + '</h2><p class="handle">@' + esc(item.handle) + '</p><p class="detail-email">' + esc(item.email || "No email available") + '</p><div class="detail-badges">' + statusBadge(item.status) + '<span class="badge ' + (item.emailVerified ? "approved" : "pending") + '">' + (item.emailVerified ? "Email verified" : "Email unverified") + '</span>' + foundingBadge + '</div></div><section class="detail-section"><h3>Alpha access</h3><div class="detail-actions">' + access + '</div></section><section class="detail-section"><h3>Plan & creator access</h3><dl class="detail-list"><dt>Effective plan</dt><dd>' + planBadge(item.effectivePlan) + '</dd><dt>Normal billing plan</dt><dd>' + esc(planName(item.billingPlan)) + '</dd><dt>Complimentary plan</dt><dd>' + (item.complimentaryPlan ? esc(planName(item.complimentaryPlan)) : "None") + '</dd>' + (item.complimentaryPlan ? '<dt>Expires</dt><dd>' + expiryMarkup(item) + '</dd>' : '') + '</dl>' + (item.complimentaryNote ? '<div class="detail-note"><small>PRIVATE NOTE</small>' + esc(item.complimentaryNote) + '</div>' : '<div style="height:18px"></div>') + '<div class="detail-actions">' + grantActions + '</div><p class="detail-help">Complimentary access keeps the normal billing plan intact.</p></section>' + foundingDetail + '<section class="detail-section"><h3>Account recovery</h3><p>Generate a private link for the account owner.</p><div class="recovery-actions">' + actionButton("reset-link",item,"Create password reset link") + (!item.emailVerified ? actionButton("verify-link",item,"Create email verification link") + actionButton("mark-verified",item,"Mark email verified","quiet") : '') + '</div></section><section class="detail-section"><h3>Account history</h3><dl class="detail-list"><dt>Signed up</dt><dd>' + esc(date(item.createdAt,true)) + '</dd><dt>Last reviewed</dt><dd>' + esc(date(item.reviewedAt,true)) + '</dd><dt>Creator grant updated</dt><dd>' + esc(date(item.complimentaryUpdatedAt,true)) + '</dd></dl></section>';
    syncBusy();
  }
  function openDetails(id) { inlineError("accountError", ""); renderDetails(id); if (state.selected && !$("accountDialog").open) $("accountDialog").showModal(); }
  function updateGrantExpiry() {
    const days = Number($("grantDuration").value);
    $("grantExpiry").textContent = days ? "Access will expire on " + date(Date.now() + days * DAY) + ". Saving replaces any existing grant; the duration starts today." : "Access stays active until you revoke it. Saving replaces any existing grant.";
  }
  function openGrant(item) {
    $("grantForm").reset();
    inlineError("grantError", "");
    if (item) { $("grantHandle").value = item.handle; $("grantPlan").value = item.complimentaryPlan || "SLOTH_PRO"; $("grantNote").value = item.complimentaryNote || ""; $("grantApprove").checked = item.status !== "approved"; }
    $("grantTitle").textContent = item?.complimentaryPlan ? "Update creator access." : "Grant creator access.";
    $("grantAccess").textContent = item?.complimentaryPlan ? "Save creator access" : "Grant access";
    updateGrantExpiry();
    $("grantDialog").showModal();
    $("grantHandle").focus();
  }
  function confirmChange(title, text, label, action, danger = false) {
    state.confirm = action;
    $("confirmTitle").textContent = title; $("confirmText").textContent = text; $("confirmAction").textContent = label;
    $("confirmAction").className = "button " + (danger ? "danger" : "primary");
    inlineError("confirmError", ""); $("confirmDialog").showModal(); $("confirmCancel").focus();
  }
  function showRecovery(data, label) {
    if (data.alreadyVerified) return;
    if (typeof data.url !== "string" || !/^https?:\/\//i.test(data.url)) throw new Error("The server did not return a valid recovery link.");
    $("linkTitle").textContent = label;
    $("recoveryUrl").value = data.url;
    $("linkExpiry").textContent = "Expires " + date(data.expiresAt, true) + ". No email was sent automatically.";
    $("copyStatus").textContent = "";
    $("linkDialog").showModal();
  }
  function accountAction(action, id) {
    if (state.busy) return;
    const item = findAccount(id);
    if (!item) { notify("This account is no longer in the loaded overview. Please refresh.", true); return; }
    const handle = "@" + item.handle;
    if (action === "details") return openDetails(id);
    if (action === "edit-grant") return openGrant(item);
    if (action === "approve") return perform("/api/admin/alpha/accounts/status", {id:item.id,status:"approved"}, {message:handle + " approved."});
    if (action === "reject") return confirmChange(item.status === "approved" ? "Revoke alpha access?" : "Reject this account?", item.status === "approved" ? handle + " will lose access and their current sessions will be ended. You can approve the account again later." : handle + " will be marked as rejected. You can approve the account again later.", item.status === "approved" ? "Revoke access" : "Reject account", () => perform("/api/admin/alpha/accounts/status", {id:item.id,status:"rejected"}, {close:"confirmDialog",errorId:"confirmError",message:"Account access updated."}), true);
    if (action === "quick-pro") return confirmChange("Give Sloth Pro for 90 days?", handle + " will receive complimentary Sloth Pro for 90 days from today" + (item.status !== "approved" ? " and be approved for the Closed Alpha." : ".") + (item.complimentaryPlan ? " This replaces their existing grant." : ""), "Grant Pro 90d", () => perform("/api/admin/alpha/creator-access/grant", {handle:item.handle,plan:"SLOTH_PRO",durationDays:90,note:item.complimentaryNote || "Creator access",approveAccount:item.status !== "approved"}, {close:"confirmDialog",errorId:"confirmError",message:"Creator access granted."}));
    if (action === "revoke-grant") return confirmChange("Revoke creator access?", "Remove " + handle + "’s complimentary plan? Their normal paid or Free plan will remain unchanged.", "Revoke comp plan", () => perform("/api/admin/alpha/creator-access/revoke", {id:item.id}, {close:"confirmDialog",errorId:"confirmError",message:"Complimentary access revoked."}), true);
    if (action === "mark-verified") return confirmChange("Mark this email as verified?", "This verifies " + (item.email || handle) + " without the tester opening an email verification link.", "Mark verified", () => perform("/api/admin/alpha/accounts/mark-email-verified", {id:item.id}, {close:"confirmDialog",errorId:"confirmError",message:"Email marked as verified."}));
    if (action === "reset-link" || action === "verify-link") {
      const reset = action === "reset-link", label = reset ? "Password reset link" : "Email verification link";
      return perform("/api/admin/alpha/accounts/" + (reset ? "password-reset-link" : "verification-link"), {id:item.id}, {message:label + " generated.",reload:false,after:data => showRecovery(data,label)});
    }
  }

  $("loginForm").addEventListener("submit", async event => {
    event.preventDefault();
    if ($("connect").disabled) return;
    const token = $("token").value.trim();
    if (!token) return inlineError("loginError", "Enter your admin token first.");
    state.token = token; const session = ++state.session;
    $("connect").disabled = true; inlineError("loginError", "");
    try { ingest(await api("/api/admin/alpha/summary")); $("token").value = ""; $("login").hidden = true; $("workspace").hidden = false; showView("accounts"); $("main").focus(); }
    catch (error) { if (session === state.session) { state.token = ""; inlineError("loginError", "Could not connect. " + error.message); } }
    finally { $("connect").disabled = false; }
  });
  $("disconnect").addEventListener("click", () => disconnect());
  $("refresh").addEventListener("click", refresh);
  $("openGrant").addEventListener("click", () => openGrant());
  $("foundingToggle").addEventListener("click", () => {
    const f = state.founding;
    if (!f || f.finished || state.busy) return;
    const enabled = !f.enabled;
    confirmChange(enabled ? "Resume Founding 50?" : "Pause Founding 50?", enabled ? "New qualifying squad Moments will be able to claim the remaining " + number(f.remaining) + " spots again." : "Existing winners keep their Sloth+ reward, but new Moments will not claim a spot while this is paused.", enabled ? "Resume reward" : "Pause reward", () => perform("/api/admin/alpha/founding-50/settings", {enabled}, {close:"confirmDialog",errorId:"confirmError",message:enabled ? "Founding 50 resumed." : "Founding 50 paused."}), !enabled);
  });
  $("closeToast").addEventListener("click", () => { $("toast").hidden = true; });
  document.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.dataset.view) showView(button.dataset.view);
    if (button.dataset.status) { state.status = button.dataset.status; state.page = 1; renderAccounts(); }
    if (button.dataset.action) accountAction(button.dataset.action, button.dataset.id);
    if (button.dataset.close) $(button.dataset.close).close();
  });
  ["search","planFilter","emailFilter","sort"].forEach(id => $(id).addEventListener(id === "search" ? "input" : "change", () => { state.page = 1; renderAccounts(); }));
  ["creatorSearch","grantFilter"].forEach(id => $(id).addEventListener(id === "creatorSearch" ? "input" : "change", renderGrants));
  $("prevPage").addEventListener("click", () => { state.page--; renderAccounts(); });
  $("nextPage").addEventListener("click", () => { state.page++; renderAccounts(); });
  $("accessMode").addEventListener("change", () => { modeHelp(); $("settingsStatus").textContent = "You have unsaved changes."; });
  $("testerLimit").addEventListener("input", () => { $("settingsStatus").textContent = "You have unsaved changes."; });
  $("settingsForm").addEventListener("submit", event => {
    event.preventDefault(); if (state.busy) return;
    const approvalRequired = $("accessMode").value === "closed_alpha";
    const testerLimit = Number($("testerLimit").value);
    if (!Number.isInteger(testerLimit) || testerLimit < 1 || testerLimit > 10000) return notify("Use a tester limit between 1 and 10,000.", true);
    const save = () => perform("/api/admin/alpha/settings", {approvalRequired,testerLimit}, {close:"confirmDialog",errorId:"confirmError",message:"Release settings saved."});
    if (!approvalRequired && state.data.summary.approvalRequired) confirmChange("Open GameSloth to everyone?", "Switching to Open Beta approves all " + number(state.data.summary.pendingCount) + " currently pending accounts. New accounts will receive access immediately, without the tester limit.", "Enable Open Beta", save);
    else save();
  });
  $("grantDuration").addEventListener("change", updateGrantExpiry);
  $("grantForm").addEventListener("submit", event => {
    event.preventDefault(); if (state.busy) return;
    const handle = $("grantHandle").value.trim().replace(/^@/, "");
    if (!handle) return inlineError("grantError", "Enter an existing GameSloth handle.");
    perform("/api/admin/alpha/creator-access/grant", {handle,plan:$("grantPlan").value,durationDays:Number($("grantDuration").value),note:$("grantNote").value.trim(),approveAccount:$("grantApprove").checked}, {close:"grantDialog",errorId:"grantError",message:"Creator access granted."});
  });
  $("confirmAction").addEventListener("click", () => { if (!state.busy && state.confirm) state.confirm(); });
  $("confirmDialog").addEventListener("close", () => { state.confirm = null; });
  $("accountDialog").addEventListener("close", () => { state.selected = null; });
  $("linkDialog").addEventListener("close", () => { $("recoveryUrl").value = ""; $("copyStatus").textContent = ""; });
  document.querySelectorAll("dialog").forEach(dialog => dialog.addEventListener("cancel", event => { if (state.busy) event.preventDefault(); }));
  $("copyLink").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText($("recoveryUrl").value); $("copyStatus").textContent = "Copied. Share it privately with the account owner."; }
    catch { $("recoveryUrl").focus(); $("recoveryUrl").select(); $("copyStatus").textContent = "Copy the selected link with Ctrl+C or ⌘C."; }
  });
})();
