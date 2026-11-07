import { api } from './api.js';
import { GROUP_NAME } from './config.js';

// Safe localStorage/sessionStorage (some browsers block storage).
const store = {
  get(type, key) {
    try { return (type === 'local' ? localStorage : sessionStorage).getItem(key) || ''; } catch { return ''; }
  },
  set(type, key, value) {
    try {
      const s = type === 'local' ? localStorage : sessionStorage;
      value ? s.setItem(key, value) : s.removeItem(key);
    } catch { /* storage blocked: the app still works, it just won't remember */ }
  },
};

// ================= STATE =================
const state = {
  data: null, // everything from the backend: people, events, responses, ledger, balances
  me: store.get('local', 'treatup-me'), // which person is using this phone
  pin: store.get('session', 'treatup-pin'), // admin PIN (only for this browser tab)
  code: store.get('local', 'treatup-code'), // group code (this phone remembers it)
  needCode: false, // true when the backend asks for the group code
  menuDraft: null, // the food menu while the admin is editing it (saved with "Save menu")
  busy: false,
};
api.setCode(state.code);
const app = document.getElementById('app');

// ================= SMALL HELPERS =================
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => `${state.data.currency} ${(Math.round(Number(n) * 100) / 100).toFixed(2).replace(/\.00$/, '')}`;
const isAdmin = () => !!state.data?.isAdmin;
const person = (id) => state.data.people.find((p) => p.id === id);
const nameOf = (id) => person(id)?.name || 'Someone';
const todayIso = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d) ? esc(iso) : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
};
const eventLink = (id) => `${location.origin}${location.pathname}#/event/${id}`;
const waLink = (text, phone = '') => `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
const responsesFor = (evId) => state.data.responses.filter((r) => r.eventId === evId);
const myResponse = (evId) => state.data.responses.find((r) => r.eventId === evId && r.personId === state.me);
const chargesFor = (evId) => state.data.ledger.filter((l) => l.eventId === evId && l.type === 'charge');
const isLunch = (ev) => ev.kind === 'lunch';
const isCodeError = (err) => String(err?.message || '').startsWith('GROUP_CODE');
const cleanError = (err) => String(err?.message || err).replace(/^GROUP_CODE:\s*/, '');
/** "cake", "gift", "cake & gift" or "bill" */
const collectWord = (ev) => (ev.collectFor || '').toLowerCase();
const collectQuestion = (ev) => (ev.collectFor === 'Bill' ? 'Are you sharing the bill?' : `Are you in for the ${collectWord(ev)}?`);
const billLabel = (ev) => (ev.collectFor === 'Bill' ? 'the bill' : `the ${collectWord(ev)} bill`);
const STAGE_LABEL = { vote: 'Voting on place', dish: 'Choosing dishes', order: 'Ordering', collect: 'Collecting', done: 'Done' };

function toast(message, type = 'ok') {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 5000 : 2800);
}

function setBusy(on) {
  state.busy = on;
  document.body.classList.toggle('busy', on);
  document.querySelectorAll('button, input, select, textarea').forEach((el) => { el.disabled = on; });
}

// ================= LOADING DATA =================
async function load() {
  try {
    state.data = await api.getData(state.pin);
  } catch (err) {
    if (isCodeError(err)) { state.needCode = true; state.data = null; }
    throw err;
  }
  state.needCode = false;
  if (state.pin && !state.data.isAdmin) { // PIN was changed on the server
    state.pin = '';
    store.set('session', 'treatup-pin', '');
  }
  if (state.me && !person(state.me)) { state.me = ''; store.set('local', 'treatup-me', ''); }
}

/** Runs an action, reloads the data, re-draws the page, and shows a message. */
async function run(action, successMessage) {
  if (state.busy) return;
  setBusy(true);
  try {
    const result = await action();
    await load();
    render();
    if (successMessage) toast(typeof successMessage === 'function' ? successMessage(result) : successMessage);
    return result;
  } catch (err) {
    if (isCodeError(err)) { render(); toast('Please enter the group code again.', 'error'); }
    else toast(cleanError(err), 'error');
  } finally {
    setBusy(false);
  }
}

// ================= ROUTER =================
function currentRoute() {
  const [page = '', id = ''] = location.hash.replace(/^#\/?/, '').split(/[/-]/);
  return { page: page || 'home', id };
}

function render() {
  if (!api.isConfigured()) { app.innerHTML = setupNeededView(); return; }
  if (state.needCode) { app.innerHTML = codeView(); return; }
  if (!state.data) { app.innerHTML = `<div class="loading">Loading…</div>`; return; }
  const { page, id } = currentRoute();
  const views = { home: homeView, event: () => eventView(id), balances: balancesView, admin: adminView, new: newEventView };
  app.innerHTML = layout((views[page] || homeView)(), page);
  afterRender();
}

function layout(content, page) {
  const tab = (href, label, key) => `<a href="#/${href}" class="${page === key ? 'active' : ''}">${label}</a>`;
  return `
    <header class="top">
      <a href="#/" class="brand">🎉 ${esc(GROUP_NAME)}</a>
      <button class="icon-btn" data-action="refresh" aria-label="Refresh" title="Refresh">↻</button>
    </header>
    <nav class="tabs">
      ${tab('', 'Events', 'home')}${tab('balances', 'Balances', 'balances')}${tab('admin', isAdmin() ? 'Admin ✓' : 'Admin', 'admin')}
    </nav>
    <main>${content}</main>
    ${state.me ? `<footer class="me-bar">You are <b>${esc(nameOf(state.me))}</b> · <button class="link" data-action="change-me">not you?</button></footer>` : ''}`;
}

// ================= VIEWS =================
function setupNeededView() {
  return `<main><div class="card"><h2>Almost there</h2>
    <p>Open <code>js/config.js</code> and paste your Apps Script web app URL into <code>API_URL</code>.</p>
    <p class="muted">The README explains every step.</p></div></main>`;
}

function codeView() {
  return `<main class="gate">
    <form class="card gate-card" data-form="code">
      <div class="gate-mark" aria-hidden="true">🎉</div>
      <h1>${esc(GROUP_NAME)}</h1>
      <p class="muted">Enter your group code to open the app. Ask the organiser if you don't have it.</p>
      <label for="group-code" class="sr-only">Group code</label>
      <input id="group-code" name="code" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Group code" required>
      <p class="form-error" hidden></p>
      <button class="btn primary block">Open</button>
    </form>
    <details class="organiser">
      <summary>I'm the organiser</summary>
      <form data-form="login" class="card">
        <label for="gate-pin">Admin PIN</label>
        <input id="gate-pin" name="pin" type="password" inputmode="numeric" required autocomplete="current-password">
        <button class="btn block">Log in as admin</button>
      </form>
    </details>
  </main>`;
}

function whoAreYou() {
  return `<form class="card who" data-form="set-me">
    <h2>Who are you?</h2>
    <p class="muted">Pick your name once. This phone will remember it.</p>
    <select name="me" required>
      <option value="">Choose your name…</option>
      ${state.data.people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}
    </select>
    <button class="btn primary">That's me</button>
  </form>`;
}

function homeView() {
  const { events, balances } = state.data;
  const open = events.filter((e) => e.stage !== 'done');
  const past = events.filter((e) => e.stage === 'done');
  const myBal = state.me ? balances[state.me] || 0 : 0;
  return `
    ${state.me ? `<div class="card balance ${myBal > 0 ? 'owes' : 'clear'}">
        <span>Your balance</span>
        <strong>${myBal > 0 ? `You owe ${money(myBal)}` : myBal < 0 ? `${money(-myBal)} in credit` : 'All clear 🎉'}</strong>
      </div>` : whoAreYou()}
    ${isAdmin() ? `<a class="btn primary block" href="#/new">+ New event</a>` : ''}
    <h3 class="section">Happening now</h3>
    ${open.length ? open.map(eventCard).join('') : `<p class="muted empty">No open events right now.</p>`}
    ${past.length ? `<h3 class="section">Past events</h3>${past.map(eventCard).join('')}` : ''}`;
}

function eventCard(ev) {
  const res = responsesFor(ev.id);
  const mine = state.me && myResponse(ev.id);
  const needsMe = state.me && ev.stage !== 'done' && state.me !== ev.personId && !mine;
  const what = [ev.hasTreat ? (isLunch(ev) ? 'Food vote' : 'Treat') : '', ev.collectFor === 'Bill' ? 'Shared bill' : ev.collectFor]
    .filter(Boolean).join(' + ');
  return `<a class="card event-card" href="#/event/${ev.id}">
    <div class="row"><strong>${esc(ev.title)}</strong><span class="pill stage-${ev.stage}">${STAGE_LABEL[ev.stage] || ev.stage}</span></div>
    <div class="muted small">${fmtDate(ev.date)} · ${esc(what)}${ev.foodWinner ? ` · ${esc(ev.foodWinner)}` : ''} · ${res.length} answered</div>
    ${needsMe ? `<div class="nudge">Tap to answer 👉</div>` : ''}
  </a>`;
}

// ---------- EVENT PAGE ----------
function eventView(id) {
  const ev = state.data.events.find((e) => e.id === id);
  if (!ev) return `<div class="card"><p>Event not found.</p><a href="#/">Back to events</a></div>`;
  const giver = nameOf(ev.personId);
  const isToday = ev.date === todayIso();
  const headline = isLunch(ev)
    ? `🍽️ ${esc(ev.title)}${isToday ? ' today' : ''}`
    : ev.hasTreat
      ? `🎉 ${esc(giver)} is giving us a treat${isToday ? ' today' : ''}!`
      : `🎂 It's ${esc(giver)}'s birthday${isToday ? ' today' : ''}!`;
  const moneyLine = !ev.collectFor ? ''
    : ev.collectFor === 'Bill' ? " · We're splitting the bill"
    : ` · We're ${ev.hasTreat || isLunch(ev) ? 'also ' : ''}collecting for a ${esc(collectWord(ev))}`;
  return `
    <a href="#/" class="back">← All events</a>
    <section class="hero">
      <h1>${headline}</h1>
      <p class="muted">${fmtDate(ev.date)}${moneyLine}</p>
      ${ev.note ? `<p class="note">${esc(ev.note)}</p>` : ''}
      ${stepper(ev)}
    </section>
    ${ev.stage !== 'done' ? (state.me ? memberForm(ev) : whoAreYou()) : ''}
    ${ev.stage === 'done' ? summaryView(ev) : ''}
    ${resultsView(ev)}
    ${isAdmin() ? adminEventPanel(ev) : ''}`;
}

function stepper(ev) {
  const steps = ev.hasTreat
    ? [['vote', 'Place'], ['dish', 'Dishes'], ['order', 'Order'], ['done', 'Done']]
    : [['collect', 'Collect'], ['done', 'Done']];
  const at = steps.findIndex(([k]) => k === ev.stage);
  return `<ol class="stepper">${steps.map(([, label], i) =>
    `<li class="${i < at ? 'past' : i === at ? 'now' : ''}">${label}</li>`).join('')}</ol>`;
}

function memberForm(ev) {
  const mine = myResponse(ev.id) || {};
  const isGiver = state.me === ev.personId;
  const charged = chargesFor(ev.id).length > 0;
  const parts = [];

  if (ev.hasTreat && ev.stage === 'vote' && !isGiver) {
    const pick = mine.foodVote || '';
    const radio = (value, label) => `<label class="choice"><input type="radio" name="foodVote" value="${esc(value)}" ${pick === value ? 'checked' : ''}><span>${label}</span></label>`;
    parts.push(`<fieldset><legend>Where should we eat?</legend>
      <div class="choices">
        ${ev.foodOptions.map((o) => radio(o, esc(o))).join('')}
        ${radio('MAJORITY', 'I\'ll go with the majority')}
        ${radio('NONE', 'I can\'t come this time')}
        ${radio('SUGGEST', 'Suggest something else')}
      </div>
      <input type="text" name="suggestion" class="suggest-input" placeholder="Your suggestion, e.g. Shawarma" maxlength="40" ${pick === 'SUGGEST' ? '' : 'hidden'}>
    </fieldset>`);
  }

  if (ev.hasTreat && ev.stage === 'dish') {
    const pick = mine.dish || '';
    parts.push(`<fieldset><legend>We're going for <b>${esc(ev.foodWinner)}</b>! What do you want?</legend>
      <div class="choices">
        ${ev.dishOptions.map((d) => `<label class="choice"><input type="radio" name="dish" value="${esc(d)}" ${pick === d ? 'checked' : ''}><span>${esc(d)}</span></label>`).join('')}
        <label class="choice"><input type="radio" name="dish" value="SKIP" ${pick === 'SKIP' ? 'checked' : ''}><span>I'm not eating</span></label>
      </div></fieldset>`);
  }

  if (ev.hasTreat && ev.stage === 'order') {
    parts.push(`<p class="info">🛒 The order is being placed for <b>${esc(ev.foodWinner)}</b>.
      ${mine.dish ? `Your choice: <b>${mine.dish === 'SKIP' ? 'not eating' : esc(mine.dish)}</b>.` : ''}</p>`);
  }

  if (ev.collectFor && !charged) {
    if (isGiver) {
      parts.push(`<p class="info">It's your day, you don't pay for your own ${esc(collectWord(ev))} 🎂</p>`);
    } else {
      const pick = mine.contribute || '';
      parts.push(`<fieldset><legend>${esc(collectQuestion(ev))}</legend>
        <div class="choices two">
          <label class="choice"><input type="radio" name="contribute" value="Yes" ${pick === 'Yes' ? 'checked' : ''}><span>Yes, count me in!</span></label>
          <label class="choice"><input type="radio" name="contribute" value="No" ${pick === 'No' ? 'checked' : ''}><span>No, thank you</span></label>
        </div></fieldset>`);
    }
  }

  const hasQuestions = parts.some((p) => p.startsWith('<fieldset'));
  if (!parts.length) return '';
  return `<form class="card answer" data-form="respond" data-event="${ev.id}">
    <h2>Your answer</h2>
    ${parts.join('')}
    ${hasQuestions ? `<p class="form-error" hidden></p>
      <button class="btn primary block">${mine.updatedAt ? 'Update my answer' : 'Save my answer'}</button>
      ${mine.updatedAt ? `<p class="muted small center">Saved ✓ You can change it until the admin closes this step.</p>` : ''}` : ''}
  </form>`;
}

function resultsView(ev) {
  const res = responsesFor(ev.id);
  const blocks = [];
  const names = (list) => list.map((r) => esc(nameOf(r.personId))).join(', ');

  // place vote
  if (ev.hasTreat) {
    const counts = ev.foodOptions.map((o) => ({ o, voters: res.filter((r) => r.foodVote === o) }));
    const max = Math.max(1, ...counts.map((c) => c.voters.length));
    const majority = res.filter((r) => r.foodVote === 'MAJORITY');
    const none = res.filter((r) => r.foodVote === 'NONE');
    blocks.push(`<div class="card"><h3>Place vote ${ev.foodWinner ? `· <span class="win">${esc(ev.foodWinner)} won</span>` : ''}</h3>
      ${counts.map(({ o, voters }) => `<div class="bar-row ${ev.foodWinner === o ? 'winner' : ''}">
        <div class="bar-label"><span>${esc(o)}</span><b>${voters.length}</b></div>
        <div class="bar"><span style="width:${(voters.length / max) * 100}%"></span></div>
        ${voters.length ? `<div class="muted small">${names(voters)}</div>` : ''}
      </div>`).join('')}
      ${majority.length ? `<p class="small">Going with the majority: ${majority.length} (${names(majority)})</p>` : ''}
      ${none.length ? `<p class="small muted">Can't come: ${names(none)}</p>` : ''}
    </div>`);
  }

  // dishes = buying list
  if (ev.hasTreat && ['dish', 'order', 'done'].includes(ev.stage)) {
    blocks.push(`<div class="card"><h3>Buying list · ${esc(ev.foodWinner)}</h3>${buyingListHtml(ev)}</div>`);
  }

  // cake / gift
  if (ev.collectFor) {
    const yes = res.filter((r) => r.contribute === 'Yes');
    const no = res.filter((r) => r.contribute === 'No' && r.personId !== ev.personId);
    blocks.push(`<div class="card"><h3>${ev.collectFor === 'Bill' ? 'Sharing the bill' : esc(ev.collectFor)}: ${yes.length} in</h3>
      ${yes.length ? `<p class="small">✅ ${names(yes)}</p>` : `<p class="muted small">Nobody yet.</p>`}
      ${no.length ? `<p class="small muted">Not in: ${names(no)}</p>` : ''}
    </div>`);
  }

  // who hasn't answered
  if (ev.stage !== 'done') {
    const waiting = notAnswered(ev);
    if (waiting.length) blocks.push(`<div class="card"><h3>Waiting for ${waiting.length}</h3>
      <p class="small muted">${waiting.map((p) => esc(p.name)).join(', ')}</p></div>`);
  }
  return blocks.join('');
}

function buyingListGroups(ev) {
  const res = responsesFor(ev.id);
  return {
    groups: ev.dishOptions.map((d) => ({ d, people: res.filter((r) => r.dish === d) })),
    skip: res.filter((r) => r.dish === 'SKIP'),
  };
}

function buyingListHtml(ev) {
  const { groups, skip } = buyingListGroups(ev);
  const total = groups.reduce((n, g) => n + g.people.length, 0);
  return `<ul class="buy-list">
    ${groups.map((g) => `<li><span class="qty">${g.people.length}</span><div><b>${esc(g.d)}</b>
      <div class="muted small">${g.people.map((r) => esc(nameOf(r.personId))).join(', ') || '—'}</div></div></li>`).join('')}
  </ul>
  <p class="small"><b>${total}</b> eating${skip.length ? ` · ${skip.length} not eating` : ''}</p>`;
}

function buyingListText(ev) {
  const { groups } = buyingListGroups(ev);
  const lines = groups.filter((g) => g.people.length)
    .map((g) => `• ${g.d} x${g.people.length} (${g.people.map((r) => nameOf(r.personId)).join(', ')})`);
  return `🛒 ${ev.foodWinner} order – ${ev.title}\n${lines.join('\n')}\nTotal: ${groups.reduce((n, g) => n + g.people.length, 0)}`;
}

function notAnswered(ev) {
  const res = responsesFor(ev.id);
  return state.data.people.filter((p) => {
    if (p.id === ev.personId) return false;
    const r = res.find((x) => x.personId === p.id);
    if (!r) return true;
    if (ev.stage === 'vote' && !r.foodVote) return true;
    if (ev.stage === 'dish' && r.foodVote !== 'NONE' && !r.dish) return true;
    if (ev.collectFor && !r.contribute && !chargesFor(ev.id).length) return true;
    return false;
  });
}

function summaryView(ev) {
  const charges = chargesFor(ev.id);
  const share = charges[0]?.amount || 0;
  const mine = charges.find((c) => c.personId === state.me);
  return `<div class="card summary">
    <h2>All done 🎉</h2>
    ${ev.collectFor ? `
      <div class="stats">
        <div><span>Total ${esc(billLabel(ev).replace(/^the /, ''))}</span><b>${money(ev.total)}</b></div>
        <div><span>Each person</span><b>${money(share)}</b></div>
        <div><span>People</span><b>${charges.length}</b></div>
      </div>
      ${mine ? `<p class="info">${money(mine.amount)} was added to your balance.</p>` : ''}
      <p class="small muted">Split between: ${charges.map((c) => esc(nameOf(c.personId))).join(', ')}</p>` : ''}
    ${photosHtml(ev)}
    ${ev.mediaLink ? `<a class="btn block" href="${esc(ev.mediaLink)}" target="_blank" rel="noopener">📸 Open photos & videos album</a>` : ''}
  </div>`;
}

function photosHtml(ev) {
  if (!ev.images.length) return '';
  return `<div class="photos">${ev.images.map((img) =>
    `<a href="${img.view}" target="_blank" rel="noopener"><img src="${img.thumb}" alt="Event photo" loading="lazy"></a>`).join('')}</div>`;
}

// ---------- ADMIN PANEL ON EVENT PAGE ----------
function adminEventPanel(ev) {
  const res = responsesFor(ev.id);
  const charged = chargesFor(ev.id).length > 0;
  const parts = [];

  if (ev.stage === 'vote') {
    const top = [...ev.foodOptions].sort((a, b) =>
      res.filter((r) => r.foodVote === b).length - res.filter((r) => r.foodVote === a).length)[0] || '';
    parts.push(`<form data-form="set-winner" data-event="${ev.id}" class="admin-block">
      <h3>1. Lock the place</h3>
      <p class="muted small">If there's a tie, pick the one the birthday person likes.</p>
      <label>Place<select name="winner">${ev.foodOptions.map((o) => `<option ${o === top ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
      <label>Dish options <span class="muted">(comma separated)</span>
        <input name="dishOptions" value="${esc(defaultDishes(top).join(', '))}"></label>
      <button class="btn primary">Lock place & open dish choice</button>
    </form>`);
  }
  if (ev.stage === 'dish') {
    parts.push(`<div class="admin-block"><h3>2. Close dish choice</h3>
      <p class="muted small">Do this when it's time to order.</p>
      <button class="btn primary" data-action="set-stage" data-event="${ev.id}" data-stage="order">Close & make buying list</button>
      <button class="btn" data-action="set-stage" data-event="${ev.id}" data-stage="vote">Back to voting</button></div>`);
  }
  if (ev.stage === 'order') {
    parts.push(`<div class="admin-block"><h3>Order</h3>
      <button class="btn" data-action="copy-list" data-event="${ev.id}">Copy buying list</button>
      <a class="btn" href="${waLink(buyingListText(ev))}" target="_blank" rel="noopener">Send list on WhatsApp</a>
      <button class="btn" data-action="set-stage" data-event="${ev.id}" data-stage="dish">Reopen dish choice</button></div>`);
  }

  if (ev.stage !== 'done') {
    if (ev.collectFor && !charged) {
      const saidYes = new Set(res.filter((r) => r.contribute === 'Yes').map((r) => r.personId));
      const others = state.data.people.filter((p) => p.id !== ev.personId);
      parts.push(`<form data-form="split" data-event="${ev.id}" class="admin-block">
        <h3>Split ${esc(billLabel(ev))}</h3>
        <p class="muted small">After you buy it. The total is split equally between everyone ticked as <b>In</b> and added to their balance. Tick <b>Paid</b> for anyone who has already given you the money. This closes the event.</p>
        <label>Total bill (${esc(state.data.currency)})<input name="total" type="number" min="0" step="0.01" inputmode="decimal" required></label>
        <div class="tick-table">
          <div class="tick-head"><span>Name</span><span>In</span><span>Paid</span></div>
          ${others.map((p) => `<div class="tick-row">
            <span>${esc(p.name)}</span>
            <input type="checkbox" class="tick-in" value="${p.id}" aria-label="${esc(p.name)} is in" ${saidYes.has(p.id) ? 'checked' : ''}>
            <input type="checkbox" class="tick-paid" value="${p.id}" aria-label="${esc(p.name)} has paid">
          </div>`).join('')}
          <div class="tick-tools"><button type="button" class="link small" data-action="tick-all" data-col="in">All in</button>
            <button type="button" class="link small" data-action="tick-all" data-col="paid">Everyone ticked has paid</button></div>
        </div>
        <p class="split-preview small"></p>
        <label>Note <span class="muted">(optional)</span><input name="note" value="${esc(ev.note)}" placeholder="e.g. Red velvet cake from Brands Bakery"></label>
        <label>Photos & videos album link <span class="muted">(optional)</span><input name="mediaLink" type="url" value="${esc(ev.mediaLink)}" placeholder="Google Photos / Drive link"></label>
        <button class="btn primary">Split & add to accounts</button>
      </form>`);
    } else {
      parts.push(`<form data-form="finish" data-event="${ev.id}" class="admin-block">
        <h3>Finish event</h3>
        <label>Photos & videos album link <span class="muted">(optional)</span><input name="mediaLink" type="url" value="${esc(ev.mediaLink)}"></label>
        <button class="btn primary">Mark as done</button>
      </form>`);
    }
  } else {
    parts.push(`<form data-form="event-info" data-event="${ev.id}" class="admin-block">
      <h3>Event details</h3>
      <label>Note<input name="note" value="${esc(ev.note)}"></label>
      <label>Photos & videos album link<input name="mediaLink" type="url" value="${esc(ev.mediaLink)}"></label>
      <button class="btn">Save details</button>
      <a class="btn" href="${waLink(summaryText(ev))}" target="_blank" rel="noopener">Share summary on WhatsApp</a>
    </form>`);
  }

  parts.push(`<div class="admin-block"><h3>Photos (bill, cake, gift)</h3>
    ${ev.stage !== 'done' ? photosHtml(ev) : ''}
    <label class="btn file-btn">Upload photos<input type="file" accept="image/*" multiple data-upload="${ev.id}" hidden></label>
    <p class="muted small">Videos: add them to a Google Photos album and paste the link above.</p></div>`);

  if (ev.stage !== 'done') {
    const waiting = notAnswered(ev);
    parts.push(`<div class="admin-block"><h3>Share & remind</h3>
      <a class="btn" href="${waLink(inviteText(ev))}" target="_blank" rel="noopener">Share event in WhatsApp group</a>
      ${waiting.length ? `<p class="small">Remind people who haven't answered:</p><div class="chips">
        ${waiting.map((p) => p.phone
          ? `<a class="chip" target="_blank" rel="noopener" href="${waLink(`Hi ${p.name}, please answer for ${ev.title} 👉 ${eventLink(ev.id)}`, p.phone)}">${esc(p.name)}</a>`
          : `<span class="chip off" title="No phone saved">${esc(p.name)}</span>`).join('')}</div>` : ''}
    </div>`);
  }
  if (ev.stage !== 'done' && !charged) {
    parts.push(`<form data-form="settings" data-event="${ev.id}" class="admin-block">
      <h3>Event settings</h3>
      ${switchesHtml(ev.hasTreat, ev.collectFor, ev.kind, `s-${ev.id}`)}
      <p class="muted small">Turning the food vote off skips the place vote and dishes. Turning it on again starts a fresh vote.</p>
      <p class="form-error" hidden></p>
      <button class="btn">Save settings</button>
    </form>`);
  }

  parts.push(`<div class="admin-block"><h3>Delete event</h3>
    <p class="muted small">For test events and mistakes. Removes the event, everyone's answers, and any amounts it added to balances. Uploaded photos stay in Drive.</p>
    <button class="btn danger" data-action="delete-event" data-event="${ev.id}">Delete event</button></div>`);
  return `<section class="card admin"><h2>Admin</h2>${parts.join('')}</section>`;
}

function defaultDishes(place) {
  return state.data.defaultDishes[place] || state.data.defaultOtherDishes;
}

function inviteText(ev) {
  const giver = nameOf(ev.personId);
  const lines = [isLunch(ev) ? `🍽️ ${ev.title} – ${fmtDate(ev.date)}`
    : ev.hasTreat ? `🎉 ${giver} is giving us a treat!` : `🎂 It's ${giver}'s birthday!`];
  if (ev.hasTreat) lines.push(`Vote where we eat: ${ev.foodOptions.join(' / ')}`);
  if (ev.collectFor === 'Bill') lines.push("We're splitting the bill. Tell us if you're in.");
  else if (ev.collectFor) lines.push(`We're ${ev.hasTreat ? 'also ' : ''}collecting for a ${collectWord(ev)}. Tell us if you're in.`);
  lines.push(`👉 ${eventLink(ev.id)}`);
  return lines.join('\n');
}

function summaryText(ev) {
  const charges = chargesFor(ev.id);
  const lines = [`✅ ${ev.title} – done!`];
  if (ev.collectFor && charges.length) {
    lines.push(`${ev.collectFor} total: ${money(ev.total)}`, `Each person: ${money(charges[0].amount)} (${charges.length} people)`);
  }
  if (ev.note) lines.push(ev.note);
  lines.push(`Bill & photos 👉 ${eventLink(ev.id)}`);
  return lines.join('\n');
}

// ---------- BALANCES ----------
function balancesView() {
  const { people, balances, ledger } = state.data;
  const sorted = [...people].sort((a, b) => (balances[b.id] || 0) - (balances[a.id] || 0));
  const pending = people.reduce((n, p) => n + Math.max(0, balances[p.id] || 0), 0);
  return `
    <div class="card balance ${pending > 0 ? 'owes' : 'clear'}"><span>Total pending in the group</span><strong>${money(pending)}</strong></div>
    <div class="card list">
      ${sorted.map((p) => {
        const bal = balances[p.id] || 0;
        const history = ledger.filter((l) => l.personId === p.id).reverse();
        return `<details class="person ${p.id === state.me ? 'is-me' : ''}" data-person="${p.id}" ${state.openPerson === p.id ? 'open' : ''}>
          <summary><span>${esc(p.name)}</span><b class="${bal > 0 ? 'neg' : 'pos'}">${bal > 0 ? money(bal) : bal < 0 ? `+${money(-bal)}` : 'Clear'}</b></summary>
          ${history.length ? `<ul class="history">${history.map((l) => `<li>
            <span>${esc(l.date)} · ${esc(l.note)}</span>
            <b class="${l.type === 'payment' ? 'pos' : 'neg'}">${l.type === 'payment' ? '−' : '+'}${money(l.amount)}</b>
            ${isAdmin() ? `<button class="link small remove" data-action="delete-entry" data-id="${l.id}" aria-label="Remove this entry">remove</button>` : ''}</li>`).join('')}</ul>`
          : '<p class="muted small">No history yet.</p>'}
          ${isAdmin() ? `<form class="pay-form" data-form="money" data-person="${p.id}">
            <input name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Amount" value="${bal > 0 ? bal : ''}" required>
            <input name="note" placeholder="Note (optional)">
            <div class="row-btns">
              <button class="btn primary" name="kind" value="payment">Record payment</button>
              <button class="btn" name="kind" value="charge">Add old due</button>
              ${bal > 0 && p.phone ? `<a class="btn" target="_blank" rel="noopener" href="${waLink(`Hi ${p.name}, a quick reminder: your pending birthday contribution is ${money(bal)}. Details 👉 ${location.origin}${location.pathname}#/balances`, p.phone)}">Remind</a>` : ''}
            </div>
          </form>` : ''}
        </details>`;
      }).join('')}
    </div>`;
}

// ---------- ADMIN ----------
function adminView() {
  if (!isAdmin()) {
    return `<form class="card" data-form="login">
      <h2>Admin login</h2>
      <p class="muted">Only the organiser needs this.</p>
      <input name="pin" type="password" inputmode="numeric" placeholder="Admin PIN" required autocomplete="current-password">
      <button class="btn primary block">Log in</button>
    </form>`;
  }
  return `
    <a class="btn primary block" href="#/new">+ New event</a>
    ${menuEditor()}
    <div class="card">
      <h2>People (${state.data.people.length})</h2>
      <p class="muted small">Phone numbers are only shown to the admin. Use full number with country code, e.g. 9715…</p>
      ${state.data.people.map((p) => `<form class="person-row" data-form="update-person" data-person="${p.id}">
        <input name="name" value="${esc(p.name)}" aria-label="Name">
        <input name="phone" value="${esc(p.phone)}" placeholder="Phone" inputmode="tel" aria-label="Phone">
        <button class="btn small">Save</button>
      </form>`).join('')}
      <form class="person-row add" data-form="add-person">
        <input name="name" placeholder="New person's name" required>
        <input name="phone" placeholder="Phone" inputmode="tel">
        <button class="btn primary small">Add</button>
      </form>
    </div>
    <button class="btn block" data-action="logout">Log out of admin</button>
    <p class="center small"><button class="link" data-action="forget-code">Forget the group code on this phone</button></p>`;
}

/** The two on/off switches: food vote and collecting money. */
function switchesHtml(foodOn, collectFor, kind, idp) {
  const collectOn = !!collectFor;
  const pick = collectFor || (kind === 'lunch' ? 'Bill' : 'Cake');
  const opt = (v, label) => `<option value="${v}" ${pick === v ? 'selected' : ''}>${label}</option>`;
  return `
    <div class="switch-block">
      <label class="switch" for="${idp}-food"><input type="checkbox" id="${idp}-food" name="hasTreat" ${foodOn ? 'checked' : ''}><span class="track"></span>Food vote</label>
      <p class="hint">People vote where to eat, then pick their dish. You get a buying list.</p>
    </div>
    <div class="switch-block">
      <label class="switch" for="${idp}-collect"><input type="checkbox" id="${idp}-collect" name="collect" ${collectOn ? 'checked' : ''}><span class="track"></span>Collect money</label>
      <p class="hint">People say if they're in, then you split the bill and it goes to their balance.</p>
      <label class="collect-only" for="${idp}-for" ${collectOn ? '' : 'hidden'}>Collecting for
        <select id="${idp}-for" name="collectFor">
          ${opt('Bill', 'Shared bill (split the food cost)')}${opt('Cake', 'Cake')}${opt('Gift', 'Gift')}${opt('Cake & gift', 'Cake & gift')}
        </select></label>
    </div>`;
}

// ---------- FOOD MENU EDITOR ----------
const tidyName = (x) => { const t = String(x || '').replace(/,/g, ' ').replace(/\s+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1); };
const menuCopy = (m) => m.map((x) => ({ place: x.place, dishes: [...x.dishes] }));
const menuDraft = () => (state.menuDraft ||= menuCopy(state.data.menu || []));
const menuChanged = () => !!state.menuDraft && JSON.stringify(state.menuDraft) !== JSON.stringify(state.data.menu || []);

function menuEditor() {
  const draft = menuDraft();
  return `<section class="card menu-card" aria-labelledby="menu-title">
    <h2 id="menu-title">Food menu</h2>
    <p class="muted small">The places and dishes offered when you make an event. Changing it doesn't touch events already made.</p>
    ${draft.map((m, i) => `<div class="menu-place">
      <div class="menu-head">
        <b>${esc(m.place)}</b>
        <button type="button" class="link small" data-action="menu-remove-place" data-i="${i}">Remove place</button>
      </div>
      <div class="chips">
        ${m.dishes.map((d, j) => `<span class="chip edit">${esc(d)}<button type="button" data-action="menu-remove-dish" data-i="${i}" data-j="${j}" aria-label="Remove ${esc(d)}">×</button></span>`).join('')
          || '<span class="muted small">No dishes yet. People will see Chicken, Beef, Mutton, Veg.</span>'}
      </div>
      <form class="inline-add" data-form="menu-add-dish" data-i="${i}">
        <label for="menu-dish-${i}" class="sr-only">Add a dish to ${esc(m.place)}</label>
        <input id="menu-dish-${i}" name="dish" placeholder="Add a dish" maxlength="40" required>
        <button class="btn small">Add</button>
      </form>
    </div>`).join('') || '<p class="muted small">No places yet. Add one below.</p>'}
    <form class="inline-add new-place" data-form="menu-add-place">
      <label for="menu-place" class="sr-only">New place</label>
      <input id="menu-place" name="place" placeholder="New place, e.g. Shawarma" maxlength="40" required>
      <button class="btn small">Add place</button>
    </form>
    ${menuChanged() ? `<div class="save-bar" role="status">
      <span>Not saved yet</span>
      <button type="button" class="btn small" data-action="menu-undo">Undo</button>
      <button type="button" class="btn primary small" data-action="menu-save">Save menu</button>
    </div>` : ''}
  </section>`;
}

/** Re-draws after a menu edit and puts the cursor back where it was. */
function redrawMenu(focusId) {
  render();
  if (focusId) document.getElementById(focusId)?.focus();
}

function newEventView() {
  if (!isAdmin()) return `<div class="card"><p>Only the admin can create events.</p><a href="#/admin">Log in</a></div>`;
  return `<form class="card" data-form="create-event">
    <h2>New event</h2>
    <div class="seg" role="radiogroup" aria-label="Event type">
      <label><input type="radio" name="kind" value="birthday" checked><span>🎂 Birthday</span></label>
      <label><input type="radio" name="kind" value="lunch"><span>🍽️ Lunch order</span></label>
    </div>
    <label class="birthday-only" for="ne-person">Whose birthday / who's giving the treat?
      <select id="ne-person" name="personId" required><option value="">Choose…</option>
      ${state.data.people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
    <label class="lunch-only" for="ne-title-lunch" hidden>Name
      <input id="ne-title-lunch" name="lunchTitle" placeholder="Lunch order" value="Lunch order"></label>
    <label for="ne-date">Date<input id="ne-date" name="date" type="date" value="${todayIso()}" required></label>
    ${switchesHtml(true, 'Cake', 'birthday', 'ne')}
    <fieldset class="treat-only food-pick">
      <legend>Places to vote on</legend>
      <div class="toggles">
        ${state.data.defaultFood.map((place, i) => `<label class="tog" for="ne-food-${i}"><input type="checkbox" id="ne-food-${i}" name="food" value="${esc(place)}" checked><span>${esc(place)}</span></label>`).join('')}
      </div>
      <label for="ne-extra" class="small">Add more just for this event <span class="muted">(comma separated)</span>
        <input id="ne-extra" name="extraFood" placeholder="e.g. Shawarma, Pizza"></label>
      <p class="muted small">Change the saved list in <a href="#/admin">Admin → Food menu</a>. People can also suggest places when they vote.</p>
    </fieldset>
    <label class="birthday-only" for="ne-title">Title <span class="muted">(optional)</span><input id="ne-title" name="title" placeholder="e.g. Gift for Justin's daughter"></label>
    <label for="ne-note">Note <span class="muted">(optional)</span><textarea id="ne-note" name="note" rows="2" placeholder="Any details for the group"></textarea></label>
    <p class="form-error" hidden></p>
    <button class="btn primary block">Create event</button>
  </form>`;
}

// ================= EVENTS (clicks & forms) =================
function afterRender() {
  if (state.busy) setBusy(true);
}

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-form]');
  if (!form) return;
  e.preventDefault();
  const f = Object.fromEntries(new FormData(form));
  const pin = state.pin;
  const evId = form.dataset.event;

  switch (form.dataset.form) {
    case 'set-me':
      if (!f.me) return;
      state.me = f.me;
      store.set('local', 'treatup-me', f.me);
      render();
      break;

    case 'respond': {
      const answers = {};
      const err = form.querySelector('.form-error');
      const showError = (msg) => { err.textContent = msg; err.hidden = false; };
      if (form.querySelector('[name=foodVote]')) {
        if (!f.foodVote) return showError('Pick a place first.');
        if (f.foodVote === 'SUGGEST' && !f.suggestion?.trim()) return showError('Type your suggestion.');
        answers.foodVote = f.foodVote;
        if (f.foodVote === 'SUGGEST') answers.suggestion = f.suggestion.trim();
      }
      if (form.querySelector('[name=dish]')) {
        if (!f.dish) return showError('Pick what you want to eat.');
        answers.dish = f.dish;
      }
      if (form.querySelector('[name=contribute]')) {
        if (!f.contribute) return showError('Tell us if you are in or not.');
        answers.contribute = f.contribute;
      }
      await run(() => api.respond(evId, state.me, answers), 'Saved, thank you! 🙌');
      break;
    }

    case 'login':
      setBusy(true);
      try {
        await api.checkPin(f.pin);
        state.pin = f.pin;
        store.set('session', 'treatup-pin', f.pin);
        await load();
        render();
        toast('Logged in as admin');
      } catch (err) { toast(cleanError(err), 'error'); } finally { setBusy(false); }
      break;

    case 'code': {
      const code = String(f.code || '').trim();
      const err = form.querySelector('.form-error');
      setBusy(true);
      try {
        await api.checkCode(code);
        state.code = code;
        store.set('local', 'treatup-code', code);
        api.setCode(code);
        await load();
        render();
      } catch (e2) {
        setBusy(false);
        err.textContent = isCodeError(e2) ? "That code isn't right. Check with the organiser." : cleanError(e2);
        err.hidden = false;
        return;
      }
      setBusy(false);
      break;
    }

    case 'menu-add-place': {
      const place = tidyName(f.place);
      if (!place) return;
      const draft = menuDraft();
      if (draft.some((m) => m.place.toLowerCase() === place.toLowerCase())) return toast(`${place} is already on the menu.`, 'error');
      draft.push({ place, dishes: [] });
      redrawMenu(`menu-dish-${draft.length - 1}`); // jump straight to adding its dishes
      break;
    }

    case 'menu-add-dish': {
      const i = Number(form.dataset.i);
      const dish = tidyName(f.dish);
      if (!dish) return;
      const m = menuDraft()[i];
      if (m.dishes.some((d) => d.toLowerCase() === dish.toLowerCase())) return toast(`${dish} is already there.`, 'error');
      m.dishes.push(dish);
      redrawMenu(`menu-dish-${i}`);
      break;
    }

    case 'settings': {
      const hasTreat = !!form.hasTreat.checked;
      const collectFor = form.collect.checked ? f.collectFor : '';
      const err = form.querySelector('.form-error');
      if (!hasTreat && !collectFor) { err.textContent = 'Keep the food vote or collecting money on.'; err.hidden = false; return; }
      await run(() => api.updateEventSettings(pin, evId, { hasTreat, collectFor }), 'Settings saved');
      break;
    }

    case 'add-person':
      await run(() => api.addPerson(pin, f.name, f.phone), `${f.name} added`);
      break;

    case 'update-person':
      await run(() => api.updatePerson(pin, form.dataset.person, { name: f.name, phone: f.phone }), 'Saved');
      break;

    case 'create-event': {
      const hasTreat = !!form.hasTreat.checked;
      const collectFor = form.collect.checked ? f.collectFor : '';
      const lunch = f.kind === 'lunch';
      const err = form.querySelector('.form-error');
      if (!hasTreat && !collectFor) { err.textContent = 'Turn on the food vote, collecting money, or both.'; err.hidden = false; return; }
      const foodOptions = hasTreat ? [...new Set([
        ...[...form.querySelectorAll('input[name=food]:checked')].map((c) => c.value),
        ...String(f.extraFood || '').split(',').map((x) => x.trim()).filter(Boolean),
      ])] : [];
      if (hasTreat && !foodOptions.length) { err.textContent = 'Pick at least one place to vote on, or turn the food vote off.'; err.hidden = false; return; }
      const id = await run(() => api.createEvent(pin, {
        kind: f.kind, personId: lunch ? '' : f.personId, date: f.date, hasTreat, collectFor,
        title: lunch ? f.lunchTitle : f.title, note: f.note,
        foodOptions,
      }), 'Event created. Now share it in the group!');
      if (id) location.hash = `#/event/${id}`;
      break;
    }

    case 'set-winner':
      await run(() => api.setWinner(pin, evId, f.winner, f.dishOptions.split(',').map((s) => s.trim()).filter(Boolean)),
        `${f.winner} it is! Dish choice is open.`);
      break;

    case 'split': {
      const personIds = [...form.querySelectorAll('.tick-in:checked')].map((c) => c.value);
      const paidIds = [...form.querySelectorAll('.tick-paid:checked')].map((c) => c.value).filter((id) => personIds.includes(id));
      const payers = personIds.length;
      const total = Number(f.total);
      if (!payers) return toast('Tick at least one person as In.', 'error');
      // Two-step confirm inside the page (works everywhere, no popup)
      const btn = form.querySelector('button.primary');
      if (form.dataset.armed !== String(total)) {
        form.dataset.armed = String(total);
        btn.textContent = `Yes, split ${money(total / payers)} each and close`;
        btn.classList.add('confirm');
        return;
      }
      await run(() => api.splitBill(pin, evId, total, { note: f.note, mediaLink: f.mediaLink, personIds, paidIds }),
        (r) => `Done! ${money(r.share)} added to ${r.people} people.`);
      break;
    }

    case 'finish':
      await run(() => api.finishEvent(pin, evId, { mediaLink: f.mediaLink }), 'Event closed');
      break;

    case 'event-info':
      await run(() => api.updateEventInfo(pin, evId, { note: f.note, mediaLink: f.mediaLink }), 'Saved');
      break;

    case 'money': {
      const kind = e.submitter?.value || 'payment';
      const personId = form.dataset.person;
      const fn = kind === 'payment' ? api.recordPayment : api.addCharge;
      await run(() => fn(pin, personId, Number(f.amount), f.note), kind === 'payment' ? 'Payment recorded' : 'Due added');
      break;
    }
  }
});

document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action } = btn.dataset;
  if (action === 'refresh') await run(async () => {}, 'Updated');
  if (action === 'change-me') { state.me = ''; store.set('local', 'treatup-me', ''); render(); window.scrollTo(0, 0); }
  if (action === 'logout') { state.pin = ''; store.set('session', 'treatup-pin', ''); await run(async () => {}, 'Logged out'); }
  if (action === 'forget-code') {
    state.code = ''; api.setCode(''); store.set('local', 'treatup-code', '');
    state.pin = ''; store.set('session', 'treatup-pin', '');
    state.needCode = true; state.data = null; render();
  }
  if (action === 'menu-remove-place') { menuDraft().splice(Number(btn.dataset.i), 1); redrawMenu(); }
  if (action === 'menu-remove-dish') { menuDraft()[Number(btn.dataset.i)].dishes.splice(Number(btn.dataset.j), 1); redrawMenu(); }
  if (action === 'menu-undo') { state.menuDraft = null; redrawMenu(); }
  if (action === 'menu-save') {
    const draft = menuDraft();
    if (!draft.length) return toast('Keep at least one place on the menu.', 'error');
    const saved = await run(() => api.saveMenu(state.pin, draft), 'Menu saved');
    if (saved !== undefined) { state.menuDraft = null; render(); }
  }
  if (action === 'tick-all') {
    const form = btn.closest('form');
    const boxes = [...form.querySelectorAll(btn.dataset.col === 'in' ? '.tick-in' : '.tick-in:checked ~ .tick-paid')];
    const turnOn = boxes.some((b) => !b.checked);
    boxes.forEach((b) => { b.checked = turnOn; });
    if (btn.dataset.col === 'in' && !turnOn) form.querySelectorAll('.tick-paid').forEach((b) => { b.checked = false; });
    updateSplitForm(form);
  }
  if (action === 'delete-event' || action === 'delete-entry') {
    if (!btn.dataset.armed) { // two-step: first tap asks, second tap does it
      btn.dataset.armed = '1';
      btn.textContent = action === 'delete-event' ? 'Tap again to delete for good' : 'tap again to remove';
      btn.classList.add('armed');
      return;
    }
    if (action === 'delete-event') {
      const done = await run(() => api.deleteEvent(state.pin, btn.dataset.event), 'Event deleted');
      if (done !== undefined) location.hash = '#/';
    } else {
      await run(() => api.deleteEntry(state.pin, btn.dataset.id), 'Entry removed');
    }
  }
  if (action === 'set-stage') await run(() => api.setStage(state.pin, btn.dataset.event, btn.dataset.stage), 'Updated');
  if (action === 'copy-list') {
    const ev = state.data.events.find((x) => x.id === btn.dataset.event);
    try { await navigator.clipboard.writeText(buyingListText(ev)); toast('Buying list copied'); }
    catch { toast('Could not copy. Use the WhatsApp button instead.', 'error'); }
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  // show the suggestion box only when "Suggest something else" is picked
  if (el.name === 'foodVote') {
    const box = el.form.querySelector('.suggest-input');
    box.hidden = el.value !== 'SUGGEST';
    if (!box.hidden) box.focus();
  }
  if (el.classList.contains('tick-paid') && el.checked) el.parentElement.querySelector('.tick-in').checked = true;
  if (el.classList.contains('tick-in') && !el.checked) el.parentElement.querySelector('.tick-paid').checked = false;
  if (el.closest?.('form[data-form="split"]')) updateSplitForm(el.form);
  if (el.name === 'winner') el.form.dishOptions.value = defaultDishes(el.value).join(', ');
  if (el.name === 'hasTreat') { const t = el.form.querySelector('.treat-only'); if (t) t.hidden = !el.checked; }
  if (el.name === 'collect') el.form.querySelector('.collect-only').hidden = !el.checked;
  if (el.name === 'hasTreat' || el.name === 'collect') { const er = el.form.querySelector('.form-error'); if (er) er.hidden = true; }
  if (el.name === 'kind') {
    const lunch = el.value === 'lunch';
    const f = el.form;
    f.querySelectorAll('.birthday-only').forEach((x) => { x.hidden = lunch; });
    f.querySelectorAll('.lunch-only').forEach((x) => { x.hidden = !lunch; });
    f.personId.required = !lunch;
    // sensible defaults: lunch = just a food list; birthday = treat + cake
    f.collect.checked = !lunch;
    f.collectFor.value = lunch ? 'Bill' : 'Cake';
    f.querySelector('.collect-only').hidden = lunch;
    f.hasTreat.checked = true;
    f.querySelector('.treat-only').hidden = false;
  }
  if (el.name === 'contribute' || el.name === 'dish' || el.name === 'foodVote') {
    const err = el.form.querySelector('.form-error');
    if (err) err.hidden = true;
  }
  if (el.dataset.upload) {
    const files = [...el.files];
    if (!files.length) return;
    await run(async () => {
      for (const [i, file] of files.entries()) {
        toast(`Uploading ${i + 1} of ${files.length}…`);
        await api.addImage(state.pin, el.dataset.upload, await compressImage(file));
      }
    }, `${files.length} photo${files.length > 1 ? 's' : ''} uploaded`);
  }
});

document.addEventListener('input', (e) => {
  const form = e.target.closest('form[data-form="split"]');
  if (!form) return;
  updateSplitForm(form);
});

function updateSplitForm(form) {
  const payers = form.querySelectorAll('.tick-in:checked').length;
  const paid = form.querySelectorAll('.tick-in:checked ~ .tick-paid:checked').length;
  const total = Number(form.total.value);
  if (form.dataset.armed) {
    delete form.dataset.armed;
    const btn = form.querySelector('button.primary');
    btn.textContent = 'Split & add to accounts';
    btn.classList.remove('confirm');
  }
  form.querySelector('.split-preview').textContent = payers && total > 0
    ? `= ${money(total / payers)} each for ${payers} people${paid ? ` · ${paid} already paid` : ''}` : `${payers} people ticked`;
}

/** Shrinks a photo before upload so it's fast on mobile data. */
function compressImage(file, maxSide = 1600, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve({ name: file.name.replace(/\.[^.]+$/, '') + '.jpg', mime: 'image/jpeg', data: dataUrl.split(',')[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Could not read ${file.name}`)); };
    img.src = url;
  });
}

// ================= START =================
// Fetch fresh data in the background (when switching pages or coming back to the app).
async function refreshQuietly() {
  if (!state.data || state.busy) return;
  try {
    const before = JSON.stringify(state.data);
    await load();
    const changed = JSON.stringify(state.data) !== before;
    const typing = document.activeElement?.matches('input, textarea, select');
    if (changed && !state.busy && !typing) render(); // only redraw when something is new
  } catch { /* keep showing the old data */ }
}
document.addEventListener('toggle', (e) => {
  const d = e.target;
  if (d.matches?.('details.person')) {
    if (d.open) state.openPerson = d.dataset.person;
    else if (state.openPerson === d.dataset.person) state.openPerson = '';
  }
}, true);
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); refreshQuietly(); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshQuietly();
});

(async function start() {
  render();
  if (!api.isConfigured()) return;
  try {
    await load();
  } catch (err) {
    if (isCodeError(err)) { render(); return; }
    app.innerHTML = `<main><div class="card"><h2>Couldn't load</h2><p>${esc(cleanError(err))}</p>
      <button class="btn primary" onclick="location.reload()">Try again</button></div></main>`;
    return;
  }
  render();
})();
