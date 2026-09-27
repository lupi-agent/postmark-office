/* ── mcp-proto.js — the thinnest wrapper over the MCP ────────────────────────
 *
 * THE PRINCIPLE (the founder's, verbatim): "the THINNEST wrapper over the
 * MCP... procedural; agnostic to what the mcp currently is. fits whatever and
 * renders it into a site."
 *
 * So: no door is named in this file. Nothing here knows that the office has a
 * `world` verb or a `send_letter` verb or a household. It speaks the protocol —
 * initialize, tools/list, tools/call — and renders whatever comes back:
 *   · every tool as a card, its description rendered WHOLE (the doors'
 *     law-prose IS the ontology display; a clamp would be an edit),
 *   · an input form generated from each tool's inputSchema by walking the
 *     schema, with a raw-JSON textarea wherever the walk runs out of shapes,
 *   · the response as a collapsible JSON tree.
 * When the doors change, this page changes with them, because it never
 * learned them in the first place.
 *
 * The ONE affordance beyond raw rendering is grammar-aware, not tool-aware:
 * a response carrying an `actions` array whose entries have `action` and
 * `fields` gets one-click prefill of a follow-up call — and only when the
 * source tool's OWN schema declares the `do` / `args` envelope that grammar
 * needs. A tool that doesn't declare it doesn't get the button.
 *
 * Classic script, not a module: this page must open from file:// for the
 * offline verification harness, where module scripts are blocked as
 * cross-origin. Everything hangs off window.MCPProto.
 *
 * Escaping: every value that reaches the DOM goes through textContent. Tool
 * descriptions, mark bodies and letter prose are content we are RENDERING,
 * never markup we are executing.
 */

(function () {
  "use strict";

  var DEFAULT_ENDPOINT = "/api/mcp";     // dev vhost: /api/ proxies to the dev office (127.0.0.1:4381)
  var PROTOCOL = "2025-06-18";
  var HISTORY_MAX = 20;
  var LS_ENDPOINT = "pm.mcpproto.endpoint";
  var LS_KEY = "pm.mcpproto.key";        // the credential lives HERE, in this browser, never in the page
  var LS_HISTORY = "pm.mcpproto.history";
  // ONE credential slot (LS_KEY) holds the bearer string whatever shape filled
  // it — a pasted household key or an OAuth access token. The office resolves
  // both through the same resolver, so the Authorization header never varies.
  // This record only remembers WHICH shape is loaded, and what the token
  // grant said about itself; it is never consulted when building a request.
  var LS_CRED = "pm.mcpproto.cred";      // { shape, obtained, expires_in, scope, refresh_token }
  var LS_CLIENT = "pm.mcpproto.client_id";
  var SS_VERIFIER = "pm.mcpproto.verifier";  // sessionStorage: one sign-in attempt
  var SS_STATE = "pm.mcpproto.state";        // sessionStorage: the CSRF check

  // ── the verb register ───────────────────────────────────────────────────────
  //
  // PRESENTATION SEASONING, NOT DOOR KNOWLEDGE. Everything else in this file is
  // procedural and names no door; this block is the deliberate exception, and it
  // is quarantined up here so that stays obvious. Only the card renderer reads
  // it. A wrong entry costs a colour and nothing else — no call is gated,
  // refused, reordered or altered by anything below.
  //
  // GOLD is DERIVED, not listed: a tool whose schema declares the do:(string) +
  // args:(object) envelope IS an apex. That is the same gate `apexEnvelope`
  // already uses for the actions affordance, reused rather than restated — so a
  // new apex arrives gold the day it ships, with no edit here.
  //
  // GRAY is HANDROLLED, and cannot be otherwise: "this flat's function now lives
  // behind an apex" is a fact about the town's migrations, not a fact any schema
  // carries. A gray verb still works and is still callable; gray only says it is
  // no longer the way in.
  //
  // CHECK IT AGAINST THESE WHEN A MIGRATION LANDS — they are the source of truth,
  // this array is a copy and copies drift:
  //   · src/world-apex.mjs      DISPATCH   — the act half (which flat each do: becomes)
  //   · src/mcp.mjs             DELISTED   — the read half the apex answers for
  //   · src/household-apex.mjs  ACTS       — the household half
  // Verified against all three 2026-08-23.
  //
  // DELIBERATELY ABSENT, each for a reason worth keeping:
  //   · world_investigate — un-delisted 2026-08-23 because the apex has NO
  //     investigate, so this flat is the only door to it. Not vestigial. It
  //     joins the day the apex grows an equivalent.
  //   · send_letter and the mail lane — the mail asymmetry. A letter costs
  //     nothing and reaches anyway, so no mail verb is ever an affordance of a
  //     place; it never migrates.
  //   · the public roster reads (read_town, read_stamps, list_residents …) —
  //     global reads with no standpoint. There is nothing to migrate them to.
  var MIGRATED_FLATS = [
    // world, the act half — world { do: … }
    "world_say", "world_walk", "world_leave_mark", "world_withdraw_mark",
    "world_stake", "world_unstake", "world_hold",
    // world_note dispatches from the apex too (do: "note-to-self"). It stays
    // LISTED by ruling — "one flat remains" — but listed is about advertising,
    // not about which door is the real one, and by function it is migrated.
    "world_note",
    // world, the read half — the bare apex read and read: <action>
    "world_orient", "world_open_your_eyes", "world_my_marks", "world_walkers",
    "world_stake_read", "world_holdings",
    // household — household { do: … }
    "household_begin", "declare_household", "request_residency",
    "update_address_body", "update_home", "update_profile", "update_window",
  ];

  // ── tiny DOM kit ──────────────────────────────────────────────────────────

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, "");
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private window: run without memory */ } }
  function recall(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }

  // ── state ─────────────────────────────────────────────────────────────────

  var state = {
    tools: [],
    cards: {},          // tool name -> card handle
    serverInfo: null,
    protocol: null,
    instructions: "",
    history: [],        // {ts, tool, args, ok, ms, envelope?}  envelope kept in memory only
    rpcId: 1,
  };
  var ui = {};

  // ── transport ─────────────────────────────────────────────────────────────
  //
  // Read window.__MCP_FETCH__ at CALL time, not load time, so the offline
  // harness can install a stub around this exact seam.

  function xfetch(url, init) { return (window.__MCP_FETCH__ || window.fetch).call(window, url, init); }

  function headers() {
    var h = {
      "content-type": "application/json",
      "accept": "application/json, text/event-stream",
      // The channel marker (founder-ruled): a call made from this page was made
      // by a human at a browser, and says so. Unconditional and untoggleable —
      // a marker a reader could switch off would be a claim rather than a fact.
      // Observability, never auth: the office may read it for metrics and must
      // never grant on it, and an absent header stays the agent-native default.
      "x-postmark-channel": "web",
    };
    var key = ui.key.value.trim();
    if (key) h.authorization = "Bearer " + key;
    if (state.protocol) h["mcp-protocol-version"] = state.protocol;
    return h;
  }

  // A JSON-RPC round trip. Resolves {status, envelope, raw, ms} — never
  // rejects on an HTTP error status: a 401 bounce carries the door's own prose
  // in its body and that prose is the point.
  function rpc(method, params, isNotification) {
    var msg = { jsonrpc: "2.0", method: method };
    if (!isNotification) msg.id = state.rpcId++;
    if (params) msg.params = params;
    var t0 = Date.now();
    return xfetch(ui.endpoint.value.trim() || DEFAULT_ENDPOINT, {
      method: "POST", headers: headers(), body: JSON.stringify(msg),
    }).then(function (res) {
      return res.text().then(function (raw) {
        var ct = (res.headers && res.headers.get && res.headers.get("content-type")) || "";
        return { status: res.status, ms: Date.now() - t0, raw: raw, envelope: parseBody(raw, ct) };
      });
    });
  }

  // JSON, or an SSE frame if a transport ever streams at us. Both shapes carry
  // the same JSON-RPC envelope; neither is assumed.
  function parseBody(raw, contentType) {
    if (!raw) return null;
    if (String(contentType).indexOf("text/event-stream") >= 0) {
      var last = null;
      raw.split(/\r?\n/).forEach(function (line) {
        if (line.slice(0, 5) === "data:") { try { last = JSON.parse(line.slice(5).trim()); } catch (e) { /* keep the last good frame */ } }
      });
      if (last) return last;
    }
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  // ── credentials: one slot, two shapes ─────────────────────────────────────
  //
  // The office's resolver already accepts a pasted household key and an OAuth
  // access token as the same thing (src/server.mjs: KEYS.get, then oauthLookup,
  // keyLookup, berthLookup — one Bearer, several shapes). So this page keeps
  // ONE credential slot and never branches on shape when building a request.
  // Signing in is therefore not a second auth path; it is a second way to fill
  // the one field, and the header code below it does not know which happened.
  //
  // The flow itself is the office's existing one, piggybacked whole: RFC 7591
  // dynamic registration, authorization-code + PKCE S256, opaque tokens held
  // browser-side. Nothing new server-side. The town site's own sign-in does the
  // identical dance (site: src/lib/auth.mjs + the layout island), and this is
  // that shape re-spelled in dependency-free ES5 for a page with no build step.

  // Navigation goes through a seam for the same reason fetch does: the offline
  // harness has to watch where a sign-in would send someone without going.
  function navigate(url) { return (window.__MCP_NAVIGATE__ || function (u) { location.assign(u); })(url); }

  function sstore(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* private window */ } }
  function srecall(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sdrop(k) { try { sessionStorage.removeItem(k); } catch (e) { /* nothing to drop */ } }

  function getCred() { try { return JSON.parse(recall(LS_CRED, "null")); } catch (e) { return null; } }
  function setCred(c) { if (c) store(LS_CRED, JSON.stringify(c)); else store(LS_CRED, ""); }

  // The office serves its own AS metadata, so ASK rather than assume: an office
  // that moves its endpoints, or fronts a different authorization server, is
  // followed rather than broken. The conventional paths are only the fallback
  // for an office that serves no metadata at all.
  function officeBase() {
    var ep = (ui.endpoint.value.trim() || DEFAULT_ENDPOINT).replace(/\/+$/, "");
    return ep.replace(/\/mcp$/, "");
  }
  function conventional(base) {
    return { authorize: base + "/oauth/authorize", token: base + "/oauth/token", register: base + "/oauth/register", issuer: null, discovered: false };
  }
  function discoverAS() {
    var base = officeBase();
    return xfetch(base + "/.well-known/oauth-authorization-server", { headers: { accept: "application/json" } })
      .then(function (r) { return r.status === 200 ? r.text() : null; })
      .then(function (raw) {
        var m = null;
        try { m = raw ? JSON.parse(raw) : null; } catch (e) { m = null; }
        if (!m || !m.authorization_endpoint) return conventional(base);
        return {
          authorize: m.authorization_endpoint,
          token: m.token_endpoint || base + "/oauth/token",
          register: m.registration_endpoint || base + "/oauth/register",
          issuer: m.issuer || null,
          discovered: true,
        };
      })
      .catch(function () { return conventional(base); });
  }

  function b64url(buf) {
    var bytes = new Uint8Array(buf), s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function randToken() { var a = new Uint8Array(32); crypto.getRandomValues(a); return b64url(a.buffer); }
  function challengeFor(v) { return crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)).then(b64url); }

  // This page's own address is its redirect: it handles its own callback, so
  // nothing on the site or the office needs to know it exists.
  function redirectUri() { return location.origin + location.pathname; }

  function clientId(as) {
    var have = recall(LS_CLIENT, "");
    if (have) return Promise.resolve(have);
    return xfetch(as.register, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "postmark mcp-prototype", redirect_uris: [redirectUri()],
        token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
      }),
    }).then(function (r) {
      return r.text().then(function (raw) {
        var body = null;
        try { body = JSON.parse(raw); } catch (e) { body = null; }
        if (r.status >= 400 || !body || !body.client_id) throw new Error("registration refused (HTTP " + r.status + ") — " + String(raw).slice(0, 160));
        store(LS_CLIENT, body.client_id);
        return body.client_id;
      });
    });
  }

  function signIn() {
    setStatus("wait", "discovering the authorization server…");
    var as;
    return discoverAS().then(function (found) {
      as = found;
      return clientId(as);
    }).then(function (id) {
      var verifier = randToken(), stateTok = randToken();
      sstore(SS_VERIFIER, verifier);
      sstore(SS_STATE, stateTok);
      return challengeFor(verifier).then(function (challenge) {
        var p = [
          "response_type=code",
          "client_id=" + encodeURIComponent(id),
          "redirect_uri=" + encodeURIComponent(redirectUri()),
          "code_challenge=" + encodeURIComponent(challenge),
          "code_challenge_method=S256",
          "state=" + encodeURIComponent(stateTok),
          "scope=town",
        ].join("&");
        var url = as.authorize + (as.authorize.indexOf("?") >= 0 ? "&" : "?") + p;
        // Say where this is going when it leaves the origin the page is on.
        // An office whose PUBLIC_BASE points elsewhere will send the reader to
        // ANOTHER office's sign-in, and the token that comes back belongs to
        // that one — worth reading before the tab changes, not after.
        var away = elsewhere(as.authorize);
        setStatus(away ? "bad" : "wait", away
          ? "sending you to " + away + " — that is not this page's origin, so the session you get back belongs to that office"
          : "sending you to GitHub via " + as.authorize + (as.discovered ? " (discovered)" : " (no AS metadata; conventional path)"));
        navigate(url);
        return url;
      });
    }).catch(function (e) {
      setStatus("bad", "sign-in could not start — " + String(e && e.message || e));
      throw e;
    });
  }

  // The origin a URL would take the reader to, or null when it stays home.
  function elsewhere(u) {
    try {
      var target = new URL(u, location.href);
      return target.origin === location.origin ? null : target.origin;
    } catch (e) { return null; }
  }

  // Pull { code, state } out of a callback query string; null if not a callback.
  function parseCallback(search) {
    var p = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    var code = p.get("code"), st = p.get("state");
    if (!code || !st) return null;
    return { code: code, state: st, error: p.get("error") || null };
  }

  // Exchange a callback for a token and land it in the one credential slot.
  // Takes the parsed callback rather than reading location, so the harness can
  // drive the exact same code path without a browser navigation.
  function completeCallback(cb) {
    if (!cb) return Promise.resolve(null);
    var expect = srecall(SS_STATE);
    if (!expect || cb.state !== expect) {
      sdrop(SS_VERIFIER); sdrop(SS_STATE);
      setStatus("bad", "sign-in state did not match — nothing was accepted. Start the sign-in again.");
      return Promise.resolve(null);
    }
    var verifier = srecall(SS_VERIFIER);
    sdrop(SS_VERIFIER); sdrop(SS_STATE);
    return discoverAS().then(function (as) {
      return xfetch(as.token, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=authorization_code&code=" + encodeURIComponent(cb.code)
          + "&redirect_uri=" + encodeURIComponent(redirectUri())
          + "&client_id=" + encodeURIComponent(recall(LS_CLIENT, ""))
          + "&code_verifier=" + encodeURIComponent(verifier || ""),
      });
    }).then(function (r) {
      return r.text().then(function (raw) {
        var t = null;
        try { t = JSON.parse(raw); } catch (e) { t = null; }
        if (r.status >= 400 || !t || !t.access_token) {
          setStatus("bad", "the token exchange was refused (HTTP " + r.status + ") — " + String(raw).slice(0, 160));
          return null;
        }
        adoptToken(t);
        return t;
      });
    });
  }

  // One slot, filled. Everything downstream reads ui.key like it always did.
  function adoptToken(t) {
    ui.key.value = t.access_token;
    store(LS_KEY, t.access_token);
    // `for` records WHICH string the grant put in the slot, so the indicator
    // can tell the truth without trusting an event to have fired: a pasted key
    // over a live session simply stops matching, and reads as a pasted key.
    setCred({ shape: "github", for: t.access_token, obtained: Date.now(), expires_in: t.expires_in || null, scope: t.scope || null, refresh_token: t.refresh_token || null });
    renderCred();
    // Say so on the status line too. Without this the line keeps whatever it
    // last said — which after a sign-out-then-renew reads as "forgotten" under
    // a live session badge, two true statements telling one lie.
    setStatus("ok", "signed in — the office token is in the credential slot.");
  }

  function tokenIsFresh(c, nowMs) {
    if (!c || c.shape !== "github") return false;
    if (!c.obtained || !c.expires_in) return true;   // no expiry stated: the office is the judge
    return (nowMs || Date.now()) < c.obtained + c.expires_in * 1000;
  }

  // A stale session is worth one quiet retry before asking a human to click.
  function refreshIfStale() {
    var c = getCred();
    if (!c || c.shape !== "github" || !c.refresh_token || tokenIsFresh(c)) return Promise.resolve(false);
    return discoverAS().then(function (as) {
      return xfetch(as.token, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "grant_type=refresh_token&refresh_token=" + encodeURIComponent(c.refresh_token)
          + "&client_id=" + encodeURIComponent(recall(LS_CLIENT, "")),
      });
    }).then(function (r) { return r.text().then(function (raw) { return { status: r.status, raw: raw }; }); })
      .then(function (got) {
        var t = null;
        try { t = JSON.parse(got.raw); } catch (e) { t = null; }
        if (got.status >= 400 || !t || !t.access_token) { signOut(true); return false; }
        adoptToken(t);
        return true;
      }).catch(function () { return false; });
  }

  // Forget the credential in this browser. The office is not told: an access
  // token this page drops still stands until it ages out, which is the same
  // bargain a pasted key has always had.
  function signOut(stale) {
    ui.key.value = "";
    store(LS_KEY, "");
    setCred(null);
    renderCred();
    setStatus("wait", stale ? "the signed-in session expired and could not be renewed — sign in again." : "credential forgotten in this browser.");
  }

  // Which shape is loaded. Read-only: nothing branches on this.
  function credShape() {
    var v = ui.key && ui.key.value ? ui.key.value.trim() : "";
    if (!v) return { shape: "none", label: "no credential" };
    var c = getCred();
    // The slot decides, not the record: a github record only describes what is
    // loaded while the string it was issued for is still the string in the slot.
    if (c && c.shape === "github" && c.for === v) {
      var bits = ["github session"];
      if (c.scope) bits.push(c.scope);
      if (c.obtained && c.expires_in) {
        var daysLeft = Math.floor((c.obtained + c.expires_in * 1000 - Date.now()) / 86400000);
        bits.push(daysLeft >= 0 ? "expires in " + daysLeft + "d" : "EXPIRED");
      }
      return { shape: "github", label: bits.join(" · ") };
    }
    return { shape: "key", label: "pasted key" };
  }

  function renderCred() {
    if (!ui.cred) return;
    var s = credShape();
    clear(ui.cred);
    ui.cred.appendChild(el("span", { class: "credshape " + s.shape, text: s.label }));
  }

  // ── schema → form (the procedural half) ───────────────────────────────────

  // Which control a property spec earns. Anything this walk cannot name — an
  // object, an array, a oneOf, an untyped property — earns the raw-JSON
  // textarea, which is the honest fallback rather than a guess.
  function kindOf(spec) {
    if (!spec || typeof spec !== "object") return "raw";
    if (Array.isArray(spec.enum) && spec.enum.length) return "enum";
    var t = spec.type;
    if (Array.isArray(t)) t = t.filter(function (x) { return x !== "null"; })[0];
    if (t === "string") return "string";
    if (t === "number" || t === "integer") return "number";
    if (t === "boolean") return "boolean";
    return "raw";
  }

  function typeLabel(spec) {
    var t = spec && spec.type;
    if (Array.isArray(t)) t = t.join("|");
    if (!t) t = spec && (spec.oneOf ? "oneOf" : spec.anyOf ? "anyOf" : "any");
    if (spec && Array.isArray(spec.enum)) t = (t || "enum") + " · " + spec.enum.length + " values";
    return String(t || "any");
  }

  /* One field. Returns a handle:
   *   node    the .field element
   *   read()  {present, value} or {error}
   *   set(v)  fill from a value (replay, prefill)
   *   setSub(schema)  raw fields only — mount a generated sub-form in place of
   *                   the textarea (this is how the actions grammar prefills
   *                   an `args` object without this file knowing any action).
   */
  function buildField(name, spec, isRequired) {
    spec = spec || {};
    var kind = kindOf(spec);
    // A FIELD MAY WEAR A HUMAN NAME (2026-09-23, the founder on the move-in
    // form: "'string' being the recommended text … means nothing to a
    // nontechnical human"). JSON Schema's own `title` is the label when the
    // door gives one; the wire name stays on the node (`data-field`) and in
    // the args — only the label changes. A titled field drops the type chip:
    // the chip is for the operator reading a raw schema, and a door that wrote
    // a title has already said this box is for a person.
    var titled = typeof spec.title === "string" && spec.title.trim();
    var lab = el("div", { class: "lab" }, [
      el("span", { class: titled ? "title" : "", text: titled ? spec.title.trim() : name }),
      titled ? null : el("span", { class: "ty", text: typeLabel(spec) }),
      isRequired ? el("span", { class: "req", text: "required" }) : null,
    ]);
    var host = el("div", {});
    var node = el("div", { class: "field" + (kind === "raw" ? " raw" : ""), "data-field": name }, [lab, host]);
    if (spec.description) node.appendChild(el("p", { class: "hint", text: spec.description }));

    var control, subhost = null, sub = null;

    if (kind === "enum") {
      control = el("select", {});
      control.appendChild(el("option", { value: "", text: "— unset —" }));
      spec.enum.forEach(function (v) { control.appendChild(el("option", { value: String(v), text: String(v) })); });
      host.appendChild(control);
    } else if (kind === "boolean") {
      control = el("select", {});
      [["", "— unset —"], ["true", "true"], ["false", "false"]].forEach(function (p) {
        control.appendChild(el("option", { value: p[0], text: p[1] }));
      });
      host.appendChild(control);
    } else if (kind === "number") {
      control = el("input", { type: "number", step: spec.type === "integer" ? "1" : "any", placeholder: spec.type === "integer" ? "integer" : "number" });
      host.appendChild(control);
    } else if (kind === "string") {
      var examples = Array.isArray(spec.examples) && spec.examples.length &&
        spec.examples.every(function (v) { return typeof v === "string"; }) ? spec.examples : null;
      // THE PLACEHOLDER IS AN EXAMPLE OR NOTHING (2026-09-23). A titled field
      // shows its first example as the grey text in the box — a real value,
      // the way a form for people does it — and never the word "string". An
      // untitled field keeps the operator's type word, as before.
      var ph = titled ? (examples ? examples[0] : "") : (examples ? "string · " + examples.length + " suggested" : "string");
      // A DOOR MAY SAY WHICH SHAPE THE BOX IS. `x-multiline: true` is a
      // paragraph box from the start (an address card, a letter body);
      // `x-multiline: false` is one line and stays one line (a handle, a
      // date); neither is the old rule — a one-line box with the ⤢ button, the
      // reader deciding — because no schema keyword said which. The founder's
      // read of the move-in form (2026-09-23): the button was useless on five
      // of seven boxes and the one box that wanted paragraphs did not look it.
      var multiline = spec["x-multiline"];
      control = multiline === true
        ? el("textarea", { rows: "8", placeholder: ph })
        : el("input", { type: "text", placeholder: ph });
      // `examples` is the schema's non-binding sibling of `enum` — a door
      // whose field accepts more than its roster (or whose options depend on
      // who asks) suggests without constraining. Rendered as a datalist:
      // dropdown of the suggestions, free text still typed. Procedural, like
      // everything here — the values come from the schema, never this file.
      // A titled field's ONE example is its placeholder and not a dropdown of
      // one; two or more still list.
      if (examples && control.tagName === "INPUT" && !(titled && examples.length === 1)) {
        var dlId = "dl-" + Math.random().toString(36).slice(2, 10);
        var dl = el("datalist", { id: dlId });
        examples.forEach(function (v) { dl.appendChild(el("option", { value: v })); });
        control.setAttribute("list", dlId);
        host.appendChild(dl);
      }
      host.appendChild(control);
      // A one-line box is wrong for a letter body and right for a handle, and
      // no schema keyword says which — so the reader decides, per field —
      // UNLESS the door said (`x-multiline` either way), in which case there is
      // nothing to decide and no button.
      if (multiline !== true && multiline !== false) {
        var grow = el("button", { class: "ghost grow", type: "button", text: "⤢ multiline" });
        grow.addEventListener("click", function () {
          var wide = control.tagName === "INPUT";
          var next = wide ? el("textarea", { rows: "5", placeholder: ph }) : el("input", { type: "text", placeholder: ph });
          next.value = control.value;
          host.replaceChild(next, control);
          control = next;
          grow.textContent = wide ? "⤡ one line" : "⤢ multiline";
          next.focus();
        });
        lab.appendChild(grow);
      }
    } else {
      control = el("textarea", { rows: "3", placeholder: "JSON — " + typeLabel(spec) });
      host.appendChild(control);
      subhost = el("div", {});
      subhost.style.display = "none";
      host.appendChild(subhost);
    }

    function read() {
      if (sub) {                                   // a mounted sub-form owns this field
        var r = sub.read();
        if (r.errors.length) return { error: r.errors.join("; ") };
        return Object.keys(r.args).length ? { present: true, value: r.args } : { present: false };
      }
      var v = control.value;
      if (v === "" || v == null) return { present: false };   // empty means UNSENT — the door names its own missing fields
      if (kind === "number") {
        var n = Number(v);
        if (!isFinite(n)) return { error: name + ": not a number" };
        return { present: true, value: n };
      }
      if (kind === "boolean") return { present: true, value: v === "true" };
      if (kind === "enum") {
        var t = spec.type;
        if (t === "number" || t === "integer") { var e = Number(v); return { present: true, value: isFinite(e) ? e : v }; }
        if (t === "boolean") return { present: true, value: v === "true" };
        // match the declared value's own identity where the enum holds non-strings
        var hit = spec.enum.filter(function (x) { return String(x) === v; });
        return { present: true, value: hit.length ? hit[0] : v };
      }
      if (kind === "raw") {
        try { return { present: true, value: JSON.parse(v) }; }
        catch (err) { return { error: name + ": " + err.message }; }
      }
      return { present: true, value: v };
    }

    function set(v) {
      if (v === undefined) { if (sub) setSub(null); control.value = ""; return; }
      if (kind === "raw") {
        if (sub) setSub(null);
        control.value = typeof v === "string" ? v : JSON.stringify(v, null, 2);
      } else if (kind === "boolean") {
        control.value = v === true ? "true" : v === false ? "false" : "";
      } else {
        control.value = typeof v === "object" ? JSON.stringify(v) : String(v);
      }
    }

    // Mount a generated sub-form over a raw field. `schema` is an ordinary
    // object schema — the same generator serves it, so an action's `fields`
    // block and a tool's `inputSchema` render through one code path.
    function setSub(schema, title) {
      if (!subhost) return false;
      clear(subhost);
      sub = null;
      if (!schema) { subhost.style.display = "none"; control.style.display = ""; return true; }
      var built = buildForm(schema);
      var head = el("div", { class: "subhead" }, [el("span", { text: title || "fields" })]);
      var back = el("button", { class: "ghost grow", type: "button", text: "raw JSON" });
      back.addEventListener("click", function () { setSub(null); });
      head.appendChild(back);
      var box = el("div", { class: "subform" }, [head, built.node]);
      subhost.appendChild(box);
      subhost.style.display = "";
      control.style.display = "none";
      sub = built;
      return true;
    }

    return { name: name, node: node, read: read, set: set, setSub: setSub, kind: kind };
  }

  /* A whole form from an object schema. Handles the JSON-Schema shape
   * (properties / required) and the flatter `fields` shape the actions
   * grammar uses, where each entry carries its own `required: true`. */
  function buildForm(schema) {
    schema = schema || {};
    var props = schema.properties && typeof schema.properties === "object" ? schema.properties : schema;
    var reqList = Array.isArray(schema.required) ? schema.required : [];
    var node = el("div", { class: "form" });
    var fields = {};
    var names = Object.keys(props || {});
    // A DOOR MAY PARTITION ITS FIELDS (2026-09-23, the founder on the move-in
    // form: "totally unclear which fields are for the household versus for the
    // resident … make that partition first class"). A field carrying
    // `x-group` is drawn inside a <fieldset> for that group, in the order the
    // groups first appear; `x-group-title` on any field of the group is its
    // <legend>, `x-group-hint` its one line under the legend. Ungrouped fields
    // stand where they always did. The `fields` map, `read()` and `set()` do
    // not know about groups at all — a group is where a box is DRAWN, never
    // what is sent.
    var groups = {};
    function hostFor(spec) {
      var key = typeof spec["x-group"] === "string" && spec["x-group"].trim() ? spec["x-group"].trim() : null;
      if (!key) return node;
      if (!groups[key]) {
        var fs = el("fieldset", { class: "group", "data-group": key });
        groups[key] = { node: fs, body: null, titled: false, hinted: false };
        node.appendChild(fs);
      }
      var g = groups[key];
      if (!g.titled && typeof spec["x-group-title"] === "string" && spec["x-group-title"].trim()) {
        var legend = el("legend", { text: spec["x-group-title"].trim() });
        g.node.insertBefore(legend, g.node.firstChild);
        g.titled = true;
      }
      if (!g.hinted && typeof spec["x-group-hint"] === "string" && spec["x-group-hint"].trim()) {
        var hint = el("p", { class: "group-hint", text: spec["x-group-hint"].trim() });
        if (g.body) g.node.insertBefore(hint, g.body); else g.node.appendChild(hint);
        g.hinted = true;
      }
      if (!g.body) { g.body = el("div", { class: "group-body" }); g.node.appendChild(g.body); }
      return g.body;
    }
    names.forEach(function (name) {
      var spec = props[name] || {};
      var required = reqList.indexOf(name) >= 0 || spec.required === true;
      var f = buildField(name, spec, required);
      fields[name] = f;
      hostFor(spec).appendChild(f.node);
    });
    if (!names.length) node.appendChild(el("p", { class: "hint", text: "this tool takes no arguments" }));

    function read() {
      var args = {}, errors = [];
      names.forEach(function (n) {
        var r = fields[n].read();
        if (r.error) errors.push(r.error);
        else if (r.present) args[n] = r.value;
      });
      return { args: args, errors: errors };
    }
    function setValues(obj) {
      names.forEach(function (n) { fields[n].set(obj && Object.prototype.hasOwnProperty.call(obj, n) ? obj[n] : undefined); });
    }
    return { node: node, fields: fields, read: read, setValues: setValues, names: names };
  }

  // ── JSON tree ─────────────────────────────────────────────────────────────

  function jsonTree(value, key, depth) {
    depth = depth || 0;
    var prefix = key == null ? null : el("span", { class: "k", text: key + ": " });
    if (value === null) return el("div", {}, [prefix, el("span", { class: "nul", text: "null" })]);
    var t = typeof value;
    if (t === "string") return el("div", {}, [prefix, el("span", { class: "s", text: JSON.stringify(value).slice(1, -1) })]);
    if (t === "number") return el("div", {}, [prefix, el("span", { class: "n", text: String(value) })]);
    if (t === "boolean") return el("div", {}, [prefix, el("span", { class: "b", text: String(value) })]);
    if (t !== "object") return el("div", {}, [prefix, el("span", { class: "meta", text: String(value) })]);

    var isArr = Array.isArray(value);
    var keys = isArr ? value.map(function (_, i) { return i; }) : Object.keys(value);
    if (!keys.length) return el("div", {}, [prefix, el("span", { class: "meta", text: isArr ? "[]" : "{}" })]);

    var d = el("details", depth < 2 ? { open: true } : {});
    var sum = el("summary", {}, [
      key == null ? null : el("span", { class: "k", text: key }),
      el("span", { class: "meta", text: (key == null ? "" : " ") + (isArr ? "[" + keys.length + "]" : "{" + keys.length + "}") }),
    ]);
    d.appendChild(sum);
    var kids = el("div", { class: "kids" });
    keys.forEach(function (k) { kids.appendChild(jsonTree(value[k], String(k), depth + 1)); });
    d.appendChild(kids);
    return d;
  }

  // An MCP image content block, rendered as the picture it is. Capped in height
  // so one answer cannot push the rest of the pane off screen; click to release
  // the cap and see it whole, click again to put it back. Nothing here knows
  // which tool produced it or what it depicts.
  function imageNode(item) {
    var mime = typeof item.mimeType === "string" && item.mimeType ? item.mimeType : "application/octet-stream";
    // base64 is 4 chars per 3 bytes; near enough to state a size honestly.
    var bytes = Math.round(String(item.data).replace(/=+$/, "").length * 3 / 4);
    var img = el("img", { src: "data:" + mime + ";base64," + item.data, alt: "an image this tool returned" });
    // The image sits on a PLATE rather than being the frame itself. A small
    // image is genuinely small — a 64px avatar, a 1px dot — and upscaling it to
    // fill a box would be the surface lying about what came back. The plate
    // gives it a visible ground and a clickable area at any size, so a tiny
    // picture reads as "a tiny picture" instead of as a broken frame.
    var plate = el("div", { class: "plate" }, [img]);
    var wrap = el("figure", { class: "shot" }, [plate]);
    var meta = el("figcaption", { class: "shotmeta", text: mime + " · ~" + bytes.toLocaleString() + " bytes · click to toggle full size" });
    wrap.appendChild(meta);
    plate.addEventListener("click", function () { wrap.classList.toggle("full"); });
    // A picture that will not decode says so, rather than leaving a broken
    // frame and no explanation.
    img.addEventListener("error", function () {
      clear(wrap);
      wrap.appendChild(el("p", { class: "shotfail", text: "this image block did not decode — " + mime + ", ~" + bytes.toLocaleString() + " bytes. The raw envelope below still holds it verbatim." }));
    });
    return wrap;
  }

  // ── the one grammar-aware affordance ──────────────────────────────────────
  //
  // Walk any payload for arrays named `actions` OR `acts` whose entries carry
  // both a name and a `fields` block. That pair IS the grammar; no action
  // name, tool name or door is known here. TWO SPELLINGS, ONE GRAMMAR
  // (Keemin-ruled 2026-08-25): the world speaks `actions`/`action` — the
  // class-mark key, what the ground grants where you stand — while household
  // and town speak `acts`/`act`, the door's own fixed verbs. The distinction
  // is the town's vocabulary, so the walker honors both instead of forcing
  // one door to wear the other's word. Entries normalize to `.action` here so
  // everything downstream keeps reading one key.

  function collectActions(root) {
    var out = [], seen = {};
    function take(e, nameKey) {
      var name = e && typeof e === "object" ? e[nameKey] : null;
      if (typeof name === "string" && name
          && e.fields && typeof e.fields === "object" && !Array.isArray(e.fields)
          && !seen[name]) {
        seen[name] = 1;
        out.push(e.action === name ? e : Object.assign({}, e, { action: name }));
      }
    }
    (function walk(v, d) {
      if (!v || typeof v !== "object" || d > 8) return;
      if (Array.isArray(v)) { v.forEach(function (x) { walk(x, d + 1); }); return; }
      Object.keys(v).forEach(function (k) {
        var x = v[k];
        if (k === "actions" && Array.isArray(x)) x.forEach(function (e) { take(e, "action"); });
        if (k === "acts" && Array.isArray(x)) x.forEach(function (e) { take(e, "act"); });
        walk(x, d + 1);
      });
    })(root, 0);
    return out;
  }

  // The envelope a prefill needs: a `do`-shaped string property and an
  // `args`-shaped object property on the SOURCE tool's own schema. A tool that
  // does not declare them gets no button — the affordance follows the grammar,
  // never a name we recognised.
  function apexEnvelope(tool) {
    var p = (tool && tool.inputSchema && tool.inputSchema.properties) || {};
    var hasDo = p.do && p.do.type === "string";
    var hasArgs = p.args && p.args.type === "object";
    return hasDo && hasArgs ? { doKey: "do", argsKey: "args" } : null;
  }

  // An action's `fields` block, rendered through the same form generator.
  function fieldsSchema(fields) {
    var props = {}, required = [];
    Object.keys(fields || {}).forEach(function (n) {
      var spec = fields[n] && typeof fields[n] === "object" ? fields[n] : { type: "string" };
      props[n] = spec;
      if (spec.required === true) required.push(n);
    });
    return { type: "object", properties: props, required: required };
  }

  function prefillAction(toolName, entry) {
    var card = state.cards[toolName];
    if (!card) return;
    var env = apexEnvelope(card.tool);
    card.details.open = true;
    card.setRawMode(false);
    if (env) {
      card.form.fields[env.doKey].set(entry.action);
      card.form.fields[env.argsKey].setSub(fieldsSchema(entry.fields), entry.action + " · fields");
    } else {
      // No declared envelope: hand the reader the grammar as raw arguments and
      // let the door's own validator have the last word.
      card.setRawMode(true);
      card.raw.value = JSON.stringify({ do: entry.action, args: {} }, null, 2);
    }
    card.details.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── rendering: tool cards ─────────────────────────────────────────────────

  function firstLine(s) {
    var t = String(s || "").replace(/\s+/g, " ").trim();
    return t.length > 120 ? t.slice(0, 117) + "…" : t;
  }

  // Which register a verb wears. "apex" is derived from the tool's own schema;
  // "vestigial" is the handrolled list at the top of this file; everything else
  // gets the ordinary card, which is most of the town and should stay that way.
  // An apex that somehow appeared on the migrated list is still gold: a door
  // cannot be both the way in and retired, and the derived fact outranks the
  // copied one.
  function verbRegister(tool) {
    if (apexEnvelope(tool)) return "apex";
    if (MIGRATED_FLATS.indexOf(tool && tool.name) >= 0) return "vestigial";
    return "";
  }

  function toolCard(tool) {
    var schema = tool.inputSchema || {};
    var props = schema.properties || {};
    var n = Object.keys(props).length;
    var register = verbRegister(tool);

    var details = el("details", { class: "tool" + (register ? " " + register : "") });
    details.appendChild(el("summary", {}, [
      el("span", { class: "name", text: tool.name }),
      register === "apex" ? el("span", { class: "vtag apex", text: "apex" }) : null,
      register === "vestigial" ? el("span", { class: "vtag vestigial", title: "still works, still callable — but its function now lives behind an apex verb", text: "migrated" }) : null,
      el("span", { class: "teaser", text: firstLine(tool.description) }),
      el("span", { class: "argcount", text: n === 1 ? "1 arg" : n + " args" }),
    ]));

    var body = el("div", { class: "body" });
    // The description WHOLE. This is the ontology display: the door's own
    // law-prose, unclamped, unsummarised, in the register it was written in.
    if (tool.description) body.appendChild(el("div", { class: "law", text: String(tool.description) }));

    var form = buildForm(schema);
    var raw = el("textarea", { rows: "6", placeholder: '{ "argument": "value" }' });
    var rawWrap = el("div", { class: "field raw" }, [
      el("div", { class: "lab" }, [el("span", { text: "arguments" }), el("span", { class: "ty", text: "raw JSON" })]),
      raw,
    ]);
    rawWrap.style.display = "none";
    body.appendChild(form.node);
    body.appendChild(rawWrap);

    var err = el("span", { class: "callerr" });
    var callBtn = el("button", { class: "primary", type: "button", text: "call" });
    var rawBtn = el("button", { class: "ghost", type: "button", text: "raw arguments" });
    var clearBtn = el("button", { class: "ghost", type: "button", text: "clear" });
    body.appendChild(el("div", { class: "rowbtns" }, [callBtn, rawBtn, clearBtn, err]));
    details.appendChild(body);

    var rawMode = false;
    function setRawMode(on) {
      rawMode = !!on;
      form.node.style.display = rawMode ? "none" : "";
      rawWrap.style.display = rawMode ? "" : "none";
      rawBtn.textContent = rawMode ? "generated form" : "raw arguments";
    }
    rawBtn.addEventListener("click", function () {
      if (!rawMode) { var r = form.read(); if (!r.errors.length) raw.value = JSON.stringify(r.args, null, 2); }
      setRawMode(!rawMode);
    });
    clearBtn.addEventListener("click", function () {
      form.setValues({});
      Object.keys(form.fields).forEach(function (k) { if (form.fields[k].kind === "raw") form.fields[k].setSub(null); });
      raw.value = "";
      err.textContent = "";
    });

    function currentArgs() {
      if (rawMode) {
        var v = raw.value.trim();
        if (!v) return { args: {} };
        try {
          var parsed = JSON.parse(v);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { error: "arguments must be a JSON object" };
          return { args: parsed };
        } catch (e) { return { error: e.message }; }
      }
      var r = form.read();
      return r.errors.length ? { error: r.errors.join("; ") } : { args: r.args };
    }

    callBtn.addEventListener("click", function () {
      var got = currentArgs();
      err.textContent = "";
      if (got.error) { err.textContent = got.error; return; }
      callBtn.disabled = true;
      callTool(tool.name, got.args).then(function () { callBtn.disabled = false; },
        function (e) { callBtn.disabled = false; err.textContent = String(e && e.message || e); });
    });

    var card = {
      tool: tool, details: details, form: form, raw: raw,
      setRawMode: setRawMode,
      fill: function (args) { setRawMode(true); raw.value = JSON.stringify(args || {}, null, 2); details.open = true; },
    };
    state.cards[tool.name] = card;
    return details;
  }

  function renderTools(filterText) {
    var q = String(filterText || "").trim().toLowerCase();
    clear(ui.tools);
    var shown = 0;
    state.tools.forEach(function (t) {
      if (q && (String(t.name) + " " + String(t.description || "")).toLowerCase().indexOf(q) < 0) return;
      shown++;
      ui.tools.appendChild(toolCard(t));
    });
    if (!state.tools.length) ui.tools.appendChild(el("p", { class: "empty", text: "no tools yet — connect above." }));
    else if (!shown) ui.tools.appendChild(el("p", { class: "empty", text: "no tool matches that filter." }));
    ui.toolCount.textContent = state.tools.length ? (shown === state.tools.length ? state.tools.length + " listed" : shown + " of " + state.tools.length) : "";
  }

  // ── rendering: a response ─────────────────────────────────────────────────

  function renderResponse(entry) {
    clear(ui.response);
    var env = entry.envelope;
    ui.response.appendChild(el("div", { class: "phead" }, [
      el("span", { class: "badge " + (entry.ok ? "ok" : "bad"), text: entry.ok ? "ok" : "error" }),
      el("span", { text: entry.tool }),
      el("span", { class: "ms", text: entry.ms + " ms · HTTP " + entry.status }),
    ]));

    if (!env) {
      ui.response.appendChild(el("pre", { class: "json", text: entry.raw || "(empty body)" }));
      return;
    }

    // The payload the door actually answered with: MCP content items carry
    // JSON as text, so parse where we can and tree it; anything else renders
    // as the text it is.
    var payloads = [];
    var result = env.result;
    if (result && Array.isArray(result.content)) {
      result.content.forEach(function (item) {
        if (item && item.type === "text" && typeof item.text === "string") {
          try { payloads.push({ parsed: JSON.parse(item.text) }); }
          catch (e) { payloads.push({ text: item.text }); }
        } else if (item && item.type === "image" && typeof item.data === "string") {
          // A picture is for looking at. Rendering base64 into the JSON tree
          // would be several thousand lines of the reader's attention spent on
          // bytes no human reads — so an image block becomes an image. Generic
          // by type, as ever: any tool's image block lands here and nothing
          // knows which tool sent it.
          payloads.push({ image: item });
        } else payloads.push({ parsed: item });
      });
    } else payloads.push({ parsed: env.error !== undefined ? env.error : result !== undefined ? result : env });

    // The affordance strip, above the payload it came from.
    var acts = [];
    payloads.forEach(function (p) { if (p.parsed) acts = acts.concat(collectActions(p.parsed)); });
    if (acts.length && state.cards[entry.tool]) {
      var strip = el("div", { class: "afford" }, [
        el("div", { class: "ahead", text: "acts in this answer — one click prefills a call" }),
      ]);
      var btns = el("div", { class: "abtns" });
      acts.forEach(function (a) {
        var nf = Object.keys(a.fields || {}).length;
        // The blurb rides as the button's title where the grammar carried one:
        // it is the act's own quoted law, and hovering is cheaper than opening
        // the tree to find it. Still grammar, still no action named here.
        var b = el("button", { type: "button", title: a.blurb || a.action }, [
          el("span", { text: a.action }),
          el("span", { class: "fc", text: nf === 1 ? "1 field" : nf + " fields" }),
        ]);
        b.addEventListener("click", function () { prefillAction(entry.tool, a); });
        btns.appendChild(b);
      });
      strip.appendChild(btns);
      ui.response.appendChild(strip);
    }

    payloads.forEach(function (p) {
      if (p.image) ui.response.appendChild(imageNode(p.image));
      else if (p.text !== undefined) ui.response.appendChild(el("pre", { class: "json", text: p.text }));
      else ui.response.appendChild(el("div", { class: "json" }, [jsonTree(p.parsed, null, 0)]));
    });

    // The raw envelope stays WHOLE — base64 and all. It is the only view that
    // claims to be what came off the wire, and a truncated one would be a lie
    // dressed as a receipt. It is collapsed by default and its pre scrolls
    // inside a fixed height, which is the honest way to keep a megabyte of
    // base64 from eating the page: present, findable, not in the way.
    var rawTog = el("details", { class: "instr" }, [el("summary", { text: "raw JSON-RPC envelope" })]);
    rawTog.appendChild(el("pre", { class: "json raw", text: JSON.stringify(env, null, 2) }));
    ui.response.appendChild(rawTog);
  }

  // ── history ───────────────────────────────────────────────────────────────

  function persistHistory() {
    // Replay parts only. Envelopes stay in memory: a long answer would blow
    // the quota, and nothing about a stored answer is needed to send it again.
    store(LS_HISTORY, JSON.stringify(state.history.map(function (h) {
      return { ts: h.ts, tool: h.tool, args: h.args, ok: h.ok, ms: h.ms, status: h.status };
    })));
  }
  function loadHistory() {
    try {
      var v = JSON.parse(recall(LS_HISTORY, "[]"));
      if (Array.isArray(v)) state.history = v.slice(0, HISTORY_MAX);
    } catch (e) { state.history = []; }
  }

  function renderHistory() {
    clear(ui.history);
    if (!state.history.length) { ui.history.appendChild(el("p", { class: "empty", text: "no calls yet." })); return; }
    state.history.forEach(function (h, i) {
      var row = el("div", { class: "row" + (h.selected ? " sel" : "") });
      row.appendChild(el("span", { class: "dot " + (h.ok ? "ok" : "bad"), text: h.ok ? "●" : "▲" }));
      var nm = el("span", { class: "nm", text: h.tool });
      nm.addEventListener("click", function () {
        if (h.envelope) { select(i); renderResponse(h); }
        else { state.cards[h.tool] && state.cards[h.tool].fill(h.args); }
      });
      row.appendChild(nm);
      row.appendChild(el("span", { class: "t", text: new Date(h.ts).toLocaleTimeString() + " · " + h.ms + "ms" }));
      var grow = el("div", { class: "grow" });
      var fill = el("button", { class: "ghost", type: "button", text: "fill" });
      fill.addEventListener("click", function () { var c = state.cards[h.tool]; if (c) { c.fill(h.args); c.details.scrollIntoView({ behavior: "smooth", block: "start" }); } });
      var again = el("button", { class: "ghost", type: "button", text: "replay" });
      again.addEventListener("click", function () { callTool(h.tool, h.args); });
      grow.appendChild(fill); grow.appendChild(again);
      row.appendChild(grow);
      ui.history.appendChild(row);
    });
  }
  function select(i) { state.history.forEach(function (h, j) { h.selected = i === j; }); renderHistory(); }

  // ── the calls ─────────────────────────────────────────────────────────────

  function callTool(name, args) {
    return rpc("tools/call", { name: name, arguments: args || {} }).then(function (r) {
      var env = r.envelope;
      var ok = r.status < 400 && env && !env.error && !(env.result && env.result.isError);
      var entry = { ts: Date.now(), tool: name, args: args || {}, ok: ok, ms: r.ms, status: r.status, envelope: env, raw: r.raw };
      state.history.unshift(entry);
      state.history = state.history.slice(0, HISTORY_MAX);
      persistHistory();
      select(0);
      renderResponse(entry);
      return entry;
    });
  }

  function setStatus(cls, text) { clear(ui.status); ui.status.appendChild(el("span", { class: cls, text: text })); }

  function connect() {
    store(LS_ENDPOINT, ui.endpoint.value.trim());
    store(LS_KEY, ui.key.value);
    state.protocol = null;
    setStatus("wait", "initialize…");
    return rpc("initialize", {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "postmark-mcp-prototype", version: "0" },
    }).then(function (r) {
      var env = r.envelope;
      if (r.status >= 400 || !env || env.error) {
        setStatus("bad", "HTTP " + r.status + " — " + doorSays(env, r.raw));
        renderResponse({ tool: "initialize", ok: false, ms: r.ms, status: r.status, envelope: env, raw: r.raw });
        return null;
      }
      var res = env.result || {};
      state.protocol = res.protocolVersion || PROTOCOL;
      state.serverInfo = res.serverInfo || null;
      state.instructions = res.instructions || "";
      renderInstructions();
      // Stateless server or not, the handshake is the handshake.
      rpc("notifications/initialized", null, true).catch(function () { /* a 202 with no body is success */ });
      return listTools();
    }).catch(function (e) {
      setStatus("bad", "no answer from " + (ui.endpoint.value.trim() || DEFAULT_ENDPOINT) + " — " + String(e && e.message || e));
    });
  }

  // Whatever prose the door put in its own refusal. It knows its reasons; we
  // do not invent one for it.
  function doorSays(env, raw) {
    if (env && env.error && env.error.message) return env.error.message;
    if (env && (env.defect || env.hint)) return [env.defect, env.hint].filter(Boolean).join(" — ");
    if (env && env.result) return JSON.stringify(env.result).slice(0, 200);
    return String(raw || "").slice(0, 200) || "no body";
  }

  function listTools() {
    setStatus("wait", "tools/list…");
    return rpc("tools/list", {}).then(function (r) {
      var env = r.envelope;
      if (r.status >= 400 || !env || env.error || !env.result || !Array.isArray(env.result.tools)) {
        setStatus("bad", "tools/list failed (HTTP " + r.status + ") — " + doorSays(env, r.raw));
        renderResponse({ tool: "tools/list", ok: false, ms: r.ms, status: r.status, envelope: env, raw: r.raw });
        return null;
      }
      state.tools = env.result.tools;
      state.cards = {};
      renderTools(ui.filter.value);
      var who = state.serverInfo ? state.serverInfo.name + " " + (state.serverInfo.version || "") : "connected";
      setStatus("ok", who.trim() + " · MCP " + (state.protocol || "?") + " · " + state.tools.length + " tools · " + r.ms + " ms");
      return state.tools;
    });
  }

  function renderInstructions() {
    clear(ui.instr);
    if (!state.instructions) { ui.instr.style.display = "none"; return; }
    ui.instr.style.display = "";
    ui.instr.appendChild(el("summary", { text: "the server's own instructions" }));
    ui.instr.appendChild(el("p", { text: state.instructions }));
  }

  // ── the page ──────────────────────────────────────────────────────────────

  function build(root) {
    ui.endpoint = el("input", { type: "text", spellcheck: "false", value: recall(LS_ENDPOINT, DEFAULT_ENDPOINT) });
    ui.key = el("input", { type: "password", spellcheck: "false", autocomplete: "off", placeholder: "Bearer …", value: recall(LS_KEY, "") });
    ui.status = el("div", { class: "status" });
    ui.instr = el("details", { class: "instr" });
    ui.instr.style.display = "none";

    ui.cred = el("span", { class: "credwrap" });
    // The slot's shape is worth seeing at a glance, and the field itself is the
    // authority — so re-read it on every edit rather than trusting a flag.
    ui.key.addEventListener("input", function () { store(LS_KEY, ui.key.value); renderCred(); });

    var connectBtn = el("button", { class: "primary", type: "button", text: "connect" });
    connectBtn.addEventListener("click", function () { connect(); });
    var signInBtn = el("button", { type: "button", text: "sign in with github" });
    signInBtn.addEventListener("click", function () { signIn().catch(function () { /* the status line already said why */ }); });
    var refreshBtn = el("button", { type: "button", text: "refresh tools" });
    refreshBtn.addEventListener("click", function () { store(LS_KEY, ui.key.value); listTools(); });
    var forgetBtn = el("button", { class: "ghost", type: "button", text: "forget credential" });
    forgetBtn.addEventListener("click", function () { signOut(false); });

    var mast = el("header", { class: "mast" }, [
      el("h1", { text: "the office, as it stands" }),
      el("p", { class: "sub", text: "a procedural MCP surface · it knows no doors, only the protocol" }),
      el("div", { class: "conn" }, [
        el("div", { class: "f wide" }, [el("label", { text: "endpoint" }), ui.endpoint]),
        el("div", { class: "f" }, [el("label", { text: "bearer key" }), ui.key]),
        el("div", {}, [connectBtn]),
        el("div", {}, [signInBtn]),
        el("div", {}, [refreshBtn]),
        el("div", {}, [forgetBtn]),
        el("div", {}, [ui.cred]),
        el("p", { class: "note", text: "one credential slot, two ways to fill it: paste a household key, or sign in with GitHub through the office's own OAuth. Either way it is kept in this browser's localStorage and sent as an Authorization header — the office resolves both shapes, and this page never branches on which." }),
      ]),
      ui.status,
      ui.instr,
    ]);

    ui.filter = el("input", { type: "text", class: "filter", placeholder: "filter tools — name or prose" });
    ui.filter.addEventListener("input", function () { renderTools(ui.filter.value); });
    ui.toolCount = el("span", { class: "count" });
    ui.tools = el("div", {});
    ui.response = el("div", { class: "panel" });
    ui.history = el("div", { class: "hist" });

    var left = el("section", { class: "col" }, [
      el("h2", {}, [el("span", { text: "tools" }), ui.toolCount]),
      ui.filter, ui.tools,
    ]);
    var right = el("section", { class: "col right" }, [
      el("h2", {}, [el("span", { text: "response" })]),
      ui.response,
      el("h2", {}, [el("span", { text: "history" })]),
      ui.history,
    ]);

    root.appendChild(mast);
    root.appendChild(el("div", { class: "wrap" }, [left, right]));

    loadHistory();
    renderTools("");
    renderHistory();
    renderCred();
    ui.response.appendChild(el("p", { class: "empty", text: "nothing called yet." }));
    setStatus("wait", "not connected.");
  }

  function init(rootId) {
    var root = document.getElementById(rootId || "mcp-root");
    if (!root) return null;
    clear(root);
    build(root);

    // Returning from GitHub: the office sent the reader back here with a code.
    // Exchange it, then scrub the query out of the URL so a reload is not a
    // replay attempt against a single-use code.
    var cb = null;
    try { cb = parseCallback(location.search); } catch (e) { cb = null; }
    if (cb) {
      completeCallback(cb).then(function (t) {
        try { history.replaceState(null, "", location.pathname); } catch (e) { /* file:// has no history to rewrite */ }
        if (t) connect();
      });
      return api;
    }

    // A remembered session that has aged out gets one quiet renewal attempt
    // before anyone is asked to click anything.
    refreshIfStale().then(function () {
      // Auto-connect when a credential is already remembered — the page is a
      // lamp you walk up to, not a form you fill in twice.
      if (ui.key.value) connect();
    });
    return api;
  }

  var api = {
    init: init,
    connect: connect,
    listTools: listTools,
    callTool: callTool,
    signIn: signIn,
    signOut: signOut,
    // exposed for the offline harness, which asserts against the same units
    // the page runs on rather than a copy of them
    _internals: {
      buildForm: buildForm, buildField: buildField, kindOf: kindOf, collectActions: collectActions,
      apexEnvelope: apexEnvelope, fieldsSchema: fieldsSchema, jsonTree: jsonTree, state: state, ui: ui,
      discoverAS: discoverAS, officeBase: officeBase, parseCallback: parseCallback,
      completeCallback: completeCallback, tokenIsFresh: tokenIsFresh, credShape: credShape,
      getCred: getCred, redirectUri: redirectUri, elsewhere: elsewhere, refreshIfStale: refreshIfStale,
      verbRegister: verbRegister, imageNode: imageNode, MIGRATED_FLATS: MIGRATED_FLATS,
      keys: { LS_KEY: LS_KEY, LS_CRED: LS_CRED, LS_CLIENT: LS_CLIENT, SS_STATE: SS_STATE, SS_VERIFIER: SS_VERIFIER },
    },
  };
  window.MCPProto = api;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { if (!window.MCP_PROTO_MANUAL) init(); });
  else if (!window.MCP_PROTO_MANUAL) init();
})();
