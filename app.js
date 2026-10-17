(() => {
  'use strict';

  const tg = window.Telegram && window.Telegram.WebApp;
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => Math.floor(n).toLocaleString('ru-RU');

  const UP = {
    tap:    { ico: '👊', name: 'Тяжёлая лапа',   desc: (u) => `Монет за тап: ${fmt(u.now)} → ${fmt(u.next)}` },
    energy: { ico: '🔋', name: 'Бездонный мешок', desc: (u) => `Макс. энергия: ${fmt(u.now)} → ${fmt(u.next)}` },
    regen:  { ico: '🍖', name: 'Сытный ужин',     desc: (u) => `Энергия в секунду: ${u.now} → ${u.next}` },
    mine:   { ico: '⛏️', name: 'Гоблинская шахта', desc: (u) => `Доход в час: ${fmt(u.now)} → ${fmt(u.next)}` },
  };

  const S = {
    token: null, ready: false,
    coins: 0, energy: 0, maxEnergy: 1, regen: 1, power: 1, mine: 0,
    pending: 0, seq: Date.now(), inflight: false,
    data: null, tab: 'tap', rafQueued: false,
  };

  // ---------- сеть ----------
  async function request(path, opts = {}, retryAuth = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (S.token) headers.Authorization = `Bearer ${S.token}`;
    const res = await fetch(`/api${path}`, {
      method: opts.method || 'GET', headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    if (res.status === 401 && retryAuth && path !== '/auth') {
      await login();
      return request(path, opts, false);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error || 'error'); e.status = res.status; throw e; }
    return data;
  }

  async function login() {
    const res = await fetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: tg.initData }),
    });
    if (!res.ok) throw new Error('auth_failed');
    S.token = (await res.json()).token;
  }

  // ---------- состояние ----------
  function applyServer(d) {
    S.data = d;
    S.power = d.tapPower; S.regen = d.regenPerSec; S.maxEnergy = d.maxEnergy; S.mine = d.minePerHour;
    // оптимистично добавляем тапы, ещё не отправленные на сервер
    S.coins = d.coins + S.pending * S.power;
    S.energy = Math.max(0, d.energy - S.pending);
    scheduleRender();
  }

  async function flush() {
    if (S.inflight || S.pending === 0 || !S.ready) return;
    const count = Math.min(S.pending, 100);
    S.inflight = true; S.pending -= count;
    try {
      applyServer(await request('/tap', { method: 'POST', body: { count, seq: ++S.seq } }));
    } catch (e) {
      if (e.status === 409 || e.status === 400) { S.pending = 0; await refresh().catch(() => {}); }
      else if (e.status === 429) { S.pending += count; }
      else { S.pending += count; toast('Нет связи с сервером…', true); }
    } finally { S.inflight = false; }
  }

  async function refresh() { applyServer(await request('/state')); }

  // ---------- интерфейс ----------
  function scheduleRender() {
    if (S.rafQueued) return;
    S.rafQueued = true;
    requestAnimationFrame(() => { S.rafQueued = false; render(); });
  }

  function render() {
    const d = S.data; if (!d) return;
    $('#player').textContent = d.user.name;
    $('#coins').textContent = fmt(S.coins);
    $('#shopCoins').textContent = fmt(S.coins);
    $('#power').textContent = S.power;
    $('#rate').textContent = fmt(S.mine);
    $('#energy').textContent = fmt(S.energy);
    $('#maxEnergy').textContent = fmt(S.maxEnergy);
    $('#energyFill').style.width = `${Math.min(100, (S.energy / S.maxEnergy) * 100)}%`;
    $('#goblin').classList.toggle('empty', S.energy < 1);
    $('#friends').textContent = d.friends;
    $('#bonusYou').textContent = fmt(d.refBonus.you);
    $('#bonusFriend').textContent = fmt(d.refBonus.friend);
    if (S.tab === 'shop') renderShop();
  }

  function renderShop() {
    const list = $('#shopList');
    list.textContent = '';
    for (const u of S.data.upgrades) {
      const meta = UP[u.type];
      const card = document.createElement('div'); card.className = 'card up';
      const ico = document.createElement('div'); ico.className = 'up-ico'; ico.textContent = meta.ico;
      const body = document.createElement('div'); body.className = 'up-body';
      const name = document.createElement('div'); name.className = 'up-name'; name.textContent = `${meta.name} · ур. ${u.level}`;
      const desc = document.createElement('div'); desc.className = 'up-desc'; desc.textContent = u.maxed ? 'Максимальный уровень' : meta.desc(u);
      body.append(name, desc);
      const btn = document.createElement('button'); btn.className = 'buy'; btn.type = 'button';
      btn.textContent = u.maxed ? 'MAX' : `🪙 ${fmt(u.cost)}`;
      btn.disabled = u.maxed || S.coins < u.cost;
      btn.addEventListener('click', () => buy(u.type));
      card.append(ico, body, btn);
      list.append(card);
    }
  }

  async function buy(type) {
    try {
      await flush();
      applyServer(await request('/upgrade', { method: 'POST', body: { type } }));
      haptic('success');
      renderShop();
    } catch (e) {
      toast(e.message === 'not_enough_coins' ? 'Не хватает золота' : 'Не получилось купить', true);
      await refresh().catch(() => {});
    }
  }

  function haptic(kind) {
    try {
      const h = tg && tg.HapticFeedback; if (!h) return;
      if (kind === 'success') h.notificationOccurred('success'); else h.impactOccurred('light');
    } catch { /* ignore */ }
  }

  let toastTimer;
  function toast(text, isErr) {
    const t = $('#toast'); t.textContent = text; t.className = `toast${isErr ? ' err' : ''}`; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200);
  }

  function floatText(x, y, text) {
    const fx = $('#fx');
    if (fx.childElementCount > 25) fx.firstElementChild.remove();
    const el = document.createElement('div'); el.className = 'float'; el.textContent = text;
    el.style.left = `${x}px`; el.style.top = `${y}px`;
    el.addEventListener('animationend', () => el.remove());
    fx.append(el);
  }

  function onTap(e) {
    e.preventDefault();
    if (!S.ready) return;
    const btn = $('#goblin');
    if (S.energy < 1) { toast('Нет энергии — подожди немного ⚡'); return; }
    S.energy -= 1; S.coins += S.power; S.pending += 1;
    btn.classList.add('hit'); setTimeout(() => btn.classList.remove('hit'), 70);
    floatText(e.clientX, e.clientY - 20, `+${S.power}`);
    haptic('light');
    scheduleRender();
    if (S.pending >= 25) flush();
  }

  // ---------- вкладки ----------
  function showTab(name) {
    S.tab = name;
    for (const el of document.querySelectorAll('.tab')) el.hidden = el.id !== `tab-${name}`;
    for (const b of document.querySelectorAll('.nav button')) b.classList.toggle('on', b.dataset.tab === name);
    if (name === 'shop') renderShop();
    if (name === 'top') loadTop();
  }

  async function loadTop() {
    try {
      const d = await request('/leaderboard');
      const list = $('#topList'); list.textContent = '';
      for (const r of d.top) {
        const li = document.createElement('li'); if (r.isMe) li.className = 'me';
        const rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = r.rank;
        const name = document.createElement('span'); name.className = 'name'; name.textContent = r.name;
        const score = document.createElement('span'); score.className = 'score'; score.textContent = `🪙 ${fmt(r.score)}`;
        li.append(rank, name, score); list.append(li);
      }
      $('#me').textContent = d.me ? `Твоё место: #${fmt(d.me.rank)} · 🪙 ${fmt(d.me.score)}` : '';
    } catch { toast('Не удалось загрузить рейтинг', true); }
  }

  async function copyLink() {
    const link = S.data.refLink;
    try { await navigator.clipboard.writeText(link); toast('Ссылка скопирована'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = link; document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast('Ссылка скопирована'); } catch { toast(link); }
      ta.remove();
    }
  }

  function share() {
    const text = '👺 Присоединяйся к Goblin Empire — тапай и строй империю гоблинов!';
    const url = `https://t.me/share/url?url=${encodeURIComponent(S.data.refLink)}&text=${encodeURIComponent(text)}`;
    if (tg && tg.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank');
  }

  // ---------- старт ----------
  function gate(text) { $('#gateText').textContent = text; $('#gate').hidden = false; }

  async function init() {
    if (!tg || !tg.initData) { gate('Открой игру через Telegram: найди бота и нажми «Играть».'); return; }
    try {
      tg.ready(); tg.expand();
      try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch { /* старые версии */ }
      try { tg.setHeaderColor('#0f1a0c'); tg.setBackgroundColor('#0f1a0c'); } catch { /* ignore */ }
    } catch { /* ignore */ }

    $('#goblin').addEventListener('pointerdown', onTap);
    $('#goblin').addEventListener('contextmenu', (e) => e.preventDefault());
    for (const b of document.querySelectorAll('.nav button')) b.addEventListener('click', () => showTab(b.dataset.tab));
    $('#shareBtn').addEventListener('click', share);
    $('#copyBtn').addEventListener('click', copyLink);

    try {
      await login();
      await refresh();
      S.ready = true;
    } catch {
      gate('Не удалось войти. Закрой и открой игру заново.');
      return;
    }

    // регенерация энергии и пассивный доход — визуально между запросами
    setInterval(() => {
      S.energy = Math.min(S.maxEnergy, S.energy + S.regen * 0.25);
      S.coins += S.mine / 3600 * 0.25;
      scheduleRender();
    }, 250);
    setInterval(flush, 1000);
    setInterval(() => { if (!S.inflight && S.pending === 0) refresh().catch(() => {}); }, 20000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush(); else if (S.pending === 0) refresh().catch(() => {});
    });
  }

  init();
})();
