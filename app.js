(function () {
  'use strict';

  /* ---------------------------------------------------------------
     Storage: a small JSON list in localStorage, with an in-memory
     fallback so the app still works if storage is blocked.
  --------------------------------------------------------------- */
  var KEY = 'mood.entries.v1'; // key kept so existing entries carry over
  var NOTE_MAX = 100;
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
      typeof e.t === 'number' && isFinite(e.t) &&
      (e.note === undefined || typeof e.note === 'string');
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

  function findEntry(id) {
    for (var i = 0; i < entries.length; i++) if (entries[i].id === id) return entries[i];
    return null;
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
  var toastEl = $('toast');
  var toastText = $('toast-text');
  var toastUndo = $('toast-undo');

  var view = 'pad';
  var editing = false;

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
     Notes: tap a row, type, press Enter / tap away to save
  --------------------------------------------------------------- */
  var noteEdit = null; // { id, span, input, cancel }

  function commitNote() {
    var ne = noteEdit;
    if (!ne) return;
    noteEdit = null; // set first: removing the input fires blur again
    var entry = findEntry(ne.id);
    if (entry && !ne.cancel) {
      var val = ne.input.value.replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
      if (val !== (entry.note || '')) {
        if (val) entry.note = val; else delete entry.note;
        save();
      }
    }
    ne.span.textContent = (entry && entry.note) || '';
  }

  function startNoteEdit(row) {
    commitNote();
    var entry = findEntry(row.dataset.id);
    var span = row.querySelector('.entry-note');
    if (!entry || !span) return;

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'note-input';
    input.maxLength = NOTE_MAX;
    input.value = entry.note || '';
    input.name = 'henry-note-' + entry.id;
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('autocorrect', 'off');
    input.setAttribute('autocapitalize', 'off');
    input.setAttribute('inputmode', 'text');
    input.setAttribute('enterkeyhint', 'done');
    input.setAttribute('data-lpignore', 'true');   // password managers
    input.setAttribute('data-1p-ignore', 'true');
    input.setAttribute('data-form-type', 'other');
    input.setAttribute('aria-label', 'Note');

    span.textContent = '';
    span.appendChild(input);
    noteEdit = { id: entry.id, span: span, input: input, cancel: false };

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      else if (ev.key === 'Escape') { noteEdit && (noteEdit.cancel = true); input.blur(); }
    });
    input.addEventListener('blur', commitNote);

    input.focus();
    var n = input.value.length;
    try { input.setSelectionRange(n, n); } catch (e) {}
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
    commitNote();
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
          var row = el('div', 'entry');
          row.dataset.id = e.id;
          row.appendChild(el('span', 'entry-val', String(e.v)));
          row.appendChild(el('span', 'entry-time', timeFmt.format(new Date(e.t))));
          row.appendChild(el('span', 'entry-note', e.note || ''));
          var del = el('button', 'entry-del', 'Delete');
          del.type = 'button';
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
  }

  /* ---------------------------------------------------------------
     Views and history (so the Android back button behaves).
     Switching is a plain show/hide: instant, no animation.
  --------------------------------------------------------------- */
  function showView(next) {
    commitNote();
    view = next;
    var isPad = next === 'pad';
    viewPad.hidden = !isPad;
    viewLog.hidden = isPad;

    if (isPad) {
      editing = false;
    } else {
      renderLog();
      scroller.scrollTop = 0;
    }
  }

  function goLog() {
    history.pushState({ v: 'log' }, '', '#log');
    showView('log');
  }

  function goPad() {
    // The log is always opened from the pad, so stepping back lands on it.
    showView('pad'); // switch immediately; the history step below is bookkeeping
    if (history.state && history.state.v === 'log') history.back();
  }

  window.addEventListener('popstate', function () {
    var want = (history.state && history.state.v === 'log') || location.hash === '#log' ? 'log' : 'pad';
    if (want !== view) showView(want);
  });

  /* ---------------------------------------------------------------
     Press handling: act on the press itself (pointerdown), not on
     release, so everything responds instantly. A click with detail 0
     is a keyboard activation (Enter/Space) and is handled too.
  --------------------------------------------------------------- */
  // The screen changes on pointerdown, so the rest of that same touch
  // (pointerup + click) would land on whatever is now under the finger,
  // e.g. "Edit" sitting where "Log" was. Swallow it.
  var swallowClicks = false;
  var swallowTimer = null;

  function endSwallow() {
    clearTimeout(swallowTimer);
    swallowTimer = setTimeout(function () { swallowClicks = false; }, 120);
  }
  document.addEventListener('pointerup', function () { if (swallowClicks) endSwallow(); }, true);
  document.addEventListener('pointercancel', function () { if (swallowClicks) endSwallow(); }, true);
  document.addEventListener('click', function (ev) {
    if (swallowClicks && ev.detail !== 0) {
      ev.stopImmediatePropagation();
      ev.preventDefault();
    }
  }, true);

  function onPress(target, handler) {
    target.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0 || ev.isPrimary === false) return;
      clearTimeout(swallowTimer);
      swallowClicks = true;
      swallowTimer = setTimeout(function () { swallowClicks = false; }, 1500); // safety net
      handler(ev);
    });
    target.addEventListener('click', function (ev) {
      if (ev.detail === 0) handler(ev); // keyboard activation
    });
  }

  /* ---------------------------------------------------------------
     Toast with undo (appears and disappears instantly)
  --------------------------------------------------------------- */
  var toastTimer = null;
  var toastAction = null;

  function showToast(text, undoFn) {
    clearTimeout(toastTimer);
    toastAction = undoFn;
    toastText.textContent = text;
    toastUndo.hidden = !undoFn;
    toastEl.hidden = false;
    toastTimer = setTimeout(hideToast, undoFn ? 5000 : 3000);
  }

  function hideToast() {
    clearTimeout(toastTimer);
    toastEl.hidden = true;
    toastAction = null;
  }

  onPress(toastUndo, function () {
    var fn = toastAction;
    hideToast();
    if (fn) fn();
  });

  /* ---------------------------------------------------------------
     Actions
  --------------------------------------------------------------- */
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

  function logValue(v) {
    // The view changes synchronously, so a second tap can never log twice.
    if (view !== 'pad') return;
    var entry = addEntry(v);
    goLog();
    showToast('Logged ' + v, function () {
      removeEntry(entry.id);
      if (view === 'log') renderLog();
    });
  }

  onPress(pad, function (ev) {
    var key = ev.target.closest && ev.target.closest('.key');
    if (!key) return;
    var v = parseInt(key.dataset.v, 10);
    if (v >= 1 && v <= 10) logValue(v);
  });

  onPress($('to-log'), function () {
    if (view === 'pad') goLog();
  });

  onPress($('to-pad'), function () {
    if (view !== 'log') return;
    hideToast();
    goPad();
  });

  editBtn.addEventListener('click', function () {
    editing = !editing;
    renderLog();
  });

  logEl.addEventListener('click', function (ev) {
    var btn = ev.target.closest('.entry-del');
    if (btn) {
      var row = btn.closest('.entry');
      var removed = row && removeEntry(row.dataset.id);
      if (!removed) return;
      renderLog();
      showToast('Deleted ' + removed.v, function () {
        entries.push(removed);
        save();
        if (view === 'log') renderLog();
      });
      return;
    }
    if (ev.target.closest('.note-input')) return; // already editing this note
    var r = ev.target.closest('.entry');
    if (r) startNoteEdit(r);
  });

  /* ---------------------------------------------------------------
     Lifecycle
  --------------------------------------------------------------- */
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      commitNote(); // never lose a half-typed note
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
