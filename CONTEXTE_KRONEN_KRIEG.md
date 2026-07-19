# ⚔️ KRONEN KRIEG — Contexte complet du projet (à jour)

## INFORMATIONS GÉNÉRALES
- **Nom du groupe** : Kronen Krieg
- **Devise** : Honneur · Loyauté · Silence
- **Type** : Faction FiveM / GTA RP, Los Santos
- **Base** : dérivé du site Volta (même stack, même structure)
- **Admin** : créé via setup.html (prénom/nom/grade/mdp au choix, id = prenom_nom en minuscule)

## STACK TECHNIQUE
- Frontend : HTML/CSS/JS vanilla — GitHub Pages (statique)
- Base de données : Firebase Realtime Database (région europe-west1), **projet Firebase dédié** (nouveau, séparé de Volta)

## FIREBASE CONFIG (js/firebase-config.js)
```javascript
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
```
- Auth anonyme activée (obligatoire — les rules exigent `auth != null`)
- Rules Realtime Database :
```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

## PALETTE — thème allemand
- `--steel` (rouge) : `#d00000`
- `--gold` (or) : `#ffce00`
- Fond : noir quasi pur (`--bg-0` `#050505` → `--bg-3` `#1c1c1c`)
- `--line` : liseré doré translucide

## DIFFÉRENCES VS VOLTA (base d'origine)
1. **Armurerie supprimée** : page `pages/armurerie.html` retirée, entrée retirée de `NAV_ITEMS` (js/app.js) et `PAGES_DISPO` (js/firebase-config.js). Dans `pages/tracker.html`, la logique "équipe" (participants multiples) ne reconnaît plus que l'action **Fleeca** (plus "Armurerie").
2. **Logo / fond** : `img/logo.png` et `img/background.png` = même image (flag allemand + texte "FA / FlashBack FA" fournie par l'utilisateur — à changer si un vrai logo Kronen Krieg est fourni plus tard).
3. **setup.html généralisé** : ne crée plus un membre fixe "Tony Diaz" — formulaire Prénom/Nom/Grade/Mot de passe, id membre = `prenom_nom` slugifié, protection admin dans `admin.html` basée sur `role === 'admin'` (plus sur un id fixe).
4. **Système de semaines automatique** (nouveau, absent de Volta) — voir section dédiée ci-dessous.
5. **Transactions** : champ "Groupe" rendu optionnel (plus de blocage si vide, affiche "-" dans le tableau et dans la description de la transaction).
6. **Paye** : type d'argent par défaut sur **Propre** (au lieu de Sale) — montant suggéré/affiché déjà réduit du taux de blanchiment.
7. **Taxes** : "Type de taxe" renommé en **"Zone de taxe"** (UI uniquement, le nœud Firebase reste `types_taxes`). Champ "Notes" retiré, remplacé par un champ **"Code à donner"** (`code`) saisi manuellement par le membre (auto-généré en secours si laissé vide) — affiché dans l'historique, à donner au groupe payé. Chaque taxe a `expireAt` = `createdAt` + 7 jours ; l'historique affiche date/heure de paiement, date/heure d'expiration et un badge Active/Expirée.

## STRUCTURE DU SITE
kronen-krieg-site/
├── index.html          ← Connexion — "KRONEN KRIEG", devise, trim() mdp, "Mot de passe oublié ?"
├── setup.html           ← Init unique : crée l'admin (formulaire libre) + 1ère semaine auto
├── css/style.css        ← Thème rouge/or/noir allemand
├── img/background.png + logo.png
├── js/app.js             ← Sidebar "KRONEN KRIEG", NAV_ITEMS, système de semaines auto
├── js/firebase-config.js ← Config Firebase, PAGES_DISPO (sans armurerie), session, permissions
└── pages/
    ├── dashboard.html, tracker.html, labo.html, stock.html
    ├── quotas.html, stats.html, blanchiment.html, paye.html
    ├── transactions.html, taxes.html, admin.html, profil.html

Pages absentes/non liées : objectifs, sanctions, armurerie, logs, tv, consommation.

## AUTH
- Firebase Anonymous Authentication activé
- **Toute page qui lit/écrit dans Firebase doit `await authReady;` avant** (bug déjà rencontré dans setup.html : écriture avant fin de connexion anonyme → `PERMISSION_DENIED`)
- Login (index.html) : après vérif mot_de_passe + actif, `signInAnonymously()` puis écrit `sessions/{uid} = membreId`
- Rules Firebase conditionnent write sur `auth != null`

## FIREBASE — NŒUDS CLÉS
- `sessions/{uid}` : membreId lié à la session Firebase Auth anonyme
- `membres/{id}` : prenom, nom, grade, mot_de_passe, actif, role, quota
- `grades/{id}` : nom, ordre
- `visibilite_grades/{gradeNom}/{page}` : true/false — page ∈ {quotas, stats, paye, tracker, labo}
- `actions/{semaineId}/{id}` : produit_drogue_id (présent si cat_variable), participants_ids/noms (Fleeca uniquement — Armurerie retirée)
- `stock/{catId}/produits/{id}` : nom, prix, stock, seuil, recipe (optionnel Labo)
- `labo_stock/{membreId}/{produitId}` : stock PERSONNEL produits finis
- `labo_stock_commun/{produitId}` : stock COMMUN ingrédients
- `events_drogue/{id}` : debut, fin (timestamps), taux (% drogue), taux_actions (% actions), nom
- `reset_requests/{membreId}` : demandes mot de passe oublié
- `transactions/{id}` : inclut membre_id, prenom_membre
- `config` : blanchiment_taux (35), taux_paye_drogue (20), taux_paye_autres (45), discord_webhook_semaine
- `semaines/{id}` : nom, bloquee, createdAt, **debut, fin, verrouAt, auto, closedAt, resume** (nouveaux champs)
- `semaine_index/{debutTimestamp}` : id de la semaine correspondante — sert de verrou anti-doublon pour la création auto

## SYSTÈME DE SEMAINES AUTOMATIQUE (nouveau vs Volta)
Fonctions dans `js/app.js`, appelées via `ensureSemaineAuto()` à chaque `initShell()` (donc à chaque chargement de page protégée) :
- **Semaine** = lundi 00:00 → dimanche 23:59:59 (heure du navigateur)
- **Nom auto** : `Semaine du JJ/MM au JJ/MM`
- **Verrouillage auto** : dès qu'un membre charge une page après dimanche 19h00, la semaine active est verrouillée automatiquement (`verrouillerSemaineAuto`), un résumé est généré et stocké dans `semaines/{id}/resume`, envoyé au webhook Discord (`config/discord_webhook_semaine`) si configuré
- **Création auto** : si aucune semaine n'existe pour la période courante, elle est créée automatiquement
- **Anti-doublon** : verrouillage via `transaction()` sur `semaines/{id}/bloquee` (un seul client exécute le lock) et sur `semaine_index/{debut}` (un seul client crée la semaine) — robuste si plusieurs membres connectés en même temps
- **Admin → Semaines** : la création manuelle (`creerSemaine()` dans admin.html) calcule aussi les bornes de la semaine en cours pour s'intégrer au système auto (évite les doublons). Tableau des semaines affiche désormais la colonne "Verrouillage auto"
- Pas de vrai cron côté serveur (site statique) : le déclenchement dépend qu'un membre ouvre une page après l'heure de verrouillage. Si personne ne se connecte le dimanche soir, le verrouillage se fait au premier chargement suivant.

## QUOTAS
- Global : filtre `!a.produit_drogue_id` (exclut drogue ET labo)
- Par catégorie variable : généré automatiquement
- Logique dupliquée dans `quotas.html` ET `admin.html` onglet Quotas

## TRACKER
- Labo exclu de la liste d'actions
- **Fleeca uniquement** : équipe sans minimum, coéquipiers sans action comptée (Armurerie retirée de cette logique)
- Historique : sélecteur 10/30/50/Tout
- Bannière event animée si event actif selon l'action sélectionnée

## LABO
- Bootstrap auto (crée stock/labo_cat + action "Labo" si absents)
- Ingrédients → stock COMMUN ; Produits finis → stock PERSO
- Catalogue gérable dans Admin → Stock catégorie Labo
- Page Stock connectée à labo_stock_commun

## PAYE
- **Propre par défaut** (select pré-sélectionné sur "Propre", montant affiché déjà réduit de -blanchiment_taux%). Sale reste sélectionnable manuellement.
- Montant calculé (lecture seule), paiement à 0 autorisé
- Events : taux drogue et/ou actions appliqués par action selon createdAt
- Fleeca : gains divisés entre participants
- Gains arrondis (Math.round)

## BLANCHIMENT
- Bouton Annuler (admin) : supprime + rollback argent

## EVENTS
- Admin → Config → "🎯 Events — Taux spéciaux"
- Bannière animée sur Dashboard et Tracker
- Paye applique le bon taux selon createdAt de chaque action

## MOT DE PASSE OUBLIÉ
- Login → reset_requests / Admin → Membres → panneau 🔔

## ADMIN
- Onglets : Semaines / Membres / Stock / Actions / Quotas / Grades / Visibilité / Permissions / Config
- Visibilité : matrice grade × page (distinct de Permissions)
- Protection suppression membre : basée sur `role === 'admin'` (pas un id fixe)

## POINTS D'ATTENTION
1. Toujours trier en JS, pas via Firebase orderByChild
2. Règles Firebase mode test expirent à 30 jours — celles posées ici (`auth != null`) sont permanentes, pas de date d'expiration
3. Solde = cumul depuis le début, pas par semaine
4. Après git push : 60s + Ctrl+F5
5. Quota → modifier dans quotas.html ET admin.html
6. **Toute nouvelle page/script Firebase doit faire `await authReady;` avant lecture/écriture** (sinon PERMISSION_DENIED) **ET inclure le script `firebase-auth-compat.js`** (sinon `firebase.auth is not a function`) — bug rencontré dans setup.html, corrigé
7. Fichiers modifiés ici ne sont pas auto dans le repo — télécharger et remplacer manuellement (ou git add/commit/push)
