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
  if (!PX.SKINS[posterStyle]) posterStyle = "A";
  let posterUrl = "", posterBlob = null, posterFile = null, posterDirty = true;
  let saving = false;
  let steelHide = new Set(S.get("steelHide", []) || []);   // สินค้าที่ไม่เอามาเทียบกับร้านพ่อ (จำในเครื่อง)
  const saveHide = () => S.set("steelHide", Array.from(steelHide));
  let steelLock = new Set(S.get("steelLock", []) || []);   // ตัวที่ล็อกราคาไว้ในระบบ (เว็บบอกตอนกดอัพเดทตามร้านพ่อ) — ไม่นับว่าต่าง

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
    if (tab === "price") pills = `<button class="pill${view === "ours" ? " on" : ""}" data-v="ours">สาขา 2 + 4</button><button class="pill${view === "steel" ? " on" : ""}" data-v="steel">เทียบร้านพ่อ</button>`;
    if (tab === "poster") pills = Object.keys(PX.SKINS).map(k => `<button class="pill${posterStyle === k ? " on" : ""}" data-s="${k}">${PX.esc(PX.SKINS[k])}</button>`).join("");
    if (tab === "hist" && histKey) pills = [[7, "7 วัน"], [30, "30 วัน"], [90, "3 เดือน"], [182, "6 เดือน"], [365, "1 ปี"]].map(r => `<button class="pill${histDays === r[0] ? " on" : ""}" data-d="${r[0]}">${r[1]}</button>`).join("");
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
      const rows = PX.steelRows(D, q).filter(r => r.key);          // เฉพาะตัวที่จับคู่กับสินค้าเราได้
      const nDiff = rows.filter(r => !steelHide.has(r.key) && !steelLock.has(r.key) && r.ours != null && PX.r2(r.p - r.ours) !== 0).length;
      h += `<button class="upd" id="btnSteel"${busy ? " disabled" : ""}>🔄 อัพเดทตามร้านพ่อ${nDiff ? " (ต่าง " + nDiff + " รายการ)" : ""}</button>`;
      if (D.steel) h += `<div class="lbl" style="margin:0 2px 6px">ราคาร้านพ่ออ่านเมื่อ ${PX.esc(PX.when(D.steel.at))} · กด "ไม่เทียบ" = ไม่เอาตัวนั้นมาเทียบ/อัพเดท</div>`;
      const row = r => {
        const off = steelHide.has(r.key);
        const diff = r.ours == null ? null : PX.r2(r.p - r.ours);
        const cmp = off ? "ไม่เอามาเทียบ" : "ของเรา " + PX.fmt(r.ours) + (diff ? (diff > 0 ? " · ร้านพ่อสูงกว่า " : " · ร้านพ่อต่ำกว่า ") + PX.fmt(Math.abs(diff)) : " · เท่ากัน") + (steelLock.has(r.key) && diff ? " · 🔒 ล็อกไว้ ไม่ตาม" : "");
        return `<div class="it${off ? " off" : ""}"><div class="nm">${PX.esc(r.n)}<small class="${off ? "" : diff > 0 ? "up" : diff < 0 ? "dn" : ""}">${PX.esc(cmp)}</small></div>` +
          `<button class="eye" data-hide="${PX.esc(r.key)}">${off ? "↩ เทียบ" : "ไม่เทียบ"}</button><div class="sp">${PX.fmt(r.p)}</div></div>`;
      };
      const on = rows.filter(r => !steelHide.has(r.key)), off = rows.filter(r => steelHide.has(r.key));
      // ตัวที่ราคาต่างขึ้นก่อน
      const live = r => PX.r2(r.p - r.ours) !== 0 && !steelLock.has(r.key);
      on.sort((a, b) => live(b) - live(a));
      h += on.map(row).join("") + (off.length ? `<div class="sec">ไม่เอามาเทียบ (${off.length})</div>` + off.map(row).join("") : "") ||
        `<div class="empty">${D.steel ? "ไม่พบสินค้า" : hasData ? "ยังไม่มีราคาร้านพ่อ" : "กำลังโหลด…"}</div>`;
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
    const unit = it ? it.unit : "กก.";
    $("body").innerHTML = bannerHtml() + `<button class="back" id="hBack">‹ ประวัติทั้งหมด</button>` +
      `<div class="box"><div class="lbl">${PX.esc(name)} · ${PX.esc(it ? it.c : "")}</div>` +
      `<div class="selhead"><div class="big" id="hVal">${it ? PX.fmt(it.price) : "—"} <small>บ./${PX.esc(unit)}</small></div><div class="when" id="hWhen">ราคาตอนนี้</div></div>` +
      `<div class="chart" id="hChart"><div class="empty">กำลังโหลด…</div></div></div><div class="box" id="hRows"></div>`;
    const hk = histKey;
    histLoad(hk).then(rows => {
      if (tab !== "hist" || !$("hChart") || histKey !== hk) return;
      const now = Date.now(), from = now - histDays * 86400000;
      const pts = PX.series(rows, it ? it.price : NaN, histDays, now);
      const inR = rows.filter(r => PX.parseStamp(r.t) >= from);
      drawChart(pts, from, now, unit, inR.length);
      $("hRows").innerHTML = inR.length ? inR.map(histRow(false)).join("") : `<div class="empty" style="padding:16px">ไม่มีการเปลี่ยนราคาในช่วงนี้</div>`;
    }).catch(e => {
      if (e instanceof PX.AuthError) return authLost();
      if ($("hChart")) $("hChart").innerHTML = `<div class="banner err">${PX.esc(e.message || "ดึงประวัติไม่ได้")}</div>`;
    });
  }

  /* กราฟจิ้มดู (แบบแอพหุ้น/Dime): แตะหรือลากบนกราฟ = เห็นวันที่ + ราคา ณ วันนั้นด้านบน · ปล่อยนิ้วแล้วค้างไว้ · แตะ "ราคาตอนนี้" = กลับ */
  function drawChart(pts, from, now, unit, nChg) {
    const box = $("hChart"); if (!box) return;
    const W = Math.max(260, Math.round(box.clientWidth || 320)), H = 170;
    const g = PX.chartGeom(pts, W, H);
    const mid = from + (now - from) / 2;
    box.innerHTML = `<div class="chartbox" id="hBox">${PX.chartSvg2(pts, W, H, "#2f8a4f")}` +
      `<div class="ylab" style="top:${(g.Y(g.hi) - 8).toFixed(0)}px">${PX.fmt(g.hi)}</div>` + (g.hi !== g.lo ? `<div class="ylab" style="top:${(g.Y(g.lo) - 8).toFixed(0)}px">${PX.fmt(g.lo)}</div>` : "") + `</div>` +
      `<div class="chartlbl"><span>${PX.esc(PX.shortDate(new Date(from)))}</span><span>${PX.esc(PX.shortDate(new Date(mid)))}</span><span>วันนี้</span></div>` +
      `<div class="tip">${nChg ? "แตะหรือลากบนกราฟเพื่อดูราคาแต่ละวัน · เปลี่ยนราคา " + nChg + " ครั้งในช่วงนี้" : "ช่วงนี้ราคาไม่เปลี่ยน — ลองเลือกช่วงที่ยาวขึ้น"}</div>`;
    const svg = box.querySelector("svg"), cur = svg.querySelector(".cur"), cl = svg.querySelector(".cl"), cd = svg.querySelector(".cd");
    const show = ev => {
      const r = svg.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width * W;
      const t = g.T(px), v = PX.valueAt(pts, t);
      const x = g.X(t);
      cur.style.display = ""; cl.setAttribute("x1", x); cl.setAttribute("x2", x); cd.setAttribute("cx", x); cd.setAttribute("cy", g.Y(v));
      $("hVal").innerHTML = PX.fmt(v) + ` <small>บ./${PX.esc(unit)}</small>`;
      const d = new Date(t);
      $("hWhen").textContent = "วันที่ " + PX.shortDate(d) + (now - t < 60000 ? " (ตอนนี้)" : "");
    };
    let down = false;
    svg.addEventListener("pointerdown", e => { down = true; try { svg.setPointerCapture(e.pointerId); } catch (x) {} show(e); });
    svg.addEventListener("pointermove", e => { if (down) show(e); });
    svg.addEventListener("pointerup", () => { down = false; });
    svg.addEventListener("pointercancel", () => { down = false; });
    $("hWhen").onclick = () => { cur.style.display = "none"; $("hVal").innerHTML = PX.fmt(PX.valueAt(pts, now)) + ` <small>บ./${PX.esc(unit)}</small>`; $("hWhen").textContent = "ราคาตอนนี้"; };
  }

  /* ---------- อัพเดทตามร้านพ่อ: ปุ่มเดียว → รายการที่ราคาต่าง (ติ๊กไว้ให้) → ยืนยัน → ราคาเราเปลี่ยนตามร้านพ่อ ----------
     ใช้คำสั่งเดิมของเว็บ (ปุ่ม "อัพเดทราคาจากสาขา 3" ในเว็บ/โปรแกรมร้าน): priceUpdates / priceApply · ตัวที่ล็อกราคาไว้ในระบบ เว็บไม่เสนอ */
  let SU = null;   // {r: ผลจากเว็บ, pick: Set(key)}
  async function steelUpdate() {
    if (busy || saving) return;
    const b = $("btnSteel"); if (b) { b.disabled = true; b.textContent = "กำลังเทียบราคากับร้านพ่อ…"; }
    try {
      const r = await PX.post(cfg.url, "priceUpdates", { token: cfg.token }, 90000);
      SU = { r, pick: new Set((r.items || []).filter(x => !steelHide.has(x.key)).map(x => x.key)) };
      steelLock = new Set((r.lockedItems || []).map(x => x.key)); S.set("steelLock", Array.from(steelLock));
      steelSheet();
    } catch (e) {
      if (e instanceof PX.AuthError) return authLost();
      toast(e.message || "เทียบราคาไม่สำเร็จ", 4000);
    } finally { const b2 = $("btnSteel"); if (b2) { b2.disabled = false; renderPrice(); } }
  }
  function steelSheet() {
    const r = SU.r, items = r.items || [];
    const on = items.filter(x => !steelHide.has(x.key)), off = items.filter(x => steelHide.has(x.key));
    const row = x => {
      const hid = steelHide.has(x.key), d = PX.r2(x.next - x.cur);
      const it = D.byKey[x.key];
      return `<label class="ck${hid ? " off" : ""}"><input type="checkbox" data-pick="${PX.esc(x.key)}"${SU.pick.has(x.key) ? " checked" : ""}${hid ? " disabled" : ""}>` +
        `<div class="n">${PX.esc(x.product)}<small>${PX.esc(x.category)}${x.big ? ' · <b class="dn">⚠ ต่างเยอะ ' + PX.fmt(Math.abs(x.pct)) + "%</b>" : ""}${x.single ? " · ⚠ ตรวจกับรูปก่อน" : ""}</small></div>` +
        `<div class="r"><span class="${d > 0 ? "up" : "dn"}">${d > 0 ? "▲" : "▼"} ${PX.fmt(Math.abs(d))}</span> ${PX.fmt(x.cur)} → <b>${PX.fmt(x.next)}</b>` +
        `<br><button class="eye" data-hide2="${PX.esc(x.key)}" style="margin-top:3px">${hid ? "↩ เทียบ" : "ไม่เทียบ"}</button></div></label>`;
    };
    let html = "";
    if (r.fallback) html += `<div class="banner">อ่านชีตร้านพ่อตรง ๆ ไม่ได้ — ใช้ราคาจากรูปใบราคาใน LINE แทน (ตรวจก่อนติ๊ก)</div>`;
    html += on.length ? `<div class="lbl">ติ๊กตัวที่จะเปลี่ยนตามร้านพ่อ (ติ๊กไว้ให้ทุกตัว)</div>` + on.map(row).join("") : `<div class="empty" style="padding:18px">ราคาตรงกับร้านพ่อทุกตัวแล้ว 👍</div>`;
    if (off.length) html += `<div class="sec">ไม่เอามาเทียบ (${off.length})</div>` + off.map(row).join("");
    if (r.lockedItems && r.lockedItems.length) html += `<div class="sec">🔒 ล็อกราคาไว้ในระบบ ไม่เปลี่ยนตาม (${r.lockedItems.length}): ${PX.esc(r.lockedItems.map(x => x.product).join(", "))}</div>`;
    if (r.checkItems && r.checkItems.length) html += `<div class="sec">⚠ อ่านไม่ชัด ไม่เสนอ (${r.checkItems.length})</div>`;
    const n = on.filter(x => SU.pick.has(x.key)).length;
    const sh = sheet("อัพเดทตามร้านพ่อ", `<div class="lbl" style="margin-bottom:4px">ราคาร้านพ่อ ณ ${PX.esc(PX.when(r.sheetAt || ""))}</div>` + html,
      on.length ? [{ label: "ยกเลิก" }, { label: n ? "เปลี่ยนตามร้านพ่อ " + n + " รายการ" : "ยังไม่ได้ติ๊ก", main: true, on: () => steelApply() }] : [{ label: "ปิด", main: true }]);
    sh.addEventListener("change", e => {
      const k = e.target.dataset && e.target.dataset.pick; if (!k) return;
      if (e.target.checked) SU.pick.add(k); else SU.pick.delete(k);
      const m = on.filter(x => SU.pick.has(x.key)).length;
      const btn = sh.querySelector('.bar [data-i="1"]'); if (btn) btn.textContent = m ? "เปลี่ยนตามร้านพ่อ " + m + " รายการ" : "ยังไม่ได้ติ๊ก";
    });
    sh.addEventListener("click", e => {
      const b = e.target.closest("[data-hide2]"); if (!b) return;
      e.preventDefault(); e.stopPropagation();
      const k = b.dataset.hide2;
      if (steelHide.has(k)) { steelHide.delete(k); SU.pick.add(k); } else { steelHide.add(k); SU.pick.delete(k); }
      saveHide(); const sc = sh.querySelector(".sc").scrollTop; steelSheet(); const s2 = $("sheet"); if (s2) s2.querySelector(".sc").scrollTop = sc;
    }, true);
  }
  async function steelApply() {
    const r = SU.r;
    const list = (r.items || []).filter(x => SU.pick.has(x.key) && !steelHide.has(x.key));
    if (!list.length) return;
    const sh = $("sheet"); if (sh) sh.classList.add("busy");
    saving = true;
    try {
      const res = await PX.post(cfg.url, "priceApply", { token: cfg.token, sheetKey: r.sheetKey, items: list.map(x => ({ category: x.category, product: x.product, price: x.next })) }, 90000);
      closeSheet();
      const sk = res.skipped || [];
      if (sk.length) sheet("เปลี่ยนแล้ว " + (res.updated || 0) + " รายการ · ข้าม " + sk.length, sk.map(s => `<div class="hrow"><div>${PX.esc(String(s).split("||").pop())}</div></div>`).join(""), [{ label: "ตกลง", main: true }]);
      else toast("✓ เปลี่ยนตามร้านพ่อแล้ว " + (res.updated || 0) + " รายการ");
      saving = false;
      await refresh(true);
    } catch (e) {
      if (sh) sh.classList.remove("busy");
      if (e instanceof PX.AuthError) { closeSheet(); return authLost(); }
      toast(e instanceof PX.Offline ? "ติดต่อเว็บไม่ได้ — ตรวจราคากับเว็บก่อนกดใหม่" : (e.message || "อัพเดทไม่สำเร็จ"), 4500);
      if (e instanceof PX.Offline) { closeSheet(); refresh(true); }
    } finally { saving = false; }
  }

  /* ---------- หน้าใบราคา ---------- */
  async function renderPoster() {
    const stale = hasData && !PX.posterModel(D, new Date()).isToday;
    $("body").innerHTML = bannerHtml() + (stale ? `<div class="banner">⚠ ราคาในรูปเป็นของ ${PX.esc(PX.when(D.at))} (ยังไม่ได้ดึงราคาวันนี้) — กด 🔄 ก่อนส่ง</div>` : "") +
      (hasData ? `<img class="posterImg" id="pImg" alt="ใบราคา"><div class="pEdit"><button class="btn" id="btnPText">✏️ แก้ข้อความในรูป</button><button class="btn" id="btnPArrow">▲▼ ลูกศรราคา</button></div><div class="hint">แตะรูปเพื่อดูเต็มจอ/ซูม · หน้าตา/หมวด/ลำดับเดียวกับใบราคาในโปรแกรมร้าน · ราคาตามที่บันทึกล่าสุด${Object.keys(edits).length ? " <b class=\"dn\">(ที่แก้ยังไม่บันทึก ไม่อยู่ในรูป)</b>" : ""}</div>` : `<div class="empty">ยังไม่มีราคา — กด 🔄</div>`);
    if (!hasData) return;
    $("btnPText").onclick = editText;
    $("btnPArrow").onclick = editArrows;
    try { if (posterDirty || !posterUrl) await makePoster(); }
    catch (e) { toast((e && e.message) || "สร้างรูปใบราคาไม่สำเร็จ", 4000); return; }
    if ($("pImg") && posterUrl) { $("pImg").src = posterUrl; $("pImg").onclick = openZoom; }
    // iPhone: เตรียมไฟล์รูปไว้ก่อน — กด "ส่ง LINE" แล้วเปิดหน้าต่างแชร์ทันที (Safari ยอมแชร์เฉพาะทันทีหลังแตะ)
    if (!IS_ANDROID && !posterFile) { try { posterFile = new File([await getBlob()], posterName(), { type: "image/png" }); } catch (e) {} }
  }
  /* ใบราคาแบบเดียวกับโปรแกรมร้าน: วาด HTML (poster.css) นอกจอ → html2canvas (ไฟล์ในแอพ ไม่ต้องใช้เน็ต) */
  let H2C = null;
  function loadH2C() {
    if (typeof window.html2canvas === "function") return Promise.resolve(window.html2canvas);
    if (H2C) return H2C;
    H2C = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "vendor/html2canvas.min.js";
      s.onload = () => typeof window.html2canvas === "function" ? res(window.html2canvas) : rej(new Error("โหลดตัวสร้างรูปไม่ได้"));
      s.onerror = () => { H2C = null; rej(new Error("โหลดตัวสร้างรูปไม่ได้")); };
      document.head.appendChild(s);
    });
    return H2C;
  }
  /* มือถือตั้งตัวหนังสือเล็ก/ใหญ่ (เช่น 90%) → เว็บย่อ/ขยายตัวหนังสือในรูปด้วย = รูปเพี้ยน (ราคา/กก. โดนตัด)
     → สลับเป็น 100% ชั่วคราวระหว่างแปลงเป็นรูป (มีม่าน "กำลังทำรูป" บังไว้) แล้วคืนค่าเดิม */
  const sysZoom = () => { try { return IS_ANDROID && typeof ShopAndroid.textZoom === "function" ? Number(ShopAndroid.textZoom()) || 100 : 100; } catch (e) { return 100; } };
  const setZoom = z => { try { ShopAndroid.setTextZoom(z); } catch (e) {} };
  const frames = n => new Promise(r => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); });
  async function makePoster() {
    const z = sysZoom();
    if (z === 100) return makePoster0();
    const cover = document.createElement("div");
    cover.className = "pxCover"; cover.textContent = "กำลังทำรูปใบราคา…";
    document.body.appendChild(cover);
    setZoom(100);
    try {
      for (let i = 0; i < 40; i++) {   // รอเว็บใช้ขนาดใหม่จริง (สูงสุด ~2 วิ)
        await new Promise(r => setTimeout(r, 50));
        if (Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize) - 16) < 0.01) break;
      }
      await frames(2);
      await makePoster0();
    } finally { setZoom(0); cover.remove(); }
  }
  async function makePoster0() {
    await PX.fontsReady();
    const h2c = await loadH2C();
    let host = $("posterHost");
    if (!host) {
      host = document.createElement("div");
      host.id = "posterHost";
      host.setAttribute("aria-hidden", "true");
      host.style.cssText = "position:fixed;left:-20000px;top:0;width:1560px;pointer-events:none";
      document.body.appendChild(host);
    }
    host.innerHTML = `<div class="${PX.skinClass(posterStyle)}" id="pxPoster">${PX.posterHtml(D, null, new Date())}</div>`;
    const node = $("pxPoster");
    await Promise.all(Array.from(node.querySelectorAll("img")).map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    const canvas = await h2c(node, { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false, windowWidth: 1600, windowHeight: Math.max(1200, node.offsetHeight + 40), scrollX: 0, scrollY: 0 });
    posterUrl = canvas.toDataURL("image/png");
    host.innerHTML = "";
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

  /* ---------- แก้ใบราคา: ข้อความบนรูป / ลูกศร → บันทึกขึ้นเว็บ (ใบเดียวกับโปรแกรมร้าน สาขา 2) ----------
     กันทับกัน: ก่อนบันทึกดึงใบล่าสุดจากเว็บ — มีคนแก้ใบไปแล้ว (เช่นจากโปรแกรมร้าน) = ไม่บันทึก ให้ดูใหม่ก่อน */
  async function saveLayout(L, okMsg) {
    if (saving) return;
    saving = true;
    const sh = $("sheet"); if (sh) sh.classList.add("busy");
    try {
      const before = JSON.stringify(D.layout || null);
      const fresh = await call("load", {}, 90000);
      if (JSON.stringify(fresh.layout || null) !== before) {
        S.set("data", fresh); D = PX.normalize(fresh); hasData = true; posterDirty = true; HC = {};
        closeSheet();
        sheet("ใบราคาเพิ่งถูกแก้จากที่อื่น", `<div class="lbl">มีคนแก้ใบราคา (เช่นจากโปรแกรมร้าน) ระหว่างนี้ — ยังไม่ได้บันทึกของคุณ · ดึงใบล่าสุดมาแล้ว ลองแก้อีกครั้ง</div>`, [{ label: "ตกลง", main: true }]);
        render(); return;
      }
      await PX.post(cfg.url, "savePriceLayout", { token: cfg.token, branch: "2", layout: L }, 90000);
      closeSheet();
      toast(okMsg || "✓ บันทึกใบราคาแล้ว");
      saving = false;
      await refresh(true);
    } catch (e) {
      if (sh) sh.classList.remove("busy");
      if (e instanceof PX.AuthError) { closeSheet(); authLost(); return; }
      toast((e && e.message) || "บันทึกใบราคาไม่สำเร็จ", 4500);
      if (e instanceof PX.Offline) { closeSheet(); refresh(true); }
    } finally { saving = false; }
  }
  function editArrows() {
    const L = PX.layoutOf(D);
    let up = 0, dn = 0;
    L.sections.forEach(s => (s.items || []).forEach(it => { const a = PX.layoutArrow(D, L, it); if (a === "up") up++; else if (a === "down") dn++; }));
    const btns = [];
    if (L.showArrows) {
      btns.push({ label: "ล้างลูกศร", main: true, on: () => saveLayout(PX.layoutResetBase(D, PX.layoutOf(D), new Date()), "✓ ล้างลูกศรแล้ว — ราคาเปลี่ยนจากนี้ไปถึงจะขึ้นลูกศร") });
      btns.push({ label: "ซ่อนลูกศร", on: () => { const x = PX.layoutOf(D); x.showArrows = false; saveLayout(x, "✓ ซ่อนลูกศรแล้ว"); } });
    } else {
      btns.push({ label: "โชว์ลูกศร", main: true, on: () => { const x = PX.layoutOf(D); x.showArrows = true; if (!x.prices || !Object.keys(x.prices).length) PX.layoutResetBase(D, x, new Date()); saveLayout(x, "✓ โชว์ลูกศรแล้ว"); } });
    }
    btns.push({ label: "ปิด" });
    sheet("ลูกศรราคา ▲▼", L.showArrows
      ? `<div class="lbl">ตอนนี้ขึ้น <b class="up">▲ ${up}</b> · <b class="dn">▼ ${dn}</b> รายการ (เทียบกับราคาวันที่ ${PX.esc(L.baseAt || "-")})</div><div class="lbl"><b>ล้างลูกศร</b> = ลูกศรหายหมด เริ่มนับใหม่จากราคาตอนนี้ (เหมือนปุ่ม "ตั้งราคาวันนี้เป็นฐาน" ในโปรแกรมร้าน)</div>`
      : `<div class="lbl">ตอนนี้ไม่โชว์ลูกศรบนใบราคา</div>`, btns);
  }
  function editText() {
    const L = PX.layoutOf(D);
    const inp = (f, v, ph, extra) => `<input class="eIn" data-f="${f}" ${extra || ""} value="${PX.esc(v)}" placeholder="${PX.esc(ph || "")}" autocomplete="off">`;
    let h = `<div class="lbl">แก้แค่บนรูปใบราคา — ราคา/ชื่อสินค้าจริงไม่เปลี่ยน · ช่องราคาลบให้ว่าง = ใช้ราคาจริง</div>` +
      `<div class="eLbl">หัวใบ</div>${inp("title", L.title || "", D.shop.name || "ชื่อร้าน")}` +
      `<div class="eLbl">ข้อความท้ายใบ</div>${inp("note", L.note == null ? PX.NOTE_DEF : L.note, "")}`;
    L.sections.forEach((s, si) => {
      h += `<div class="eSec">${inp("sec", s.name || "", "ชื่อหมวด", `data-si="${si}"`)}</div>`;
      (s.items || []).forEach((it, ii) => {
        if (!it || typeof it !== "object") return;
        const real = PX.layoutReal(D, it);
        const nm = it.text != null ? String(it.text) : (it.label != null && String(it.label).trim() ? String(it.label) : real.name);
        const pr = it.text != null ? String(it.price == null ? "" : it.price) : (it.priceOv != null && String(it.priceOv).trim() ? String(it.priceOv) : real.price);
        const a = PX.layoutArrow(D, L, it);
        h += `<div class="eRow">${inp("name", nm, real ? real.name : "ข้อความ", `data-si="${si}" data-ii="${ii}"`)}` +
          `${a ? `<span class="${a === "up" ? "up" : "dn"}">${a === "up" ? "▲" : "▼"}</span>` : ""}` +
          `${inp("price", pr, real ? real.price : "", `data-si="${si}" data-ii="${ii}" class="eIn ePr"`)}</div>`;
      });
    });
    sheet("✏️ แก้ข้อความในรูป", h, [{ label: "ยกเลิก" }, { label: "บันทึก", main: true, on: () => {
      const x = PX.layoutOf(D);
      document.querySelectorAll("#sheet .eIn").forEach(el => {
        const f = el.dataset.f, v = el.value.replace(/\s+/g, " ").trim();
        if (f === "title") { if (v !== String(x.title || "").replace(/\s+/g, " ").trim()) x.title = v; return; }   // ว่าง = ใช้ชื่อร้าน · ไม่แตะถ้าไม่ได้แก้
        if (f === "note" && el.value.trim() === String(x.note == null ? PX.NOTE_DEF : x.note).trim()) return;
        if (f === "note") { x.note = el.value.trim(); return; }
        const s = x.sections[Number(el.dataset.si)]; if (!s) return;
        if (f === "sec") { if (v && v !== String(el.defaultValue || "").replace(/\s+/g, " ").trim()) s.name = v; return; }
        const it = (s.items || [])[Number(el.dataset.ii)]; if (!it) return;
        if (v === String(el.defaultValue || "").replace(/\s+/g, " ").trim()) return;   // ไม่ได้แก้ช่องนี้ = ไม่แตะ
        if (it.text != null) { if (f === "name") it.text = v; else it.price = v; return; }
        const real = PX.layoutReal(D, it);
        if (f === "name") { if (!v || v === real.name) delete it.label; else it.label = v; }
        else { if (!v || v === real.price) delete it.priceOv; else it.priceOv = v; }
      });
      if (JSON.stringify(x) === JSON.stringify(PX.layoutOf(D))) { closeSheet(); toast("ไม่ได้แก้อะไร"); return; }
      saveLayout(x, "✓ บันทึกข้อความในรูปแล้ว (โปรแกรมร้านเห็นด้วย)");
    } }]);
  }

  /* ---------- ดูรูปใบราคาเต็มจอ: สองนิ้วถ่างซูม · นิ้วเดียวลากเลื่อน · แตะสองครั้งซูม/คืน · ✕ หรือปุ่มย้อนกลับ = ปิด ---------- */
  function closeZoom() { const z = $("zoomV"); if (z) z.remove(); }
  function openZoom() {
    if (!posterUrl) return;
    closeZoom();
    const v = document.createElement("div");
    v.id = "zoomV";
    v.innerHTML = `<img alt="ใบราคา" draggable="false"><button class="zx" aria-label="ปิด">✕</button><div class="zh">ถ่างสองนิ้วเพื่อซูม · แตะสองครั้งซูม/คืน</div>`;
    document.body.appendChild(v);
    const img = v.querySelector("img");
    let s = 1, x = 0, y = 0, base = 1, W = 0, H = 0;
    const pts = new Map();
    let start = null, lastTap = 0, moved = false;
    const fit = () => {
      const r = v.getBoundingClientRect(), iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      base = Math.min(r.width / iw, r.height / ih); W = r.width; H = r.height;
      img.style.width = iw * base + "px"; img.style.height = ih * base + "px";
    };
    const clamp = () => {
      s = Math.min(8, Math.max(1, s));
      const iw = (img.naturalWidth || 1) * base * s, ih = (img.naturalHeight || 1) * base * s;
      const mx = Math.max(0, (iw - W) / 2), my = Math.max(0, (ih - H) / 2);
      x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
    };
    const apply = () => { clamp(); img.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${s})`; };
    /* ซูมรอบจุด (cx,cy) บนจอ — จุดใต้นิ้วอยู่ที่เดิม */
    const zoomAt = (ns, cx, cy) => {
      const ox = cx - W / 2, oy = cy - H / 2;
      ns = Math.min(8, Math.max(1, ns));
      x = ox - (ox - x) * ns / s; y = oy - (oy - y) * ns / s; s = ns; apply();
    };
    img.onload = () => { fit(); apply(); };
    img.src = posterUrl;
    if (img.complete) { fit(); apply(); }
    const dist = () => { const a = [...pts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); };
    const mid = () => { const a = [...pts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; };
    v.addEventListener("pointerdown", e => {
      if (e.target.closest(".zx")) return;
      v.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pts.size === 2) start = { d: dist(), s, m: mid(), x, y };
      else start = { px: e.clientX, py: e.clientY, x, y };
    });
    v.addEventListener("pointermove", e => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && start && start.d) {
        const m = mid();
        x = start.x; y = start.y; s = start.s;
        zoomAt(start.s * dist() / (start.d || 1), start.m.x, start.m.y);
        x += m.x - start.m.x; y += m.y - start.m.y; apply();
        moved = true;
      } else if (pts.size === 1 && start && start.px != null) {
        const dx = e.clientX - start.px, dy = e.clientY - start.py;
        if (Math.abs(dx) + Math.abs(dy) > 6) moved = true;
        x = start.x + dx; y = start.y + dy; apply();
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size === 1) { const p = [...pts.values()][0]; start = { px: p.x, py: p.y, x, y }; return; }
      if (pts.size) return;
      start = null;
      if (moved || e.type === "pointercancel") return;
      const now = Date.now();
      if (now - lastTap < 320) { lastTap = 0; if (s > 1.05) { s = 1; x = 0; y = 0; apply(); } else zoomAt(3, e.clientX, e.clientY); }
      else lastTap = now;
    };
    v.addEventListener("pointerup", up);
    v.addEventListener("pointercancel", up);
    v.addEventListener("wheel", e => { e.preventDefault(); zoomAt(s * (e.deltaY < 0 ? 1.2 : 1 / 1.2), e.clientX, e.clientY); }, { passive: false });
    v.querySelector(".zx").addEventListener("click", closeZoom);
    window.addEventListener("resize", () => { if ($("zoomV")) { fit(); apply(); } });
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
    if (e.target.id === "btnSteel") { steelUpdate(); return; }
    const hb = e.target.closest("[data-hide]");
    if (hb) { const k = hb.dataset.hide; if (steelHide.has(k)) steelHide.delete(k); else steelHide.add(k); saveHide(); renderPrice(); return; }
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
    if ($("zoomV")) { closeZoom(); return true; }
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
