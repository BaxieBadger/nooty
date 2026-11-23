// Stemmestyring af opgaver – fælles for index.html, wall.html (og senere mobilsiden).
//
// Tryk én gang for at optage, én gang til for at stoppe. Lyden konverteres til WAV
// (16 kHz mono, så det virker ens i Chrome, Edge, Safari og Firefox), sendes til
// Supabase Edge Function "voice-command", og svaret vises i en bekræftelsesboks.
// Først når der trykkes OK, kaldes sidens egen create/update/remove.
//
// Brug:
//   NootyVoice.init({
//     getTasks: () => state.projects,
//     types: OPGAVE_TYPES,
//     getConfig: () => ({ url: SUPABASE_URL, key: SUPABASE_KEY }),
//     create: (fields, parentId) => {...},
//     update: (id, fields) => {...},
//     remove: (id) => {...},
//     position: { right: '92px', bottom: '24px' },   // valgfrit
//   });
(function () {
  const MAX_SECONDS = 60;
  const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  const PRIO = { high: 'Høj', mid: 'Middel', low: 'Lav' };

  let opts = null;
  let btn, panel, timerEl;
  let recorder = null, chunks = [], stream = null, startedAt = 0, tick = null, autoStop = null;
  let busy = false;

  const MIC_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><path d="M12 17v5"/></svg>';
  const STOP_SVG = '<svg viewBox="0 0 24 24" width="18" height="18"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>';

  function css() {
    const s = document.createElement('style');
    s.textContent = `
.nv-btn{position:fixed;z-index:390;width:52px;height:52px;border-radius:50%;border:none;cursor:pointer;
  background:var(--accent2,#7a8a5e);color:#fff;display:flex;align-items:center;justify-content:center;
  box-shadow:0 4px 14px rgba(0,0,0,.18);transition:background .2s,transform .15s;-webkit-tap-highlight-color:transparent}
.nv-btn:hover{transform:scale(1.05)}
.nv-btn.rec{background:#c0392b;animation:nv-pulse 1.4s ease-in-out infinite}
.nv-btn.busy{cursor:wait;opacity:.85}
.nv-btn.busy svg{display:none}
.nv-btn.busy::after{content:'';width:20px;height:20px;border-radius:50%;border:2.5px solid rgba(255,255,255,.4);border-top-color:#fff;animation:nv-spin .8s linear infinite}
.nv-timer{position:absolute;top:-22px;left:50%;transform:translateX(-50%);font:600 12px/1 system-ui,sans-serif;
  color:#c0392b;background:var(--surface,#fff);padding:3px 6px;border-radius:6px;display:none;white-space:nowrap}
.nv-btn.rec .nv-timer{display:block}
@keyframes nv-pulse{0%,100%{box-shadow:0 0 0 0 rgba(192,57,43,.5)}50%{box-shadow:0 0 0 12px rgba(192,57,43,0)}}
@keyframes nv-spin{to{transform:rotate(360deg)}}
.nv-panel{position:fixed;z-index:391;width:min(360px,calc(100vw - 32px));background:var(--surface,#fff);color:var(--text,#201e1d);
  border:1px solid var(--border,rgba(0,0,0,.15));border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.2);
  padding:16px;font:14px/1.45 system-ui,-apple-system,sans-serif;display:none}
.nv-panel.show{display:block}
.nv-kind{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text-muted,#82796a);margin-bottom:6px}
.nv-kind.delete{color:#c0392b}
.nv-summary{font-size:15px;font-weight:600;margin-bottom:8px}
.nv-details{margin:0 0 10px;padding:0;list-style:none;font-size:13px}
.nv-details li{padding:2px 0}.nv-details b{font-weight:600;color:var(--text-muted,#82796a);margin-right:4px}
.nv-subs{margin:0 0 10px;padding-left:20px;font-size:13px}
.nv-subs li{padding:2px 0}.nv-subs span{color:var(--text-muted,#82796a)}
.nv-transcript{font-size:12px;color:var(--text-muted,#82796a);font-style:italic;margin-bottom:12px}
.nv-actions{display:flex;gap:8px}
.nv-actions button{flex:1;padding:10px 12px;border-radius:9px;border:1px solid var(--border,rgba(0,0,0,.15));
  background:var(--surface2,#ebddc5);color:var(--text,#201e1d);font:600 14px system-ui,sans-serif;cursor:pointer}
.nv-actions button.ok{background:var(--accent,#c67139);border-color:transparent;color:#fff}
.nv-actions button.ok.delete{background:#c0392b}`;
    document.head.appendChild(s);
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function fmtDate(d) {
    if (!d) return 'ingen';
    const dt = new Date(d + 'T12:00:00');
    if (isNaN(dt)) return d;
    return `${WEEKDAYS[dt.getDay()]} ${dt.getDate()}. ${MONTHS[dt.getMonth()]}`;
  }
  function localDate(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }

  // ── UI ──
  function build() {
    css();
    btn = document.createElement('button');
    btn.className = 'nv-btn';
    btn.type = 'button';
    btn.title = 'Stemmestyring: tryk for at tale';
    btn.setAttribute('aria-label', 'Stemmestyring: tryk for at tale');
    btn.innerHTML = MIC_SVG + '<span class="nv-timer"></span>';
    timerEl = btn.querySelector('.nv-timer');
    panel = document.createElement('div');
    panel.className = 'nv-panel';
    panel.setAttribute('role', 'dialog');
    const pos = Object.assign({ right: '24px', bottom: '24px' }, opts.position || {});
    Object.assign(btn.style, pos);
    // Panelet lægges over knappen, højrestillet med samme afstand
    panel.style.right = pos.right;
    panel.style.bottom = `calc(${pos.bottom} + 64px)`;
    btn.addEventListener('click', onClick);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (recorder) cancelRecording(); hidePanel(); } });
    document.body.append(btn, panel);
  }

  function setVisible(v) { if (btn) btn.style.display = v ? 'flex' : 'none'; if (!v) hidePanel(); }
  function hidePanel() { panel.classList.remove('show'); panel.innerHTML = ''; }
  function showPanel(html) { panel.innerHTML = html; panel.classList.add('show'); }

  function showMessage(title, text) {
    showPanel(`<div class="nv-kind">${esc(title)}</div><div class="nv-summary">${esc(text)}</div>
      <div class="nv-actions"><button type="button" data-nv="close">Luk</button></div>`);
    panel.querySelector('[data-nv=close]').onclick = hidePanel;
  }

  // ── Optagelse ──
  async function onClick() {
    if (busy) return;
    if (recorder) { stopRecording(); return; }
    hidePanel();
    const cfg = opts.getConfig();
    if (!cfg.url || !cfg.key) { showMessage('Ikke forbundet', 'Forbind til Supabase først – stemmestyringen bruger samme forbindelse.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { showMessage('Ikke understøttet', 'Denne browser kan ikke optage lyd.'); return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      showMessage('Ingen mikrofon', 'Giv siden adgang til mikrofonen (ikonet i adresselinjen) og prøv igen.');
      return;
    }
    chunks = [];
    try {
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.start();
    } catch (e) {
      console.warn('NootyVoice: kunne ikke starte optagelse', e);
      recorder = null;
      resetButton();
      showMessage('Ingen mikrofon', 'Optagelsen kunne ikke starte. Tjek at mikrofonen ikke bruges af et andet program.');
      return;
    }
    startedAt = Date.now();
    btn.classList.add('rec');
    btn.innerHTML = STOP_SVG + '<span class="nv-timer">0:00</span>';
    timerEl = btn.querySelector('.nv-timer');
    btn.title = 'Tryk for at stoppe';
    tick = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      timerEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 250);
    autoStop = setTimeout(stopRecording, MAX_SECONDS * 1000);
  }

  function resetButton() {
    clearInterval(tick); clearTimeout(autoStop);
    btn.classList.remove('rec', 'busy');
    btn.innerHTML = MIC_SVG + '<span class="nv-timer"></span>';
    btn.title = 'Stemmestyring: tryk for at tale';
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null;
  }

  function cancelRecording() {
    if (!recorder) return;
    recorder.onstop = null;
    try { recorder.stop(); } catch (e) {}
    recorder = null;
    resetButton();
  }

  function stopRecording() {
    if (!recorder) return;
    const rec = recorder;
    recorder = null;
    const tooShort = Date.now() - startedAt < 600;
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      resetButton();
      if (tooShort) { showMessage('For kort', 'Tryk, sig din kommando, og tryk igen når du er færdig.'); return; }
      process(blob);
    };
    rec.stop();
  }

  // ── Lyd → WAV (16 kHz mono) ──
  async function toWavBase64(blob) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    ctx.close && ctx.close();
    const rate = 16000;
    const off = new OfflineAudioContext(1, Math.ceil(decoded.duration * rate), rate);
    const src = off.createBufferSource();
    src.buffer = decoded; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const buf = new ArrayBuffer(44 + pcm.length * 2);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
    for (let i = 0; i < pcm.length; i++) {
      const x = Math.max(-1, Math.min(1, pcm[i]));
      v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
    }
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function compactTasks() {
    return (opts.getTasks() || [])
      .filter(p => p && p.title && !p.done && !p.inboxItem)
      .map(p => ({
        id: String(p.id), title: p.title, deadline: p.deadline || '', type: p.type || '',
        underkat: p.underkat || '', prio: p.prio || '', parentId: p.parentId ? String(p.parentId) : null,
      }));
  }

  async function process(blob) {
    busy = true;
    btn.classList.add('busy');
    let stage = 'lyd';
    try {
      const audio = await toWavBase64(blob);
      stage = 'net';
      const now = new Date();
      const cfg = opts.getConfig();
      const res = await fetch(`${cfg.url.replace(/\/$/, '')}/functions/v1/voice-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: cfg.key, Authorization: 'Bearer ' + cfg.key },
        body: JSON.stringify({
          audio, mimeType: 'audio/wav',
          today: localDate(now), weekday: WEEKDAYS[now.getDay()],
          tasks: compactTasks(),
          types: (opts.types || []).map(t => ({ id: t.id, navn: t.navn, underkategorier: t.underkategorier || [] })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        let hint = data.error || data.message || data.msg || `Fejl ${res.status}`;
        if (res.status === 404) hint = 'Edge Function "voice-command" findes ikke – tjek navnet i Supabase.';
        if (res.status === 401) hint = 'Supabase afviste nøglen (401). Slå "Verify JWT" fra på funktionen.';
        if (data.detail) hint += ' – ' + String(data.detail).slice(0, 200);
        showMessage(`Noget gik galt (${res.status})`, hint);
        return;
      }
      showConfirm(data);
    } catch (e) {
      console.warn('NootyVoice:', stage, e);
      const why = `${e && e.name ? e.name + ': ' : ''}${e && e.message ? e.message : e}`;
      showMessage('Noget gik galt',
        stage === 'lyd'
          ? `Browseren kunne ikke læse optagelsen (${blob.type || 'ukendt format'}, ${Math.round(blob.size / 1024)} KB). ${why}`
          : `Kunne ikke nå Supabase-funktionen "voice-command". Er den deployet, og hedder den præcis sådan? (${why})`);
    } finally {
      busy = false;
      btn.classList.remove('busy');
    }
  }

  // ── Bekræftelse ──
  function findTask(id) { return (opts.getTasks() || []).find(p => String(p.id) === String(id)); }
  function typeName(id) { return (opts.types || []).find(t => t.id === id)?.navn || id; }

  function detailRows(fields, intent) {
    const rows = [];
    const f = fields || {};
    if (intent === 'update' && f.title) rows.push(['Ny titel', f.title]);
    if ('deadline' in f) rows.push(['Deadline', fmtDate(f.deadline)]);
    if (f.prio) rows.push(['Prioritet', PRIO[f.prio] || f.prio]);
    if (f.type) rows.push(['Type', typeName(f.type) + (f.underkat ? ' / ' + f.underkat : '')]);
    else if (f.underkat) rows.push(['Underkategori', f.underkat]);
    if (f.desc) rows.push(['Beskrivelse', f.desc]);
    if (f.done === true) rows.push(['Status', 'Færdig']);
    if (f.done === false) rows.push(['Status', 'Genåbnet']);
    return rows;
  }

  function showConfirm(a) {
    const transcript = a.transcript ? `<div class="nv-transcript">“${esc(a.transcript)}”</div>` : '';
    if (a.intent === 'unclear' || !['create', 'update', 'delete'].includes(a.intent)) {
      showPanel(`<div class="nv-kind">Forstod ikke helt</div>
        <div class="nv-summary">${esc(a.question || a.summary || 'Prøv igen.')}</div>${transcript}
        <div class="nv-actions"><button type="button" data-nv="close">Luk</button><button type="button" class="ok" data-nv="again">Prøv igen</button></div>`);
      panel.querySelector('[data-nv=close]').onclick = hidePanel;
      panel.querySelector('[data-nv=again]').onclick = () => { hidePanel(); onClick(); };
      return;
    }
    const target = a.targetId ? findTask(a.targetId) : null;
    const parent = a.parentId ? findTask(a.parentId) : null;
    const subs = a.intent === 'create' && Array.isArray(a.subtasks) ? a.subtasks.filter(s => s && s.title) : [];
    const onlySubs = a.intent === 'create' && !a.fields?.title && parent && subs.length;
    const kind = {
      create: onlySubs ? 'Nye delopgaver' : parent ? 'Ny delopgave' : 'Ny opgave',
      update: 'Ændr opgave', delete: 'Slet opgave',
    }[a.intent];
    const rows = [];
    if (a.intent === 'create' && !onlySubs) rows.push(['Titel', a.fields?.title]);
    if (parent) rows.push(['Under', parent.title]);
    if (target) rows.push(['Opgave', target.title]);
    if (a.intent === 'delete' && target) {
      const kids = (opts.getTasks() || []).filter(p => String(p.parentId) === String(target.id)).length;
      if (kids) rows.push(['OBS', `${kids} delopgave${kids !== 1 ? 'r' : ''} slettes også`]);
    }
    // Vis præcis det, der bliver gemt (efter oprydning), så boksen aldrig lover mere end der sker
    const effective = a.intent === 'delete' ? {} : cleanFields(a.fields);
    if (a.intent === 'update' && !Object.keys(effective).length) {
      showPanel(`<div class="nv-kind">Forstod ikke helt</div>
        <div class="nv-summary">Jeg fandt "${esc(target?.title || 'opgaven')}", men forstod ikke, hvad der skulle ændres.</div>${transcript}
        <div class="nv-actions"><button type="button" data-nv="close">Luk</button><button type="button" class="ok" data-nv="again">Prøv igen</button></div>`);
      panel.querySelector('[data-nv=close]').onclick = hidePanel;
      panel.querySelector('[data-nv=again]').onclick = () => { hidePanel(); onClick(); };
      return;
    }
    if (a.intent !== 'delete') rows.push(...detailRows(effective, a.intent));
    const okLabel = { create: 'Opret', update: 'Gem', delete: 'Slet' }[a.intent];
    const subList = subs.length
      ? `<div class="nv-kind" style="margin-top:4px">Delopgaver (${subs.length})</div>
         <ol class="nv-subs">${subs.map(s => `<li>${esc(s.title)}${s.deadline ? ` <span>· ${esc(fmtDate(s.deadline))}</span>` : ''}${s.prio === 'high' ? ' <span>· Høj</span>' : ''}</li>`).join('')}</ol>`
      : '';
    showPanel(`<div class="nv-kind ${a.intent === 'delete' ? 'delete' : ''}">${kind}</div>
      <div class="nv-summary">${esc(a.summary)}</div>
      <ul class="nv-details">${rows.map(([k, v]) => `<li><b>${esc(k)}:</b>${esc(v)}</li>`).join('')}</ul>${subList}${transcript}
      <div class="nv-actions"><button type="button" data-nv="cancel">Annuller</button>
      <button type="button" class="ok ${a.intent === 'delete' ? 'delete' : ''}" data-nv="ok">${okLabel}</button></div>`);
    panel.querySelector('[data-nv=cancel]').onclick = hidePanel;
    panel.querySelector('[data-nv=ok]').onclick = () => { hidePanel(); apply(a); };
    panel.querySelector('[data-nv=ok]').focus();
  }

  function cleanFields(f) {
    const out = {};
    const src = f || {};
    for (const k of ['title', 'desc', 'deadline', 'prio', 'type', 'underkat', 'done']) {
      if (src[k] !== undefined && src[k] !== null) out[k] = src[k];
    }
    if (out.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(out.deadline)) delete out.deadline;
    // Gemini svarer nogle gange med typens navn ("Kommunikation") i stedet for id'et
    // ("kommunikation"). Match på begge, uden forskel på store/små bogstaver.
    const norm = s => String(s || '').trim().toLowerCase();
    const types = opts.types || [];
    const findType = v => types.find(x => norm(x.id) === norm(v) || norm(x.navn) === norm(v));
    // "Kommunikation / Intern" i ét felt → del op i type og underkategori
    for (const k of ['type', 'underkat']) {
      if (out[k] && /[\/>]/.test(out[k])) {
        const [a, b] = String(out[k]).split(/\s*[\/>]\s*/);
        if (findType(a)) { out.type = a; if (b) out.underkat = b; }
      }
    }
    // Lagde Gemini typen i underkategori-feltet ("kategorien" → underkat), så flyt den over
    if (out.underkat && !out.type && findType(out.underkat)) { out.type = out.underkat; delete out.underkat; }
    if (out.type && out.underkat && norm(out.underkat) === norm(findType(out.type)?.navn)) delete out.underkat;
    if (out.type) {
      const t = types.find(x => norm(x.id) === norm(out.type) || norm(x.navn) === norm(out.type));
      if (t) out.type = t.id; else { delete out.type; delete out.underkat; }
    }
    if (out.underkat) {
      // Underkategorien skal findes under den (nye) type; ellers droppes den
      const t = out.type ? types.find(x => x.id === out.type) : null;
      const list = t ? (t.underkategorier || []) : types.flatMap(x => x.underkategorier || []);
      const u = list.find(x => norm(x) === norm(out.underkat));
      if (u) out.underkat = u; else delete out.underkat;
    }
    return out;
  }

  async function apply(a) {
    try {
      const fields = cleanFields(a.fields);
      if (a.intent === 'create') {
        const parentId = a.parentId ? findTask(a.parentId)?.id ?? null : null;
        const subs = (Array.isArray(a.subtasks) ? a.subtasks : []).filter(s => s && s.title);
        // Uden titel men med parentId: tilføj kun delopgaver til en eksisterende opgave
        let ownerId = parentId;
        if (fields.title) ownerId = await opts.create(fields, parentId);
        if (ownerId == null && subs.length) throw new Error('Kunne ikke finde hovedopgaven til delopgaverne');
        // Delopgaver arver type/underkategori fra hovedopgaven (host'en sørger for det via parentId)
        for (const s of subs) {
          await opts.create(cleanFields({ title: s.title, deadline: s.deadline, prio: s.prio, desc: s.desc }), ownerId);
        }
        return;
      }
      else if (a.intent === 'update') { const t = findTask(a.targetId); if (t) opts.update(t.id, fields); }
      else if (a.intent === 'delete') { const t = findTask(a.targetId); if (t) opts.remove(t.id); }
    } catch (e) {
      console.warn('NootyVoice apply:', e);
      showMessage('Noget gik galt', 'Ændringen kunne ikke gemmes.');
    }
  }

  window.NootyVoice = {
    init(o) {
      opts = o;
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
      else build();
    },
    setVisible,
  };
})();
