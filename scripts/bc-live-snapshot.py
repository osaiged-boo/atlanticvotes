#!/usr/bin/env python3
"""Build a same-origin JSON snapshot of Elections BC's 2026 election-night
results for the Atlantic Votes BC live page (bc.html).

Sources -- Elections BC only, no other data source:
  * Candidate view (authoritative for per-candidate votes):
    https://results.elections.bc.ca/Results_11684_GE-2026-10-24_Candidate.html
  * Party view (cross-check only):
    https://results.elections.bc.ca/Results_11684_GE-2026-10-24_Party.html

Output: a bare JSON array of
  {"riding": str, "reportingPct": float | null,
   "candidates": [{"name": str, "party": str, "votes": int,
                   "status": "Elected" | "Leading" | null}]}

reportingPct per riding =
    100 * (advance reported + final-day reported)
        / (advance total + final-day total), rounded to 1 decimal.
It is null only when the riding's ballot-box totals are missing or zero.

Failure contract: if either page fails to fetch, or the candidate table
cannot be parsed into exactly 93 ridings each with at least one candidate,
the script prints the error to stderr, exits non-zero, and writes NO output
file (never placeholder or invented numbers). Cross-check mismatches against
the Party view are warnings on stderr only: the two pages refresh every
3 minutes and the two fetches can straddle an update, so a small drift must
not kill the snapshot. Candidate-view numbers always win.

Party names are mapped to the page's PARTY_META keys. An affiliation outside
the map is passed through unchanged with a stderr warning (the page renders
unknown parties in grey) rather than dropping the candidate.

Usage: python3 scripts/bc-live-snapshot.py [OUTPUT]
  OUTPUT defaults to assets/data/bc-live-2026.json (relative to the cwd).
  The write is atomic (temp file + os.replace).
Standard library only.
"""

import html.parser
import json
import os
import re
import sys
import urllib.error
import urllib.request

CANDIDATE_URL = (
    "https://results.elections.bc.ca/Results_11684_GE-2026-10-24_Candidate.html"
)
PARTY_URL = (
    "https://results.elections.bc.ca/Results_11684_GE-2026-10-24_Party.html"
)
DEFAULT_OUTPUT = "assets/data/bc-live-2026.json"
EXPECTED_RIDINGS = 93

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)

# Elections BC affiliation -> page PARTY_META key.
PARTY_MAP = {
    "BC NDP": "BC NDP",
    "BC Green Party": "BC Green Party",
    "BC Green": "BC Green Party",
    "Conservative Party": "Conservative Party",
    "CentreBC": "CentreBC",
    "OneBC": "OneBC",
    "Independent": "Independent",
    "Unaffiliated": "Unaffiliated",
    "Libertarian": "Libertarian",
    "Christian Heritage Party of BC": "Christian Heritage Party of BC",
    "Christian Heritage Party of B.C.": "Christian Heritage Party of BC",
    "Communist Party of BC": "Communist Party of BC",
    "Freedom Party of BC": "Freedom Party of BC",
    "CWP": "CWP",
}

BOXES_RE = re.compile(r"(\d+)\s+of\s+(\d+)\s+reported")
ASOF_RE = re.compile(r"As of\s+[^<\n]{0,80}")


def warn(msg):
    print("warning: " + msg, file=sys.stderr)


def fail(msg):
    print("error: " + msg, file=sys.stderr)
    sys.exit(1)


def fetch(url):
    req = urllib.request.Request(
        url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            if resp.status != 200:
                fail("fetch %s: HTTP %s" % (url, resp.status))
            charset = resp.headers.get_content_charset() or "utf-8"
            raw = resp.read()
    except urllib.error.URLError as exc:
        fail("fetch %s: %s" % (url, exc))
    try:
        return raw.decode(charset)
    except (UnicodeDecodeError, LookupError):
        return raw.decode("utf-8", errors="replace")


def clean(text):
    return re.sub(r"\s+", " ", text or "").strip()


def parse_int(text, what):
    num = clean(text).replace(",", "")
    if not re.fullmatch(r"-?\d+", num):
        fail("cannot parse %s from %r" % (what, text))
    return int(num)


class TableParser(html.parser.HTMLParser):
    """Collect tables as lists of rows of cleaned cell strings.

    Nested tables are kept separate: rows inside an inner table belong to
    the inner table only, so a layout table never swallows the results table.
    """

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = []
        self._stack = []  # each: {"rows": [], "row": None, "cell": None}

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self._stack.append({"rows": [], "row": None, "cell": None})
        elif tag == "tr" and self._stack:
            self._stack[-1]["row"] = []
        elif tag in ("td", "th") and self._stack and self._stack[-1]["row"] is not None:
            self._stack[-1]["cell"] = []
        elif tag == "br" and self._stack and self._stack[-1]["cell"] is not None:
            self._stack[-1]["cell"].append(" ")

    def handle_endtag(self, tag):
        if tag == "table" and self._stack:
            ctx = self._stack.pop()
            if ctx["row"] is not None:
                ctx["rows"].append(ctx["row"])
            self.tables.append(ctx["rows"])
        elif tag == "tr" and self._stack and self._stack[-1]["row"] is not None:
            self._stack[-1]["rows"].append(self._stack[-1]["row"])
            self._stack[-1]["row"] = None
        elif tag in ("td", "th") and self._stack and self._stack[-1]["cell"] is not None:
            ctx = self._stack[-1]
            ctx["row"].append(clean("".join(ctx["cell"])))
            ctx["cell"] = None

    def handle_data(self, data):
        if self._stack and self._stack[-1]["cell"] is not None:
            self._stack[-1]["cell"].append(data)


def get_tables(html):
    parser = TableParser()
    parser.feed(html)
    return parser.tables


def find_table(tables, must_have, label):
    """Return the largest table whose header row contains every must_have
    substring (case-insensitive)."""
    best = None
    for rows in tables:
        for row in rows:
            joined = " | ".join(row).lower()
            if all(s.lower() in joined for s in must_have):
                if best is None or len(rows) > len(best):
                    best = rows
                break
    if best is None:
        fail("could not find %s table" % label)
    return best


def parse_boxes(text):
    """Parse 'X of Y reported' -> (X, Y) or None."""
    m = BOXES_RE.search(text or "")
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def parse_status(row):
    """Capture Elections BC's own status word if the row carries one."""
    for cell in row:
        low = cell.lower()
        if "elected" in low:
            return "Elected"
        if "leading" in low:
            return "Leading"
    return None


def parse_candidate_table(rows):
    """Rows after the header -> ordered list of riding dicts (no reporting
    totals yet; ballot-box rows are attached as encountered)."""
    ridings = []
    current = None
    header_seen = False
    for row in rows:
        if not row or all(c == "" for c in row):
            continue
        joined = " | ".join(row)
        if not header_seen:
            if "electoral district" in joined.lower():
                header_seen = True
            continue
        low = joined.lower()
        if "ballot boxes" in low:
            if current is None:
                continue
            boxes = parse_boxes(joined)
            if boxes is None:
                warn("unparseable ballot-box row for %s: %r"
                     % (current["riding"], joined))
                continue
            if "advance" in low:
                current["adv"] = boxes
            elif "final voting day" in low:
                current["final"] = boxes
            continue
        second = row[1].lower() if len(row) > 1 else ""
        if (second.startswith("total valid")
                or second.startswith("rejected")
                or second.startswith("total considered")):
            continue
        # Candidate row: first cell non-empty starts a new riding block.
        if row[0] != "":
            current = {"riding": row[0], "candidates": [],
                       "adv": None, "final": None}
            ridings.append(current)
        if current is None:
            fail("candidate row before any riding header: %r" % (joined,))
        if len(row) < 4:
            fail("candidate row with too few cells: %r" % (joined,))
        name = row[1]
        affiliation = clean(row[2])
        if name == "":
            fail("candidate row with empty name: %r" % (joined,))
        if affiliation == "":
            # Elections BC leaves the Affiliation cell blank for its
            # "Unaffiliated" candidates (verified: exactly the six
            # Unaffiliated names on the roster, and the Party view's
            # Unaffiliated total counts their votes). Map the blank to
            # the page's Unaffiliated key rather than emitting "".
            affiliation = "Unaffiliated"
        party = PARTY_MAP.get(affiliation)
        if party is None:
            warn("unknown affiliation %r for %s; passing through"
                 % (affiliation, name))
            party = affiliation
        votes = parse_int(row[3], "votes for %s" % name)
        current["candidates"].append({
            "name": name,
            "party": party,
            "votes": votes,
            "status": parse_status(row),
        })
    if not header_seen:
        fail("candidate table header not found")
    return ridings


def parse_party_table(rows):
    """Return {district: {gp, ndp, cp, other, total_valid, adv, final}}."""
    out = {}
    header_seen = False
    for row in rows:
        if not row or all(c == "" for c in row):
            continue
        joined = " | ".join(row)
        if not header_seen:
            if "electoral district" in joined.lower():
                header_seen = True
            continue
        if len(row) < 6:
            continue
        district = row[0]
        if district == "":
            continue
        # Columns: 0 district, 1 GP, 2 NDP, 3 CP, 4 Other, 5 Total Valid,
        # 6 Rejected, 7 Total Considered, 8 Advance boxes, 9 Final boxes.
        adv = parse_boxes(row[8]) if len(row) > 8 else None
        fin = parse_boxes(row[9]) if len(row) > 9 else None
        out[district] = {
            "gp": parse_int(row[1], "GP for %s" % district),
            "ndp": parse_int(row[2], "NDP for %s" % district),
            "cp": parse_int(row[3], "CP for %s" % district),
            "other": parse_int(row[4], "Other for %s" % district),
            "total_valid": parse_int(row[5], "total valid for %s" % district),
            "adv": adv,
            "final": fin,
        }
    if not header_seen:
        fail("party table header not found")
    return out


def reporting_pct(adv, final):
    if adv is None or final is None:
        return None
    reported = adv[0] + final[0]
    total = adv[1] + final[1]
    if total <= 0:
        return None
    return round(100.0 * reported / total, 1)


def main(argv):
    output = argv[1] if len(argv) > 1 else DEFAULT_OUTPUT

    cand_html = fetch(CANDIDATE_URL)
    party_html = fetch(PARTY_URL)

    asof = ASOF_RE.search(cand_html)
    if asof:
        print("source snapshot: %s" % clean(asof.group(0)))

    cand_tables = get_tables(cand_html)
    cand_rows = find_table(
        cand_tables, ["electoral district", "candidate", "affiliation"],
        "candidate")
    ridings = parse_candidate_table(cand_rows)

    if len(ridings) != EXPECTED_RIDINGS:
        fail("parsed %d ridings, expected %d"
             % (len(ridings), EXPECTED_RIDINGS))
    for r in ridings:
        if not r["candidates"]:
            fail("riding %s has no candidates" % r["riding"])

    # Cross-check against the Party view (warnings only, see module docstring).
    party_tables = get_tables(party_html)
    party_rows = find_table(
        party_tables, ["electoral district", "advance voting"],
        "party")
    party = parse_party_table(party_rows)
    for r in ridings:
        p = party.get(r["riding"])
        if p is None:
            warn("riding %s missing from party view" % r["riding"])
            continue
        sums = {"gp": 0, "ndp": 0, "cp": 0, "other": 0}
        for c in r["candidates"]:
            if c["party"] == "BC Green Party":
                sums["gp"] += c["votes"]
            elif c["party"] == "BC NDP":
                sums["ndp"] += c["votes"]
            elif c["party"] == "Conservative Party":
                sums["cp"] += c["votes"]
            else:
                sums["other"] += c["votes"]
        for key, label in (("gp", "GP"), ("ndp", "NDP"), ("cp", "CP"),
                           ("other", "Other")):
            if sums[key] != p[key]:
                warn("party cross-check %s: candidates sum %d != party %d"
                     % (r["riding"] + " " + label, sums[key], p[key]))
        total = sum(c["votes"] for c in r["candidates"])
        if total != p["total_valid"]:
            warn("party cross-check %s: candidate total %d != valid %d"
                 % (r["riding"], total, p["total_valid"]))
        if r["adv"] is not None and p["adv"] is not None and r["adv"] != p["adv"]:
            warn("advance boxes differ for %s" % r["riding"])
        if (r["final"] is not None and p["final"] is not None
                and r["final"] != p["final"]):
            warn("final-day boxes differ for %s" % r["riding"])

    snapshot = []
    for r in ridings:
        pct = reporting_pct(r["adv"], r["final"])
        if pct is None:
            warn("no ballot-box totals for %s; reportingPct null"
                 % r["riding"])
        snapshot.append({
            "riding": r["riding"],
            "reportingPct": pct,
            "candidates": r["candidates"],
        })

    text = json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n"
    out_dir = os.path.dirname(os.path.abspath(output))
    os.makedirs(out_dir, exist_ok=True)
    tmp = output + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.replace(tmp, output)

    total_votes = sum(c["votes"] for r in snapshot for c in r["candidates"])
    total_cands = sum(len(r["candidates"]) for r in snapshot)
    print("wrote %s: %d ridings, %d candidates, %d votes"
          % (output, len(snapshot), total_cands, total_votes))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
