# Scouting MCBF

PWA interna de la Direcció Esportiva del Manresa CBF per registrar i consultar,
des del mòbil i dins el pavelló, la informació de jugadores observades en altres
equips.

App **independent** de `manresa-hub` i de `jugadores`: full de càlcul propi,
desplegament d'Apps Script propi i PIN propi. No comparteix res amb elles.

- Frontend estàtic: HTML + CSS + JavaScript, sense frameworks, sense build i
  **sense cap dependència externa ni CDN** (ha de funcionar sense cobertura).
- Backend: Google Apps Script sobre el full **Scouting MCBF**.

## Fitxers

| Fitxer | Què és |
|---|---|
| `index.html` | Marcatge, estils i `CONFIG.API_URL` |
| `app.js` | Tota la lògica: cua offline, pantalles, matriu de decisió |
| `service-worker.js` | Còpia local de l'app per obrir-la sense xarxa |
| `manifest.json` | Fa que s'instal·li com a app |
| `Codi_AppsScript.gs` | Backend: enganxa'l dins el full de càlcul |
| `icon-*.png` | Icones de l'app |

## Posar-ho en marxa

### 1. El full de càlcul

1. Crea un Google Sheet nou anomenat **Scouting MCBF**.
2. **Extensions → Apps Script**, enganxa-hi `Codi_AppsScript.gs` sencer i desa.
3. Tria la funció **`setup`** i executa-la (▶). Crea les 4 pestanyes amb les
   capçaleres exactes i la configuració inicial.
4. A la pestanya **Config**, canvia el `pin` (ve amb `1234`) i posa els
   `responsables`.
5. **Desplega → Nou desplegament → Aplicació web**, executant *com a tu* i amb
   accés per a *qualsevol persona*. Copia la URL `/exec`.
6. Enganxa la URL a `CONFIG.API_URL`, dins `index.html`.

El full ha de quedar **restringit** (no "qualsevol amb l'enllaç"). Que el
desplegament sigui obert no l'exposa: el `doGet` no retorna dades i tota
lectura o escriptura passa pel PIN, comprovat al servidor, amb bloqueig de
5 minuts després de 8 errades.

### 2. Publicar

Repositori: <https://github.com/manresacbf/scouting>, amb **Pages** activat
sobre la branca `main` (arrel). Queda servida a
<https://manresacbf.github.io/scouting/>. Ha d'anar per HTTPS o el service
worker no arrenca.

Com que Pages necessita el repositori públic, la URL `/exec` del full és
visible per qualsevol que miri el codi. Això no dona accés a res: el PIN és
l'única porta i es comprova al servidor. Tot i així, **val la pena posar un PIN
de 6 dígits** a la pestanya `Config` en lloc de 4 (l'app ja els accepta sense
canviar res): amb el bloqueig de 8 errades cada 5 minuts, provar-los tots
passaria de dies a segles.

### 3. Instal·lar-la al mòbil

- **Android** (Chrome): menú → *Instal·lar aplicació*.
- **iPhone** (cal **Safari**): Compartir → *Afegir a la pantalla d'inici*.

## Manteniment

**Cada cop que publiquis canvis, puja el número de `VERSIO` a
`service-worker.js`.** Si no, els mòbils que ja tenen l'app instal·lada poden
quedar-se amb la còpia antiga.

Si canvies el `Codi_AppsScript.gs`: **Desplega → Gestiona desplegaments →
editar (llapis) → Versió: Nova versió**. Així la URL `/exec` no canvia i no cal
tocar `index.html`.

Responsables, PIN, categories i posicions es canvien a la pestanya **Config**
del full, sense tocar codi. L'app les rellegeix cada cop que arrenca.

## Com funciona sense cobertura

Tota escriptura va primer a una cua a `localStorage` i la pantalla confirma a
l'instant; l'enviament al full ve després. La pastilla de la capçalera diu
*Sincronitzat* o *N canvis pendents*, i prement-la es força l'enviament.
Es reintenta sol en recuperar connexió i en tornar a obrir l'app.

Cada operació porta un UUID generat al mòbil i el full fa *upsert* per aquest
id: reenviar una operació no duplica mai cap fila. Si el full rebutja un canvi,
la cua el reté i el llistat mostra l'error amb l'opció de reintentar-ho o
descartar-ho.

**Una observació no substitueix mai l'anterior**: cada visita és una fila nova
a `Observacions`. L'historial és el valor de l'app, i la comparativa entre
observadors mostra sempre els tres valors per separat, mai només la mitjana.

## Decisions preses en construir-la

- **Tipografia del sistema** en lloc d'Oswald/Inter: la línia visual és la de
  `manresa-hub`, però carregar-les de Google Fonts trencaria la regla de no
  dependre de cap CDN, i dins el pavelló no hi ha xarxa per anar-les a buscar.
- **Icones copiades de `manresa-hub`**: al mòbil es veuran igual que les altres
  apps del club. Si vols distingir-les, substitueix els tres `icon-*.png`.
- **El PIN no es desa mai al full de retorn**: el `bootstrap` no el torna, així
  no acaba dins el `localStorage` del mòbil.
- **Cap pantalla d'administració, ni fotos, ni camps d'entorn personal**, tal
  com demanen les instruccions.
