/* Atlantic Votes polls — shared renderer.
   Fetches assets/data/polls.json (regenerated every morning by
   build_polls_json.py) and renders the newest poll per jurisdiction.
   Used by polls.html (all jurisdictions) and by the latest-poll slot
   on pei.html / nb.html / nl.html (one jurisdiction each, via
   data-jurisdiction on the slot element). No sample size and no margin
   of error anywhere, per the Nov 9 card rules; footers credit the
   pollster, never Wikipedia. */
(function () {
  "use strict";
  var FEED_URL = "assets/data/polls.json";
  var PLURAL = {Liberal: "Liberals", Conservative: "Conservatives",
    NDP: "NDP", Bloc: "Bloc", Green: "Greens", PPC: "PPC",
    PC: "PCs", UCP: "UCP", "SK Party": "SK Party", CAQ: "CAQ",
    PQ: "PQ", QS: "QS", PCQ: "PCQ"};

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;",
              '"': "&quot;", "'": "&#39;"}[c];
    });
  }
  function fmtPct(v) {
    return (Math.round(v * 10) / 10).toString().replace(/\.0$/, "") + "%";
  }

  function cardHtml(p) {
    var leader = p.leader || "Others";
    var leaderColor = "#0033ff";
    if (p.parties && p.parties.length) leaderColor = p.parties[0].color;
    var who = PLURAL[leader] || leader;
    var head;
    if (p.lead == null || p.lead === 0) {
      head = "Tied at the top";
    } else {
      head = esc(who) + " lead by <span class=\"poll-lead-n\" " +
        "style=\"color:" + esc(leaderColor) + "\">" +
        esc(fmtPct(p.lead).replace("%", "")) + "</span>";
    }
    var bars = "";
    (p.parties || []).forEach(function (pt) {
      var w = Math.round(900 * Math.min(pt.pct, 50) / 50) / 9;
      bars += "<div class=\"poll-row\"><span>" + esc(pt.label) +
        "</span><div class=\"poll-track\"><div class=\"poll-fill\" " +
        "style=\"width:" + w + "%;background:" + esc(pt.color) +
        "\"></div></div><span class=\"poll-pct\">" +
        esc(fmtPct(pt.pct)) + "</span></div>";
    });
    var chip = p.delta ? "<span class=\"poll-chip\">" + esc(p.delta) +
      "</span>" : "";
    var recent = "";
    if (p.recent && p.recent.length > 1) {
      var rows = "";
      p.recent.forEach(function (r) {
        var leadTxt = r.lead == null ? "–" :
          (r.lead === 0 ? "Tied" : "+" + (Math.round(r.lead * 10) / 10));
        rows += "<tr><td>" + esc(r.pollster) + "</td><td>" +
          esc(r.date_label) + "</td><td>" + esc(r.leader || "") +
          " " + esc(leadTxt) + "</td></tr>";
      });
      recent = "<details class=\"poll-recent\"><summary>Recent polls</summary>" +
        "<table><tr><th>Pollster</th><th>Date</th><th>Leader</th></tr>" +
        rows + "</table></details>";
    }
    return "<article class=\"poll-card\"><div class=\"poll-strip\" " +
      "style=\"background:" + esc(leaderColor) + "\"></div>" +
      "<div class=\"poll-body\"><div class=\"poll-kicker\">New poll &middot; " +
      esc(p.label) + "</div><h3 class=\"poll-head\">" + head + "</h3>" +
      "<p class=\"poll-sub\">" + esc(p.pollster) + " &middot; " +
      esc(p.date_label) + "</p>" + chip +
      "<div class=\"poll-bars\">" + bars + "</div>" + recent +
      "<p class=\"poll-foot\">Source: <a href=\"" + esc(p.source_url) +
      "\" rel=\"noopener\">" + esc(p.pollster) +
      "</a> &middot; atlanticvotes.ca</p></div></article>";
  }

  function load() {
    return fetch(FEED_URL + "?cb=" + Date.now())
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); });
  }

  function renderAllInto(el) {
    return load().then(function (data) {
      el.innerHTML = (data.polls || []).map(cardHtml).join("");
      return data;
    });
  }

  function renderLatestInto(el, jurisdiction) {
    return load().then(function (data) {
      var found = null;
      (data.polls || []).forEach(function (p) {
        if (p.jurisdiction === jurisdiction) found = p;
      });
      if (!found) {
        el.innerHTML = "<p class=\"poll-loading\">No poll for this " +
          "province yet.</p>";
      } else {
        el.innerHTML = cardHtml(found);
      }
      return data;
    });
  }

  window.AVPolls = {load: load, cardHtml: cardHtml,
    renderAllInto: renderAllInto, renderLatestInto: renderLatestInto,
    FEED_URL: FEED_URL};

  function initSlots() {
    document.querySelectorAll("[data-jurisdiction]").forEach(function (slot) {
      var body = slot.querySelector("[data-poll-body]") || slot;
      renderLatestInto(body, slot.getAttribute("data-jurisdiction"))
        .catch(function () {
          body.innerHTML = "<p class=\"poll-loading\">Latest poll " +
            "unavailable right now.</p>";
        });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSlots);
  } else {
    initSlots();
  }
  // Refresh the slot data every 60 seconds, like the live pages.
  setInterval(function () {
    document.querySelectorAll("[data-jurisdiction]").forEach(function (slot) {
      var body = slot.querySelector("[data-poll-body]") || slot;
      renderLatestInto(body, slot.getAttribute("data-jurisdiction"))
        .catch(function () {});
    });
  }, 60000);
})();
