/* Atlantic Votes — animated counters (vanilla JS, no dependencies).
   Eased count-up for seat / vote numbers and bar widths.
   - Page load (pei.html): [data-av-count] numbers count up from 0 and
     [data-av-bar] widths grow from 0 to their authored values.
   - Live refresh (bc.html, us-midterms.html): AVCount.setNumber /
     setNumberFrom / setWidth animate a number only when it changed;
     unchanged values are left alone (no flicker, no re-animation).
   - Respects prefers-reduced-motion: values are set instantly, no animation.
   - If this file fails to load, every page still shows its authored numbers:
     callers guard with `window.AVCount` and fall back to plain text.
*/
(function () {
  "use strict";
  var REDUCED = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var DUR = 900; /* ms */

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function fmtInt(n) { return Math.round(n).toLocaleString("en-US"); }
  function parseNum(text) {
    if (text === null || text === undefined) return null;
    var m = String(text).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }
  function formatValue(v, decimals, kind) {
    if (kind === "pct") return v.toFixed(1) + "%";
    if (decimals && decimals > 0) return v.toFixed(decimals);
    return fmtInt(v);
  }
  function animateNumber(el, from, to, opts) {
    opts = opts || {};
    var decimals = opts.decimals || 0;
    var kind = opts.kind || "int";
    if (REDUCED || from === null || from === undefined || from === to) {
      el.textContent = formatValue(to, decimals, kind);
      return;
    }
    if (el._avRaf) cancelAnimationFrame(el._avRaf);
    var start = null;
    function frame(ts) {
      if (start === null) start = ts;
      var p = Math.min(1, (ts - start) / DUR);
      var v = from + (to - from) * easeOutCubic(p);
      el.textContent = formatValue(v, decimals, kind);
      if (p < 1) {
        el._avRaf = requestAnimationFrame(frame);
      } else {
        el._avRaf = null;
        el.textContent = formatValue(to, decimals, kind);
      }
    }
    el._avRaf = requestAnimationFrame(frame);
  }
  function animateWidth(el, fromPct, toPct) {
    if (REDUCED || fromPct === null || fromPct === undefined || fromPct === toPct) {
      el.style.transition = "";
      el.style.width = toPct + "%";
      return;
    }
    el.style.transition = "width " + DUR + "ms cubic-bezier(0.22, 1, 0.36, 1)";
    el.style.width = fromPct + "%";
    void el.offsetWidth; /* force reflow so the transition runs from fromPct */
    el.style.width = toPct + "%";
  }

  window.AVCount = {
    reduced: REDUCED,
    parseNum: parseNum,
    fmtInt: fmtInt,
    /* Animate el from its currently displayed number to `to`; no-op if unchanged. */
    setNumber: function (el, to, opts) {
      if (!el) return;
      animateNumber(el, parseNum(el.textContent), to, opts);
    },
    /* Animate el from a given previous value to `to`; no-op if unchanged. */
    setNumberFrom: function (el, from, to, opts) {
      if (!el) return;
      animateNumber(el, from, to, opts);
    },
    /* Animate el from 0 to `to` (page-load count-up). */
    countUp: function (el, to, opts) {
      if (!el) return;
      animateNumber(el, 0, to, opts);
    },
    /* Animate a bar's width from fromPct to toPct; no-op if unchanged. */
    setWidth: function (el, fromPct, toPct) {
      if (!el) return;
      animateWidth(el, fromPct, toPct);
    },
    /* Page-load count-up: [data-av-count] numbers and [data-av-bar] widths. */
    initLoadCounters: function () {
      if (REDUCED) return; /* values stay exactly as authored in the HTML */
      var nums = document.querySelectorAll("[data-av-count]");
      for (var i = 0; i < nums.length; i++) {
        var n = nums[i];
        var to = parseFloat(n.getAttribute("data-av-to"));
        if (isNaN(to)) continue;
        animateNumber(n, 0, to, {
          decimals: parseInt(n.getAttribute("data-av-decimals") || "0", 10),
          kind: n.getAttribute("data-av-kind") || "int"
        });
      }
      var bars = document.querySelectorAll("[data-av-bar]");
      for (var j = 0; j < bars.length; j++) {
        var b = bars[j];
        var w = parseFloat(b.getAttribute("data-av-width"));
        if (isNaN(w)) continue;
        animateWidth(b, 0, w);
      }
    }
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", window.AVCount.initLoadCounters);
  } else {
    window.AVCount.initLoadCounters();
  }
})();
