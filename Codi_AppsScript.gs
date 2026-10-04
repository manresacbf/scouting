/**
 * Backend de l'app "Scouting MCBF" (Direcció Esportiva del Manresa CBF).
 *
 * COM POSAR-HO EN MARXA
 * ---------------------
 * 1) Crea un Google Sheet nou i anomena'l  Scouting MCBF.
 * 2) Extensions -> Apps Script. Esborra el que hi hagi i enganxa aquest
 *    fitxer sencer. Desa.
 * 3) A dalt, tria la funcio "setup" i clica ▶ Executar. Aixo crea les 5
 *    pestanyes amb les capçaleres correctes i la configuracio inicial.
 *    (La primera vegada Google demanara permisos: accepta-ho.)
 * 4) Ves a la pestanya Config i canvia el PIN: ve amb 1234 de fabrica.
 * 5) Desplega -> Nou desplegament -> tipus "Aplicacio web":
 *       Executa com:  Jo (el teu compte)
 *       Qui hi te acces:  Qualsevol persona
 *    Copia la URL que acaba en /exec.
 * 6) Enganxa aquella URL dins d'index.html, a CONFIG.API_URL.
 *
 * SI DESPRES CANVIES AQUEST CODI: Desplega -> Gestiona desplegaments ->
 * llapis (editar) -> Versio: Nova versio -> Desplega. Aixi la URL /exec no
 * canvia i no cal tocar l'index.html.
 *
 * SEGURETAT: l'unica barrera es el PIN, i es comprova aqui, al servidor.
 * La URL /exec no retorna res sense PIN correcte. Tot i aixi, no comparteixis
 * la URL fora de la Direccio Esportiva i canvia el PIN si algu deixa el club.
 */

/* ------------------------------------------------------------------ *
 *  Esquema del full                                                   *
 * ------------------------------------------------------------------ *
 * El codi accedeix a les columnes pel NOM de la capçalera, mai per
 * posicio: pots reordenar columnes al full sense trencar l'app.        */

var FULLS = {
  jugadores: {
    nom: 'Jugadores',
    clau: 'id',
    capcalera: ['id', 'nom', 'any_naixement', 'club', 'equip', 'categoria',
                'posicio', 'alcada', 'dorsal', 'creada_per', 'data_creacio'],
    // Columnes que Sheets no ha de "millorar" convertint-les en data o numero.
    text: ['id', 'alcada', 'dorsal', 'data_creacio']
  },
  observacions: {
    nom: 'Observacions',
    clau: 'id',
    capcalera: ['id', 'id_jugadora', 'data', 'responsable', 'competicio', 'rival',
                'minuts_vistos', 'rol_equip', 'val_ara', 'val_sostre',
                'perfil_conducta', 'notes'],
    text: ['id', 'id_jugadora', 'data', 'val_ara', 'val_sostre', 'perfil_conducta']
  },
  captacio: {
    nom: 'Captacio',
    clau: 'id_jugadora',
    capcalera: ['id_jugadora', 'prioritat', 'estat', 'contacte', 'propera_accio',
                'data_propera_accio', 'actualitzat_per', 'data_actualitzacio'],
    text: ['id_jugadora', 'data_propera_accio', 'data_actualitzacio']
  },
  senior: {
    nom: 'Senior',
    clau: 'id',
    // Una fila per jugadora: tornar-la a veure reescriu la fila, no n'afegeix
    // una de nova. Per a senior interessa la decisio d'ara, no l'historial.
    capcalera: ['id', 'nom', 'equip', 'any_naixement', 'posicio', 'punts_forts',
                'a_millorar', 'nivell', 'interes', 'notes', 'actualitzada'],
    text: ['id', 'actualitzada']
  },
  config: {
    nom: 'Config',
    clau: 'clau',
    capcalera: ['clau', 'valor'],
    text: ['clau', 'valor']
  }
};

var CONFIG_INICIAL = [
  ['pin', '1234'],
  // Qui entri amb aquest codi veu tot el que veu la resta MES la pestanya
  // Senior. Mentre estigui buit, no el veu ningu.
  ['pin_director', ''],
  ['responsables', 'Agustí, Responsable 2, Responsable 3'],
  ['categories', 'Mini, Preinfantil, Infantil, Cadet, Júnior, Sènior'],
  ['posicions', 'Base, Escorta, Aler, Ala-pivot, Pivot'],
  ['senior_punts', 'Tir exterior, Penetració, Rebot, Defensa interior, ' +
    'Defensa exterior, Bot, Joc d\'esquena, Lectura de joc, Físic, ' +
    'Intensitat, Lideratge'],
  ['senior_nivell', 'Completaria plantilla, Competiria pel lloc, Titular'],
  ['senior_interes', 'Seguir-la mirant, Parlar-hi aquesta temporada, Prioritat']
];

/* Frena la força bruta contra el PIN: 8 errades en 5 minuts i es tanca
   5 minuts. Un encert correcte esborra el comptador. */
var MAX_ERRADES = 8;
var FINESTRA_MS = 5 * 60 * 1000;

/* ------------------------------------------------------------------ *
 *  Preparacio del full (executar un sol cop, a ma)                    *
 * ------------------------------------------------------------------ */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  Object.keys(FULLS).forEach(function (clau) {
    var def = FULLS[clau];
    var sh = ss.getSheetByName(def.nom) || ss.insertSheet(def.nom);

    // Nomes escrivim la capçalera si la fila 1 es buida: aixi, si ja tens
    // dades al full, executar setup() un segon cop no te les toca.
    if (String(sh.getRange(1, 1).getValue() || '').trim() === '') {
      sh.getRange(1, 1, 1, def.capcalera.length).setValues([def.capcalera]);
      sh.getRange(1, 1, 1, def.capcalera.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }

    // Format text a les columnes d'id, dates ISO i JSON. Sense aixo Sheets
    // converteix "2011-03-04" en data i el JSON de valoracions en formula.
    var caps = capcalera_(sh);
    (def.text || []).forEach(function (nomCol) {
      var i = caps.indexOf(nomCol);
      if (i !== -1) sh.getRange(2, i + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });

  // Configuracio inicial, nomes les claus que encara no hi son.
  var conf = ss.getSheetByName(FULLS.config.nom);
  var existents = files_('config').map(function (f) { return String(f.clau || '').trim(); });
  var afegir = CONFIG_INICIAL.filter(function (c) { return existents.indexOf(c[0]) === -1; });
  if (afegir.length) {
    conf.getRange(conf.getLastRow() + 1, 1, afegir.length, 2).setValues(afegir);
  }

  ss.toast('Pestanyes preparades. Ara posa el PIN i el pin_director a Config.', 'Scouting MCBF', 8);
}

/* ------------------------------------------------------------------ *
 *  Utilitats                                                          *
 * ------------------------------------------------------------------ */

function full_(clau) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FULLS[clau].nom);
  if (!sh) throw new Error('Falta la pestanya "' + FULLS[clau].nom + '". Executa la funcio setup().');
  return sh;
}

/** Noms de les columnes tal com son ara mateix a la fila 1. */
function capcalera_(sh) {
  var ultima = sh.getLastColumn();
  if (!ultima) return [];
  return sh.getRange(1, 1, 1, ultima).getValues()[0].map(function (v) {
    return String(v || '').trim();
  });
}

/** Files d'una pestanya com a objectes {nom_columna: valor}. */
function files_(clau) {
  var sh = full_(clau);
  if (sh.getLastRow() < 2) return [];
  var caps = capcalera_(sh);
  return sh.getRange(2, 1, sh.getLastRow() - 1, caps.length).getValues().map(function (fila) {
    var obj = {};
    caps.forEach(function (nom, i) { if (nom) obj[nom] = fila[i]; });
    return obj;
  });
}

/**
 * Desa un objecte a una pestanya. Si la clau ja hi es, ACTUALITZA la fila;
 * si no, l'afegeix al final. Aquesta idempotencia es imprescindible: la cua
 * offline del mobil pot reenviar la mateixa operacio i no ha de duplicar res.
 */
function desa_(clau, obj) {
  var def = FULLS[clau];
  var sh = full_(clau);
  var caps = capcalera_(sh);
  var iClau = caps.indexOf(def.clau);
  if (iClau === -1) throw new Error('La pestanya ' + def.nom + ' no te la columna ' + def.clau);

  var valorClau = String(obj[def.clau] || '').trim();
  if (!valorClau) throw new Error('Falta ' + def.clau);

  var fila = caps.map(function (nom) {
    if (!nom) return '';
    var v = obj[nom];
    if (v === undefined || v === null) return '';
    // Els objectes (val_ara, val_sostre, perfil_conducta) van al full com a JSON.
    return (typeof v === 'object') ? JSON.stringify(v) : v;
  });

  var nFila = troba_(sh, iClau + 1, valorClau);
  if (nFila) {
    sh.getRange(nFila, 1, 1, caps.length).setValues([fila]);
    return { id: valorClau, actualitzat: true };
  }
  sh.getRange(sh.getLastRow() + 1, 1, 1, caps.length).setValues([fila]);
  return { id: valorClau, actualitzat: false };
}

/** Numero de fila on la columna donada val 'valor', o 0 si no hi es. */
function troba_(sh, columna, valor) {
  if (sh.getLastRow() < 2) return 0;
  var vals = sh.getRange(2, columna, sh.getLastRow() - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim() === valor) return i + 2;
  }
  return 0;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function text_(v) { return String(v === undefined || v === null ? '' : v).trim(); }

function num_(v) {
  if (v === '' || v === null || v === undefined) return '';
  var n = Number(String(v).replace(',', '.'));
  return isNaN(n) ? '' : n;
}

function llista_(v) {
  return text_(v).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; });
}

/** El full pot tornar un JSON com a text; l'app el vol com a objecte. */
function desJson_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(String(v)); } catch (err) { return null; }
}

function ara_() { return new Date().toISOString(); }

/* ------------------------------------------------------------------ *
 *  PIN                                                                *
 * ------------------------------------------------------------------ */

function configuracio_() {
  var conf = {};
  files_('config').forEach(function (f) {
    var k = text_(f.clau);
    if (k) conf[k] = text_(f.valor);
  });
  return conf;
}

function validaPin_(pin) {
  var props = PropertiesService.getScriptProperties();
  var bloqueigFins = Number(props.getProperty('bloqueig_fins') || 0);
  if (bloqueigFins && Date.now() < bloqueigFins) {
    return { ok: false, error: 'Massa intents. Torna-ho a provar en uns minuts.' };
  }

  var conf = configuracio_();
  var esperat = text_(conf.pin);
  var director = text_(conf.pin_director);
  if (!esperat && !director) {
    return { ok: false, error: 'No hi ha cap PIN a la pestanya Config.' };
  }

  // Un codi buit a Config no ha d'obrir res: per aixo es comprova que hi
  // sigui abans de comparar-lo.
  var escrit = text_(pin);
  var rol = '';
  if (director && escrit === director) rol = 'director';
  else if (esperat && escrit === esperat) rol = 'observador';

  if (rol) {
    props.deleteProperty('errades');
    props.deleteProperty('errades_des_de');
    props.deleteProperty('bloqueig_fins');
    return { ok: true, rol: rol };
  }

  // Comptem errades dins d'una finestra de temps.
  var desDe = Number(props.getProperty('errades_des_de') || 0);
  var errades = Number(props.getProperty('errades') || 0);
  if (!desDe || Date.now() - desDe > FINESTRA_MS) { desDe = Date.now(); errades = 0; }
  errades++;
  props.setProperty('errades_des_de', String(desDe));
  props.setProperty('errades', String(errades));
  if (errades >= MAX_ERRADES) props.setProperty('bloqueig_fins', String(Date.now() + FINESTRA_MS));

  return { ok: false, error: 'PIN' };
}

/* ------------------------------------------------------------------ *
 *  Lectures                                                           *
 * ------------------------------------------------------------------ */

function jugadores_() {
  return files_('jugadores')
    .filter(function (f) { return text_(f.id); })
    .map(function (f) {
      return {
        id: text_(f.id),
        nom: text_(f.nom),
        any_naixement: num_(f.any_naixement),
        club: text_(f.club),
        equip: text_(f.equip),
        categoria: text_(f.categoria),
        posicio: text_(f.posicio),
        alcada: text_(f.alcada),
        dorsal: text_(f.dorsal),
        creada_per: text_(f.creada_per),
        data_creacio: text_(f.data_creacio)
      };
    });
}

function captacio_() {
  return files_('captacio')
    .filter(function (f) { return text_(f.id_jugadora); })
    .map(function (f) {
      return {
        id_jugadora: text_(f.id_jugadora),
        prioritat: text_(f.prioritat),
        estat: text_(f.estat),
        contacte: text_(f.contacte),
        propera_accio: text_(f.propera_accio),
        data_propera_accio: text_(f.data_propera_accio),
        actualitzat_per: text_(f.actualitzat_per),
        data_actualitzacio: text_(f.data_actualitzacio)
      };
    });
}

/* Els punts forts i el que ha de millorar es desen com a text separat per
   comes i no com a JSON: aquesta pestanya l'ha de poder llegir una persona. */
function senior_() {
  return files_('senior')
    .filter(function (f) { return text_(f.id); })
    .map(function (f) {
      return {
        id: text_(f.id),
        nom: text_(f.nom),
        equip: text_(f.equip),
        any_naixement: num_(f.any_naixement),
        posicio: text_(f.posicio),
        punts_forts: llista_(f.punts_forts),
        a_millorar: llista_(f.a_millorar),
        nivell: text_(f.nivell),
        interes: text_(f.interes),
        notes: text_(f.notes),
        actualitzada: text_(f.actualitzada)
      };
    });
}

function observacions_(idJugadora) {
  return files_('observacions')
    .filter(function (f) {
      return text_(f.id) && (!idJugadora || text_(f.id_jugadora) === idJugadora);
    })
    .map(function (f) {
      return {
        id: text_(f.id),
        id_jugadora: text_(f.id_jugadora),
        data: text_(f.data),
        responsable: text_(f.responsable),
        competicio: text_(f.competicio),
        rival: text_(f.rival),
        minuts_vistos: num_(f.minuts_vistos),
        rol_equip: text_(f.rol_equip),
        val_ara: desJson_(f.val_ara) || {},
        val_sostre: desJson_(f.val_sostre) || {},
        perfil_conducta: desJson_(f.perfil_conducta) || {},
        notes: text_(f.notes)
      };
    });
}

/* ------------------------------------------------------------------ *
 *  Accions                                                            *
 * ------------------------------------------------------------------ */

function bootstrap_(rol) {
  var conf = configuracio_();
  return json_({
    ok: true,
    data: {
      // El PIN no surt mai d'aqui: el mobil no l'ha de rebre ni desar.
      config: {
        responsables: llista_(conf.responsables),
        categories: llista_(conf.categories),
        posicions: llista_(conf.posicions),
        senior_punts: llista_(conf.senior_punts),
        senior_nivell: llista_(conf.senior_nivell),
        senior_interes: llista_(conf.senior_interes)
      },
      rol: rol,
      // La llista senior no surt del full si qui pregunta no es el director.
      senior: rol === 'director' ? senior_() : [],
      jugadores: jugadores_(),
      captacio: captacio_(),
      ts: ara_()
    }
  });
}

function getJugadora_(id) {
  id = text_(id);
  if (!id) return json_({ ok: false, error: 'Falta l\'id.' });
  var j = jugadores_().filter(function (x) { return x.id === id; })[0];
  if (!j) return json_({ ok: false, error: 'No hi ha cap jugadora amb aquest id.' });
  var cap = captacio_().filter(function (c) { return c.id_jugadora === id; })[0] || null;
  return json_({ ok: true, data: { jugadora: j, captacio: cap, observacions: observacions_(id) } });
}

function saveJugadora_(p) {
  if (!text_(p.id)) return json_({ ok: false, error: 'Falta l\'id de la jugadora.' });
  if (!text_(p.nom)) return json_({ ok: false, error: 'Falta el nom.' });
  var r = desa_('jugadores', {
    id: text_(p.id),
    nom: text_(p.nom),
    any_naixement: num_(p.any_naixement),
    club: text_(p.club),
    equip: text_(p.equip),
    categoria: text_(p.categoria),
    posicio: text_(p.posicio),
    alcada: text_(p.alcada),
    dorsal: text_(p.dorsal),
    creada_per: text_(p.creada_per),
    data_creacio: text_(p.data_creacio) || ara_()
  });
  return json_({ ok: true, data: { id: r.id } });
}

function saveObservacio_(p) {
  if (!text_(p.id)) return json_({ ok: false, error: 'Falta l\'id de l\'observacio.' });
  if (!text_(p.id_jugadora)) return json_({ ok: false, error: 'Falta la jugadora.' });
  // Cada visita es una fila nova; desa_ nomes reescriu si torna el MATEIX id,
  // cosa que passa quan la cua offline reenvia una operacio ja desada.
  var r = desa_('observacions', {
    id: text_(p.id),
    id_jugadora: text_(p.id_jugadora),
    data: text_(p.data) || ara_(),
    responsable: text_(p.responsable),
    competicio: text_(p.competicio),
    rival: text_(p.rival),
    minuts_vistos: num_(p.minuts_vistos),
    rol_equip: text_(p.rol_equip),
    val_ara: p.val_ara || {},
    val_sostre: p.val_sostre || {},
    perfil_conducta: p.perfil_conducta || {},
    notes: text_(p.notes)
  });
  return json_({ ok: true, data: { id: r.id } });
}

function saveCaptacio_(p) {
  if (!text_(p.id_jugadora)) return json_({ ok: false, error: 'Falta la jugadora.' });
  desa_('captacio', {
    id_jugadora: text_(p.id_jugadora),
    prioritat: text_(p.prioritat),
    estat: text_(p.estat),
    contacte: text_(p.contacte),
    propera_accio: text_(p.propera_accio),
    data_propera_accio: text_(p.data_propera_accio),
    actualitzat_per: text_(p.actualitzat_per),
    data_actualitzacio: text_(p.data_actualitzacio) || ara_()
  });
  return json_({ ok: true, data: { id_jugadora: text_(p.id_jugadora) } });
}

/**
 * Una fila per jugadora: tornar-la a desar reescriu la que hi havia. Nomes
 * la direccio esportiva, i es comprova aqui: amagar el boto al mobil no
 * serveix de res si la peticio es pot enviar igualment.
 */
function saveSenior_(p, rol) {
  if (rol !== 'director') {
    return json_({ ok: false, error: 'Aquesta llista es nomes de la direccio esportiva.' });
  }
  if (!text_(p.id)) return json_({ ok: false, error: 'Falta l\'id.' });
  if (!text_(p.nom)) return json_({ ok: false, error: 'Falta el nom.' });

  var r = desa_('senior', {
    id: text_(p.id),
    nom: text_(p.nom),
    equip: text_(p.equip),
    any_naixement: num_(p.any_naixement),
    posicio: text_(p.posicio),
    punts_forts: (p.punts_forts || []).join(', '),
    a_millorar: (p.a_millorar || []).join(', '),
    nivell: text_(p.nivell),
    interes: text_(p.interes),
    notes: text_(p.notes),
    actualitzada: ara_()
  });
  return json_({ ok: true, data: { id: r.id } });
}

/** Executa una operacio de la cua i retorna un objecte pla (no HTTP). */
function executa_(action, payload, rol) {
  var resposta;
  switch (action) {
    case 'saveJugadora':  resposta = saveJugadora_(payload || {}); break;
    case 'saveObservacio': resposta = saveObservacio_(payload || {}); break;
    case 'saveCaptacio':  resposta = saveCaptacio_(payload || {}); break;
    case 'saveSenior':    resposta = saveSenior_(payload || {}, rol); break;
    default: return { ok: false, error: 'Accio desconeguda: ' + action };
  }
  return JSON.parse(resposta.getContent());
}

/**
 * Buida la cua del mobil. Una operacio que falla no atura les altres: cada
 * una torna el seu resultat amb el seu opId i el mobil ja decideix.
 */
function sync_(operacions, rol) {
  var resultats = (operacions || []).map(function (op) {
    var r;
    try {
      r = executa_(text_(op.action), op.payload, rol);
    } catch (err) {
      r = { ok: false, error: String(err && err.message ? err.message : err) };
    }
    return { opId: text_(op.opId), ok: !!r.ok, error: r.ok ? '' : (r.error || 'Error desconegut') };
  });
  return json_({ ok: true, data: { resultats: resultats } });
}

/* ------------------------------------------------------------------ *
 *  Entrada HTTP                                                       *
 * ------------------------------------------------------------------ */

/* Res de dades per GET: qui obri la URL amb el navegador no ha de veure el
   contingut del full. Tota lectura passa per doPost amb PIN. */
function doGet() {
  return ContentService
    .createTextOutput('Scouting MCBF — servei intern. Cal fer servir l\'app.')
    .setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return json_({ ok: false, error: 'El full esta ocupat. Torna-ho a provar.' });
  }

  try {
    var body = JSON.parse(e.postData.contents);
    var action = text_(body.action);

    var pin = validaPin_(body.pin);
    if (!pin.ok) return json_(pin);
    var rol = pin.rol;

    switch (action) {
      case 'bootstrap':      return bootstrap_(rol);
      case 'getJugadora':    return getJugadora_(body.id);
      case 'saveJugadora':   return saveJugadora_(body.payload || {});
      case 'saveObservacio': return saveObservacio_(body.payload || {});
      case 'saveCaptacio':   return saveCaptacio_(body.payload || {});
      case 'saveSenior':     return saveSenior_(body.payload || {}, rol);
      case 'sync':           return sync_(body.operacions, rol);
      default:               return json_({ ok: false, error: 'Accio desconeguda: ' + action });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}
