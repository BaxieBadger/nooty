// Supabase Realtime for de sider der står tændt hele tiden (wall.html, cover.html).
//
// I stedet for at hente hele tabellerne hvert X. sekund, abonnerer siden på ændringer:
// Supabase sender kun den række der er ændret, i det øjeblik det sker. Det sparer
// næsten al trafik (egress) og opdaterer samtidig hurtigere.
//
// Kræver at tabellerne er tilføjet Realtime-publikationen – se supabase/realtime.sql.
// Kræver supabase-js (UMD) indlæst før denne fil.
//
// Brug:
//   const ok = NootyRealtime.start({
//     url, key,
//     tables: ['projects', 'some_posts'],
//     onChange(table, eventType, newRow, oldRow) {...},   // eventType: INSERT | UPDATE | DELETE
//     onReconnect() {...},                               // forbindelsen var nede → hent alt én gang
//   });
//   // ok === false → supabase-js kunne ikke indlæses; siden bør falde tilbage til polling.
(function () {
  let client = null;
  let channel = null;

  function start(opts) {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      console.warn('NootyRealtime: supabase-js er ikke indlæst – falder tilbage til polling');
      return false;
    }
    stop();
    client = window.supabase.createClient(opts.url, opts.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    channel = client.channel('nooty-' + Math.random().toString(36).slice(2, 8));
    (opts.tables || []).forEach(table => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
        try { opts.onChange(table, payload.eventType, payload.new, payload.old); }
        catch (e) { console.warn('NootyRealtime onChange:', e); }
      });
    });
    let subscribedOnce = false;
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        // Første gang er data lige hentet af siden selv. Ved genforbindelse (fx efter
        // tabt wifi eller dvale) kan vi have misset ændringer, så hent alt én gang.
        if (subscribedOnce && opts.onReconnect) opts.onReconnect();
        subscribedOnce = true;
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('NootyRealtime:', status, err || '');
      }
    });
    return true;
  }

  function stop() {
    if (client && channel) client.removeChannel(channel);
    channel = null;
    client = null;
  }

  // Erstat/indsæt/fjern én række i en liste, uden at ændre rækkefølgen for de øvrige.
  function applyRow(list, eventType, newRow, oldRow, parse) {
    const id = String((newRow && newRow.id != null) ? newRow.id : (oldRow && oldRow.id));
    const idx = list.findIndex(x => String(x.id) === id);
    if (eventType === 'DELETE') {
      if (idx >= 0) list.splice(idx, 1);
      return list;
    }
    const obj = parse(newRow);
    if (!obj) { if (idx >= 0) list.splice(idx, 1); return list; }
    if (idx >= 0) list[idx] = obj; else list.push(obj);
    return list;
  }

  window.NootyRealtime = { start, stop, applyRow };
})();
