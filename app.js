(function () {
  'use strict';

  /* ---------------------------------------------------------------
     Storage: a small JSON list in localStorage, with an in-memory
     fallback so the app still works if storage is blocked.
  --------------------------------------------------------------- */
  var KEY = 'mood.entries.v1';
  var memoryOnly = null; // raw string used only when localStorage is unavailable

  function readRaw() {
    try { return localStorage.getItem(KEY); } catch (e) { return memoryOnly; }
  }

  function writeRaw(raw) {
    try {
      localStorage.setItem(KEY, raw);
      return true;
    } catch (e) {
      memoryOnly = raw;
      return false;
    }
  }

  function isValid(e) {
    return e && typeof e === 'object' &&
      typeof e.id === 'string' &&
      Number.isInteger(e.v) && e.v >= 1 && e.v <= 10 &&
      typeof e.t === 'number' && isFinite(e.t);
  }

  function load() {
    var raw = readRaw();
    if (!raw) return [];
    try {
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('not an array');
      return parsed.filter(isValid);
    } catch (e) {
      // Never silently destroy data: keep the unreadable copy aside.
      try { localStorage.setItem(KEY + '.corrupt', raw); } catch (e2) {}
      return [];
    }
  }

  var entries = load();

  function save() {
    var ok = writeRaw(JSON.stringify(entries));
    if (!ok) showToast('Could not save to this device', null);
    return ok;
  }

  function newId(t) {
    return t.toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------------------------------------------------------------
     Elements
  --------------------------------------------------------------- */
  var $ = function (id) { return document.getElementById(id); };
  var viewPad = $('view-pad');
  var viewLog = $('view-log');
  var pad = document.querySelector('.pad');
  var logEl = $('log');
  var scroller = $('scroller');
  var editBtn = $('edit-toggle');
  var footEl = document.querySelector('.foot');
  var toastEl = $('toast');
  var toastText = $('toast-text');
  var toastUndo = $('toast-undo');

  var view = 'pad';
  var editing = false;
  var locked = false;
  var freshId = null;

  /* ---------------------------------------------------------------
     Formatting
  --------------------------------------------------------------- */
  var timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
  var weekdayFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long' });

  function startOfDay(ts) {
    var d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function dayLabel(dayStart) {
    var now = Date.now();
    var diff = Math.round((startOfDay(now) - dayStart) / 86400000);
    var d = new Date(dayStart);
    var sameYear = d.getFullYear() === new Date(now).getFullYear();
    var dateStr = new Intl.DateTimeFormat(undefined, sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
    if (diff === 0) return { main: 'Today', sub: dateStr };
    if (diff === 1) return { main: 'Yesterday', sub: dateStr };
    return { main: weekdayFmt.format(d), sub: dateStr };
  }

  function avg(list) {
    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i].v;
    return Number((sum / list.length).toFixed(1));
  }

  /* ---------------------------------------------------------------
     Render the log
  --------------------------------------------------------------- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function renderLog() {
    var sorted = entries.slice().sort(function (a, b) { return b.t - a.t; });
    var frag = document.createDocumentFragment();

    if (!sorted.length) {
      frag.appendChild(el('p', 'empty', 'Nothing written down yet.'));
      editing = false;
    } else {
      var i = 0;
      while (i < sorted.length) {
        var dayStart = startOfDay(sorted[i].t);
        var group = [];
        while (i < sorted.length && startOfDay(sorted[i].t) === dayStart) {
          group.push(sorted[i]);
          i++;
        }

        var label = dayLabel(dayStart);
        var head = el('div', 'day');
        var name = el('span', 'day-name', label.main);
        name.appendChild(el('small', null, label.sub));
        head.appendChild(name);
        if (group.length > 1) head.appendChild(el('span', 'day-avg', 'avg ' + avg(group)));
        frag.appendChild(head);

        for (var j = 0; j < group.length; j++) {
          var e = group[j];
          var row = el('div', 'entry' + (e.id === freshId ? ' fresh' : ''));
          row.appendChild(el('span', 'entry-val', String(e.v)));
          row.appendChild(el('span', 'entry-time', timeFmt.format(new Date(e.t))));
          var del = el('button', 'entry-del', 'Delete');
          del.type = 'button';
          del.dataset.id = e.id;
          del.setAttribute('aria-label', 'Delete ' + e.v + ' at ' + timeFmt.format(new Date(e.t)));
          row.appendChild(del);
          frag.appendChild(row);
        }
      }
    }

    logEl.textContent = '';
    logEl.appendChild(frag);
    logEl.classList.toggle('editing', editing);
    editBtn.hidden = !sorted.length;
    editBtn.textContent = editing ? 'Done' : 'Edit';
    editBtn.classList.toggle('on', editing);
    footEl.hidden = !sorted.length;
  }

  /* ---------------------------------------------------------------
     Views and history (so the Android back button behaves)
  --------------------------------------------------------------- */
  function showView(next) {
    view = next;
    var isPad = next === 'pad';
    viewPad.hidden = !isPad;
    viewLog.hidden = isPad;
    var active = isPad ? viewPad : viewLog;
    active.classList.remove('enter');
    void active.offsetWidth; // restart the animation
    active.classList.add('enter');

    if (isPad) {
      editing = false;
      locked = false;
      pad.classList.remove('locked');
      clearHits();
    } else {
      renderLog();
      scroller.scrollTop = 0;
    }
  }

  function goLog(withFresh) {
    freshId = withFresh || null;
    history.pushState({ v: 'log' }, '', '#log');
    showView('log');
    freshId = null;
  }

  function goPad() {
    // The log is always opened from the pad, so stepping back lands on it.
    if (history.state && history.state.v === 'log') history.back();
    else showView('pad');
  }

  window.addEventListener('popstate', function () {
    var want = (history.state && history.state.v === 'log') || location.hash === '#log' ? 'log' : 'pad';
    if (want !== view) showView(want);
  });

  /* ---------------------------------------------------------------
     Toast with undo
  --------------------------------------------------------------- */
  var toastTimer = null;
  var toastAction = null;

  function showToast(text, undoFn) {
    clearTimeout(toastTimer);
    toastAction = undoFn;
    toastText.textContent = text;
    toastUndo.hidden = !undoFn;
    toastEl.hidden = false;
    // restart the entrance animation
    toastEl.style.animation = 'none';
    void toastEl.offsetWidth;
    toastEl.style.animation = '';
    toastTimer = setTimeout(hideToast, undoFn ? 5000 : 3000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
    toastAction = null;
  }

  toastUndo.addEventListener('click', function () {
    var fn = toastAction;
    hideToast();
    if (fn) fn();
  });

  /* ---------------------------------------------------------------
     Actions
  --------------------------------------------------------------- */
  function buzz() {
    try { if (navigator.vibrate) navigator.vibrate(12); } catch (e) {}
  }

  function addEntry(v) {
    var t = Date.now();
    var entry = { id: newId(t), v: v, t: t };
    entries.push(entry);
    save();
    return entry;
  }

  function removeEntry(id) {
    var idx = -1;
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) { idx = i; break; }
    if (idx === -1) return null;
    var removed = entries.splice(idx, 1)[0];
    save();
    return removed;
  }

  function clearHits() {
    var hits = pad.querySelectorAll('.hit');
    for (var i = 0; i < hits.length; i++) hits[i].classList.remove('hit');
  }

  pad.addEventListener('click', function (ev) {
    var key = ev.target.closest('.key');
    if (!key || locked || view !== 'pad') return;
    var v = parseInt(key.dataset.v, 10);
    if (!(v >= 1 && v <= 10)) return;

    locked = true; // ignore any further taps (double-taps, second finger)
    pad.classList.add('locked');
    key.classList.add('hit');
    buzz();

    var entry = addEntry(v);
    setTimeout(function () {
      if (view !== 'pad') return;
      goLog(entry.id);
      showToast('Logged ' + v, function () {
        removeEntry(entry.id);
        if (view === 'log') renderLog();
      });
    }, 170);
  });

  $('to-log').addEventListener('click', function () {
    if (view === 'pad' && !locked) goLog(null);
  });

  $('to-pad').addEventListener('click', function () {
    hideToast();
    goPad();
  });

  editBtn.addEventListener('click', function () {
    editing = !editing;
    renderLog();
  });

  logEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.entry-del');
    if (!btn) return;
    var removed = removeEntry(btn.dataset.id);
    if (!removed) return;
    renderLog();
    showToast('Deleted ' + removed.v, function () {
      entries.push(removed);
      save();
      if (view === 'log') renderLog();
    });
  });

  /* ---------------------------------------------------------------
     Export a copy as CSV (the data only lives on this phone)
  --------------------------------------------------------------- */
  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  $('export').addEventListener('click', function () {
    var rows = entries.slice().sort(function (a, b) { return a.t - b.t; });
    var lines = ['date,time,mood'];
    rows.forEach(function (e) {
      var d = new Date(e.t);
      lines.push(
        d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ',' +
        pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + ',' + e.v
      );
    });
    var now = new Date();
    var name = 'mood-' + now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) + '.csv';
    var url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  });

  /* ---------------------------------------------------------------
     Lifecycle
  --------------------------------------------------------------- */
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    if (!hiddenAt) return;
    var away = Date.now() - hiddenAt;
    hiddenAt = 0;
    // Coming back after a while counts as "opening" the app: show the numpad.
    if (away > 20000) {
      hideToast();
      if (view === 'log') goPad();
      else showView('pad');
    } else if (view === 'log') {
      renderLog();
    }
  });

  // Another tab/window changed the data.
  window.addEventListener('storage', function (ev) {
    if (ev.key !== KEY) return;
    entries = load();
    if (view === 'log') renderLog();
  });

  /* ---------------------------------------------------------------
     Start
  --------------------------------------------------------------- */
  history.replaceState({ v: 'pad' }, '', location.pathname + location.search);
  showView('pad');

  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) {}

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }
})();
