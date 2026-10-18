// GR·EAT Video AI – Oberfläche (ohne Build-Schritt, reines JavaScript)
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
  const fmtSec = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const STATUS = {
    processing: 'Wird geschnitten',
    review: 'Wartet auf Freigabe',
    changes_requested: 'Änderungen verlangt',
    approved: 'Freigegeben',
    publishing: 'Wird gepostet',
    published: 'Veröffentlicht',
    partly_published: 'Teilweise gepostet',
    publish_failed: 'Posten fehlgeschlagen',
    failed: 'Fehler beim Schneiden',
  };
  const FILTERS = {
    review: ['review', 'changes_requested'],
    work: ['processing', 'approved', 'publishing', 'failed', 'publish_failed', 'partly_published'],
    done: ['published', 'partly_published'],
    all: null,
  };
  const PLATFORM_LETTER = { instagram: 'IG', facebook: 'f', linkedin: 'in', youtube: '▶', tiktok: '♪' };

  const state = { role: null, meta: null, items: [], filter: 'review', cards: new Map(), pollTimer: null };

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin(); throw new Error(data.error || 'Bitte anmelden.'); }
    if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
    return data;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  // ---------- Navigation ----------

  function currentTab() {
    const tab = location.hash.slice(1).split('?')[0];
    const allowed = state.role === 'admin' ? ['hochladen', 'freigabe', 'konten'] : ['hochladen', 'freigabe'];
    return allowed.includes(tab) ? tab : state.role === 'admin' ? 'freigabe' : 'hochladen';
  }

  function route() {
    if (!state.role) return;
    const tab = currentTab();
    $$('.view').forEach((v) => (v.hidden = v.id !== `view-${tab}`));
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    if (tab === 'freigabe') loadItems();
    if (tab === 'konten') loadAccounts();
  }
  window.addEventListener('hashchange', route);

  function showLogin() {
    state.role = null;
    $$('.view').forEach((v) => (v.hidden = v.id !== 'view-login'));
    $('#tabs').hidden = true;
    $('#logoutBtn').hidden = true;
  }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { role } = await api('/api/login', { method: 'POST', body: { password: e.target.password.value } });
      e.target.reset();
      $('#loginError').hidden = true;
      await start(role);
    } catch (err) {
      $('#loginError').textContent = err.message;
      $('#loginError').hidden = false;
    }
  });

  $('#logoutBtn').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    showLogin();
  });

  async function start(role) {
    state.role = role;
    $('#tabs').hidden = false;
    $$('[data-admin]').forEach((el) => (el.hidden = role !== 'admin'));
    state.meta = await api('/api/meta');
    $('#logoutBtn').hidden = !(await api('/api/session')).authEnabled;
    buildUploadForm();
    route();
    refreshCount();
  }

  // ---------- Hochladen ----------

  let selectedFiles = [];

  function buildUploadForm() {
    const { categories, platforms } = state.meta;
    $('#categoryChips').innerHTML = Object.entries(categories).map(([k, label], i) =>
      `<label class="chip"><input type="radio" name="category" value="${k}" ${i === 0 ? 'checked' : ''}>${esc(label)}</label>`).join('');
    $('#platformChips').innerHTML = platforms.map((p) =>
      `<label class="chip"><input type="checkbox" name="platforms" value="${p.id}" checked><span class="dot ${p.connected ? 'on' : ''}" title="${p.connected ? 'verknüpft' : 'noch nicht verknüpft'}"></span>${esc(p.name)}</label>`).join('');
    try { $('#uploaderName').value = localStorage.getItem('gva-name') || ''; } catch { /* privater Modus */ }
  }

  function renderFileList() {
    const list = $('#fileList');
    list.innerHTML = '';
    selectedFiles.forEach((f, i) => {
      const li = document.createElement('li');
      const url = URL.createObjectURL(f);
      li.innerHTML = f.type.startsWith('video/')
        ? `<video src="${url}#t=0.5" muted playsinline preload="metadata"></video>`
        : f.type.startsWith('image/') ? `<img src="${url}" alt="">` : '<img alt="">';
      li.insertAdjacentHTML('beforeend', `<span>${esc(f.name)}</span><button type="button" aria-label="Entfernen">×</button>`);
      li.querySelector('button').onclick = () => { selectedFiles.splice(i, 1); renderFileList(); };
      list.append(li);
    });
    $('#uploadBtn').disabled = !selectedFiles.length;
    const v = selectedFiles.filter((f) => f.type.startsWith('video/')).length;
    const p = selectedFiles.length - v;
    $('#uploadBtn').textContent = selectedFiles.length
      ? `Hochladen (${[v && `${v} Video${v > 1 ? 's' : ''}`, p && `${p} Foto${p > 1 ? 's' : ''}`].filter(Boolean).join(', ')})`
      : 'Hochladen';
  }

  $('#fileInput').addEventListener('change', (e) => {
    selectedFiles.push(...e.target.files);
    e.target.value = '';
    renderFileList();
  });
  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, () => dz.classList.remove('drag')));
  dz.addEventListener('drop', (e) => {
    e.preventDefault();
    selectedFiles.push(...e.dataTransfer.files);
    renderFileList();
  });

  $('#uploadForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData();
    for (const f of selectedFiles) fd.append('files', f);
    for (const key of ['uploader', 'note', 'location', 'hook']) fd.append(key, form[key].value);
    fd.append('category', form.category.value);
    $$('input[name=platforms]:checked', form).forEach((c) => fd.append('platforms', c.value));
    try { localStorage.setItem('gva-name', form.uploader.value); } catch { /* egal */ }

    const prog = $('#uploadProgress');
    const err = $('#uploadError');
    prog.hidden = false;
    err.hidden = true;
    $('#uploadBtn').disabled = true;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/uploads');
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      $('.bar', prog).style.width = `${pct}%`;
      $('span', prog).textContent = pct < 100 ? `Wird hochgeladen … ${pct} %` : 'Wird gespeichert …';
    };
    xhr.onload = () => {
      prog.hidden = true;
      $('.bar', prog).style.width = '0';
      if (xhr.status === 201) {
        selectedFiles = [];
        renderFileList();
        form.note.value = form.location.value = form.hook.value = '';
        form.hidden = true;
        $('#uploadDone').hidden = false;
        refreshCount();
      } else {
        let msg = 'Hochladen fehlgeschlagen.';
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* Standardtext */ }
        if (xhr.status === 401) return showLogin();
        err.textContent = msg;
        err.hidden = false;
        $('#uploadBtn').disabled = false;
      }
    };
    xhr.onerror = () => {
      prog.hidden = true;
      err.textContent = 'Verbindung unterbrochen – bitte nochmal versuchen (WLAN?).';
      err.hidden = false;
      $('#uploadBtn').disabled = false;
    };
    xhr.send(fd);
  });

  $('#uploadAgain').addEventListener('click', () => {
    $('#uploadForm').hidden = false;
    $('#uploadDone').hidden = true;
  });

  // ---------- Freigabe-Liste ----------

  $('#filterChips').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    $$('#filterChips .chip').forEach((c) => c.classList.toggle('active', c === btn));
    renderItems(true);
  });

  async function loadItems() {
    try {
      const { items } = await api('/api/items');
      state.items = items;
      renderItems();
      updateCount();
    } catch (err) {
      toast(err.message);
    }
    schedulePoll();
  }

  function schedulePoll() {
    clearTimeout(state.pollTimer);
    const busy = state.items.some((i) => ['processing', 'approved', 'publishing'].includes(i.status));
    if (currentTab() === 'freigabe') state.pollTimer = setTimeout(loadItems, busy ? 3000 : 20000);
  }

  async function refreshCount() {
    try {
      state.items = (await api('/api/items')).items;
      updateCount();
    } catch { /* ignorieren */ }
  }

  function updateCount() {
    const n = state.items.filter((i) => i.status === 'review').length;
    $('#reviewCount').textContent = n;
    $('#reviewCount').hidden = !n;
  }

  function renderItems(force = false) {
    const list = $('#itemList');
    const allowed = FILTERS[state.filter];
    const visible = state.items.filter((i) => !allowed || allowed.includes(i.status));
    if (force) { state.cards.clear(); list.innerHTML = ''; }
    if (!visible.length) {
      list.innerHTML = `<div class="empty">${state.filter === 'review' ? 'Alles erledigt – nichts wartet auf Freigabe. 🎉' : 'Hier ist noch nichts.'}</div>`;
      state.cards.clear();
      return;
    }
    $('.empty', list)?.remove();
    const keep = new Set(visible.map((i) => i.id));
    for (const [id, card] of state.cards) if (!keep.has(id)) { card.el.remove(); state.cards.delete(id); }

    visible.forEach((item, idx) => {
      let card = state.cards.get(item.id);
      const changed = !card || card.updatedAt !== item.updatedAt;
      // Nicht neu zeichnen, solange jemand in der Karte tippt (sonst gehen Änderungen verloren).
      if (card && changed && !(card.dirty && card.status === item.status)) {
        const fresh = buildCard(item, card);
        card.el.replaceWith(fresh.el);
        card = fresh;
      } else if (!card) {
        card = buildCard(item);
      }
      state.cards.set(item.id, card);
      if (list.children[idx] !== card.el) list.insertBefore(card.el, list.children[idx] || null);
    });
  }

  function platformName(id) {
    return state.meta.platforms.find((p) => p.id === id)?.name || id;
  }

  function buildCard(item, prev) {
    const el = $('#tpl-item').content.firstElementChild.cloneNode(true);
    const card = {
      el, updatedAt: item.updatedAt, status: item.status, dirty: false,
      tab: prev?.tab || item.platforms[0] || 'instagram',
      texts: structuredClone(item.texts || {}),
      platforms: new Set(item.platforms),
      showChanges: prev?.showChanges && ['review', 'changes_requested'].includes(item.status),
    };
    const isAdmin = state.role === 'admin';
    const reviewable = ['review', 'changes_requested'].includes(item.status);
    const cat = state.meta.categories[item.category] || item.category;

    // Medien
    const media = $('.item-media', el);
    if (item.status === 'processing') {
      media.innerHTML = `<div class="placeholder"><div class="spinner"></div><div>${esc(item.progress || 'Wird verarbeitet …')}</div></div>`;
    } else if (item.videoUrl) {
      // Erst nur das Vorschaubild laden (spart mobile Daten), Video beim Antippen.
      media.innerHTML = `<button class="poster" type="button" aria-label="Reel abspielen" style="background-image:url('${item.thumbUrl}')"><span class="play">▶</span></button>`;
      $('.poster', media).onclick = () => {
        media.innerHTML = `<video src="${item.videoUrl}" controls autoplay playsinline></video>`;
      };
    } else {
      media.innerHTML = `<div class="placeholder">${esc(item.error || 'Kein Video')}</div>`;
    }

    // Kopf
    const body = $('.item-body', el);
    const parts = [];
    parts.push(`<div class="item-head">
      <div>
        <div class="item-title">${esc(cat)}${item.location ? ` · ${esc(item.location)}` : ''}</div>
        <div class="item-sub">${esc(item.uploader || 'Unbekannt')} · ${fmtDate(item.createdAt)}${item.window ? ` · ${Math.round(item.window.length)} s Reel${item.sourceDuration ? ` aus ${fmtSec(item.sourceDuration)} Rohmaterial` : ''}` : ''}${item.music ? ` · 🎵 ${esc(item.music)}` : ''}</div>
      </div>
      <span class="status ${item.status}">${STATUS[item.status] || item.status}</span>
    </div>`);
    if (item.note) parts.push(`<div class="item-sub">„${esc(item.note)}“</div>`);
    if (item.status === 'failed') parts.push(`<div class="warn">${esc(item.error)}</div>`);
    for (const w of item.warnings || []) parts.push(`<div class="warn">${esc(w)}</div>`);
    for (const f of item.feedback || []) {
      if (f.note) parts.push(`<div class="feedback"><b>${esc(f.by || 'Feedback')}</b> · ${fmtDate(f.at)}<br>${esc(f.note)}</div>`);
    }

    // Veröffentlichungs-Ergebnisse
    const results = Object.entries(item.publishResults || {});
    if (results.length) {
      parts.push(`<div class="results">${results.map(([pid, r]) => {
        const icon = { ok: '✅', error: '❌', running: '⏳' }[r.status] || '•';
        const detail = r.status === 'ok'
          ? (r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">ansehen</a>` : 'gepostet') + (r.note ? ` – ${esc(r.note)}` : '')
          : r.status === 'running' ? 'wird hochgeladen …' : esc(r.error);
        return `<div>${icon} <b>${esc(platformName(pid))}</b>: ${detail}</div>`;
      }).join('')}</div>`);
    }

    // Texte pro Plattform
    if (item.texts) {
      parts.push(`<div class="ptabs" role="tablist">${state.meta.platforms.map((p) => `
        <button type="button" data-ptab="${p.id}" class="${card.tab === p.id ? 'active' : ''}">
          ${isAdmin && reviewable ? `<input type="checkbox" data-pcheck="${p.id}" ${card.platforms.has(p.id) ? 'checked' : ''} title="auf ${esc(p.name)} posten">` : ''}
          ${esc(p.name)}${p.connected ? '' : ' <span title="nicht verknüpft">⚠︎</span>'}
        </button>`).join('')}</div>
        <div class="ptext"></div>`);
    }

    // Aktionen
    if (isAdmin) {
      const actions = [];
      if (reviewable) {
        actions.push('<button class="btn approve big" data-act="approve">✓ Freigeben &amp; posten</button>');
        actions.push('<button class="btn" data-act="toggle-changes">Änderungen verlangen</button>');
      }
      if (item.status === 'changes_requested') actions.push('<button class="btn small" data-act="resubmit">Erledigt – wieder zur Freigabe</button>');
      if (['publish_failed', 'partly_published'].includes(item.status)) actions.push('<button class="btn mango" data-act="retry">Fehlgeschlagene erneut posten</button>');
      if (item.status === 'failed') actions.push('<button class="btn mango" data-act="rerender">Neu versuchen</button>');
      actions.push('<span class="spacer"></span>');
      if (item.videoUrl) actions.push(`<a class="btn small ghost" href="${item.videoUrl}" download="GREAT-Reel-${item.id}.mp4">⬇ Video</a>`);
      if (!['publishing', 'approved'].includes(item.status)) actions.push('<button class="btn small ghost danger" data-act="delete">Löschen</button>');
      parts.push(`<div class="actions">${actions.join('')}</div><div class="changes-slot"></div>`);
    }

    body.innerHTML = parts.join('');
    if (item.texts) renderText(card, item);
    if (card.showChanges) renderChanges(card, item);

    body.addEventListener('input', (e) => {
      card.dirty = true;
      const field = e.target.dataset.field;
      if (field) {
        card.texts[card.tab] = { ...card.texts[card.tab], [field]: e.target.value };
        const counter = $('.count', body);
        if (counter) counter.textContent = countLabel(card.tab, e.target.value);
      }
    });
    body.addEventListener('click', (e) => onCardClick(e, card, item));
    return card;
  }

  const LIMITS = { instagram: 2200, facebook: 63206, linkedin: 3000, tiktok: 2200, youtube: 5000 };
  const countLabel = (pid, text) => `${text.length} / ${LIMITS[pid]} Zeichen`;

  function renderText(card, item) {
    const box = $('.ptext', card.el);
    const t = card.texts[card.tab] || {};
    const editable = state.role === 'admin' && !['published', 'publishing', 'approved'].includes(item.status);
    const ro = editable ? '' : 'readonly';
    box.innerHTML = card.tab === 'youtube'
      ? `<div class="stack"><label>Titel <input data-field="title" maxlength="100" value="${esc(t.title)}" ${ro}></label>
         <label>Beschreibung <textarea data-field="description" ${ro}>${esc(t.description)}</textarea></label></div>
         <div class="row"><span class="count">${countLabel('youtube', t.description || '')}</span>${editable ? '<button class="btn small ghost" data-act="regen-one">↻ Neuer Vorschlag</button>' : ''}</div>`
      : `<textarea data-field="caption" ${ro}>${esc(t.caption)}</textarea>
         <div class="row"><span class="count">${countLabel(card.tab, t.caption || '')}</span>${editable ? '<button class="btn small ghost" data-act="regen-one">↻ Neuer Vorschlag</button>' : ''}</div>`;
  }

  function renderChanges(card, item) {
    const slot = $('.changes-slot', card.el);
    if (!card.showChanges) { slot.innerHTML = ''; return; }
    const isVideo = item.kind === 'video';
    const w = item.window || { start: 0, length: 20 };
    const segs = (item.transcript?.segments || []).filter((s) => s.end > w.start && s.start < w.start + w.length);
    const music = state.meta.music;
    slot.innerHTML = `<div class="changes stack">
      <label>Was soll geändert werden?
        <textarea name="note" rows="3" placeholder="z. B. Anfang zu wackelig, bitte erst ab dem Kühlschrank; Text weniger förmlich"></textarea>
      </label>
      <details>
        <summary>Direkt am Video korrigieren (wird automatisch neu geschnitten)</summary>
        <div class="stack" style="margin-top:12px">
          <label>Überschrift im Video <input name="hook" maxlength="40" value="${esc(item.edit?.hook ?? item.hook ?? '')}" placeholder="leer = keine"></label>
          <div class="grid2">
            ${isVideo ? `<label>Start bei (Sekunden) <input name="start" type="number" min="0" step="0.5" value="${w.start}"></label>` : ''}
            <label>Länge (Sekunden) <input name="length" type="number" min="${state.meta.limits.min}" max="${state.meta.limits.max}" step="1" value="${Math.round(w.length)}"></label>
          </div>
          <label>Musik
            <select name="music">
              <option value="">Zufällig</option>
              <option value="none" ${item.edit?.music === 'none' ? 'selected' : ''}>Keine Musik</option>
              ${music.map((m) => `<option ${item.music === m && item.edit?.music ? 'selected' : ''}>${esc(m)}</option>`).join('')}
            </select>
          </label>
          ${isVideo ? `<label class="checkline"><input type="checkbox" name="subtitles" ${item.edit?.subtitles === false ? '' : 'checked'}> Untertitel anzeigen</label>` : ''}
          ${segs.length ? `<div><b style="font-size:14px">Untertitel korrigieren</b><div class="segments">${segs.map((s) =>
            `<div><span>${fmtSec(s.start - w.start)}</span><input data-seg="${s.start}" value="${esc(s.text)}"></div>`).join('')}</div></div>` : ''}
          <label class="checkline"><input type="checkbox" name="applyEdit"> Video mit diesen Einstellungen neu schneiden</label>
        </div>
      </details>
      <div class="actions"><button class="btn mango" data-act="send-changes">Änderungen senden</button><button class="btn ghost" data-act="toggle-changes">Abbrechen</button></div>
    </div>`;
    slot.oninput = () => {
      const apply = $('[name=applyEdit]', slot);
      if (apply && document.activeElement !== apply && document.activeElement?.closest('details')) apply.checked = true;
    };
  }

  function reviewerName() {
    try { return localStorage.getItem('gva-name') || ''; } catch { return ''; }
  }

  async function onCardClick(e, card, item) {
    const ptab = e.target.closest('[data-ptab]');
    if (e.target.matches('[data-pcheck]')) {
      card.dirty = true;
      e.target.checked ? card.platforms.add(e.target.dataset.pcheck) : card.platforms.delete(e.target.dataset.pcheck);
      return;
    }
    if (ptab) {
      card.tab = ptab.dataset.ptab;
      $$('[data-ptab]', card.el).forEach((b) => b.classList.toggle('active', b === ptab));
      renderText(card, item);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const btn = e.target.closest('[data-act]');
    const payload = { texts: card.texts, platforms: [...card.platforms], by: reviewerName() };
    const done = (res) => { card.dirty = false; replaceItem(res.item); };
    try {
      if (act === 'approve') {
        if (!card.platforms.size) return toast('Bitte mindestens eine Plattform anhaken.');
        const missing = [...card.platforms].filter((p) => !state.meta.platforms.find((x) => x.id === p)?.connected);
        if (missing.length && !confirm(`Nicht verknüpft: ${missing.map(platformName).join(', ')}.\nDort wird das Posten fehlschlagen. Trotzdem freigeben?`)) return;
        btn.disabled = true;
        done(await api(`/api/items/${item.id}/approve`, { method: 'POST', body: payload }));
        toast('Freigegeben – wird jetzt gepostet.');
      } else if (act === 'toggle-changes') {
        card.showChanges = !card.showChanges;
        renderChanges(card, item);
      } else if (act === 'send-changes') {
        const slot = $('.changes-slot', card.el);
        const body = { ...payload, note: $('[name=note]', slot).value };
        if ($('[name=applyEdit]', slot)?.checked) {
          const edit = { hook: $('[name=hook]', slot).value, length: $('[name=length]', slot).value, music: $('[name=music]', slot).value };
          if ($('[name=start]', slot)) edit.start = $('[name=start]', slot).value;
          if ($('[name=subtitles]', slot)) edit.subtitles = $('[name=subtitles]', slot).checked;
          const edited = $$('[data-seg]', slot);
          if (edited.length) {
            const map = new Map(edited.map((i) => [Number(i.dataset.seg), i.value]));
            edit.segments = item.transcript.segments.map((s) => (map.has(s.start) ? { ...s, text: map.get(s.start) } : s));
          }
          body.edit = edit;
        }
        if (!body.note.trim() && !body.edit) return toast('Bitte kurz beschreiben, was geändert werden soll.');
        btn.disabled = true;
        card.showChanges = false;
        done(await api(`/api/items/${item.id}/request-changes`, { method: 'POST', body }));
        toast(body.edit ? 'Wird neu geschnitten …' : 'Änderungswunsch gespeichert.');
      } else if (act === 'resubmit') {
        done(await api(`/api/items/${item.id}/resubmit`, { method: 'POST', body: payload }));
      } else if (act === 'retry') {
        done(await api(`/api/items/${item.id}/retry-publish`, { method: 'POST' }));
      } else if (act === 'rerender') {
        done(await api(`/api/items/${item.id}/rerender`, { method: 'POST' }));
      } else if (act === 'regen-one') {
        const res = await api(`/api/items/${item.id}/regenerate-texts`, { method: 'POST', body: { platform: card.tab } });
        card.texts[card.tab] = res.item.texts[card.tab];
        renderText(card, item);
        card.dirty = true;
      } else if (act === 'delete') {
        if (!confirm('Diesen Beitrag wirklich löschen?')) return;
        await api(`/api/items/${item.id}`, { method: 'DELETE' });
        state.items = state.items.filter((i) => i.id !== item.id);
        renderItems();
        updateCount();
      }
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
    }
  }

  function replaceItem(item) {
    state.items = state.items.map((i) => (i.id === item.id ? item : i));
    const card = state.cards.get(item.id);
    if (card) card.dirty = false;
    renderItems();
    updateCount();
    schedulePoll();
  }

  // ---------- Konten ----------

  async function loadAccounts() {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    const notice = $('#accountNotice');
    if (params.get('ok') || params.get('fehler')) {
      notice.textContent = params.get('ok') || params.get('fehler');
      notice.className = `notice ${params.get('ok') ? 'ok' : 'err'}`;
      notice.hidden = false;
      history.replaceState(null, '', '#konten');
    }
    try {
      const data = await api('/api/accounts');
      state.meta = await api('/api/meta');
      $('#accountList').innerHTML = data.platforms.map(accountCard).join('');
    } catch (err) {
      toast(err.message);
    }
  }

  function accountCard(p) {
    const acc = p.account;
    let body;
    if (acc) {
      const pages = acc.pages || [];
      body = `<div class="conn on">● Verknüpft als <b>${esc(acc.displayName)}</b></div>
        ${pages.length > 1 ? `<label>Seite wählen <select data-page="${p.id}">${pages.map((pg) =>
          `<option value="${esc(pg.pageId)}" ${pg.pageId === acc.pageId ? 'selected' : ''}>${esc(pg.pageName)}</option>`).join('')}</select></label>` : ''}
        <small>Seit ${fmtDate(acc.updatedAt)}${acc.expiresAt ? ` · Zugang gültig bis ${fmtDate(new Date(acc.expiresAt).toISOString())} (wird automatisch erneuert)` : ''}</small>
        <div class="actions"><a class="btn small" href="/auth/${p.id}/start">Neu verbinden</a><button class="btn small ghost danger" data-disconnect="${p.id}">Trennen</button></div>`;
    } else if (!p.configured) {
      body = `<div class="conn off">○ Noch nicht eingerichtet</div>
        <small>Einmalig eine App beim Anbieter anlegen und in der <code>.env</code> eintragen: ${p.requiredEnv.map((k) => `<code>${k}</code>`).join(' ')}</small>
        <small>Weiterleitungs-URL (beim Anbieter eintragen): <code>${esc(p.redirectUri)}</code></small>`;
    } else {
      body = `<div class="conn off">○ Nicht verknüpft</div>
        <small>Weiterleitungs-URL: <code>${esc(p.redirectUri)}</code></small>
        <div class="actions"><a class="btn primary" href="/auth/${p.id}/start">Mit ${esc(p.name)} verbinden</a></div>`;
    }
    return `<div class="card account">
      <div class="account-head"><span class="logo-badge ${p.id}">${PLATFORM_LETTER[p.id]}</span><h2 style="margin:0">${esc(p.name)}</h2></div>
      ${body}
    </div>`;
  }

  $('#accountList').addEventListener('click', async (e) => {
    const pid = e.target.dataset.disconnect;
    if (!pid || !confirm('Verknüpfung wirklich trennen?')) return;
    await api(`/api/accounts/${pid}`, { method: 'DELETE' });
    loadAccounts();
  });
  $('#accountList').addEventListener('change', async (e) => {
    const pid = e.target.dataset.page;
    if (!pid) return;
    try {
      await api(`/api/accounts/${pid}/page`, { method: 'POST', body: { pageId: e.target.value } });
      toast('Seite gespeichert.');
    } catch (err) {
      toast(err.message);
    }
    loadAccounts();
  });

  // ---------- Start ----------
  api('/api/session').then(({ role }) => (role ? start(role) : showLogin())).catch(showLogin);
})();
