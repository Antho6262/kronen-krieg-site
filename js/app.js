/* ============================================================
   KRONEN KRIEG — app.js
   Sidebar / topbar communs + items de navigation.
   ============================================================ */

const NAV_ITEMS = [
  { page: "dashboard",    icon: "🏠", label: "Dashboard",    file: "dashboard.html" },
  { page: "tracker",      icon: "📋", label: "Tracker",      file: "tracker.html" },
  { page: "stats",        icon: "📊", label: "Stats",        file: "stats.html" },
  { page: "stock",        icon: "📦", label: "Stock",        file: "stock.html" },
  { page: "quotas",       icon: "🎯", label: "Quotas",       file: "quotas.html" },
  { page: "blanchiment",  icon: "💵", label: "Blanchiment",  file: "blanchiment.html" },
  { page: "paye",         icon: "💰", label: "Paye",         file: "paye.html" },
  { page: "transactions", icon: "🔁", label: "Transactions", file: "transactions.html" },
  { page: "taxes",        icon: "🧾", label: "Taxes",        file: "taxes.html" },
  { page: "admin",        icon: "⚙️", label: "Admin",        file: "admin.html" },
  { page: "profil",       icon: "👤", label: "Profil",       file: "profil.html" }
];

/* ============================================================
   SYSTÈME DE SEMAINES AUTOMATIQUE
   Semaine = lundi 00:00 → dimanche 23:59. Verrouillage auto le
   dimanche à 19h00 (heure du navigateur) + création automatique
   de la semaine suivante. Basé sur transactions Firebase pour
   éviter les doublons si plusieurs membres sont connectés en
   même temps.
   ============================================================ */
function getLundi(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const jour = d.getDay(); // 0=dim..6=sam
  const diff = jour === 0 ? -6 : 1 - jour;
  d.setDate(d.getDate() + diff);
  return d;
}
function limitesSemaine(ts) {
  const lundi = getLundi(ts);
  const dimanche = new Date(lundi);
  dimanche.setDate(lundi.getDate() + 6);
  dimanche.setHours(23, 59, 59, 999);
  const verrouAt = new Date(lundi);
  verrouAt.setDate(lundi.getDate() + 6);
  verrouAt.setHours(19, 0, 0, 0);
  return { debut: lundi.getTime(), fin: dimanche.getTime(), verrouAt: verrouAt.getTime() };
}
function fmtJJMM(ts) {
  const d = new Date(ts);
  return String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0");
}
function nomAutoSemaine(debut, fin) {
  return "Semaine du " + fmtJJMM(debut) + " au " + fmtJJMM(fin);
}
/* Verrouille une semaine (résumé + webhook Discord si configuré).
   Protégé par transaction : un seul client exécute réellement le verrouillage. */
async function verrouillerSemaineAuto(id, nom) {
  const res = await db.ref("semaines/" + id + "/bloquee").transaction(cur => (cur === true ? undefined : true));
  if (!res.committed) return;
  await db.ref("semaines/" + id + "/closedAt").set(Date.now());

  try {
    const snap = await db.ref("actions/" + id).once("value");
    const actions = entries(snap.val()).map(([, a]) => a);
    const gainsSale = actions.reduce((acc, a) => acc + Number(a.argent_sale || 0), 0);
    const gainsPropre = actions.reduce((acc, a) => acc + Number(a.argent_propre || 0), 0);
    const reussites = actions.filter(a => a.resultat === "Réussite").length;
    const echecs = actions.filter(a => a.resultat === "Échec").length;
    const parMembre = {};
    actions.forEach(a => { parMembre[a.prenom_membre] = (parMembre[a.prenom_membre] || 0) + 1; });
    const classement = Object.entries(parMembre).sort((a, b) => b[1] - a[1])
      .map(([p, n], i) => `${i + 1}. ${p} — ${n} action(s)`).join("\n");
    const texte = `📋 RÉSUMÉ — ${nom} — Kronen Krieg\n` +
      `Actions : ${actions.length} (✅ ${reussites} / ❌ ${echecs})\n` +
      `Gains sale : ${formatMoney(gainsSale)}\n` +
      `Gains propre : ${formatMoney(gainsPropre)}\n\n` +
      `Classement :\n${classement || "—"}`;
    await db.ref("semaines/" + id + "/resume").set(texte);

    const cfgSnap = await db.ref("config/discord_webhook_semaine").once("value");
    const webhook = cfgSnap.val();
    if (webhook) {
      try { await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: texte }) }); }
      catch (e) { /* webhook injoignable, on ignore */ }
    }
  } catch (e) { console.error("verrouillerSemaineAuto", e); }
}
/* Vérifie la semaine active à chaque chargement de page :
   - verrouille l'ancienne si l'heure de verrouillage est dépassée
   - crée la semaine courante si elle n'existe pas encore */
async function ensureSemaineAuto() {
  try {
    const now = Date.now();
    const snap = await db.ref("semaines").once("value");
    const list = entries(snap.val()).map(([id, s]) => ({ id, ...s }));
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const active = list.find(s => s.bloquee !== true);

    if (active && active.verrouAt && now >= active.verrouAt) {
      await verrouillerSemaineAuto(active.id, active.nom);
    }

    const bounds = limitesSemaine(now);
    const existeDeja = list.some(s => s.debut === bounds.debut);
    if (!existeDeja) {
      const idxRef = db.ref("semaine_index/" + bounds.debut);
      const res = await idxRef.transaction(cur => (cur === null ? true : undefined));
      if (res.committed) {
        const id = uid();
        const nom = nomAutoSemaine(bounds.debut, bounds.fin);
        await db.ref("semaines/" + id).set({
          nom, bloquee: false, createdAt: now,
          debut: bounds.debut, fin: bounds.fin, verrouAt: bounds.verrouAt, auto: true
        });
        await idxRef.set(id);
      }
    }
  } catch (e) { console.error("ensureSemaineAuto", e); }
}

/* Construit le shell (sidebar + topbar) dans #shell, protège la page,
   et renvoie la session du membre connecté (ou redirige vers /index.html). */
async function initShell(activePage, pageTitle) {
  const session = requireSession();
  if (!session) return null;

  await ensureSemaineAuto();

  let allowed;
  try {
    allowed = await canAccess(session, activePage);
  } catch (e) {
    allowed = false;
  }
  if (!allowed) {
    document.body.innerHTML =
      '<div class="login-wrap"><div class="login-card"><div class="login-brand">ACCÈS REFUSÉ</div>' +
      '<p class="muted" style="text-align:center;margin-top:10px;">Ton compte est désactivé ou n\'a pas accès à cette page.</p>' +
      '<a href="' + pathToRoot() + 'index.html" class="btn btn-primary" style="margin-top:16px;display:block;text-align:center;" onclick="clearSession()">Retour à la connexion</a></div></div>';
    return null;
  }

  const root = pathToRoot();
  let navHtml = "";
  for (const item of NAV_ITEMS) {
    const ok = await canAccess(session, item.page);
    if (!ok) continue;
    const active = item.page === activePage ? " active" : "";
    navHtml += `<a class="nav-item${active}" href="${root}pages/${item.file}">
        <span class="ic">${item.icon}</span><span class="lbl">${item.label}</span>
      </a>`;
  }

  const shellHtml = `
    <div class="shell">
      <aside class="sidebar">
        <div class="sidebar-head">
          <img src="${root}img/logo.png" alt="Kronen Krieg" class="sidebar-coin">
          <div class="sidebar-logo"><span class="full">KRONEN KRIEG</span></div>
        </div>
        <nav class="nav">${navHtml}</nav>
        <div class="sidebar-foot">
          <div class="who"><b>${session.prenom} ${session.nom || ""}</b><span class="grade">${session.grade || ""}</span></div>
          <span class="logout-link" onclick="logout()">Se déconnecter</span>
        </div>
      </aside>
      <div class="main">
        <div class="topbar">
          <div class="topbar-title">${pageTitle || ""}</div>
          <div class="topbar-brand"><span class="coin">🪙</span> KRONEN KRIEG</div>
        </div>
        <main class="content fade-in" id="content"></main>
      </div>
    </div>
  `;
  document.getElementById("shell").outerHTML = shellHtml;
  return session;
}
