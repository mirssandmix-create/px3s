/* ใบราคา 3ส. — ตัวคิด (ไม่แตะหน้าจอ) ใช้ทั้งแอพ Android และเว็บแอพ iPhone
   คุยกับเว็บแอพซื้อของผ่านช่องทางโปรแกรมร้าน: POST {fn, data} (fn "login" เดิม · fn "px" ของแอพนี้)
   ทุกอย่างอยู่ใน window.PX — หน้าจอ (px-app.js) และชุดทดสอบเรียกจากที่นี่ */
"use strict";
(function (G) {
  const PX = {};

  /* ---------- ตัวช่วยทั่วไป ---------- */
  PX.key = (c, p) => String(c == null ? "" : c) + "||" + String(p == null ? "" : p);
  PX.esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  PX.r2 = n => Math.round(Number(n) * 100) / 100;
  /* ราคาแบบอ่านง่าย: 1,234.5 · 8.25 · 464 (ไม่มี .00) */
  PX.fmt = n => {
    const v = Number(n);
    if (!isFinite(v)) return "—";
    return PX.r2(v).toLocaleString("en-US", { maximumFractionDigits: 2 });
  };
  /* ช่องราคา: เลขไทยได้ · ช่องว่าง/จุลภาคหลักพันตัดทิ้ง · อย่างอื่น (ตัวอักษร * / ฯลฯ) = ใช้ไม่ได้ (NaN) ไม่เดา */
  PX.parsePrice = s => {
    let t = String(s == null ? "" : s).trim().replace(/[๐-๙]/g, d => String("๐๑๒๓๔๕๖๗๘๙".indexOf(d)));
    t = t.replace(/\s+/g, "");
    if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
    if (!/^(\d+(\.\d*)?|\.\d+)$/.test(t)) return NaN;
    const v = Number(t);
    return isFinite(v) && v <= 100000 ? PX.r2(v) : NaN;
  };
  const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const TH_MON_L = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
  const TH_DAY = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  /* "2026-11-08 09:12" → "8 พ.ย. 09:12" (ปีนี้) / "8 พ.ย. 68 09:12" (ปีอื่น) */
  PX.when = (t, now) => {
    const m = String(t || "").match(/^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d:\d\d))?/);
    if (!m) return String(t || "");
    const y = Number(m[1]), yNow = (now || new Date()).getFullYear();
    return Number(m[3]) + " " + TH_MON[Number(m[2]) - 1] + (y !== yNow ? " " + String(y + 543).slice(2) : "") + (m[4] ? " " + m[4] : "");
  };
  PX.longDate = d => "วัน" + TH_DAY[d.getDay()] + "ที่ " + d.getDate() + " " + TH_MON_L[d.getMonth()] + " " + (d.getFullYear() + 543);
  PX.shortDate = d => d.getDate() + " " + TH_MON[d.getMonth()] + " " + (d.getFullYear() + 543);
  PX.stamp = d => {
    const p = n => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  };
  PX.parseStamp = t => {
    const m = String(t || "").match(/^(\d{4})-(\d\d)-(\d\d)[ T](\d\d):(\d\d)/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime() : NaN;
  };
  PX.isKg = u => { const s = String(u || "").trim(); return !s || /^(กก\.?|กิโล(กรัม)?|kg)$/i.test(s); };
  PX.unit = u => PX.isKg(u) ? "กก." : String(u).trim();

  /* ---------- ลิงก์เว็บ ---------- */
  /* รับเฉพาะลิงก์เว็บแอพของ Google (script.google.com/macros/s/…/exec) — วางทั้งข้อความที่มีลิงก์ก็ได้ · ทดสอบ: localhost */
  PX.cleanUrl = (text, allowLocal) => {
    const m = String(text || "").match(/https?:[/][/][^\s"'<>]+/);
    if (!m) return "";
    let u;
    try { u = new URL(m[0].replace(/[.,)]+$/, "")); } catch (e) { return ""; }
    const local = allowLocal && (u.hostname === "127.0.0.1" || u.hostname === "localhost");
    if (!local && (u.protocol !== "https:" || u.hostname !== "script.google.com")) return "";
    if (!/[/]exec$/.test(u.pathname)) return "";
    return u.origin + u.pathname;
  };

  /* ---------- คุยกับเว็บ ---------- */
  PX.Offline = class extends Error {};
  PX.AuthError = class extends Error {};
  /* POST แบบ text/plain (ไม่ต้องถามก่อนข้ามโดเมน) · ไม่มีเน็ต/เว็บไม่ตอบ = Offline · auth:true = ต้องเข้าสู่ระบบใหม่ */
  PX.post = async (url, fn, data, ms) => {
    if (!url) throw new Error("ยังไม่ได้ใส่ลิงก์เว็บ");
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), ms || 60000) : 0;
    let res, txt;
    try {
      res = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ fn: fn, data: data || {} }), redirect: "follow", signal: ctl ? ctl.signal : undefined });
      txt = await res.text();
    } catch (e) {
      throw new PX.Offline(e && e.name === "AbortError" ? "เว็บตอบช้าเกินไป — ลองใหม่อีกครั้ง" : "ติดต่อเว็บไม่ได้ (ไม่มีอินเทอร์เน็ต?)");
    } finally { if (timer) clearTimeout(timer); }
    let j = null;
    try { j = JSON.parse(txt); } catch (e) {}
    if (!j || typeof j !== "object") {
      if (/accounts\.google|ServiceLogin|<html/i.test(String(txt || ""))) throw new Error("ลิงก์นี้เปิดไม่ได้แบบไม่ล็อกอิน — ตรวจลิงก์เว็บอีกครั้ง");
      throw new Error("เว็บตอบกลับผิดรูปแบบ" + (res && !res.ok ? " (" + res.status + ")" : ""));
    }
    if (j.ok === false) {
      if (j.auth) throw new PX.AuthError(j.error || "กรุณาเข้าสู่ระบบใหม่");
      const e = new Error(j.error || "เกิดข้อผิดพลาด"); e.data = j; throw e;
    }
    return j;
  };

  /* ---------- ข้อมูลราคา ---------- */
  /* load → โครงที่หน้าจอใช้: กลุ่มตามลำดับหมวด, ดัชนีราคา, ร้านพ่อ */
  PX.normalize = d => {
    const items = (Array.isArray(d && d.items) ? d.items : []).filter(x => x && x.c && x.p)
      .map(x => ({ c: String(x.c), p: String(x.p), price: Number(x.price) || 0, unit: PX.unit(x.unit), k: PX.key(x.c, x.p) }));
    const byKey = {};
    items.forEach(x => { if (!byKey[x.k]) byKey[x.k] = x; });
    const cats = [];
    (Array.isArray(d && d.cats) ? d.cats : []).forEach(c => { c = String(c || ""); if (c && cats.indexOf(c) < 0) cats.push(c); });
    items.forEach(x => { if (cats.indexOf(x.c) < 0) cats.push(x.c); });
    const steel = d && d.steel && Array.isArray(d.steel.rows) ? d.steel : null;
    const steelByKey = {};
    if (steel) steel.rows.forEach(r => { if (r && r.key && !steelByKey[r.key]) steelByKey[r.key] = { n: String(r.n || ""), p: Number(r.p) || 0, w: String(r.w || "") }; });
    return {
      at: String(d && d.at || ""), items, byKey, cats, layout: d && d.layout || null,
      shop: Object.assign({ name: "", phone: "", address: "" }, d && d.shop || {}),
      steel, steelByKey, steelError: String(d && d.steelError || ""), rev: d && d.rev || null
    };
  };
  /* ค้นหา: ไม่สนช่องว่าง/ตัวพิมพ์ · ตรงหมวดก็ขึ้นทั้งหมวด */
  PX.norm = s => String(s || "").toLowerCase().replace(/\s+/g, "");
  PX.groups = (D, q) => {
    const nq = PX.norm(q);
    return D.cats.map(c => ({
      cat: c,
      items: D.items.filter(x => x.c === c && (!nq || PX.norm(x.p).indexOf(nq) >= 0 || PX.norm(c).indexOf(nq) >= 0))
    })).filter(g => g.items.length);
  };
  /* ราคาร้านพ่อทั้งใบ (ลำดับตามชีตร้านพ่อ) + ราคาเราของตัวที่จับคู่ได้ */
  PX.steelRows = (D, q) => {
    if (!D.steel) return [];
    const nq = PX.norm(q);
    return D.steel.rows.filter(r => r && r.n && (!nq || PX.norm(r.n).indexOf(nq) >= 0))
      .map(r => { const ours = r.key ? D.byKey[r.key] : null; return { n: String(r.n), p: Number(r.p) || 0, w: String(r.w || ""), key: r.key || "", ours: ours ? ours.price : null }; });
  };

  /* ---------- ที่แก้ค้าง (ยังไม่บันทึก) ----------
     edits: { key: { v: ข้อความในช่อง, old: ราคาตอนเริ่มแก้ } } — old ส่งไปให้เว็บตรวจว่ามีคนแก้ไปก่อนไหม */
  PX.setEdit = (edits, D, key, text) => {
    const it = D.byKey[key];
    if (!it) return edits;
    const out = Object.assign({}, edits);
    const prev = out[key];
    const v = String(text == null ? "" : text);
    const n = PX.parsePrice(v);
    if (n === it.price && (!prev || prev.old === it.price)) delete out[key];   // แก้กลับเท่าเดิม = ไม่ใช่ที่แก้
    else out[key] = { v: v, old: prev ? prev.old : it.price };
    return out;
  };
  /* หลังดึงราคาใหม่: ตัวที่ราคาบนเว็บเปลี่ยนเป็นค่าที่แก้ไว้แล้ว = จบ · สินค้าหาย = ทิ้ง · ที่เหลือคงไว้ (old เดิม → ตอนบันทึกเว็บจะบอกว่ามีคนแก้ไปก่อน) */
  PX.rebaseEdits = (edits, D) => {
    const out = {};
    Object.keys(edits || {}).forEach(k => {
      const e = edits[k], it = D.byKey[k];
      if (!it || !e) return;
      const n = PX.parsePrice(e.v);
      if (n === it.price) return;
      out[k] = { v: String(e.v), old: Number(e.old) };
    });
    return out;
  };
  /* รายการที่จะบันทึก + ที่ยังผิด (ช่องว่าง/พิมพ์ผิด) */
  PX.pending = (edits, D) => {
    const ok = [], bad = [];
    Object.keys(edits || {}).forEach(k => {
      const e = edits[k], it = D.byKey[k];
      if (!it) return;
      const n = PX.parsePrice(e.v);
      if (!isFinite(n)) { bad.push({ k, c: it.c, p: it.p, v: e.v }); return; }
      if (n === it.price && e.old === it.price) return;
      const pct = e.old ? PX.r2((n - e.old) / e.old * 100) : 0;
      ok.push({ k, c: it.c, p: it.p, old: e.old, price: n, unit: it.unit, pct, big: e.old > 0 && Math.abs(pct) > 15 || n === 0 });
    });
    const order = {};
    D.items.forEach((x, i) => { order[x.k] = i; });
    ok.sort((a, b) => order[a.k] - order[b.k]);
    return { ok, bad };
  };

  /* ---------- ประวัติ / กราฟ ----------
     rows (จากเว็บ ใหม่สุดก่อน) [{t,key,old,neu,by,src}] · ราคาตอนนี้ cur → จุดแบบขั้นบันได [{x (ms), v}] ช่วง days วันล่าสุด */
  PX.series = (rows, cur, days, nowMs) => {
    const now = nowMs || Date.now();
    const from = now - days * 86400000;
    // เว็บส่งใหม่สุดก่อน · นาทีเดียวกัน = ตัวที่อยู่ก่อนในรายการใหม่กว่า
    const ev = (rows || []).map((r, i) => ({ x: PX.parseStamp(r.t), old: Number(r.old), v: Number(r.neu), i }))
      .filter(e => isFinite(e.x) && isFinite(e.v)).sort((a, b) => a.x - b.x || b.i - a.i);
    /* ราคาตอนต้นช่วง = ราคาใหม่ของครั้งล่าสุดก่อนต้นช่วง · ไม่มี = ราคาเดิมของครั้งแรกในช่วง · ไม่มีอะไรเลย = ราคาตอนนี้ */
    let start = null;
    ev.forEach(e => { if (e.x <= from) start = e.v; });
    const inR = ev.filter(e => e.x > from && e.x <= now);
    if (start == null) start = inR.length ? inR[0].old : Number(cur);
    if (!isFinite(start)) start = Number(cur) || 0;
    const pts = [{ x: from, v: start }];
    let last = start;
    inR.forEach(e => { pts.push({ x: e.x, v: last }); pts.push({ x: e.x, v: e.v }); last = e.v; });
    pts.push({ x: now, v: isFinite(Number(cur)) ? Number(cur) : last });
    return pts;
  };
  PX.chartSvg = (pts, w, h, color) => {
    if (!pts || pts.length < 2) return "";
    const xs = pts.map(p => p.x), vs = pts.map(p => p.v);
    let x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    if (x1 === x0) x1 = x0 + 1;
    if (hi === lo) { const pad = Math.max(1, Math.abs(hi) * 0.05); lo -= pad; hi += pad; }
    else { const pad = (hi - lo) * 0.12; lo -= pad; hi += pad; }
    const L = 8, R = 8, T = 10, B = 10;
    const X = x => L + (x - x0) / (x1 - x0) * (w - L - R), Y = v => T + (hi - v) / (hi - lo) * (h - T - B);
    const d = pts.map((p, i) => (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.v).toFixed(1)).join(" ");
    const lp = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="none" role="img" aria-label="กราฟราคา">` +
      `<line x1="${L}" x2="${w - R}" y1="${h - B}" y2="${h - B}" stroke="currentColor" stroke-opacity=".18"/>` +
      `<path d="${d}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>` +
      `<circle cx="${X(lp.x).toFixed(1)}" cy="${Y(lp.v).toFixed(1)}" r="4" fill="${color}"/></svg>`;
  };
  /* ราคา ณ เวลา x (จุดขั้นบันได: จุดสุดท้ายที่ไม่เกิน x) */
  PX.valueAt = (pts, x) => {
    let v = pts && pts.length ? pts[0].v : NaN;
    for (const p of pts || []) { if (p.x <= x) v = p.v; else break; }
    return v;
  };
  /* กราฟแบบจิ้มดูได้: เส้นขั้นบันได + พื้นจาง ๆ + จุดตรงวันที่เปลี่ยนราคา · คืน {svg, X(เวลา→px), T(px→เวลา), Y, lo, hi, x0, x1}
     วาดในกรอบ w×h (หน่วยเดียวกับพิกเซลจริงของกล่อง ไม่ยืด) */
  PX.chartGeom = (pts, w, h) => {
    const xs = pts.map(p => p.x), vs = pts.map(p => p.v);
    const x0 = Math.min.apply(null, xs), x1 = Math.max(Math.max.apply(null, xs), x0 + 1);
    let lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs);
    const rlo = lo, rhi = hi;
    if (hi === lo) { const pad = Math.max(1, Math.abs(hi) * 0.05); lo -= pad; hi += pad; }
    else { const pad = (hi - lo) * 0.15; lo -= pad; hi += pad; }
    const L = 6, R = 6, T = 14, B = 8;
    const X = x => L + (x - x0) / (x1 - x0) * (w - L - R);
    const T2 = px => x0 + (Math.min(Math.max(px, L), w - R) - L) / (w - L - R) * (x1 - x0);
    const Y = v => T + (hi - v) / (hi - lo) * (h - T - B);
    return { X, T: T2, Y, lo: rlo, hi: rhi, x0, x1, w, h, B };
  };
  PX.chartSvg2 = (pts, w, h, color) => {
    if (!pts || pts.length < 2) return "";
    const g = PX.chartGeom(pts, w, h);
    const line = pts.map((p, i) => (i ? "L" : "M") + g.X(p.x).toFixed(1) + " " + g.Y(p.v).toFixed(1)).join(" ");
    const area = line + " L" + g.X(pts[pts.length - 1].x).toFixed(1) + " " + (h - g.B) + " L" + g.X(pts[0].x).toFixed(1) + " " + (h - g.B) + " Z";
    // จุดตรงที่ราคาเปลี่ยน (คู่จุด x เดียวกัน = ขั้นบันได)
    let dots = "";
    for (let i = 1; i < pts.length - 1; i++) if (pts[i].x === pts[i - 1].x && pts[i].v !== pts[i - 1].v) dots += `<circle cx="${g.X(pts[i].x).toFixed(1)}" cy="${g.Y(pts[i].v).toFixed(1)}" r="3.5" fill="#fff" stroke="${color}" stroke-width="2"/>`;
    const lp = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="display:block;width:100%;height:auto;touch-action:none" role="img" aria-label="กราฟราคา">` +
      `<line x1="0" x2="${w}" y1="${h - g.B}" y2="${h - g.B}" stroke="currentColor" stroke-opacity=".15"/>` +
      `<path d="${area}" fill="${color}" fill-opacity=".10"/>` +
      `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>` + dots +
      `<circle cx="${g.X(lp.x).toFixed(1)}" cy="${g.Y(lp.v).toFixed(1)}" r="4" fill="${color}"/>` +
      `<g class="cur" style="display:none"><line class="cl" y1="0" y2="${h - g.B}" stroke="currentColor" stroke-opacity=".45" stroke-dasharray="3 3"/><circle class="cd" r="5.5" fill="${color}" stroke="#fff" stroke-width="2"/></g></svg>`;
  };
  PX.minMax = pts => {
    if (!pts || !pts.length) return null;
    const vs = pts.map(p => p.v);
    return { lo: Math.min.apply(null, vs), hi: Math.max.apply(null, vs) };
  };

  /* ---------- ใบราคา (รูป) ----------
     ใช้ใบที่จัดไว้ในเว็บ/โปรแกรมร้าน (layout: หมวด/ลำดับ/ชื่อโชว์/ราคาโชว์/บรรทัดข้อความ) · ไม่มี = เรียงตามหมวดสินค้า */
  const SEC_THEME = [
    [/เบียร์|ลังเหล้า|ลังน้ำ/, "#2e7d32", "🍺"], [/ทองแดง/, "#b5562b", "🔌"], [/ทองเหลือง/, "#8a6700", "🔑"], [/อลู|เนียม|กระป๋อง/, "#1e6fb8", "🥫"],
    [/สแตน/, "#5c6f82", "🥄"], [/หม้อน้ำ/, "#6d4c41", "♨️"], [/แบต/, "#c62828", "🔋"], [/ท่อ|พีวีซี|pvc/i, "#3949ab", "🚰"], [/แก้ว/, "#00707a", "🍾"],
    [/พลาสติก|ซีดี|pet|ขวด/i, "#00796b", "🧴"], [/กระดาษ|ลัง|กล่อง/, "#a9580a", "📦"], [/เหล็ก|สังกะสี|ปี๊บ/, "#455a64", "🔩"],
    [/ตะกั่ว/, "#5d6d7e", "⚖️"], [/ไฟฟ้า|สายไฟ|มอเตอร์/, "#b04f00", "⚡"], [/อื่น/, "#7b3fa0", "♻️"]
  ];
  const SEC_PAL = ["#455a64", "#1e6fb8", "#00796b", "#a9580a", "#7b3fa0", "#2e7d32", "#c62828", "#3949ab"];
  PX.secTheme = (name, i) => {
    for (const t of SEC_THEME) if (t[0].test(String(name || ""))) return { c: t[1], ic: t[2] };
    return { c: SEC_PAL[i % SEC_PAL.length], ic: "♻️" };
  };
  PX.NOTE_DEF = "***ราคาอาจมีการเปลี่ยนแปลงระหว่างวัน***";
  /* วันที่บนใบ = วันที่ของราคาที่ดึงมา (D.at) ไม่ใช่วันนี้ — ราคาค้างในเครื่องจะไม่กลายเป็น "ราคาวันนี้" */
  PX.posterModel = (D, now) => {
    const L = D.layout && Array.isArray(D.layout.sections) ? D.layout : null;
    const find = it => {
      if (!it) return null;
      let x = D.byKey[PX.key(it.cat, it.prod)];
      if (!x && typeof it.id === "string" && it.id.indexOf("||") > 0) x = D.byKey[it.id];
      return x || null;
    };
    let sections;
    if (L) {
      sections = L.sections.map(s => {
        const rows = [];
        (Array.isArray(s && s.items) ? s.items : []).forEach(it => {
          if (!it || typeof it !== "object") return;
          if (it.text != null) { const n = String(it.text).trim(); if (n) rows.push({ n, p: String(it.price == null ? "" : it.price).trim() }); return; }
          const f = find(it);
          const ov = it.priceOv != null && String(it.priceOv).trim() !== "" ? String(it.priceOv).trim() : "";
          if (!f && !ov) return;                                     // สินค้าถูกลบไปแล้ว
          const n = it.label != null && String(it.label).trim() !== "" ? String(it.label).trim() : (f ? f.p : String(it.prod || ""));
          rows.push({ n, p: ov || PX.fmt(f.price), u: f ? f.unit : "กก." });
        });
        return { name: String(s && s.name || ""), rows };
      }).filter(s => s.rows.length);
    } else {
      sections = D.cats.map(c => ({ name: c, rows: D.items.filter(x => x.c === c).map(x => ({ n: x.p, p: PX.fmt(x.price), u: x.unit })) })).filter(s => s.rows.length);
    }
    sections.forEach((s, i) => {
      const cnt = {};
      s.rows.forEach(r => { if (r.u) cnt[r.u] = (cnt[r.u] || 0) + 1; });
      let best = "กก.", bn = 0;
      Object.keys(cnt).forEach(u => { if (cnt[u] > bn || (cnt[u] === bn && u === "กก.")) { best = u; bn = cnt[u]; } });
      s.unit = best;
      s.rows.forEach(r => { r.su = r.u && r.u !== best ? "/" + r.u : ""; });
      const th = PX.secTheme(s.name, i); s.color = th.c; s.icon = th.ic;
    });
    const at = PX.parseStamp(D.at);
    const today = now || new Date();
    const d = isFinite(at) ? new Date(at) : today;
    const isToday = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    return {
      isToday,
      title: (L && String(L.title || "").trim()) || D.shop.name || "ร้านรับซื้อของเก่า",
      date: PX.longDate(d), shortDate: PX.shortDate(d),
      note: L && L.note != null ? String(L.note).trim() : PX.NOTE_DEF,
      phone: String(D.shop.phone || "").trim(), sections
    };
  };

  /* วาดใบราคาลง canvas — style A สีตามหมวด (พื้นขาว) · B ป้ายเข้ม · C แถบเขียวร้าน
     วาดเองทั้งหมด (ไม่พึ่งตัวแปลงหน้าเว็บเป็นรูป) · ฟอนต์ Prompt ต้องโหลดก่อน (PX.fontsReady) */
  PX.STYLES = {
    A: { name: "สีตามหมวด", bg: "#ffffff", head: "#2f8a4f", headTx: "#ffffff", box: "#ffffff", line: "#e1e5e0", tx: "#1f2933", mu: "#6b7680", secFill: true, price: null },
    B: { name: "ป้ายเข้ม", bg: "#15191d", head: "#1f262c", headTx: "#ffffff", box: "#1f262c", line: "#323b43", tx: "#f1f4f6", mu: "#9aa5ae", secFill: true, price: "#ffd27a" },
    C: { name: "แถบเขียวร้าน", bg: "#f3f7f2", head: "#1f6b3f", headTx: "#ffffff", box: "#ffffff", line: "#d5e2d4", tx: "#1f2933", mu: "#5f6b66", secFill: false, price: "#1f6b3f" }
  };
  PX.fontsReady = async () => {
    try {
      if (G.document && document.fonts && document.fonts.load) {
        await Promise.all(["600 30px Prompt", "700 30px Prompt"].map(f => document.fonts.load(f, "ราคาทองแดง0123")));
      }
    } catch (e) {}
  };
  const FONT = (w, px) => w + " " + px + "px Prompt, 'Noto Sans Thai', Tahoma, sans-serif";
  /* ตัดข้อความให้พอดีความกว้าง (ต่อท้าย …) */
  function fit(ctx, s, maxW) {
    s = String(s);
    if (ctx.measureText(s).width <= maxW) return s;
    const ch = Array.from(s);
    while (ch.length > 1 && ctx.measureText(ch.join("") + "…").width > maxW) ch.pop();
    return ch.join("") + "…";
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }
  /* วางหมวดลงคอลัมน์ที่เตี้ยที่สุด (ตามลำดับ) → ตำแหน่งของแต่ละหมวด + ความสูงรวม */
  PX.posterPlan = (M, styleKey) => {
    const nRows = M.sections.reduce((a, s) => a + s.rows.length, 0);
    const cols = nRows > 70 ? 3 : 2;
    const W = cols === 3 ? 1500 : 1080, PAD = 28, GAP = 18;
    const colW = (W - PAD * 2 - GAP * (cols - 1)) / cols;
    const HEAD = 150, SECH = 54, ROWH = 44, SECPAD = 10;
    const hs = Array(cols).fill(HEAD + PAD);
    const place = M.sections.map(s => {
      let ci = 0;
      for (let i = 1; i < cols; i++) if (hs[i] < hs[ci] - 1) ci = i;
      const h = SECH + s.rows.length * ROWH + SECPAD;
      const p = { s, x: PAD + ci * (colW + GAP), y: hs[ci], w: colW, h };
      hs[ci] += h + GAP;
      return p;
    });
    const H = Math.max.apply(null, hs) - GAP + 24 + 70;
    return { W, H: Math.ceil(Math.max(H, HEAD + 200)), cols, place, ROWH, SECH, HEAD, PAD, style: PX.STYLES[styleKey] ? styleKey : "A" };
  };
  PX.drawPoster = (canvas, M, styleKey) => {
    const P = PX.posterPlan(M, styleKey), S = PX.STYLES[P.style];
    canvas.width = P.W; canvas.height = P.H;
    const ctx = canvas.getContext("2d");
    ctx.textBaseline = "middle";
    ctx.fillStyle = S.bg; ctx.fillRect(0, 0, P.W, P.H);
    /* หัวใบ */
    ctx.fillStyle = S.head; ctx.fillRect(0, 0, P.W, P.HEAD);
    ctx.fillStyle = S.headTx; ctx.textAlign = "center";
    ctx.font = FONT(700, 48); ctx.fillText(fit(ctx, M.title + (M.isToday === false ? " · ราคารับซื้อ" : " · ราคารับซื้อวันนี้"), P.W - 60), P.W / 2, 58);
    ctx.font = FONT(600, 28); ctx.fillText(M.date + (M.phone ? "   ·   โทร " + M.phone : ""), P.W / 2, 112);
    /* หมวด */
    P.place.forEach(p => {
      const s = p.s;
      ctx.fillStyle = S.box; rr(ctx, p.x, p.y, p.w, p.h, 14); ctx.fill();
      ctx.strokeStyle = S.line; ctx.lineWidth = 2; rr(ctx, p.x, p.y, p.w, p.h, 14); ctx.stroke();
      const hc = S.secFill ? s.color : S.head;
      ctx.save(); rr(ctx, p.x, p.y, p.w, P.SECH, 14); ctx.clip();
      ctx.fillStyle = P.style === "B" ? s.color : hc; ctx.fillRect(p.x, p.y, p.w, P.SECH);
      ctx.restore();
      ctx.fillStyle = "#ffffff"; ctx.textAlign = "left"; ctx.font = FONT(700, 28);
      const unitTxt = "ราคา/" + s.unit;
      ctx.font = FONT(600, 20); const uw = ctx.measureText(unitTxt).width;
      ctx.font = FONT(700, 28);
      ctx.fillText(fit(ctx, s.icon + " " + s.name, p.w - uw - 40), p.x + 16, p.y + P.SECH / 2 + 1);
      ctx.font = FONT(600, 20); ctx.textAlign = "right"; ctx.globalAlpha = .92;
      ctx.fillText(unitTxt, p.x + p.w - 16, p.y + P.SECH / 2 + 2); ctx.globalAlpha = 1;
      s.rows.forEach((r, i) => {
        const y = p.y + P.SECH + 4 + i * P.ROWH + P.ROWH / 2;
        if (i) { ctx.strokeStyle = S.line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p.x + 14, y - P.ROWH / 2); ctx.lineTo(p.x + p.w - 14, y - P.ROWH / 2); ctx.stroke(); }
        ctx.font = FONT(700, 28); ctx.textAlign = "right";
        const pr = (r.p || "") + "";
        const pw = ctx.measureText(pr).width;
        ctx.font = FONT(600, 18); const sw = r.su ? ctx.measureText(r.su).width + 4 : 0;
        if (r.su) { ctx.fillStyle = S.mu; ctx.fillText(r.su, p.x + p.w - 16, y + 3); }
        ctx.font = FONT(700, 28); ctx.fillStyle = S.price || (P.style === "A" ? s.color : S.tx);
        ctx.fillText(pr, p.x + p.w - 16 - sw, y);
        ctx.font = FONT(600, 26); ctx.textAlign = "left"; ctx.fillStyle = S.tx;
        ctx.fillText(fit(ctx, r.n, p.w - 48 - pw - sw), p.x + 16, y);
      });
    });
    /* ท้ายใบ */
    ctx.fillStyle = S.mu; ctx.textAlign = "center"; ctx.font = FONT(600, 24);
    if (M.note) ctx.fillText(fit(ctx, M.note, P.W - 60), P.W / 2, P.H - 46);
    return P;
  };

  /* ---------- ที่เก็บในเครื่อง (localStorage — เข้าถึงไม่ได้ = จำในหน่วยความจำแทน ไม่พัง) ---------- */
  const MEM = {};
  PX.store = {
    get(k, def) { try { const v = G.localStorage.getItem("px." + k); return v == null ? def : JSON.parse(v); } catch (e) { return k in MEM ? MEM[k] : def; } },
    set(k, v) { MEM[k] = v; try { G.localStorage.setItem("px." + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { delete MEM[k]; try { G.localStorage.removeItem("px." + k); } catch (e) {} }
  };

  G.PX = PX;
})(typeof window !== "undefined" ? window : globalThis);
