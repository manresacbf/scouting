/* ═══════════════════════════════════════════════════════════════════
   Scouting MCBF — lògica de l'app
   ═══════════════════════════════════════════════════════════════════
   Tres idees que expliquen la resta del fitxer:

   1) Tota escriptura va primer a una cua local (localStorage) i la UI
      confirma a l'instant. L'enviament al full ve després, quan es pot.
      Dins el pavelló sovint no hi ha cobertura.
   2) Cada operació porta un UUID generat aquí. El full fa "upsert" per
      aquest id, així reenviar una operació no duplica mai cap fila.
   3) Una observació no substitueix mai l'anterior: cada visita és una
      fila nova. L'historial és el valor de l'app.                      */

'use strict';

/* ─────────────────────────────────────────────────────────────────────
   1. MODEL
   ───────────────────────────────────────────────────────────────────── */

const AREES = [
  { k: 'tecnica',     nom: 'Tècnica individual' },
  { k: 'tir',         nom: 'Tir' },
  { k: 'un_x_un',     nom: '1x1' },
  { k: 'passada',     nom: 'Passada i lectura del joc' },
  { k: 'defensa',     nom: 'Defensa' },
  { k: 'rebot',       nom: 'Rebot' },
  { k: 'velocitat',   nom: 'Velocitat / capacitat física' },
  { k: 'intensitat',  nom: 'Intensitat i actitud' },
  { k: 'comprensio',  nom: 'Comprensió del joc' },
  { k: 'potencial',   nom: 'Potencial físic' }
];

const ESCALA = [
  ['5', 'nivell de dos anys per sobre de la seva categoria'],
  ['4', 'de les millors de la categoria'],
  ['3', 'mitjana de la categoria'],
  ['2', 'per sota de la mitjana'],
  ['1', 'limitació important']
];

const CONDUCTES = [
  'Reacciona bé a l\'error',
  'Es queixa als àrbitres',
  'Anima des de la banqueta',
  'Accepta la correcció de l\'entrenadora',
  'Baixa els braços quan van perdent',
  'Organitza les companyes',
  'Busca la pilota en moments decisius'
];

const PERFILS = ['Directa', 'Analítica', 'Sociable', 'Estable', 'No n\'hi ha prou informació'];
const NIVELLS = ['Alt', 'Mitjà', 'Baix'];
const NIVELLS_DESP = ['Baix', 'Mitjà', 'Alt'];
const PRIORITATS = ['A', 'B', 'C'];
const ESTATS = ['Vista', 'A seguir', 'Contactada', 'Descartada'];
const POSICIONS_DEF = ['Base', 'Escorta', 'Aler', 'Ala-pivot', 'Pivot'];
const CATEGORIES_DEF = ['Mini', 'Preinfantil', 'Infantil', 'Cadet', 'Júnior', 'Sènior'];

const CLAUS = {
  sessio: 'scouting.sessio',
  dades: 'scouting.dades',
  pendents: 'scouting.pendents'
};

/* ─────────────────────────────────────────────────────────────────────
   2. ESTAT
   ───────────────────────────────────────────────────────────────────── */

let sessio = { pin: '', responsable: '' };
let D = { config: {}, jugadores: [], captacio: {}, observacions: {}, senior: [], rol: '', ts: '' };
let pendents = [];
let sincronitzant = false;
let filtres = { text: '', any: '', posicio: '', prioritat: '', estat: '' };

/* ─────────────────────────────────────────────────────────────────────
   3. UTILITATS
   ───────────────────────────────────────────────────────────────────── */

const $ = (sel, dins) => (dins || document).querySelector(sel);
const $$ = (sel, dins) => Array.prototype.slice.call((dins || document).querySelectorAll(sel));

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

/** Sense accents i en minúscules: per cercar i per detectar duplicats. */
function normalitza(t) {
  return String(t || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

function formatData(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return String(iso).slice(0, 10);
  return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + d.getFullYear();
}

/** Mitjana d'un objecte de valoracions {area: 1..5}. null si no n'hi ha cap. */
function mitjana(obj) {
  const v = Object.keys(obj || {}).map((k) => Number(obj[k])).filter((n) => n >= 1 && n <= 5);
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

function unDecimal(n) {
  return n === null || n === undefined ? '—' : n.toFixed(1).replace('.', ',');
}

function llegeix(clau, defecte) {
  try {
    const v = localStorage.getItem(clau);
    return v ? JSON.parse(v) : defecte;
  } catch (err) { return defecte; }
}

function guarda(clau, valor) {
  try { localStorage.setItem(clau, JSON.stringify(valor)); } catch (err) { /* quota plena */ }
}

let idToast;
function avisa(text, dolent) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('ko', !!dolent);
  t.classList.remove('amagat', 'fora');
  clearTimeout(idToast);
  idToast = setTimeout(() => {
    t.classList.add('fora');
    setTimeout(() => t.classList.add('amagat'), 250);
  }, dolent ? 5200 : 2600);
}

function config(clau, defecte) {
  const v = (D.config || {})[clau];
  return (v && v.length) ? v : defecte;
}

/* ─────────────────────────────────────────────────────────────────────
   4. CONNEXIÓ AMB EL FULL
   ───────────────────────────────────────────────────────────────────── *
   El web app d'Apps Script falla de tant en tant amb peticions seguides,
   per això cada crida es reintenta amb una espera creixent. Les
   escriptures són idempotents (upsert per id), així que reintentar-les
   no pot duplicar res.                                                  */

const ESPERES = [1000, 2500, 5000, 8000];
const TEMPS_MAX = 25000;     // Apps Script pot trigar 10 s o mes a despertar-se
const LIMIT_TOTAL = 60000;   // sostre: ningu s'espera mes que aixo mirant la pantalla

async function api(action, extra, intents) {
  if (!CONFIG.API_URL) throw new Error('Falta configurar API_URL');
  intents = intents || 2;
  const cos = Object.assign({ action: action, pin: sessio.pin }, extra || {});
  const INICI = Date.now();
  let ultim;

  for (let i = 0; i < intents; i++) {
    const ctrl = new AbortController();
    const rellotge = setTimeout(() => ctrl.abort(), TEMPS_MAX);
    try {
      const res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        // text/plain evita el preflight CORS, que Apps Script no respon.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(cos),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const dades = await res.json();
      if (dades && dades.ok === false && dades.error === 'PIN') {
        tancaSessio('El PIN ja no és correcte. Torna a entrar.');
        throw new Error('PIN');
      }
      return dades;
    } catch (err) {
      ultim = err;
      if (String(err && err.message) === 'PIN') throw err;
      // Prou de reintentar si ja hem cremat el pressupost de temps.
      if (i >= intents - 1 || Date.now() - INICI > LIMIT_TOTAL) break;
      await new Promise((r) => setTimeout(r, ESPERES[Math.min(i, ESPERES.length - 1)]));
    } finally {
      clearTimeout(rellotge);
    }
  }
  throw ultim || new Error('Sense connexió');
}

/* ─────────────────────────────────────────────────────────────────────
   5. MAGATZEM LOCAL
   ───────────────────────────────────────────────────────────────────── */

function guardaDades() { guarda(CLAUS.dades, D); }
function guardaPendents() { guarda(CLAUS.pendents, pendents); }

function jugadora(id) {
  return D.jugadores.filter((j) => j.id === id)[0] || null;
}

function observacionsDe(id) {
  return (D.observacions[id] || []).slice().sort((a, b) => String(b.data).localeCompare(String(a.data)));
}

function captacioDe(id) {
  return D.captacio[id] || { id_jugadora: id, prioritat: '', estat: '', contacte: '', propera_accio: '', data_propera_accio: '' };
}

/** Aplica una escriptura al magatzem local, abans de tocar la xarxa. */
function aplicaLocal(action, p) {
  if (action === 'saveJugadora') {
    const i = D.jugadores.findIndex((j) => j.id === p.id);
    if (i === -1) D.jugadores.push(p); else D.jugadores[i] = Object.assign({}, D.jugadores[i], p);
  } else if (action === 'saveObservacio') {
    const llista = D.observacions[p.id_jugadora] || (D.observacions[p.id_jugadora] = []);
    const i = llista.findIndex((o) => o.id === p.id);
    if (i === -1) llista.push(p); else llista[i] = p;
  } else if (action === 'saveCaptacio') {
    D.captacio[p.id_jugadora] = p;
  } else if (action === 'saveSenior') {
    const i = (D.senior || []).findIndex((j) => j.id === p.id);
    if (i === -1) D.senior.push(p); else D.senior[i] = p;
  }
  guardaDades();
}

/** Encua una escriptura: local primer, xarxa després. */
function encua(action, payload) {
  pendents.push({ opId: uuid(), action: action, payload: payload, ts: new Date().toISOString(), errades: 0, ultimError: '' });
  guardaPendents();
  aplicaLocal(action, payload);
  pintaSync();
  sincronitza();
}

/* ─────────────────────────────────────────────────────────────────────
   6. SINCRONITZACIÓ
   ───────────────────────────────────────────────────────────────────── */

function pintaSync() {
  const pastilla = $('#estat-sync');
  const text = $('#estat-sync-text');
  if (!pastilla) return;
  const n = pendents.length;
  pastilla.classList.toggle('pendent', n > 0);
  pastilla.classList.toggle('treballant', sincronitzant);
  if (sincronitzant) text.textContent = 'Sincronitzant…';
  else if (!n) text.textContent = 'Sincronitzat';
  else text.textContent = n === 1 ? '1 canvi pendent' : n + ' canvis pendents';
}

async function sincronitza(manual) {
  if (sincronitzant) return;
  if (!pendents.length) { if (manual) refrescaBootstrap(true); return; }
  if (!navigator.onLine && !manual) return;

  sincronitzant = true;
  pintaSync();
  try {
    const res = await api('sync', {
      operacions: pendents.map((o) => ({ opId: o.opId, action: o.action, payload: o.payload }))
    });
    if (!res || !res.ok) throw new Error((res && res.error) || 'El full no ha contestat bé');

    const resultats = (res.data && res.data.resultats) || [];
    const perId = {};
    resultats.forEach((r) => { perId[r.opId] = r; });

    pendents = pendents.filter((o) => {
      const r = perId[o.opId];
      if (!r) return true;                 // no l'ha processat: la mantenim
      if (r.ok) return false;              // desada: fora de la cua
      o.errades++;                         // el full l'ha rebutjat
      o.ultimError = r.error || '';
      return true;
    });
    guardaPendents();

    if (!pendents.length) {
      if (manual) avisa('Tot sincronitzat');
    } else if (pendents.some((o) => o.errades > 0)) {
      avisa('Hi ha canvis que el full no accepta. Mira-ho al llistat.', true);
    }
    await refrescaBootstrap(true);
  } catch (err) {
    if (manual) avisa('No s\'ha pogut connectar amb el full. Els canvis queden desats al mòbil.', true);
  } finally {
    sincronitzant = false;
    pintaSync();
    if (rutaActual().vista === 'llista') pintaLlista();
  }
}

/** Fusiona la veritat del full amb el que encara tenim pendent d'enviar. */
function refrescaLocal(data) {
  const idsPendents = {};
  pendents.forEach((o) => {
    if (o.action === 'saveJugadora') idsPendents['j:' + o.payload.id] = true;
    if (o.action === 'saveCaptacio') idsPendents['c:' + o.payload.id_jugadora] = true;
    if (o.action === 'saveSenior') idsPendents['s:' + o.payload.id] = true;
  });

  const serverJ = data.jugadores || [];
  const idsServidor = {};
  serverJ.forEach((j) => { idsServidor[j.id] = true; });
  // Les fitxes creades al pavelló que encara no han pujat no es poden perdre.
  const localsNomes = D.jugadores.filter((j) => !idsServidor[j.id] && idsPendents['j:' + j.id]);
  D.jugadores = serverJ.concat(localsNomes);

  const cap = {};
  (data.captacio || []).forEach((c) => { cap[c.id_jugadora] = c; });
  Object.keys(D.captacio).forEach((id) => {
    if (!cap[id] && idsPendents['c:' + id]) cap[id] = D.captacio[id];
  });
  D.captacio = cap;

  if (data.config) D.config = data.config;
  if (data.rol !== undefined) D.rol = data.rol;

  // Igual que amb les fitxes: una jugadora sènior entrada al pavelló i encara
  // no pujada no es pot perdre quan arriba la llista del full.
  const idsSenior = {};
  (data.senior || []).forEach((j) => { idsSenior[j.id] = true; });
  const seniorLocals = (D.senior || []).filter((j) => !idsSenior[j.id] && idsPendents['s:' + j.id]);
  D.senior = (data.senior || []).concat(seniorLocals);

  D.ts = data.ts || new Date().toISOString();
  guardaDades();
}

async function refrescaBootstrap(silenci) {
  try {
    const res = await api('bootstrap', {}, 1);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Error');
    refrescaLocal(res.data);
    const r = rutaActual();
    if (r.vista === 'llista') pintaLlista();
    return true;
  } catch (err) {
    if (!silenci) avisa('No s\'han pogut refrescar les dades', true);
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────────────
   7. ENTRADA (PIN)
   ───────────────────────────────────────────────────────────────────── */

function omplsResponsables() {
  const sel = $('#responsable');
  const llista = config('responsables', []);
  sel.innerHTML = '<option value="">Selecciona el responsable…</option>' +
    llista.map((r) => '<option value="' + esc(r) + '"' + (r === sessio.responsable ? ' selected' : '') + '>' + esc(r) + '</option>').join('');
  sel.parentNode.classList.toggle('amagat', !llista.length);
}

function mostraPin(missatge) {
  $('#vista-app').classList.add('amagat');
  $('#vista-pin').classList.remove('amagat');
  $('#pin-error').textContent = missatge || '';
  omplsResponsables();
  const hiHaPin = !!sessio.pin;
  $('#pin').classList.toggle('amagat', hiHaPin);
  $('#pin-entra').textContent = hiHaPin ? 'Continuar' : 'Entrar';
}

function tancaSessio(missatge) {
  sessio.pin = '';
  guarda(CLAUS.sessio, sessio);
  mostraPin(missatge);
}

async function entraAmbPin(ev) {
  ev.preventDefault();
  const boto = $('#pin-entra');
  const err = $('#pin-error');
  const pin = sessio.pin || $('#pin').value.trim();
  const resp = $('#responsable').value;

  if (!sessio.pin && !/^\d{4,6}$/.test(pin)) { err.textContent = 'El PIN són 4 dígits.'; return; }

  boto.disabled = true;
  boto.textContent = 'Comprovant…';
  err.textContent = '';
  sessio.pin = pin;

  try {
    const res = await api('bootstrap', {}, 5);
    if (!res || !res.ok) throw new Error((res && res.error) || 'Error');
    refrescaLocal(res.data);

    // El codi de direcció esportiva ja diu qui és: no té sentit demanar-l'hi.
    if (esDirector()) {
      sessio.responsable = RESPONSABLE_DIRECTOR;
      guarda(CLAUS.sessio, sessio);
      obreApp();
      return;
    }

    const responsables = config('responsables', []);
    if (!resp || responsables.indexOf(resp) === -1) {
      // PIN correcte però encara no sabem qui és: segon pas, ja amb la
      // llista de responsables baixada del full.
      guarda(CLAUS.sessio, { pin: pin, responsable: '' });
      mostraPin('Tria qui ets per continuar.');
      return;
    }
    sessio.responsable = resp;
    guarda(CLAUS.sessio, sessio);
    obreApp();
  } catch (e) {
    sessio.pin = '';
    if (String(e && e.message) === 'PIN') err.textContent = 'PIN incorrecte.';
    else if (!navigator.onLine) err.textContent = 'Cal cobertura per entrar el primer cop.';
    else err.textContent = 'El full de Google no ha contestat (' +
      String(e && e.message ? e.message : e) + '). Ho fa de tant en tant: torna a premer Entrar.';
  } finally {
    boto.disabled = false;
    boto.textContent = sessio.pin ? 'Continuar' : 'Entrar';
  }
}

function obreApp() {
  $('#vista-pin').classList.add('amagat');
  $('#vista-app').classList.remove('amagat');
  pintaSync();
  if (!location.hash) location.replace('#/llista');
  ruta();
  sincronitza();
  refrescaBootstrap(true);
}

/* ─────────────────────────────────────────────────────────────────────
   8. NAVEGACIÓ
   ───────────────────────────────────────────────────────────────────── */

function rutaActual() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { vista: parts[0] || 'llista', id: parts[1] || '' };
}

function ves(hash) { location.hash = hash; }

function ruta() {
  if (!sessio.pin || !sessio.responsable) { mostraPin(); return; }
  const r = rutaActual();
  const enrere = $('#enrere');
  const fab = $('#fab');

  if (r.vista === 'jugadora' && jugadora(r.id)) {
    enrere.classList.remove('amagat');
    fab.classList.remove('amagat');
    fab.textContent = '+ Nova observació';
    fab.onclick = () => ves('#/observacio/' + r.id);
    pintaFitxa(r.id);
  } else if (r.vista === 'observacio' && jugadora(r.id)) {
    enrere.classList.remove('amagat');
    fab.classList.add('amagat');
    pintaFormObservacio(r.id);
  } else if (r.vista === 'nova') {
    enrere.classList.remove('amagat');
    fab.classList.add('amagat');
    pintaFormJugadora();
  } else if (r.vista === 'senior' && esDirector()) {
    enrere.classList.remove('amagat');
    fab.classList.remove('amagat');
    fab.textContent = '+ Nova sènior';
    fab.onclick = () => ves('#/senior-fitxa');
    pintaLlistaSenior();
  } else if (r.vista === 'senior-fitxa' && esDirector()) {
    enrere.classList.remove('amagat');
    fab.classList.add('amagat');
    pintaFormSenior(r.id);
  } else {
    enrere.classList.add('amagat');
    fab.classList.remove('amagat');
    fab.textContent = '+ Nova jugadora';
    fab.onclick = () => ves('#/nova');
    $('#titol').textContent = 'Jugadores';
    pintaLlista();
  }
  pintaBarraBaix(r.vista);
  window.scrollTo(0, 0);
}

/* ─────────────────────────────────────────────────────────────────────
   9. LLISTAT
   ───────────────────────────────────────────────────────────────────── */

function anysDisponibles() {
  const anys = {};
  D.jugadores.forEach((j) => { if (j.any_naixement) anys[j.any_naixement] = true; });
  return Object.keys(anys).sort().reverse();
}

function filtrades() {
  const t = normalitza(filtres.text);
  return D.jugadores.filter((j) => {
    const c = captacioDe(j.id);
    if (t && normalitza(j.nom).indexOf(t) === -1 && normalitza(j.club).indexOf(t) === -1) return false;
    if (filtres.any && String(j.any_naixement) !== String(filtres.any)) return false;
    if (filtres.posicio && j.posicio !== filtres.posicio) return false;
    if (filtres.prioritat && c.prioritat !== filtres.prioritat) return false;
    if (filtres.estat && c.estat !== filtres.estat) return false;
    return true;
  }).sort((a, b) => normalitza(a.nom).localeCompare(normalitza(b.nom)));
}

function filaChips(nom, valors) {
  if (!valors.length) return '';
  return '<div class="fila">' + valors.map((v) =>
    '<button type="button" class="chip" data-filtre="' + nom + '" data-valor="' + esc(v) + '"' +
    ' aria-pressed="' + (String(filtres[nom]) === String(v)) + '">' + esc(v) + '</button>'
  ).join('') + '</div>';
}

function pintaLlista() {
  const cont = $('#contingut');
  const jaHiEs = !!$('#llista-cos');

  if (!jaHiEs) {
    cont.innerHTML =
      '<div class="cerca"><input id="cerca" type="search" placeholder="Cerca per nom o club…" value="' + esc(filtres.text) + '" autocomplete="off"></div>' +
      '<div class="filtres" id="filtres"></div>' +
      '<div id="avisos-cua"></div>' +
      '<p class="compta" id="compta"></p>' +
      '<div id="llista-cos"></div>' +
      '<div class="meta" style="text-align:center;margin-top:18px">' +
        'Sessió: <b>' + esc(sessio.responsable) + '</b>' +
        (esDirector() ? ''
          : ' · <button type="button" class="chip" id="canvia-resp" style="min-height:32px">Canviar</button>') +
      '</div>';


    const cerca = $('#cerca');
    cerca.addEventListener('input', () => { filtres.text = cerca.value; pintaCosLlista(); });
    if ($('#canvia-resp')) $('#canvia-resp').addEventListener('click', () => {
      sessio.responsable = '';
      guarda(CLAUS.sessio, sessio);
      mostraPin('Tria qui ets.');
    });
  }
  pintaFiltres();
  pintaCosLlista();
}

function pintaFiltres() {
  $('#filtres').innerHTML =
    filaChips('posicio', config('posicions', POSICIONS_DEF)) +
    filaChips('any', anysDisponibles()) +
    filaChips('prioritat', PRIORITATS) +
    filaChips('estat', ESTATS);

  $$('#filtres [data-filtre]').forEach((b) => {
    b.addEventListener('click', () => {
      const clau = b.getAttribute('data-filtre');
      const valor = b.getAttribute('data-valor');
      filtres[clau] = String(filtres[clau]) === String(valor) ? '' : valor;   // tornar a prémer el treu
      pintaFiltres();
      pintaCosLlista();
    });
  });
}

function pintaAvisosCua() {
  const zona = $('#avisos-cua');
  if (!zona) return;
  const dolentes = pendents.filter((o) => o.errades > 0);
  if (!dolentes.length) { zona.innerHTML = ''; return; }
  zona.innerHTML =
    '<div class="card" style="border-color:var(--pink-dim)">' +
      '<div class="eyebrow">No s\'ha pogut desar</div>' +
      '<p style="margin:0 0 10px;font-size:14px;color:var(--text-dim)">' +
        esc(dolentes.length) + ' canvi(s) que el full rebutja: ' +
        esc(dolentes[0].ultimError || 'error desconegut') +
      '</p>' +
      '<button type="button" class="btn secundari" id="reintenta">Tornar-ho a provar</button>' +
      '<button type="button" class="btn secundari" id="descarta" style="margin-top:8px">Descartar aquests canvis</button>' +
    '</div>';
  $('#reintenta').addEventListener('click', () => sincronitza(true));
  $('#descarta').addEventListener('click', () => {
    if (!confirm('Descartar ' + dolentes.length + ' canvi(s)? Es perdran definitivament.')) return;
    pendents = pendents.filter((o) => o.errades === 0);
    guardaPendents();
    pintaSync();
    pintaLlista();
  });
}

function pintaCosLlista() {
  const llista = filtrades();
  const cos = $('#llista-cos');
  const nFiltres = ['any', 'posicio', 'prioritat', 'estat'].filter((k) => filtres[k]).length;

  $('#compta').textContent = llista.length + (llista.length === 1 ? ' jugadora' : ' jugadores') +
    (nFiltres || filtres.text ? ' (filtrat)' : '') +
    (D.ts ? ' · full llegit ' + formatData(D.ts) : '');

  if (!llista.length) {
    cos.innerHTML = '<p class="buit">' + (D.jugadores.length
      ? 'Cap jugadora amb aquests filtres.'
      : 'Encara no hi ha cap jugadora. Comença amb «+ Nova jugadora».') + '</p>';
  } else {
    cos.innerHTML = llista.map((j) => {
      const c = captacioDe(j.id);
      const prio = PRIORITATS.indexOf(c.prioritat) !== -1 ? c.prioritat : 'cap';
      const sub = [j.any_naixement, j.club, j.posicio].filter((x) => x).join(' · ');
      const nObs = (D.observacions[j.id] || []).length;
      return '<button type="button" class="fila-jug" data-id="' + esc(j.id) + '">' +
        '<span class="punt-prio ' + prio + '" title="Prioritat ' + esc(c.prioritat || '—') + '"></span>' +
        '<span class="cos"><span class="nom">' + esc(j.nom) + '</span>' +
        '<span class="sub">' + esc(sub || '—') + (nObs ? ' · ' + nObs + ' obs.' : '') + '</span></span>' +
        '<span class="fletxa">›</span></button>';
    }).join('');
    $$('#llista-cos [data-id]').forEach((b) => {
      b.addEventListener('click', () => ves('#/jugadora/' + b.getAttribute('data-id')));
    });
  }
  pintaAvisosCua();
}

/* ─────────────────────────────────────────────────────────────────────
   10. FITXA DE JUGADORA
   ───────────────────────────────────────────────────────────────────── */

/** Encaix global segons §6: Alt=2, Mitjà=1, Baix=0 dels dos encaixos,
    menys 1 si el desplaçament de rol és Alt. */
function encaixGlobal(pc) {
  const n = (s) => (s === 'Alt' ? 2 : s === 'Mitjà' ? 1 : 0);
  let punts = n((pc || {}).encaix_entorn) + n((pc || {}).encaix_grup);
  if ((pc || {}).desplacament_rol === 'Alt') punts -= 1;
  return punts;
}

function pintaMatriu(ultima) {
  const cap = '<div class="eyebrow">Matriu de decisió</div>' +
    '<p class="meta" style="margin:0 0 10px">' +
    "Es calcula sola a partir de l'última observació: no es tria a mà." + '</p>';

  if (!ultima) {
    return '<div class="card">' + cap +
      '<p class="meta" style="margin:0">Encara no hi ha cap observació.</p></div>';
  }

  const pc = ultima.perfil_conducta || {};
  const sostre = mitjana(ultima.val_sostre);
  const encaix = encaixGlobal(pc);
  // Sense cap dada d'encaix no la situem enlloc: comptar el buit com a "Baix"
  // seria inventar un veredicte a partir d'un bloc que ningu ha omplert.
  const hiHaEncaix = !!(pc.encaix_entorn || pc.encaix_grup);
  const situable = sostre !== null && hiHaEncaix;
  const sostreAlt = sostre !== null && sostre >= 3.5;
  const encaixAlt = encaix >= 2;
  const actiu = !situable ? '' : (sostreAlt
    ? (encaixAlt ? 'objectiu' : 'risc')
    : (encaixAlt ? 'plantilla' : 'descartar'));

  const q = (clau, etiqueta, eixos) =>
    '<div class="quadrant' + (actiu === clau ? ' actiu' : '') + '">' + etiqueta +
    '<span class="eixos">' + eixos + '</span></div>';

  const falta = [];
  if (sostre === null) falta.push('valorar el sostre de les àrees');
  if (!hiHaEncaix) falta.push("dir l'encaix amb l'entorn i amb el grup");

  return '<div class="card">' + cap +
    '<div class="matriu">' +
      q('risc', 'Fitxatge de risc', 'sostre alt · encaix baix') +
      q('objectiu', 'Objectiu prioritari', 'sostre alt · encaix alt') +
      q('descartar', 'Descartar', 'sostre baix · encaix baix') +
      q('plantilla', 'Completa plantilla', 'sostre baix · encaix alt') +
    '</div>' +
    '<p class="llegenda-matriu">' + (situable
      ? 'Sostre ' + unDecimal(sostre) + '/5 · encaix ' + encaix + '/4 (última observació, ' +
        esc(formatData(ultima.data)) + ').'
      : "Encara no es pot situar: a l'última observació falta " + falta.join(' i ') + '.') +
    '</p>' +
  '</div>';
}

function pintaComparativa(obs, quin) {
  const responsables = config('responsables', []);
  const noms = responsables.length ? responsables
    : Object.keys(obs.reduce((a, o) => { if (o.responsable) a[o.responsable] = 1; return a; }, {}));
  if (!noms.length) return '<p class="meta">Cap observació amb responsable.</p>';

  // Última valoració de cada responsable (obs ja ve ordenada de nova a vella).
  const ultimaDe = {};
  obs.forEach((o) => { if (o.responsable && !ultimaDe[o.responsable]) ultimaDe[o.responsable] = o; });

  const files = AREES.map((a) => {
    const valors = noms.map((n) => {
      const o = ultimaDe[n];
      const v = o ? Number((o[quin] || {})[a.k]) : NaN;
      return (v >= 1 && v <= 5) ? v : null;
    });
    const posats = valors.filter((v) => v !== null);
    // La discrepància entre observadors és informació: es marca, no s'amaga.
    const discrepa = posats.length >= 2 && (Math.max.apply(null, posats) - Math.min.apply(null, posats)) >= 2;
    return '<tr class="' + (discrepa ? 'discrepa' : '') + '"><td>' + esc(a.nom) + '</td>' +
      valors.map((v) => '<td><span class="val">' + (v === null ? '—' : v) + '</span></td>').join('') +
      '</tr>';
  }).join('');

  return '<div class="commutador">' +
      '<button type="button" class="chip" data-quin="val_ara" aria-pressed="' + (quin === 'val_ara') + '">Ara</button>' +
      '<button type="button" class="chip" data-quin="val_sostre" aria-pressed="' + (quin === 'val_sostre') + '">Sostre</button>' +
    '</div>' +
    '<table class="taula"><thead><tr><th>Àrea</th>' +
      noms.map((n) => '<th>' + esc(n.split(' ')[0]) + '</th>').join('') +
    '</tr></thead><tbody>' + files + '</tbody></table>' +
    '<p class="meta">Última valoració de cada responsable. Les àrees marcades ⚠ tenen 2 punts o més de diferència entre observadors.</p>';
}

function detallObservacio(o) {
  const pc = o.perfil_conducta || {};
  const val = (a) => {
    const ara = (o.val_ara || {})[a.k];
    const sos = (o.val_sostre || {})[a.k];
    if (!ara && !sos) return '';
    return '<div class="kv"><span class="k">' + esc(a.nom) + '</span>' +
      '<span class="v">' + (ara || '—') + ' → ' + (sos || '—') + '</span></div>';
  };
  const conductes = (pc.conductes || []);
  return '<div class="obs-detall">' +
    '<h4>Context</h4>' +
    (o.competicio ? '<div class="kv"><span class="k">Competició</span><span class="v">' + esc(o.competicio) + '</span></div>' : '') +
    (o.rival ? '<div class="kv"><span class="k">Rival</span><span class="v">' + esc(o.rival) + '</span></div>' : '') +
    (o.minuts_vistos ? '<div class="kv"><span class="k">Minuts vistos</span><span class="v">' + esc(o.minuts_vistos) + '</span></div>' : '') +
    '<div class="kv"><span class="k">Rol a l\'equip</span><span class="v">' + esc(o.rol_equip || '—') + '</span></div>' +
    '<h4>Valoració (ara → sostre)</h4>' + (AREES.map(val).join('') || '<p class="meta">Sense valoracions.</p>') +
    '<h4>Conducta observada</h4>' +
    (conductes.length ? '<p style="font-size:14.5px;margin:0 0 8px">' + conductes.map(esc).join(' · ') + '</p>' : '<p class="meta" style="margin:0 0 8px">Cap conducta anotada.</p>') +
    '<div class="kv"><span class="k">Perfil probable</span><span class="v">' + esc(pc.perfil_probable || '—') + '</span></div>' +
    '<div class="kv"><span class="k">Encaix entorn</span><span class="v">' + esc(pc.encaix_entorn || '—') + '</span></div>' +
    (pc.encaix_entorn_nota ? '<p class="meta">' + esc(pc.encaix_entorn_nota) + '</p>' : '') +
    '<div class="kv"><span class="k">Encaix grup</span><span class="v">' + esc(pc.encaix_grup || '—') + '</span></div>' +
    (pc.encaix_grup_nota ? '<p class="meta">' + esc(pc.encaix_grup_nota) + '</p>' : '') +
    '<div class="kv"><span class="k">Desplaçament de rol</span><span class="v">' + esc(pc.desplacament_rol || '—') + '</span></div>' +
    (pc.desplacament_rol_nota ? '<p class="meta">' + esc(pc.desplacament_rol_nota) + '</p>' : '') +
    (o.notes ? '<h4>Notes</h4><p style="font-size:15px;margin:0;white-space:pre-wrap">' + esc(o.notes) + '</p>' : '') +
  '</div>';
}

let quinComparativa = 'val_ara';

function pintaFitxa(id, jaRefrescada) {
  const j = jugadora(id);
  if (!j) { ves('#/llista'); return; }
  const obs = observacionsDe(id);
  const c = captacioDe(id);
  $('#titol').textContent = j.nom;

  const meta = [j.categoria, j.posicio, j.alcada, j.dorsal ? 'dorsal ' + j.dorsal : ''].filter((x) => x).join(' · ');

  $('#contingut').innerHTML =
    '<div class="capcalera-fitxa">' +
      '<div class="nom">' + esc(j.nom) + '</div>' +
      '<div class="destacats">' +
        '<div class="destacat"><div class="k">Any</div><div class="v">' + esc(j.any_naixement || '—') + '</div></div>' +
        '<div class="destacat"><div class="k">Club</div><div class="v">' + esc(j.club || '—') + '</div></div>' +
        (j.equip ? '<div class="destacat"><div class="k">Equip</div><div class="v">' + esc(j.equip) + '</div></div>' : '') +
      '</div>' +
      (meta ? '<p class="meta">' + esc(meta) + '</p>' : '') +
    '</div>' +

    pintaMatriu(obs[0]) +

    '<details class="bloc" open><summary>Estat de captació</summary><div class="bloc-cos">' +
      '<div class="camp"><label>Prioritat</label><div class="multi" id="cap-prioritat">' +
        PRIORITATS.map((p) => '<button type="button" class="chip" data-valor="' + p + '" aria-pressed="' + (c.prioritat === p) + '">' + p + '</button>').join('') +
      '</div></div>' +
      '<div class="camp"><label>Estat</label><div class="multi" id="cap-estat">' +
        ESTATS.map((e) => '<button type="button" class="chip" data-valor="' + esc(e) + '" aria-pressed="' + (c.estat === e) + '">' + esc(e) + '</button>').join('') +
      '</div></div>' +
      '<div class="camp"><label for="cap-contacte">Qui del club hi té relació</label>' +
        '<input id="cap-contacte" value="' + esc(c.contacte) + '"></div>' +
      '<div class="camp"><label for="cap-accio">Propera acció</label>' +
        '<input id="cap-accio" value="' + esc(c.propera_accio) + '"></div>' +
      '<div class="camp"><label for="cap-data">Data de la propera acció</label>' +
        '<input id="cap-data" type="date" value="' + esc(String(c.data_propera_accio || '').slice(0, 10)) + '"></div>' +
      (c.actualitzat_per ? '<p class="meta">Últim canvi: ' + esc(c.actualitzat_per) + ' · ' + esc(formatData(c.data_actualitzacio)) + '</p>' : '') +
    '</div></details>' +

    '<details class="bloc" open><summary>Observacions<span class="compta-bloc">' + obs.length + '</span></summary><div class="bloc-cos">' +
      (obs.length ? obs.map((o) =>
        '<details class="obs"><summary>' +
          '<span class="data">' + esc(formatData(o.data)) + '</span> · <span class="qui">' + esc(o.responsable || '—') + '</span>' +
          (o.competicio ? '<div class="qui">' + esc(o.competicio) + (o.rival ? ' · ' + esc(o.rival) : '') + '</div>' : '') +
          '<div class="mitjanes">' +
            '<span class="pastilla">Ara <b>' + unDecimal(mitjana(o.val_ara)) + '</b></span>' +
            '<span class="pastilla">Sostre <b>' + unDecimal(mitjana(o.val_sostre)) + '</b></span>' +
          '</div>' +
        '</summary>' + detallObservacio(o) + '</details>'
      ).join('') : '<p class="meta" style="margin:0">Cap observació encara.</p>') +
    '</div></details>' +

    '<details class="bloc"><summary>Comparativa entre observadors</summary>' +
      '<div class="bloc-cos" id="zona-comparativa">' + pintaComparativa(obs, quinComparativa) + '</div>' +
    '</details>';

  // --- Captació: els xips desen al moment, els camps de text en sortir-ne.
  const xipTriat = (zona) => {
    const b = $(zona + ' .chip[aria-pressed="true"]');
    return b ? b.getAttribute('data-valor') : '';
  };
  const desaCaptacio = () => {
    const nou = {
      id_jugadora: id,
      prioritat: xipTriat('#cap-prioritat'),
      estat: xipTriat('#cap-estat'),
      contacte: $('#cap-contacte').value.trim(),
      propera_accio: $('#cap-accio').value.trim(),
      data_propera_accio: $('#cap-data').value,
      actualitzat_per: sessio.responsable,
      data_actualitzacio: new Date().toISOString()
    };
    encua('saveCaptacio', nou);
    avisa('Estat de captació desat');
  };

  ['#cap-prioritat', '#cap-estat'].forEach((zona) => {
    $$(zona + ' .chip').forEach((b) => {
      b.addEventListener('click', () => {
        const ja = b.getAttribute('aria-pressed') === 'true';
        $$(zona + ' .chip').forEach((x) => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', ja ? 'false' : 'true');
        desaCaptacio();
      });
    });
  });
  ['#cap-contacte', '#cap-accio', '#cap-data'].forEach((sel) => {
    $(sel).addEventListener('change', desaCaptacio);
  });

  const enganxaCommutador = () => {
    $$('#zona-comparativa [data-quin]').forEach((b) => {
      b.addEventListener('click', () => {
        quinComparativa = b.getAttribute('data-quin');
        $('#zona-comparativa').innerHTML = pintaComparativa(obs, quinComparativa);
        enganxaCommutador();
      });
    });
  };
  enganxaCommutador();

  // El full manté l'historial complet; el mòbil només en té la còpia.
  // Només una vegada per entrada a la fitxa: si no, cada repintat en
  // demanaria una altra i no pararíem mai.
  if (!jaRefrescada) refrescaFitxa(id);
}

async function refrescaFitxa(id) {
  try {
    const res = await api('getJugadora', { id: id }, 1);
    if (!res || !res.ok) return;
    const d = res.data;
    const i = D.jugadores.findIndex((x) => x.id === id);
    if (i !== -1) D.jugadores[i] = d.jugadora;
    if (d.captacio) D.captacio[id] = d.captacio;

    const ids = {};
    (d.observacions || []).forEach((o) => { ids[o.id] = true; });
    const localsPendents = pendents
      .filter((o) => o.action === 'saveObservacio' && o.payload.id_jugadora === id && !ids[o.payload.id])
      .map((o) => o.payload);
    D.observacions[id] = (d.observacions || []).concat(localsPendents);
    guardaDades();

    const r = rutaActual();
    if (r.vista === 'jugadora' && r.id === id) pintaFitxa(id, true);
  } catch (err) { /* sense cobertura: ja mostrem la còpia local */ }
}

/* ─────────────────────────────────────────────────────────────────────
   11. NOVA JUGADORA
   ───────────────────────────────────────────────────────────────────── */

/** Jugadores del mateix any amb un nom prou semblant. */
function semblants(nom, any) {
  const n = normalitza(nom);
  if (!n) return [];
  const paraules = n.split(/\s+/).filter((p) => p.length > 2);
  return D.jugadores.filter((j) => {
    if (any && j.any_naixement && String(j.any_naixement) !== String(any)) return false;
    const m = normalitza(j.nom);
    if (m === n) return true;
    if (m.indexOf(n) !== -1 || n.indexOf(m) !== -1) return true;
    const compartides = paraules.filter((p) => m.indexOf(p) !== -1).length;
    return compartides >= 2 || (paraules.length === 1 && compartides === 1);
  });
}

/** Els anys que es poden triar: de la mes petita d'un mini a una senior
    feta. Es calcula cada cop, aixi no cal tocar res al comencar la temporada. */
function anysNaixement() {
  const ara = new Date().getFullYear();
  const anys = [];
  for (let a = ara - 5; a >= ara - 26; a--) anys.push(String(a));
  return anys;
}

/* ─────────────────────────────────────────────────────────────────────
   13. JUGADORES SÈNIOR
   ───────────────────────────────────────────────────────────────────── *
   Només les veu qui entra amb el codi de direcció esportiva, i el full ho
   torna a comprovar: aquí només hi ha la comoditat de no ensenyar botons
   que no toquen.

   A diferència de les observacions de les joves, aquí hi ha UNA fitxa per
   jugadora i tornar-la a desar reescriu l'anterior: per a sènior interessa
   la decisió d'ara, no l'evolució.                                       */

const SENIOR_PUNTS_DEF = ['Tir exterior', 'Penetració', 'Rebot', 'Defensa interior',
  'Defensa exterior', 'Bot i maneig', "Joc d'esquena", 'Lectura de joc', 'Físic',
  'Intensitat', 'Lideratge'];
const SENIOR_NIVELL_DEF = ['Completaria plantilla', 'Competiria pel lloc', 'Titular'];
const SENIOR_INTERES_DEF = ['Seguir-la mirant', 'Parlar-hi aquesta temporada', 'Prioritat'];

/* Amb qui signa les observacions el director. No li preguntem el nom perquè
   el seu codi només el té ell: preguntar-l'hi seria un pas per no res. */
const RESPONSABLE_DIRECTOR = 'Direcció esportiva';

function esDirector() { return D.rol === 'director'; }

/** Les pantalles de sènior són una branca a part; la resta, Seguiment. */
function pintaBarraBaix(vista) {
  const barra = $('#barra-baix');
  if (!barra) return;
  const cal = esDirector();
  barra.classList.toggle('amagat', !cal);
  document.body.classList.toggle('amb-barra', cal);
  if (!cal) return;

  const aSenior = vista === 'senior' || vista === 'senior-fitxa';
  $$('#barra-baix button').forEach((b) =>
    b.setAttribute('aria-pressed', (b.getAttribute('data-tab') === '#/senior') === aSenior));
}

/** Només majors de 18: de l'any que en fa 18 cap enrere. */
function anysSenior() {
  const ara = new Date().getFullYear();
  const anys = [];
  for (let a = ara - 18; a >= ara - 40; a--) anys.push(String(a));
  return anys;
}

function seniorPerId(id) {
  return (D.senior || []).filter((j) => j.id === id)[0] || null;
}

function pintaLlistaSenior() {
  $('#titol').textContent = 'Sènior';
  // Primer les que corren més: prioritat a dalt.
  const ordre = config('senior_interes', SENIOR_INTERES_DEF);
  const llista = (D.senior || []).slice().sort((a, b) =>
    (ordre.indexOf(b.interes) - ordre.indexOf(a.interes)) || a.nom.localeCompare(b.nom));

  $('#contingut').innerHTML =
    '<p class="meta" style="margin:0 0 14px">' +
      "La teva llista per a l'any vinent. Només la veus tu, i si entres a alguna " +
      'fitxa la pots editar.' +
    '</p>' +
    (llista.length
      ? llista.map((j) =>
          '<button type="button" class="fila-jug" data-senior="' + esc(j.id) + '">' +
            '<span class="cos">' +
              '<span class="nom">' + esc(j.nom) + '</span>' +
              '<span class="sub">' +
                esc([j.equip, j.posicio, j.any_naixement].filter((x) => x).join(' · ')) +
                (j.interes ? ' · ' + esc(j.interes) : '') +
              '</span>' +
            '</span><span class="fletxa">›</span>' +
          '</button>').join('')
      : '<p class="buit">Encara no hi ha cap jugadora. Afegeix-ne una amb «+ Nova sènior».</p>');

  $$('#contingut [data-senior]').forEach((b) =>
    b.addEventListener('click', () => ves('#/senior-fitxa/' + b.getAttribute('data-senior'))));
}

function pintaFormSenior(id) {
  const j = id ? seniorPerId(id) : null;
  if (id && !j) { ves('#/senior'); return; }
  $('#titol').textContent = j ? j.nom : 'Nova sènior';

  const opcions = (llista, buit, triat) => '<option value="">' + buit + '</option>' +
    llista.map((v) => '<option value="' + esc(v) + '"' +
      (String(triat) === String(v) ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  const xips = (idBloc, llista, triats, unica) =>
    '<div class="multi" id="' + idBloc + '"' + (unica ? ' data-unica="1"' : '') + '>' +
      llista.map((v) => '<button type="button" class="chip" data-valor="' + esc(v) + '"' +
        ' aria-pressed="' + (triats.indexOf(v) !== -1) + '">' + esc(v) + '</button>').join('') +
    '</div>';

  const punts = config('senior_punts', SENIOR_PUNTS_DEF);
  const nivells = config('senior_nivell', SENIOR_NIVELL_DEF);
  const interessos = config('senior_interes', SENIOR_INTERES_DEF);

  $('#contingut').innerHTML =
    '<form id="form-senior" autocomplete="off">' +
      '<div class="card">' +
        '<div class="eyebrow">Qui és</div>' +
        '<div class="camp"><label for="s-nom">Nom i cognoms *</label>' +
          '<input id="s-nom" required value="' + esc(j ? j.nom : '') + '"></div>' +
        '<div class="camp"><label for="s-equip">Equip actual</label>' +
          '<input id="s-equip" placeholder="CB Igualada A" value="' + esc(j ? j.equip : '') + '"></div>' +
        '<div class="parell">' +
          '<div class="camp"><label for="s-any">Any de naixement</label>' +
            '<select id="s-any">' + opcions(anysSenior(), 'Sense definir', j ? j.any_naixement : '') + '</select></div>' +
          '<div class="camp"><label for="s-posicio">Posició</label>' +
            '<select id="s-posicio">' + opcions(config('posicions', POSICIONS_DEF), 'Sense definir', j ? j.posicio : '') + '</select></div>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="eyebrow">Visió general</div>' +
        '<div class="camp"><label>Nivell que li veus</label>' +
          xips('s-nivell', nivells, j && j.nivell ? [j.nivell] : [], true) + '</div>' +
        '<div class="camp"><label>Interès</label>' +
          xips('s-interes', interessos, j && j.interes ? [j.interes] : [], true) + '</div>' +
        '<div class="camp" style="margin-bottom:0"><label for="s-notes">Notes</label>' +
          '<textarea id="s-notes" placeholder="Acaba contracte, estudia fora, ja hi han parlat…">' +
            esc(j ? j.notes : '') + '</textarea></div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="eyebrow">Com juga</div>' +
        '<div class="camp"><label>Punts forts</label>' +
          xips('s-forts', punts, (j && j.punts_forts) || []) + '</div>' +
        '<div class="camp" style="margin-bottom:0"><label>A millorar</label>' +
          xips('s-millorar', punts, (j && j.a_millorar) || []) + '</div>' +
      '</div>' +

      '<button type="submit" class="btn" id="s-desa">' + (j ? 'Desar els canvis' : 'Desar') + '</button>' +
      (j && j.actualitzada
        ? '<p class="meta" style="text-align:center;margin-top:10px">Últim canvi: ' +
          esc(formatData(j.actualitzada)) + '</p>'
        : '') +
    '</form>';

  // Punts forts i a millorar deixen marcar-ne tantes com vulgui; nivell i
  // interès, només una.
  $$('#contingut .multi .chip').forEach((b) => b.addEventListener('click', () => {
    const bloc = b.parentNode;
    const ja = b.getAttribute('aria-pressed') === 'true';
    if (bloc.getAttribute('data-unica')) {
      Array.prototype.forEach.call(bloc.children, (x) => x.setAttribute('aria-pressed', 'false'));
    }
    b.setAttribute('aria-pressed', ja ? 'false' : 'true');
  }));

  const marcats = (sel) => $$(sel + ' .chip[aria-pressed="true"]').map((b) => b.getAttribute('data-valor'));

  $('#form-senior').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const nom = $('#s-nom').value.trim();
    if (!nom) { avisa('Falta el nom', true); return; }

    encua('saveSenior', {
      id: j ? j.id : uuid(),
      nom: nom,
      equip: $('#s-equip').value.trim(),
      any_naixement: $('#s-any').value,
      posicio: $('#s-posicio').value,
      punts_forts: marcats('#s-forts'),
      a_millorar: marcats('#s-millorar'),
      nivell: marcats('#s-nivell')[0] || '',
      interes: marcats('#s-interes')[0] || '',
      notes: $('#s-notes').value.trim(),
      actualitzada: new Date().toISOString()
    });
    avisa(j ? 'Fitxa actualitzada' : 'Jugadora afegida');
    ves('#/senior');
  });
}


function pintaFormJugadora() {
  $('#titol').textContent = 'Nova jugadora';
  const opcions = (llista, buit) => '<option value="">' + buit + '</option>' +
    llista.map((v) => '<option value="' + esc(v) + '">' + esc(v) + '</option>').join('');

  $('#contingut').innerHTML =
    '<form id="form-jug" autocomplete="off">' +
      '<div class="camp"><label for="j-nom">Nom i cognoms *</label><input id="j-nom" required></div>' +
      '<div class="camp"><label for="j-any">Any de naixement *</label>' +
        '<select id="j-any" required>' + opcions(anysNaixement(), 'Tria l\'any') + '</select></div>' +
      '<div class="camp"><label for="j-club">Club</label><input id="j-club"></div>' +
      '<div class="camp"><label for="j-equip">Equip dins el club</label><input id="j-equip"></div>' +
      '<div class="parell">' +
        '<div class="camp"><label for="j-categoria">Categoria</label><select id="j-categoria">' +
          opcions(config('categories', CATEGORIES_DEF), 'Sense definir') + '</select></div>' +
        '<div class="camp"><label for="j-posicio">Posició</label><select id="j-posicio">' +
          opcions(config('posicions', POSICIONS_DEF), 'Sense definir') + '</select></div>' +
      '</div>' +
      '<div class="camp"><label for="j-alcada">Alçada aproximada</label>' +
        '<input id="j-alcada" placeholder="1,72 aprox"></div>' +
      '<div id="j-avis"></div>' +
      '<button class="btn" type="submit">Desar i observar</button>' +
      '<button class="btn secundari" type="button" id="j-nomes" style="margin-top:9px">Només desar la fitxa</button>' +
    '</form>';

  const recull = () => ({
    id: uuid(),
    nom: $('#j-nom').value.trim(),
    any_naixement: $('#j-any').value.trim(),
    club: $('#j-club').value.trim(),
    equip: $('#j-equip').value.trim(),
    categoria: $('#j-categoria').value,
    posicio: $('#j-posicio').value,
    alcada: $('#j-alcada').value.trim(),
    creada_per: sessio.responsable,
    data_creacio: new Date().toISOString()
  });

  let avisatDe = '';
  const desa = (iObservar) => {
    const p = recull();
    if (!p.nom) { avisa('Falta el nom', true); return; }
    if (!p.any_naixement) { avisa('Falta l\'any de naixement', true); return; }

    // Amb 3 observadors, el duplicat és el risc principal: avisem abans de desar.
    const rep = semblants(p.nom, p.any_naixement);
    const clau = normalitza(p.nom) + '|' + p.any_naixement;
    if (rep.length && avisatDe !== clau) {
      avisatDe = clau;
      $('#j-avis').innerHTML =
        '<div class="card" style="border-color:var(--avis)">' +
          '<div class="eyebrow" style="color:var(--avis)">Possible duplicat</div>' +
          '<p style="margin:0 0 10px;font-size:15px">Ja tens fitxada una jugadora semblant:</p>' +
          rep.slice(0, 4).map((j) =>
            '<button type="button" class="fila-jug" data-obre="' + esc(j.id) + '">' +
              '<span class="cos"><span class="nom">' + esc(j.nom) + '</span>' +
              '<span class="sub">' + esc([j.any_naixement, j.club].filter((x) => x).join(' · ')) + '</span></span>' +
              '<span class="fletxa">›</span></button>').join('') +
          '<p class="meta">Si de debò és una jugadora diferent, torna a prémer el botó de desar.</p>' +
        '</div>';
      $$('#j-avis [data-obre]').forEach((b) => b.addEventListener('click', () => ves('#/jugadora/' + b.getAttribute('data-obre'))));
      $('#j-avis').scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    encua('saveJugadora', p);
    avisa('Fitxa creada');
    ves(iObservar ? '#/observacio/' + p.id : '#/jugadora/' + p.id);
  };

  $('#form-jug').addEventListener('submit', (ev) => { ev.preventDefault(); desa(true); });
  $('#j-nomes').addEventListener('click', () => desa(false));
  $('#j-nom').focus();
}

/* ─────────────────────────────────────────────────────────────────────
   12. NOVA OBSERVACIÓ
   ───────────────────────────────────────────────────────────────────── */

function pintaFormObservacio(idJugadora) {
  const j = jugadora(idJugadora);
  if (!j) { ves('#/llista'); return; }
  $('#titol').textContent = 'Observació · ' + j.nom;

  const escalaBotons = (k, quin) =>
    '<div class="escala ' + quin + '"><span class="quin">' + (quin === 'ara' ? 'Ara' : 'Sostre') + '</span>' +
      '<span class="botons">' +
        [1, 2, 3, 4, 5].map((n) =>
          '<button type="button" class="nota-val" data-area="' + k + '" data-quin="' + quin + '"' +
          ' data-nota="' + n + '" aria-pressed="false">' + n + '</button>').join('') +
      '</span></div>';

  $('#contingut').innerHTML =
    '<form id="form-obs" autocomplete="off">' +
      '<div class="card">' +
        '<div class="eyebrow">Context</div>' +
        '<div class="camp"><label for="o-rol">Rol a l\'equip</label><input id="o-rol" placeholder="1a base"></div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="eyebrow">Valoració per àrees</div>' +
        '<details class="ajuda"><summary>Què vol dir cada nota?</summary><div class="cos">' +
          ESCALA.map((e) => '<p style="margin:3px 0"><b>' + e[0] + '</b> = ' + esc(e[1]) + '</p>').join('') +
        '</div></details>' +
        AREES.map((a) =>
          '<div class="area"><div class="titol">' + esc(a.nom) + '</div>' +
          escalaBotons(a.k, 'ara') + escalaBotons(a.k, 'sostre') + '</div>').join('') +
      '</div>' +

      '<div class="card">' +
        '<div class="eyebrow">Perfil de conducta i encaix</div>' +
        '<div class="camp"><label>Conductes observades (les que hagis vist)</label>' +
          '<div class="multi" id="o-conductes">' +
            CONDUCTES.map((c) => '<button type="button" class="chip" data-valor="' + esc(c) + '" aria-pressed="false">' + esc(c) + '</button>').join('') +
          '</div></div>' +
        '<div class="camp"><label>Perfil probable</label><div class="multi" id="o-perfil">' +
          PERFILS.map((p) => '<button type="button" class="chip" data-valor="' + esc(p) + '" aria-pressed="false">' + esc(p) + '</button>').join('') +
        '</div></div>' +
        '<div class="camp"><label>Encaix amb l\'entorn del club</label><div class="multi" id="o-encaix-entorn">' +
          NIVELLS.map((n) => '<button type="button" class="chip" data-valor="' + n + '" aria-pressed="false">' + n + '</button>').join('') +
        '</div><input id="o-encaix-entorn-nota" placeholder="Per què (opcional)" style="margin-top:8px"></div>' +
        '<div class="camp"><label>Encaix amb el grup</label><div class="multi" id="o-encaix-grup">' +
          NIVELLS.map((n) => '<button type="button" class="chip" data-valor="' + n + '" aria-pressed="false">' + n + '</button>').join('') +
        '</div><input id="o-encaix-grup-nota" placeholder="Per què (opcional)" style="margin-top:8px"></div>' +
        '<div class="camp"><label>Desplaçament de rol</label>' +
          '<p class="meta" style="margin:0 0 6px">Distància entre el rol on té èxit ara i el que li demanaríem.</p>' +
          '<div class="multi" id="o-desplacament">' +
            NIVELLS_DESP.map((n) => '<button type="button" class="chip" data-valor="' + n + '" aria-pressed="false">' + n + '</button>').join('') +
          '</div><input id="o-desplacament-nota" placeholder="Per què (opcional)" style="margin-top:8px"></div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="eyebrow">Notes</div>' +
        '<div class="camp"><textarea id="o-notes" placeholder="El que vulguis afegir…"></textarea></div>' +
      '</div>' +

      '<button class="btn" type="submit">Desar observació</button>' +
      '<button class="btn secundari" type="button" id="o-cancela" style="margin-top:9px">Cancel·lar</button>' +
    '</form>';

  // Notes 1-5: una sola per fila, i tornar-hi a prémer la treu.
  $$('#form-obs .nota-val').forEach((b) => {
    b.addEventListener('click', () => {
      const germans = $$('#form-obs .nota-val[data-area="' + b.dataset.area + '"][data-quin="' + b.dataset.quin + '"]');
      const ja = b.getAttribute('aria-pressed') === 'true';
      germans.forEach((g) => g.setAttribute('aria-pressed', 'false'));
      b.setAttribute('aria-pressed', ja ? 'false' : 'true');
    });
  });

  const uni = (sel) => $$(sel + ' .chip').forEach((b) => b.addEventListener('click', () => {
    const ja = b.getAttribute('aria-pressed') === 'true';
    $$(sel + ' .chip').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    b.setAttribute('aria-pressed', ja ? 'false' : 'true');
  }));
  ['#o-perfil', '#o-encaix-entorn', '#o-encaix-grup', '#o-desplacament'].forEach(uni);
  $$('#o-conductes .chip').forEach((b) => b.addEventListener('click', () => {
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true');
  }));

  const triat = (sel) => {
    const b = $(sel + ' .chip[aria-pressed="true"]');
    return b ? b.getAttribute('data-valor') : '';
  };
  const valoracions = (quin) => {
    const out = {};
    AREES.forEach((a) => {
      const b = $('#form-obs .nota-val[data-area="' + a.k + '"][data-quin="' + quin + '"][aria-pressed="true"]');
      if (b) out[a.k] = Number(b.getAttribute('data-nota'));
    });
    return out;
  };

  $('#o-cancela').addEventListener('click', () => ves('#/jugadora/' + idJugadora));
  $('#form-obs').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const ara = valoracions('ara');
    const sostre = valoracions('sostre');
    if (!Object.keys(ara).length && !Object.keys(sostre).length &&
        !confirm('No has valorat cap àrea. Vols desar l\'observació igualment?')) return;

    encua('saveObservacio', {
      id: uuid(),
      id_jugadora: idJugadora,
      data: new Date().toISOString(),
      responsable: sessio.responsable,
      rol_equip: $('#o-rol').value.trim(),
      val_ara: ara,
      val_sostre: sostre,
      perfil_conducta: {
        conductes: $$('#o-conductes .chip[aria-pressed="true"]').map((b) => b.getAttribute('data-valor')),
        perfil_probable: triat('#o-perfil'),
        encaix_entorn: triat('#o-encaix-entorn'),
        encaix_entorn_nota: $('#o-encaix-entorn-nota').value.trim(),
        encaix_grup: triat('#o-encaix-grup'),
        encaix_grup_nota: $('#o-encaix-grup-nota').value.trim(),
        desplacament_rol: triat('#o-desplacament'),
        desplacament_rol_nota: $('#o-desplacament-nota').value.trim()
      },
      notes: $('#o-notes').value.trim()
    });
    avisa('Observació desada');
    ves('#/jugadora/' + idJugadora);
  });
}

/* ─────────────────────────────────────────────────────────────────────
   13. ARRENCADA
   ───────────────────────────────────────────────────────────────────── */

function arrenca() {
  sessio = Object.assign({ pin: '', responsable: '' }, llegeix(CLAUS.sessio, {}));
  D = Object.assign({ config: {}, jugadores: [], captacio: {}, observacions: {}, senior: [], rol: '', ts: '' }, llegeix(CLAUS.dades, {}));
  pendents = llegeix(CLAUS.pendents, []) || [];

  $('#form-pin').addEventListener('submit', entraAmbPin);
  $('#enrere').addEventListener('click', () => {
    if (history.length > 1) history.back(); else ves('#/llista');
  });
  $('#estat-sync').addEventListener('click', () => sincronitza(true));
  $$('#barra-baix button').forEach((b) =>
    b.addEventListener('click', () => ves(b.getAttribute('data-tab'))));
  window.addEventListener('hashchange', ruta);
  window.addEventListener('online', () => sincronitza());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sincronitza(); });

  if (sessio.pin && sessio.responsable) obreApp();
  else mostraPin();

  // Despres de mostraPin(), que buida el text de l'error.
  if (!CONFIG.API_URL) {
    $('#pin-error').textContent = 'Falta enganxar la URL de l\'Apps Script a CONFIG.API_URL.';
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('service-worker.js'));
  }
}

arrenca();
