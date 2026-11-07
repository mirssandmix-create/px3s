/* ใบราคา 3ส. — หน้าจอ (ใช้ PX จาก px-core.js)
   ราคา (แก้ได้ · ร้านพ่อดูอย่างเดียว) · ประวัติ + กราฟ · ใบราคาเป็นรูป ส่ง LINE
   ดึงจากเว็บ: ถามเลขรุ่นก่อน (op rev) ตรงกับที่มี = ไม่ดึงทั้งชุด · ปุ่มดึงพัก 5 วิหลังกด · ที่แก้ค้างจำไว้ในเครื่องจนบันทึก */
"use strict";
(function () {
  const $ = id => document.getElementById(id);
  const S = PX.store;
  const IS_ANDROID = typeof window.ShopAndroid === "object" && window.ShopAndroid !== null;
  const DEV = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);   // เว็บจำลองบนคอม (ทดสอบ)

  /* ---------- สถานะ ---------- */
  let cfg = S.get("cfg", {}) || {};           // {url, token, user, name}
  let D = PX.normalize(S.get("data", {}) || {});
  let hasData = !!(S.get("data", null));
  let edits = PX.rebaseEdits(S.get("edits", {}) || {}, D);
  let tab = "price", view = "ours", q = "";
  let lastCheck = 0, busy = false, net = { kind: "", msg: "" };
  let histKey = "", histDays = 30, HC = {};    // ประวัติ: สินค้าที่เปิด · ช่วงวัน · แคช {key: {at, rows}}
  let posterStyle = S.get("style", "A");
  let posterUrl = "", posterBlob = null, posterFile = null, posterDirty = true;
  let saving = false;

  /* ---------- ตัวแอพ Android (ShopAndroid) ---------- */
  const CB = {}; let N = 0;
  window.__apiDone = (id, txt) => { const c = CB[id]; delete CB[id]; if (c) c(txt); };
  function native(path, body) {
    return new Promise((res, rej) => {
      const id = ++N;
      CB[id] = txt => { let j = null; try { j = JSON.parse(txt); } catch (e) {}
        if (!j || j.ok === false) rej(new Error((j && j.error) || "ตัวแอพตอบกลับผิดรูปแบบ")); else res(j); };
      try { ShopAndroid.call(id, String(path), body == null ? null : JSON.stringify(body)); }
      catch (e) { delete CB[id]; rej(new Error("ติดต่อตัวแอพไม่ได้")); }
    });
  }
  function nativeLink() { try { return JSON.parse(ShopAndroid.link() || "{}"); } catch (e) { return {}; } }

  /* ---------- ตัวช่วยหน้าจอ ---------- */
  let toastT = 0;
  function toast(msg, ms) {
    let t = document.querySelector(".toast");
    if (!t) { t = document.createElement("div"); t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.remove("hidden");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add("hidden"), ms || 2600);
  }
  function sheet(title, html, buttons) {
    closeSheet();
    const el = document.createElement("div");
    el.className = "sheet"; el.id = "sheet";
    el.innerHTML = `<div class="in"><h2>${PX.esc(title)}</h2><div class="sc">${html}</div><div class="bar">` +
      buttons.map((b, i) => `<button class="btn${b.main ? " main" : ""}" data-i="${i}">${PX.esc(b.label)}</button>`).join("") + `</div></div>`;
    el.addEventListener("click", e => {
      if (e.target === el) { closeSheet(); return; }
      const b = e.target.closest("[data-i]");
      if (b) { const f = buttons[Number(b.dataset.i)].on; if (f) f(); else closeSheet(); }
    });
    document.body.appendChild(el);
    return el;
  }
  function closeSheet() { const s = $("sheet"); if (s) s.remove(); }
  const save = () => { S.set("edits", edits); };
  function setNet(kind, msg) { net = { kind, msg }; }

  /* ---------- เข้าสู่ระบบ ---------- */
  function showSetup(err) {
    $("main").classList.add("hidden"); $("setup").classList.remove("hidden");
    const fixed = IS_ANDROID ? nativeLink().url : "";
    if (fixed && !cfg.url) cfg.url = fixed;
    $("urlField").classList.toggle("hidden", !!(fixed && cfg.url === fixed));
    $("setUrl").value = cfg.url || "";
    $("setUser").value = cfg.user || "";
    $("setPass").value = "";
    $("setErr").textContent = err || ""; $("setErr").classList.toggle("hidden", !err);
  }
  async function doLogin() {
    const url = PX.cleanUrl($("setUrl").value, DEV);
    const user = $("setUser").value.trim(), pass = $("setPass").value;
    const err = m => { $("setErr").textContent = m; $("setErr").classList.remove("hidden"); };
    if (!url) return err("ลิงก์เว็บไม่ถูกต้อง — ต้องเป็นลิงก์ script.google.com ที่ลงท้าย /exec");
    if (!user || !pass) return err("ใส่ชื่อผู้ใช้และรหัสผ่าน");
    $("setup").classList.add("busy"); $("setGo").textContent = "กำลังเข้าสู่ระบบ…";
    try {
      const r = await PX.post(url, "login", { username: user, password: pass }, 45000);
      if (!r.token) throw new Error("เข้าสู่ระบบไม่สำเร็จ");
      if (cfg.url && cfg.url !== url) { S.del("data"); D = PX.normalize({}); hasData = false; edits = {}; save(); HC = {}; }
      cfg = { url, token: r.token, user: r.username || user, name: r.name || r.username || user };
      S.set("cfg", cfg);
      $("setPass").value = "";
      showMain();
      refresh(true);
    } catch (e) {
      err(e instanceof PX.AuthError ? "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" : (e.message || "เข้าสู่ระบบไม่สำเร็จ"));
    } finally { $("setup").classList.remove("busy"); $("setGo").textContent = "เข้าสู่ระบบ"; }
  }
  function authLost(msg) {
    cfg.token = ""; S.set("cfg", cfg);
    showSetup(msg || "กรุณาเข้าสู่ระบบใหม่ (ที่แก้ไว้ยังอยู่ ไม่หาย)");
  }
  const call = (op, data, ms) => PX.post(cfg.url, "px", Object.assign({ op, token: cfg.token }, data || {}), ms);

  /* ---------- ดึงราคา: ถามเลขรุ่นก่อน ---------- */
  async function refresh(force) {
    if (busy || !cfg.token) return;
    busy = true; paintTop();
    try {
      let need = force || !hasData || !D.rev;
      if (!need) {
        const r = await call("rev", {}, 30000);
        need = !D.rev || r.cat !== D.rev.cat || (r.steel || "") !== (D.rev.steel || "");
      }
      if (need) {
        const d = await call("load", {}, 90000);
        S.set("data", d); hasData = true;
        D = PX.normalize(d);
        edits = PX.rebaseEdits(edits, D); save();
        posterDirty = true; HC = {};
      }
      lastCheck = Date.now();
      setNet("", "");
    } catch (e) {
      if (e instanceof PX.AuthError) { busy = false; authLost(); return; }
      setNet(e instanceof PX.Offline ? "off" : "err", e.message || "ดึงราคาไม่สำเร็จ");
    } finally { busy = false; }
    render();
  }

  /* ---------- หัวหน้า ---------- */
  function paintTop() {
    const titles = { price: "ราคารับซื้อ", hist: "ประวัติราคา", poster: "ใบราคา" };
    $("hTitle").textContent = titles[tab];
    $("hSub").innerHTML = busy ? "กำลังดึง…" : D.at ? "อัปเดต<br>" + PX.esc(PX.when(D.at)) : "";
    $("btnRefresh").disabled = busy || Date.now() < coolUntil;
    let pills = "";
    if (tab === "price") pills = `<button class="pill${view === "ours" ? " on" : ""}" data-v="ours">สาขา 2 + 4</button><button class="pill${view === "steel" ? " on" : ""}" data-v="steel">ร้านพ่อ (ดูอย่างเดียว)</button>`;
    if (tab === "poster") pills = Object.keys(PX.STYLES).map(k => `<button class="pill${posterStyle === k ? " on" : ""}" data-s="${k}">${PX.esc(PX.STYLES[k].name)}</button>`).join("");
    if (tab === "hist" && histKey) pills = [[7, "7 วัน"], [30, "30 วัน"], [90, "3 เดือน"], [365, "1 ปี"]].map(r => `<button class="pill${histDays === r[0] ? " on" : ""}" data-d="${r[0]}">${r[1]}</button>`).join("");
    $("pills").innerHTML = pills; $("pills").classList.toggle("hidden", !pills);
    $("searchBox").classList.toggle("hidden", tab === "poster" || (tab === "hist" && !!histKey));
    $("q").placeholder = tab === "hist" ? "ค้นหาสินค้าเพื่อดูกราฟ" : "ค้นหาสินค้า";
    if ($("q").value !== q) $("q").value = q;
    $("qClear").classList.toggle("hidden", !q);
    document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  }
  function bannerHtml() {
    if (!net.kind) return "";
    const off = net.kind === "off";
    return `<div class="banner${off ? "" : " err"}">${off ? "📵 " : "⚠ "}${PX.esc(net.msg)}${hasData ? " · ราคาที่เห็นเป็นของ " + PX.esc(PX.when(D.at)) : ""}</div>`;
  }

  /* ---------- หน้าราคา ---------- */
  function rowHtml(it) {
    const e = edits[it.k];
    const val = e ? e.v : PX.fmt(it.price).replace(/,/g, "");
    const n = e ? PX.parsePrice(e.v) : it.price;
    const bad = e && !isFinite(n);
    const chg = e && !bad;
    const st = D.steelByKey[it.k];
    const sub = [];
    if (st) sub.push("ร้านพ่อ " + PX.fmt(st.p));
    if (chg) sub.push("เดิม " + PX.fmt(e.old));
    if (bad) sub.push("พิมพ์ตัวเลขเท่านั้น");
    return `<div class="it${chg ? " chg" : ""}${bad ? " bad" : ""}" data-k="${PX.esc(it.k)}"><div class="nm">${PX.esc(it.p)}${sub.length ? `<small>${PX.esc(sub.join(" · "))}</small>` : ""}</div>` +
      `<input class="pr" inputmode="decimal" enterkeyhint="next" value="${PX.esc(val)}" aria-label="ราคา ${PX.esc(it.p)}"><div class="u">บ./<br>${PX.esc(it.unit)}</div></div>`;
  }
  function renderPrice() {
    let h = bannerHtml();
    if (view === "steel") {
      if (D.steelError) h += `<div class="banner err">${PX.esc(D.steelError)}</div>`;
      const rows = PX.steelRows(D, q);
      if (D.steel) h += `<div class="lbl" style="margin:6px 2px">ราคาร้านพ่อ (ดูอย่างเดียว) · อ่านเมื่อ ${PX.esc(PX.when(D.steel.at))}</div>`;
      h += rows.map(r => {
        const diff = r.ours == null ? null : PX.r2(r.p - r.ours);
        const ed = r.key && edits[r.key];
        const cmp = r.ours == null ? "ไม่มีในราคาเรา" : "ของเรา " + PX.fmt(r.ours) + (diff ? (diff > 0 ? " · ร้านพ่อสูงกว่า " : " · ร้านพ่อต่ำกว่า ") + PX.fmt(Math.abs(diff)) : " · เท่ากัน");
        return `<div class="it"><div class="nm">${PX.esc(r.n)}<small class="${diff > 0 ? "up" : diff < 0 ? "dn" : ""}">${PX.esc(cmp)}</small></div>` +
          (r.key && diff && !ed ? `<button class="use" data-use="${PX.esc(r.key)}" data-p="${r.p}">ใช้ราคานี้</button>` : ed ? `<span class="lbl" style="font-size:12px">แก้ไว้แล้ว</span>` : "") +
          `<div class="sp">${PX.fmt(r.p)}</div></div>`;
      }).join("") || `<div class="empty">${D.steel ? "ไม่พบสินค้า" : hasData ? "ยังไม่มีราคาร้านพ่อ" : "กำลังโหลด…"}</div>`;
    } else {
      const gs = PX.groups(D, q);
      h += gs.map(g => `<div class="cat">${PX.esc(g.cat)}</div>` + g.items.map(rowHtml).join("")).join("") ||
        `<div class="empty">${hasData ? "ไม่พบสินค้า" : busy ? "กำลังโหลดราคา…" : "ยังไม่มีราคา — กด 🔄"}</div>`;
    }
    $("body").innerHTML = h;
    paintSaveBar();
  }
  function paintSaveBar() {
    const p = PX.pending(edits, D);
    const n = p.ok.length + p.bad.length;
    $("saveBar").classList.toggle("hidden", tab !== "price" || !n);
    $("btnSave").textContent = p.bad.length ? "แก้ช่องสีแดงก่อน" : "💾 บันทึก " + p.ok.length + " รายการ";
    $("btnSave").disabled = !!p.bad.length || !p.ok.length;
  }
  function onPriceInput(inp) {
    const row = inp.closest(".it"); if (!row) return;
    const k = row.dataset.k;
    edits = PX.setEdit(edits, D, k, inp.value); save();
    const e = edits[k], it = D.byKey[k];
    const n = e ? PX.parsePrice(e.v) : it.price;
    row.classList.toggle("chg", !!e && isFinite(n));
    row.classList.toggle("bad", !!e && !isFinite(n));
    const sub = [];
    const st = D.steelByKey[k];
    if (st) sub.push("ร้านพ่อ " + PX.fmt(st.p));
    if (e && isFinite(n)) sub.push("เดิม " + PX.fmt(e.old));
    if (e && !isFinite(n)) sub.push("พิมพ์ตัวเลขเท่านั้น");
    let sm = row.querySelector(".nm small");
    if (!sm && sub.length) { sm = document.createElement("small"); row.querySelector(".nm").appendChild(sm); }
    if (sm) sm.textContent = sub.join(" · ");
    posterDirty = true;
    paintSaveBar();
  }
  function confirmSave() {
    if (saving) return;
    const p = PX.pending(edits, D);
    if (!p.ok.length) return;
    const html = p.ok.map(x => {
      const d = PX.r2(x.price - x.old);
      return `<div class="hrow"><div>${PX.esc(x.p)}<small>${PX.esc(x.c)}${x.big ? ' · <b class="dn">⚠ เปลี่ยนเยอะ ' + (x.price === 0 ? "(ราคา 0)" : PX.fmt(Math.abs(x.pct)) + "%") + "</b>" : ""}</small></div>` +
        `<div class="r"><span class="${d > 0 ? "up" : "dn"}">${d > 0 ? "▲" : "▼"} ${PX.fmt(Math.abs(d))}</span> ${PX.fmt(x.old)} → <b>${PX.fmt(x.price)}</b></div></div>`;
    }).join("");
    sheet("บันทึกราคา " + p.ok.length + " รายการ?", `<div class="lbl" style="margin-bottom:6px">ราคาใหม่จะใช้รับซื้อทันที ทั้งหน้าเว็บและโปรแกรมร้านทุกสาขา (2 และ 4)</div>` + html,
      [{ label: "กลับไปแก้" }, { label: "ยืนยันบันทึก", main: true, on: () => doSave(p.ok) }]);
  }
  async function doSave(list) {
    if (saving) return;
    saving = true;
    const sh = $("sheet");
    if (sh) sh.classList.add("busy");
    document.querySelectorAll("#body .pr").forEach(i => { i.readOnly = true; });
    try {
      const r = await call("save", { items: list.map(x => ({ c: x.c, p: x.p, price: x.price, old: x.old })) }, 90000);
      closeSheet();
      const conflicts = r.conflicts || [], gone = r.notFound || [];
      const keep = {};
      conflicts.forEach(c => { if (edits[c.key]) keep[c.key] = edits[c.key]; });
      list.forEach(x => { if (!keep[x.k]) delete edits[x.k]; });
      // ราคาที่บันทึกแล้วลงข้อมูลในเครื่องทันที (ไม่ต้องรอดึงใหม่)
      const raw = S.get("data", {}) || {};
      const done = {};
      list.forEach(x => { if (!keep[x.k] && gone.indexOf(x.k) < 0) done[x.k] = x.price; });
      (raw.items || []).forEach(it => { const k = PX.key(it.c, it.p); if (k in done) it.price = done[k]; });
      conflicts.forEach(c => { if (typeof c.cur === "number" && isFinite(c.cur)) (raw.items || []).forEach(it => { if (PX.key(it.c, it.p) === c.key) it.price = c.cur; }); });
      S.set("data", raw); D = PX.normalize(raw);
      edits = PX.rebaseEdits(edits, D);
      // ตัวที่มีคนแก้ไปก่อน: ราคาตั้งต้นใหม่ = ราคาบนเว็บตอนนี้ (กดบันทึกอีกครั้งถ้ายังต้องการ)
      conflicts.forEach(c => { if (edits[c.key] && typeof c.cur === "number" && isFinite(c.cur)) edits[c.key].old = c.cur; });
      save(); posterDirty = true; HC = {};
      render();
      if (conflicts.length) {
        sheet("มีคนแก้ราคาไปก่อน " + conflicts.length + " รายการ", conflicts.map(c => {
          const it = D.byKey[c.key] || { p: c.key }; const e = edits[c.key];
          return `<div class="hrow"><div>${PX.esc(it.p)}<small>${c.moved ? "แถวในชีตถูกย้ายระหว่างบันทึก" : "ราคาบนเว็บตอนนี้ " + PX.fmt(c.cur)}</small></div><div class="r">ที่คุณแก้ <b>${PX.esc(e ? e.v : "")}</b></div></div>`;
        }).join("") + `<div class="lbl" style="margin-top:8px">ยังไม่ได้บันทึกตัวเหล่านี้ — ตรวจแล้วกดบันทึกอีกครั้งถ้ายังต้องการราคาที่แก้</div>`, [{ label: "ตกลง", main: true }]);
      } else toast("✓ บันทึกแล้ว " + (r.updated || 0) + " รายการ" + (gone.length ? " · ไม่พบสินค้า " + gone.length : ""));
    } catch (e) {
      if (sh) sh.classList.remove("busy");
      saving = false;
      document.querySelectorAll("#body .pr").forEach(i => { i.readOnly = false; });
      if (e instanceof PX.AuthError) { closeSheet(); authLost(); return; }
      closeSheet();
      if (e instanceof PX.Offline) {
        /* เน็ตหลุด/เว็บตอบช้า: เว็บอาจบันทึกไปแล้ว — ดึงราคาจริงมาเทียบ (ตัวที่บันทึกแล้วจะหายจากที่แก้เอง) */
        sheet("ไม่แน่ใจว่าบันทึกแล้วหรือยัง", `<div class="banner err">${PX.esc(e.message || "ติดต่อเว็บไม่ได้")}</div><div class="lbl">แอพจะตรวจกับเว็บให้เมื่อต่อได้ — ตัวที่บันทึกแล้วจะหายจากรายการที่แก้ · ตัวที่ยังเหลือ กดบันทึกอีกครั้งได้ (กดซ้ำไม่บันทึกซ้อน)</div>`, [{ label: "ตกลง", main: true }]);
        refresh(true);
        return;
      }
      sheet("ยังไม่ได้บันทึก", `<div class="banner err">${PX.esc(e.message || "บันทึกไม่สำเร็จ")}</div><div class="lbl">ที่แก้ไว้ยังอยู่ครบ — ลองกดบันทึกอีกครั้ง</div>`, [{ label: "ตกลง", main: true }]);
    } finally {
      saving = false;
      document.querySelectorAll("#body .pr").forEach(i => { i.readOnly = false; });
    }
  }
  function undoAll() {
    const n = Object.keys(edits).length;
    if (!n) return;
    sheet("ยกเลิกที่แก้ทั้งหมด?", `<div class="lbl">ราคาที่พิมพ์ไว้ ${n} รายการจะกลับเป็นราคาเดิม</div>`,
      [{ label: "ไม่ยกเลิก" }, { label: "ยกเลิกที่แก้", main: true, on: () => { edits = {}; save(); closeSheet(); posterDirty = true; render(); } }]);
  }

  /* ---------- หน้าประวัติ ---------- */
  async function histLoad(key) {
    const c = HC[key];
    if (c && Date.now() - c.at < 300000) return c.rows;
    const r = await call("hist", { key, days: key ? 400 : 30 }, 60000);
    HC[key] = { at: Date.now(), rows: r.rows || [] };
    return HC[key].rows;
  }
  function renderHist() {
    const body = $("body");
    if (histKey) return renderHistOne();
    if (q) {
      const nq = PX.norm(q);
      const list = D.items.filter(x => PX.norm(x.p).indexOf(nq) >= 0 || PX.norm(x.c).indexOf(nq) >= 0).slice(0, 80);
      body.innerHTML = bannerHtml() + (list.map(x => `<div class="hrow tap" data-hk="${PX.esc(x.k)}"><div>${PX.esc(x.p)}<small>${PX.esc(x.c)}</small></div><div class="r"><b>${PX.fmt(x.price)}</b> <small>บ./${PX.esc(x.unit)}</small></div></div>`).join("") || `<div class="empty">ไม่พบสินค้า</div>`);
      return;
    }
    body.innerHTML = bannerHtml() + `<div class="lbl" style="margin:6px 2px">เปลี่ยนราคาล่าสุด (30 วัน) · แตะเพื่อดูกราฟ</div><div class="box" id="hList"><div class="empty">กำลังโหลด…</div></div>`;
    histLoad("").then(rows => {
      if (tab !== "hist" || histKey || q) return;
      const el = $("hList"); if (!el) return;
      el.innerHTML = rows.length ? rows.slice(0, 150).map(histRow(true)).join("") : `<div class="empty">ยังไม่มีการเปลี่ยนราคาใน 30 วัน</div>`;
    }).catch(e => {
      if (e instanceof PX.AuthError) return authLost();
      const el = $("hList"); if (el) el.innerHTML = `<div class="banner err">${PX.esc(e.message || "ดึงประวัติไม่ได้")}</div>`;
    });
  }
  const histRow = withName => r => {
    const d = PX.r2(r.neu - r.old), it = D.byKey[r.key];
    const name = it ? it.p : String(r.key).split("||").pop();
    const who = [r.by, r.src].filter(Boolean).join(" · ");
    return `<div class="hrow${withName ? " tap" : ""}"${withName ? ` data-hk="${PX.esc(r.key)}"` : ""}><div>${withName ? PX.esc(name) + `<small>${PX.esc(PX.when(r.t))}${who ? " · " + PX.esc(who) : ""}</small>` : PX.esc(PX.when(r.t)) + `<small>${PX.esc(who)}</small>`}</div>` +
      `<div class="r"><span class="${d > 0 ? "up" : d < 0 ? "dn" : ""}">${d > 0 ? "▲" : d < 0 ? "▼" : ""} ${d ? PX.fmt(Math.abs(d)) : ""}</span> ${PX.fmt(r.old)} → <b>${PX.fmt(r.neu)}</b></div></div>`;
  };
  function renderHistOne() {
    const it = D.byKey[histKey];
    const name = it ? it.p : histKey.split("||").pop();
    $("body").innerHTML = bannerHtml() + `<button class="back" id="hBack">‹ ประวัติทั้งหมด</button>` +
      `<div class="box"><div class="lbl">${PX.esc(name)} · ${PX.esc(it ? it.c : "")} · ราคาตอนนี้</div><div class="big">${it ? PX.fmt(it.price) : "—"} <small>บ./${PX.esc(it ? it.unit : "กก.")}</small></div>` +
      `<div class="chart" id="hChart"><div class="empty">กำลังโหลด…</div></div></div><div class="box" id="hRows"></div>`;
    const hk = histKey;
    histLoad(hk).then(rows => {
      if (tab !== "hist" || !$("hChart") || histKey !== hk) return;
      const now = Date.now(), from = now - histDays * 86400000;
      const pts = PX.series(rows, it ? it.price : NaN, histDays, now);
      const mm = PX.minMax(pts);
      $("hChart").innerHTML = PX.chartSvg(pts, 320, 130, "#2f8a4f") +
        `<div class="chartlbl"><span>${PX.esc(PX.shortDate(new Date(from)))}</span><span>ต่ำสุด ${PX.fmt(mm.lo)} · สูงสุด ${PX.fmt(mm.hi)}</span><span>วันนี้</span></div>`;
      const inR = rows.filter(r => PX.parseStamp(r.t) >= from);
      $("hRows").innerHTML = inR.length ? inR.map(histRow(false)).join("") : `<div class="empty" style="padding:16px">ไม่มีการเปลี่ยนราคาในช่วงนี้</div>`;
    }).catch(e => {
      if (e instanceof PX.AuthError) return authLost();
      if ($("hChart")) $("hChart").innerHTML = `<div class="banner err">${PX.esc(e.message || "ดึงประวัติไม่ได้")}</div>`;
    });
  }

  /* ---------- หน้าใบราคา ---------- */
  async function renderPoster() {
    const stale = hasData && !PX.posterModel(D, new Date()).isToday;
    $("body").innerHTML = bannerHtml() + (stale ? `<div class="banner">⚠ ราคาในรูปเป็นของ ${PX.esc(PX.when(D.at))} (ยังไม่ได้ดึงราคาวันนี้) — กด 🔄 ก่อนส่ง</div>` : "") +
      (hasData ? `<img class="poster" id="pImg" alt="ใบราคา"><div class="hint">ใช้หมวด/ลำดับ/ชื่อเดียวกับใบราคาในเว็บ · ราคาตามที่บันทึกล่าสุด${Object.keys(edits).length ? " <b class=\"dn\">(ที่แก้ยังไม่บันทึก ไม่อยู่ในรูป)</b>" : ""}</div>` : `<div class="empty">ยังไม่มีราคา — กด 🔄</div>`);
    if (!hasData) return;
    if (posterDirty || !posterUrl) await makePoster();
    if ($("pImg") && posterUrl) $("pImg").src = posterUrl;
    // iPhone: เตรียมไฟล์รูปไว้ก่อน — กด "ส่ง LINE" แล้วเปิดหน้าต่างแชร์ทันที (Safari ยอมแชร์เฉพาะทันทีหลังแตะ)
    if (!IS_ANDROID && !posterFile) { try { posterFile = new File([await getBlob()], posterName(), { type: "image/png" }); } catch (e) {} }
  }
  async function makePoster() {
    await PX.fontsReady();
    const cv = $("cv");
    PX.drawPoster(cv, PX.posterModel(D, new Date()), posterStyle);
    posterUrl = cv.toDataURL("image/png");
    posterBlob = null; posterFile = null;
    posterDirty = false;
  }
  const posterName = () => "ใบราคา-" + PX.stamp(new Date()).replace(/[: ]/g, "-") + ".png";
  async function getBlob() {
    if (posterDirty || !posterUrl) await makePoster();
    if (!posterBlob) posterBlob = await (await fetch(posterUrl)).blob();
    return posterBlob;
  }
  async function sharePoster(save) {
    if (!hasData) return;
    try {
      if (posterDirty || !posterUrl) await makePoster();
      if (IS_ANDROID) {
        await native(save ? "px/save" : "px/share", { png: posterUrl.split(",")[1], name: posterName() });
        if (save) toast("✓ เก็บรูปไว้ในคลังรูปแล้ว (โฟลเดอร์ ใบราคา)");
        return;
      }
      const file = posterFile && !posterDirty ? posterFile : new File([await getBlob()], posterName(), { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "ใบราคา" }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }   // แชร์ไม่ได้ (เช่น Safari ไม่ยอม) = ดาวน์โหลดแทน
      }
      const a = document.createElement("a");
      a.href = posterUrl; a.download = posterName(); document.body.appendChild(a); a.click(); a.remove();
      toast(save ? "ดาวน์โหลดรูปแล้ว" : "มือถือนี้ส่งตรงไม่ได้ — ดาวน์โหลดรูปแล้ว ส่งใน LINE เองได้เลย", 4000);
    } catch (e) {
      if (e && e.name === "AbortError") return;    // กดยกเลิกหน้าต่างแชร์
      toast(e.message || "ส่งรูปไม่สำเร็จ", 4000);
    }
  }

  /* ---------- วาดทั้งหน้า ---------- */
  function render() {
    paintTop();
    $("saveBar").classList.add("hidden");
    $("posterBar").classList.toggle("hidden", tab !== "poster" || !hasData);
    if (tab === "price") renderPrice();
    else if (tab === "hist") renderHist();
    else renderPoster();
  }
  function showMain() {
    $("setup").classList.add("hidden"); $("main").classList.remove("hidden");
    render();
  }
  function account() {
    const host = (() => { try { const u = new URL(cfg.url); return u.hostname + "/…" + u.pathname.slice(-12); } catch (e) { return ""; } })();
    sheet("บัญชี", `<div class="hrow"><div>เข้าสู่ระบบเป็น<small>${PX.esc(cfg.name || cfg.user || "")}</small></div><div class="r">${PX.esc(cfg.user || "")}</div></div>` +
      `<div class="hrow"><div>เว็บ<small style="word-break:break-all">${PX.esc(host)}</small></div></div>` +
      `<div class="hrow"><div>รุ่นแอพ<small>${PX.esc(appVersion())}</small></div></div>`,
      [{ label: "ดึงทั้งหมดใหม่", on: () => { closeSheet(); refresh(true); } }, { label: "ออกจากระบบ", on: () => {
        closeSheet();
        const n = Object.keys(edits).length;
        sheet("ออกจากระบบ?", `<div class="lbl">${n ? '<b class="dn">ที่แก้ไว้ ' + n + " รายการยังไม่บันทึก จะถูกทิ้ง</b>" : "เข้าใหม่ด้วยชื่อผู้ใช้และรหัสผ่านเดิม"}</div>`,
          [{ label: "ไม่ออก" }, { label: "ออกจากระบบ", main: true, on: () => {
            closeSheet();
            const tk = cfg.token;
            PX.post(cfg.url, "logout", { token: tk }, 15000).catch(() => {});
            cfg.token = ""; S.set("cfg", cfg); edits = {}; save(); showSetup("");
          } }]);
      } }]);
  }
  function appVersion() {
    if (IS_ANDROID) { try { return ShopAndroid.version(); } catch (e) {} }
    const m = document.querySelector('meta[name="px-version"]');
    return m ? m.content : "ทดสอบ";
  }

  /* ---------- ปุ่ม/การแตะ ---------- */
  let coolUntil = 0;
  $("btnRefresh").addEventListener("click", () => {
    if (Date.now() < coolUntil || busy) return;
    coolUntil = Date.now() + 5000;                        // พัก 5 วิ กันกดรัว
    setTimeout(paintTop, 5100);
    refresh(false);
  });
  $("btnMe").addEventListener("click", account);
  $("setGo").addEventListener("click", doLogin);
  $("setPass").addEventListener("keydown", e => { if (e.key === "Enter") doLogin(); });
  $("nav").addEventListener("click", e => {
    const b = e.target.closest("button[data-tab]"); if (!b) return;
    if (tab === b.dataset.tab && tab === "hist" && histKey) { histKey = ""; }
    tab = b.dataset.tab; q = ""; $("body").scrollTop = 0;
    render();
  });
  $("pills").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v) { view = b.dataset.v; $("body").scrollTop = 0; }
    if (b.dataset.s) { posterStyle = b.dataset.s; S.set("style", posterStyle); posterDirty = true; }
    if (b.dataset.d) histDays = Number(b.dataset.d);
    render();
  });
  let qT = 0;
  $("q").addEventListener("input", () => {
    clearTimeout(qT);
    qT = setTimeout(() => { q = $("q").value.trim(); $("qClear").classList.toggle("hidden", !q); if (tab === "price") renderPrice(); else if (tab === "hist") renderHist(); }, 150);
  });
  $("qClear").addEventListener("click", () => { q = ""; $("q").value = ""; render(); });
  $("body").addEventListener("input", e => { if (e.target.classList.contains("pr")) onPriceInput(e.target); });
  $("body").addEventListener("focusin", e => { if (e.target.classList.contains("pr")) setTimeout(() => { try { e.target.select(); } catch (x) {} }, 0); });
  $("body").addEventListener("keydown", e => {
    if (!e.target.classList.contains("pr") || e.key !== "Enter") return;
    e.preventDefault();
    const all = Array.from(document.querySelectorAll("#body .pr"));
    const nx = all[all.indexOf(e.target) + 1];
    if (nx) nx.focus(); else e.target.blur();
  });
  $("body").addEventListener("click", e => {
    const use = e.target.closest("[data-use]");
    if (use) {
      const k = use.dataset.use;
      edits = PX.setEdit(edits, D, k, use.dataset.p); save(); posterDirty = true;
      toast("ใส่ราคา " + PX.fmt(use.dataset.p) + " แล้ว — กดบันทึกที่หน้า สาขา 2 + 4");
      renderPrice(); return;
    }
    const hk = e.target.closest("[data-hk]");
    if (hk) { histKey = hk.dataset.hk; q = ""; $("body").scrollTop = 0; render(); return; }
    if (e.target.id === "hBack") { histKey = ""; render(); }
  });
  $("btnSave").addEventListener("click", confirmSave);
  $("btnUndo").addEventListener("click", undoAll);
  $("btnShare").addEventListener("click", () => sharePoster(false));
  $("btnKeep").addEventListener("click", () => sharePoster(true));

  /* ปุ่มย้อนกลับของ Android: ปิดหน้าต่าง → ออกจากกราฟ → กลับหน้าราคา · true = จัดการแล้ว */
  window.appBack = () => {
    if ($("sheet")) { closeSheet(); return true; }
    if (tab === "hist" && histKey) { histKey = ""; render(); return true; }
    if (q) { q = ""; render(); return true; }
    if (tab !== "price") { tab = "price"; render(); return true; }
    if (view !== "ours") { view = "ours"; render(); return true; }
    return false;
  };
  /* กลับเข้าแอพ: เกิน 1 นาที = ถามเลขรุ่น (ไม่ดึงถ้าไม่มีอะไรใหม่) */
  const back = () => { if (cfg.token && !$("main").classList.contains("hidden") && Date.now() - lastCheck > 60000) refresh(false); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) back(); });
  window.appChanged = back;
  window.addEventListener("online", back);

  /* ---------- เริ่ม ---------- */
  // Android: ลิงก์ตามตัวแอพเสมอ (อัปเดตแอพแล้วลิงก์เปลี่ยนตาม · ลิงก์เปลี่ยน = ข้อมูลเดิมใช้ไม่ได้)
  if (IS_ANDROID) {
    const l = nativeLink();
    if (l.url && cfg.url !== l.url) {
      if (cfg.url) { S.del("data"); D = PX.normalize({}); hasData = false; edits = {}; save(); cfg.token = ""; }
      cfg.url = l.url; S.set("cfg", cfg);
    }
  }
  if (!cfg.url || !cfg.token) showSetup("");
  else { showMain(); refresh(false); }
  try { if (IS_ANDROID) ShopAndroid.ready(); } catch (e) {}
  window.__px = { get edits() { return edits; }, get D() { return D; }, refresh, render };   // ชุดทดสอบ
})();
