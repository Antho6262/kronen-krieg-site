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
  { page: "tv",           icon: "🖥️", label: "Mode TV",      file: "tv.html" },
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
/* Bornes de la prochaine semaine, enchaînée juste après la fin de la
   précédente (7 jours pile, verrouillage à 19h00 le 7e jour). S'il n'y a
   pas de semaine précédente, on part de la semaine calendaire courante
   (lundi → dimanche) — utilisé uniquement pour la toute première semaine. */
function prochainesBornes(derniere) {
  if (!derniere || !derniere.fin) return limitesSemaine(Date.now());
  const debutDate = new Date(derniere.fin + 1);
  debutDate.setHours(0, 0, 0, 0);
  const debut = debutDate.getTime();
  const finDate = new Date(debut);
  finDate.setDate(finDate.getDate() + 6);
  finDate.setHours(23, 59, 59, 999);
  const verrouDate = new Date(debut);
  verrouDate.setDate(verrouDate.getDate() + 6);
  verrouDate.setHours(19, 0, 0, 0);
  return { debut, fin: finDate.getTime(), verrouAt: verrouDate.getTime() };
}
/* Crée la semaine suivante enchaînée après `derniere`. Protégé par
   transaction sur semaine_index : un seul client la crée réellement. */
async function creerSemaineSuivante(derniere) {
  const bounds = prochainesBornes(derniere);
  const idxRef = db.ref("semaine_index/" + bounds.debut);
  const res = await idxRef.transaction(cur => (cur === null ? true : undefined));
  if (!res.committed) return;
  const id = uid();
  const nom = nomAutoSemaine(bounds.debut, bounds.fin);
  await db.ref("semaines/" + id).set({
    nom, bloquee: false, createdAt: Date.now(),
    debut: bounds.debut, fin: bounds.fin, verrouAt: bounds.verrouAt, auto: true
  });
  await idxRef.set(id);
}
/* Verrouille une semaine (résumé + webhook Discord si configuré) et
   enchaîne automatiquement la semaine suivante. Protégé par transaction :
   un seul client exécute réellement le verrouillage. */
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

  await majStatsEtBadges(id);
  const semSnap = await db.ref("semaines/" + id).once("value");
  await creerSemaineSuivante({ id, ...semSnap.val() });
}
/* Vérifie la semaine active à chaque chargement de page :
   - verrouille l'ancienne si l'heure de verrouillage est dépassée (ce qui
     enchaîne automatiquement la suivante, voir verrouillerSemaineAuto)
   - crée une première semaine si aucune n'existe encore */
async function ensureSemaineAuto() {
  try {
    const now = Date.now();
    const snap = await db.ref("semaines").once("value");
    const list = entries(snap.val()).map(([id, s]) => ({ id, ...s }));
    list.sort((a, b) => (b.debut || b.createdAt || 0) - (a.debut || a.createdAt || 0));
    const active = list.find(s => s.bloquee !== true);

    if (active && active.verrouAt && now >= active.verrouAt) {
      await verrouillerSemaineAuto(active.id, active.nom);
      return;
    }
    if (!list.length) {
      await creerSemaineSuivante(null);
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
  injectGlobalSearch();
  return session;
}

/* ============================================================
   ALERTE DISCORD — QUOTA ATTEINT
   Appelée après l'enregistrement d'une action réussie (tracker.html).
   Envoie une alerte une seule fois par semaine et par quota franchi
   (global ou par catégorie de produit variable), via
   config/discord_webhook_quota.
   ============================================================ */
async function envoyerWebhookQuota(texte) {
  try {
    const snap = await db.ref("config/discord_webhook_quota").once("value");
    const webhook = snap.val();
    if (!webhook) return;
    await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: texte }) });
  } catch (e) { /* webhook injoignable, on ignore */ }
}
async function verifierQuotaEtAlerter(membreId) {
  try {
    const snapW = await db.ref("semaines").once("value");
    const list = entries(snapW.val()).map(([id, s]) => ({ id, ...s })).sort((a, b) => (b.debut || b.createdAt || 0) - (a.debut || a.createdAt || 0));
    const week = list.find(s => s.bloquee !== true);
    if (!week) return;

    const [snapM, snapA, snapQC, snapStock] = await Promise.all([
      db.ref("membres/" + membreId).once("value"),
      db.ref("actions/" + week.id).once("value"),
      db.ref("quotas_categorie/" + membreId).once("value"),
      db.ref("stock").once("value")
    ]);
    const membre = snapM.val();
    if (!membre) return;
    const actionsMembre = entries(snapA.val()).map(([, a]) => a).filter(a => a.membre_id === membreId && a.resultat === "Réussite");

    const quotaGlobal = Number(membre.quota) || 0;
    if (quotaGlobal > 0) {
      const fait = actionsMembre.filter(a => !a.produit_drogue_id).reduce((acc, a) => acc + Number(a.quantite || 1), 0);
      if (fait >= quotaGlobal) {
        const alertRef = db.ref(`semaines/${week.id}/quota_alertes/${membreId}/global`);
        if (!(await alertRef.once("value")).val()) {
          await alertRef.set(true);
          await envoyerWebhookQuota(`🎯 **${membre.prenom}** a atteint son quota global (${fait}/${quotaGlobal}) — ${week.nom}`);
        }
      }
    }

    const quotasCat = snapQC.val() || {};
    const stock = snapStock.val() || {};
    for (const [catId, q] of Object.entries(quotasCat)) {
      const quota = Number(q) || 0;
      if (quota <= 0) continue;
      const cat = stock[catId];
      if (!cat) continue;
      const produitIds = new Set(Object.keys(cat.produits || {}));
      const fait = actionsMembre.filter(a => produitIds.has(a.produit_drogue_id)).reduce((acc, a) => acc + Number(a.quantite || 1), 0);
      if (fait >= quota) {
        const alertRef = db.ref(`semaines/${week.id}/quota_alertes/${membreId}/${catId}`);
        if (!(await alertRef.once("value")).val()) {
          await alertRef.set(true);
          await envoyerWebhookQuota(`🎯 **${membre.prenom}** a atteint son quota ${cat.nom} (${fait}/${quota}) — ${week.nom}`);
        }
      }
    }
  } catch (e) { console.error("verifierQuotaEtAlerter", e); }
}

/* ============================================================
   BADGES & RECORDS
   stats_membres/{id} = { total_actions, semaines_gagnees, streak_actuel, badges:{badgeId:timestamp} }
   Mis à jour à chaque verrouillage de semaine (auto ou manuel).
   ============================================================ */
const BADGES_DEFS = [
  { id: "actions_50",  seuil: 50,  type: "total_actions", label: "🔧 50 actions" },
  { id: "actions_100", seuil: 100, type: "total_actions", label: "💯 100 actions" },
  { id: "actions_250", seuil: 250, type: "total_actions", label: "⚡ 250 actions" },
  { id: "actions_500", seuil: 500, type: "total_actions", label: "🏭 500 actions" },
  { id: "streak_2",    seuil: 2,   type: "streak",        label: "🔥 2 semaines de suite en tête" },
  { id: "streak_3",    seuil: 3,   type: "streak",        label: "🔥🔥 3 semaines de suite en tête" },
  { id: "streak_5",    seuil: 5,   type: "streak",        label: "👑 5 semaines de suite en tête" }
];
async function majStatsEtBadges(weekId) {
  try {
    const snapA = await db.ref("actions/" + weekId).once("value");
    const actions = entries(snapA.val()).map(([, a]) => a).filter(a => a.resultat === "Réussite");
    if (!actions.length) return;

    const parMembre = {};
    actions.forEach(a => {
      if (!parMembre[a.membre_id]) parMembre[a.membre_id] = { count: 0, prenom: a.prenom_membre };
      parMembre[a.membre_id].count += Number(a.quantite || 1);
    });
    const classement = Object.entries(parMembre).sort((a, b) => b[1].count - a[1].count);
    const gagnantId = classement[0][0];

    const cfgSnap = await db.ref("config/dernier_gagnant_semaine").once("value");
    const dernierGagnant = cfgSnap.val();
    const webhookSnap = await db.ref("config/discord_webhook_quota").once("value");
    const webhook = webhookSnap.val();

    for (const [membreId, data] of classement) {
      const statsRef = db.ref("stats_membres/" + membreId);
      const stats = (await statsRef.once("value")).val() || { total_actions: 0, semaines_gagnees: 0, streak_actuel: 0, badges: {} };
      stats.badges = stats.badges || {};
      stats.total_actions = (stats.total_actions || 0) + data.count;

      if (membreId === gagnantId) {
        stats.semaines_gagnees = (stats.semaines_gagnees || 0) + 1;
        stats.streak_actuel = (dernierGagnant === gagnantId) ? (stats.streak_actuel || 0) + 1 : 1;
      } else if (dernierGagnant === membreId) {
        stats.streak_actuel = 0;
      }

      const nouveaux = BADGES_DEFS.filter(b => {
        const valeur = b.type === "total_actions" ? stats.total_actions : (membreId === gagnantId ? stats.streak_actuel : -1);
        return valeur >= b.seuil && !stats.badges[b.id];
      });
      nouveaux.forEach(b => { stats.badges[b.id] = Date.now(); });

      await statsRef.set(stats);

      if (nouveaux.length && webhook) {
        for (const b of nouveaux) {
          try { await fetch(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: `🏅 **${data.prenom}** a débloqué le badge : ${b.label} !` }) }); }
          catch (e) {}
        }
      }
    }
    await db.ref("config/dernier_gagnant_semaine").set(gagnantId);
  } catch (e) { console.error("majStatsEtBadges", e); }
}

/* ============================================================
   JOURNAL D'AUDIT — qui a fait quoi
   audit/{id} = { action, details, membre, membre_id, createdAt }
   ============================================================ */
async function logAudit(action, details) {
  try {
    const s = getSession();
    await db.ref("audit/" + uid()).set({
      action, details: details || "",
      membre: s ? (s.prenom + (s.nom ? " " + s.nom : "")) : "?",
      membre_id: s ? s.id : null,
      createdAt: Date.now()
    });
  } catch (e) { console.error("logAudit", e); }
}

/* ============================================================
   RECHERCHE GLOBALE (Ctrl+F) — membres, actions récentes, taxes
   ============================================================ */
function injectGlobalSearch() {
  if (document.getElementById("globalSearchModal")) return;
  const style = document.createElement("style");
  style.textContent = `
    #globalSearchModal{display:none;position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);align-items:flex-start;justify-content:center;padding-top:10vh;}
    #globalSearchBox{background:var(--bg-1);border:1px solid var(--line);border-radius:10px;width:min(600px,90vw);max-height:70vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.6);}
    #globalSearchInput{width:100%;box-sizing:border-box;padding:16px;font-size:16px;background:var(--bg-2);border:none;border-bottom:1px solid var(--line);color:var(--text);outline:none;}
    .gs-eyebrow{padding:8px 14px;font-size:11px;letter-spacing:.1em;color:var(--text-dim);text-transform:uppercase;}
    .gs-row{padding:10px 14px;cursor:pointer;border-radius:6px;margin:0 6px;}
    .gs-row:hover{background:var(--bg-2);}
  `;
  document.head.appendChild(style);
  const modal = document.createElement("div");
  modal.id = "globalSearchModal";
  modal.innerHTML = `<div id="globalSearchBox">
    <input id="globalSearchInput" type="text" placeholder="Rechercher un membre, une action, une taxe… (Échap pour fermer)">
    <div id="globalSearchResults" style="padding:6px;"></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector("#globalSearchInput").addEventListener("input", (e) => runGlobalSearch(e.target.value.trim()));
  modal.addEventListener("click", (e) => { if (e.target === modal) closeGlobalSearch(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modal.style.display !== "none") closeGlobalSearch(); });
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) { e.preventDefault(); openGlobalSearch(); }
  });
}
function openGlobalSearch() {
  const modal = document.getElementById("globalSearchModal");
  if (!modal) return;
  modal.style.display = "flex";
  const input = document.getElementById("globalSearchInput");
  input.value = ""; document.getElementById("globalSearchResults").innerHTML = "";
  setTimeout(() => input.focus(), 30);
}
function closeGlobalSearch() {
  const modal = document.getElementById("globalSearchModal");
  if (modal) modal.style.display = "none";
}
async function runGlobalSearch(q) {
  const results = document.getElementById("globalSearchResults");
  if (!q || q.length < 2) { results.innerHTML = '<p class="muted small" style="padding:10px;">Tape au moins 2 caractères…</p>'; return; }
  results.innerHTML = '<p class="muted small" style="padding:10px;">Recherche…</p>';
  const qLower = q.toLowerCase();
  const [snapM, snapT, snapS] = await Promise.all([
    db.ref("membres").once("value"), db.ref("taxes").once("value"), db.ref("semaines").once("value")
  ]);
  const membres = entries(snapM.val()).map(([id, m]) => ({ id, ...m }))
    .filter(m => (m.prenom + " " + (m.nom || "")).toLowerCase().includes(qLower));
  const taxes = entries(snapT.val()).map(([id, t]) => ({ id, ...t }))
    .filter(t => (t.groupe || "").toLowerCase().includes(qLower) || (t.code || "").toLowerCase().includes(qLower));
  const semaines = entries(snapS.val()).map(([id, s]) => ({ id, ...s })).sort((a, b) => (b.debut || 0) - (a.debut || 0));

  const actionsMatch = [];
  for (const s of semaines.slice(0, 6)) {
    const snapA = await db.ref("actions/" + s.id).once("value");
    entries(snapA.val()).forEach(([id, a]) => {
      if ((a.prenom_membre || "").toLowerCase().includes(qLower) || (a.action || "").toLowerCase().includes(qLower)) {
        actionsMatch.push({ id, semaineNom: s.nom, ...a });
      }
    });
    if (actionsMatch.length > 15) break;
  }

  const root = pathToRoot() + "pages/";
  let html = "";
  if (membres.length) html += `<div class="gs-eyebrow">Membres</div>` + membres.slice(0, 8)
    .map(m => `<div class="gs-row" onclick="location.href='${root}admin.html'">👤 ${m.prenom} ${m.nom || ""} <span class="small muted">— ${m.grade || ""}</span></div>`).join("");
  if (actionsMatch.length) html += `<div class="gs-eyebrow">Actions</div>` + actionsMatch.slice(0, 8)
    .map(a => `<div class="gs-row" onclick="location.href='${root}tracker.html'">📋 ${a.prenom_membre} — ${a.action} <span class="small muted">(${a.semaineNom})</span></div>`).join("");
  if (taxes.length) html += `<div class="gs-eyebrow">Taxes</div>` + taxes.slice(0, 8)
    .map(t => `<div class="gs-row" onclick="location.href='${root}taxes.html'">🧾 ${t.groupe} <span class="small muted">— ${formatMoney(t.montant)}</span></div>`).join("");
  results.innerHTML = html || '<p class="muted small" style="padding:10px;">Aucun résultat.</p>';
}
