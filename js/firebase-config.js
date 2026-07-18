/* ============================================================
   KRONEN KRIEG — firebase-config.js
   Config Firebase + session + permissions.

   ⚠️ A REMPLIR : créez votre propre projet Firebase (gratuit) sur
   https://console.firebase.google.com puis collez sa config ci-dessous.
   Realtime Database > Règles : démarrez en mode test, puis restreignez.
   ============================================================ */

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAzHiYENatVYTFuveq1ttjyIrRC_ddY-JU",
  authDomain: "kronen-krieg.firebaseapp.com",
  databaseURL: "https://kronen-krieg-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kronen-krieg",
  storageBucket: "kronen-krieg.firebasestorage.app",
  messagingSenderId: "401065875632",
  appId: "1:401065875632:web:b745d42daa6cd98eff4375",
  measurementId: "G-EE0990WKW5"
};

const NOM_GROUPE = "Kronen Krieg";

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.database();

const authReady = new Promise(resolve => {
  firebase.auth().onAuthStateChanged(user => {
    if (user) resolve(user);
    else firebase.auth().signInAnonymously().then(cred => resolve(cred.user));
  });
});

/* ---------- liste des pages de l'app (utilisée par admin + permissions) ---------- */
const PAGES_DISPO = [
  { page: "dashboard",     label: "Dashboard" },
  { page: "tracker",       label: "Tracker" },
  { page: "stats",         label: "Stats" },
  { page: "stock",         label: "Stock" },
  { page: "quotas",        label: "Quotas" },
  { page: "blanchiment",   label: "Blanchiment" },
  { page: "paye",          label: "Paye" },
  { page: "transactions",  label: "Transactions" },
  { page: "taxes",         label: "Taxes" },
  { page: "admin",         label: "Admin" },
  { page: "profil",        label: "Profil" }
];

/* ---------- SESSION ---------- */
function getSession() {
  try { return JSON.parse(localStorage.getItem("kn_session") || "null"); }
  catch (e) { return null; }
}
function setSession(membre) {
  localStorage.setItem("kn_session", JSON.stringify(membre));
}
function clearSession() {
  localStorage.removeItem("kn_session");
}
function logout() {
  clearSession();
  window.location.href = pathToRoot() + "index.html";
}
/* calcule le chemin relatif vers la racine selon qu'on est dans /pages/ ou pas */
function pathToRoot() {
  return window.location.pathname.includes("/pages/") ? "../" : "";
}
/* à appeler en haut de chaque page protégée (sauf index/setup) */
function requireSession() {
  const s = getSession();
  if (!s) {
    window.location.href = pathToRoot() + "index.html";
    return null;
  }
  return s;
}

/* ---------- PERMISSIONS ----------
   Stockées dans Firebase sous permissions/{grade}/{page} = true/false
   Le Fondateur (role === 'admin') a toujours accès à tout, même si rien
   n'est configuré — pour ne jamais se retrouver bloqué hors de l'admin. */
let _permsCache = null;
async function loadPermissions() {
  if (_permsCache) return _permsCache;
  const snap = await db.ref("permissions").once("value");
  _permsCache = snap.val() || {};
  return _permsCache;
}
async function canAccess(membre, page) {
  if (!membre) return false;
  if (membre.role === "admin") return true;
  const perms = await loadPermissions();
  const gradePerms = perms[membre.grade] || {};
  return gradePerms[page] === true;
}

/* ---------- UTILITAIRES ---------- */
function formatMoney(n) {
  n = Number(n) || 0;
  return n.toLocaleString("fr-FR") + " $";
}
function formatDate(d) {
  if (!d) return "-";
  try {
    const dt = new Date(d);
    return dt.toLocaleDateString("fr-FR");
  } catch (e) { return d; }
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function nowHHMM() {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
/* IMPORTANT : ne jamais utiliser snap.forEach seul (bug si pas d'index) —
   toujours repasser par Object.entries(snap.val() || {}) */
function entries(val) {
  return Object.entries(val || {});
}
function toast(msg, isErr) {
  let wrap = document.querySelector(".toast-wrap");
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.className = "toast-wrap";
    document.body.appendChild(wrap);
  }
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}
