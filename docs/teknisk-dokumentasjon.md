# SUMMIT / Xebex

En lokal sykkelapp med 100 kuraterte intervalløkter, en norsk 3D-verden og mål basert på FTP. React 19, TypeScript, Three.js **0.186.1**, Vite 8, Node og SQLite. Ingen sky-konto er nødvendig.

## Start

Node **22.13+** med `node:sqlite` kreves; prosjektet er utviklet og testet med Node 26.

```sh
npm install
npm run dev
```

Kommandoen starter SQLite-backend på `127.0.0.1:3001` og Vite på adressen terminalen viser, normalt `http://127.0.0.1:5173`. En eksisterende SUMMIT-backend på port 3001 gjenbrukes. Bruk Chrome eller Edge med Web Bluetooth-støtte.

For vanlig bruk uten utviklingsserver:

```sh
npm run build
npm start
```

Åpne **http://127.0.0.1:3001**. `npm run server` starter backend separat med automatisk omstart ved kodeendringer. Ikke restart en aktiv ANT+-bro midt i en økt. `npm run dev:client` starter bare frontend.

## Sykkel, puls og ANT+

- **Bluetooth-sykkel:** FTMS Indoor Bike Data og Cycling Power. Appen leser watt, kadens, fart og puls som konsollen faktisk sender. Den skriver bare til FTMS-kontrollpunktet når du selv har slått på automatisk motstand (ERG) for en sykkel som støtter det (se under). Ellers justerer du motstanden på sykkelen.
- **BLE-puls:** en uavhengig forbindelse til standard Heart Rate Service. Garmin, Suunto, Polar og andre merker fungerer når den aktuelle modellen sender denne standarden. Aktiver eventuelt pulsdeling/broadcast på klokken. Et merke alene garanterer ikke støtte.
- **ANT+:** koble en kompatibel Garmin ANT USB2/USB-m-mottaker til maskinen. Under «Koble til sykkel» velger du «Start ANT+-mottaker». Velg ANT+ som kilde for sykkeldata dersom du bruker watt fra ANT+. Broen leser standard sykkelwatt og puls. Ingen motstandsstyring.
- Den kjente Xebex-konsollen fra 2019 har **BT 62194 / ANT 47963**. ANT-broen filtrerer sykkelwatt til 47963. Konsollnummeret fastslår ikke om Bluetooth-profilen er FTMS, Cycling Power eller proprietær. Broen lytter også etter standard ANT+ Fitness Equipment-målinger med watt. Proprietære protokoller uten disse profilene støttes ikke.
- ANT+-puls velger første oppdagede pulsbelte. API-et støtter `heartRateId` for å låse til ett bestemt belte. USB-mottakeren må være tilgjengelig for appen; lukk annen programvare som bruker den. Manglende mottaker/USB-tilgang vises som en feil, og påvirker ikke BLE eller demomodus.
- Web Bluetooth krever localhost eller HTTPS. Safari og Firefox støtter ikke denne tilkoblingen. ANT+-broen kan fortsatt brukes fra en nettleser som åpner den lokale backend-appen.

Brukeren har bekreftet at BLE fra Xebex gir riktig watt og kadens. Fysisk mottak fra pulsbelte og ANT+-USB må fortsatt verifiseres på utstyret. De automatiserte testene bruker protokollpakker, frakobling og en simulert nettleserforbindelse.

## Automatisk motstand (ERG), kadenssensor og sykkeltest

**ERG.** Smarttrenere som oppgir *wattmål* i FTMS Fitness Machine Feature (0x2ACC) og har kontrollpunkt (0x2AD9), får bryteren «Automatisk motstand (ERG)» under «Koble til sykkel». Bryteren er av som standard og huskes per enhet i nettleseren (`summit-erg:<enhet>`). Når den er på:

- Ved start ber appen om kontroll (0x00), starter (0x07) og setter wattmålet (0x05, sint16 W). Nytt mål skrives bare når målet faktisk endres (blokkbytte, segmenthopp), aldri per sekund.
- Pause sender Stop/Pause med «pause» (0x08 02). Fortsett sender Start (0x07) og målet på nytt. Avsluttet økt sender Stopp (0x08 01) og Reset (0x01). Slås ERG av midt i økten, sendes bare Reset, slik at sykkelen går til fri motstand uten å stoppe.
- Én kommando om gangen, med svar (indikasjon 0x80) og 3 sekunders tidsavbrudd. «Ikke tillatt» gir ett nytt forsøk på å be om kontroll. Andre feil vises som «ERG feil» i cockpiten, uten nye forsøk før neste målendring. Machine Status «kontroll mistet» (0xFF) gjør at kontroll bes om på nytt.
- Wattmålet begrenses til sykkelens Supported Power Range (0x2AD8) og steglengde, og til et tak på 1500 W i appen (800 W hvis sykkelen ikke oppgir område). Ugyldige verdier sendes aldri.
- Brudd på forbindelsen slår ERG av. Etter automatisk gjenkobling er økten pauset, og ERG kobles inn igjen (med ny forespørsel om kontroll) først når du trykker Fortsett.
- Demoturer og FTP-ramptest bruker aldri ERG. I rampen holder du wattmålet selv.
- Cockpiten viser en liten «ERG 245 W»-merkelapp ved wattallet. Med ERG aktiv står det «ERG justerer» i dempet farge i stedet for «Øk/Senk N W».

`src/ftmsControl.ts` har rene kode-/dekodefunksjoner og kontrolleren `FtmsControl`. `src/useErg.ts` avgjør ønsket tilstand fra økten. Simulering av stigning (0x11: vind, stigning, crr, cw) er implementert og testet i modulen, men ikke koblet til verdenene ennå.

**Kadens fra kurbeldata.** Cycling Power-målere gir kadens fra kurbelomdreininger (flagg bit 5), med riktig håndtering av overløp i 16-bits tellere. FTMS-sykler som ikke oppgir kadens i Feature, får kadens fra Cycling Power eller CSC på samme enhet når den finnes. FTMS-kadens vinner når den sendes.

**Kadens-/fartssensor (CSC, 0x1816/0x2A5B).** Under «Flere sensorer» kan en frittstående standard sensor kobles til og huskes. Den gir kadens, og fart med hjulsensor (hjulomkrets 2,105 m), og kadensen brukes når sykkelen ikke sender kadens. Den gir aldri watt. Appen beregner ikke estimerte watt, så rekorder, FTP, ramptest og prestasjoner bygger fortsatt bare på målte watt. Virtuell distanse beregnes som før fra watt.

**Test sykkelen din.** Lenken ved «Start økten» og i sensorvinduet åpner en egen side. Appens egen sykkeltilkobling kobles fra mens du tester, og den huskede sykkelen kobles til igjen når du går ut. Siden kobler til hvilken som helst Bluetooth-enhet og viser standardtjenestene (FTMS, Cycling Power, CSC, Heart Rate, Device Information, Battery) med karakteristikker, og kjente proprietære protokoller (Tacx FE-C over BLE `6E40FEC1-…`, Wahoo `A026…`) som «kjent, ikke støttet ennå». Watt, kadens, fart og puls vises live. Hvis sykkelen støtter wattmål, kan du kjøre en ERG-test: 100 W og deretter 150 W i 10 sekunder hver, med tydelig stoppknapp. Konklusjonen er «Fungerer fullt», «Fungerer uten automatisk motstand» eller «Ikke støttet». «Kopier rapport» kopierer enhetsnavn, produsent/modell/fastvare, tjenester, målinger og testresultat, men ingen enhets-ID eller personlige data. Uten Web Bluetooth foreslår siden Bluefy på iPhone/iPad og Chrome eller Edge ellers.

Verifikasjon: `node scripts/erg-smoke.mjs` bruker ekte nettleser med egen Vite-server og midlertidig SQLite. Den simulerer en FTMS-trener med kontrollpunkt som logger hver skrevne kommando, en trener som bare har Tacx FE-C, og en CSC-sensor. Testen kontrollerer nøyaktig opkodesekvens gjennom start, blokkbytte, pause, frakobling og gjenkobling, ERG av/på og avslutning, at demo og ramptest aldri skriver, og hele sykkeltest-siden. ERG er ennå ikke prøvd på en fysisk smarttrener.

## Under en økt

- **Neste segment** hopper over resten av gjeldende segment.
- **Jeg er ferdig oppvarmet** hopper til første arbeidsdrag.
- Hoppet tid lagres separat og teller ikke som syklet, sonetid, distanse eller mekanisk arbeid.
- Pause/fortsett, lyd ved segmentbytte og fullskjerm. Tastatur: mellomrom for pause/fortsett, `F` for fullskjerm, Escape lukker dialoger.
- Ved brutt/foreldet wattforbindelse pauses ekte økter. Hvis nettleseren har stått helt inaktiv, pauses økten i stedet for å dikte opp historiske målinger.
- Økten har et lokalt kontrollpunkt omtrent hvert femte sekund og ved pause eller segmenthopp. Ved oppfriskning tilbys den i pauset tilstand. Koble til sensorer igjen før du fortsetter.
- Demoturer er tydelig merket, holdes utenfor formstatistikk og kan ikke eksporteres som målte FIT-aktiviteter.

## Lagring og utvikling

SQLite-databasen opprettes som **`data/summit.sqlite`**. Den inneholder økter, målinger, sonetid, segmenthopp, FTP og timerhendelser. Ta backup av hele `data/` når backend er stoppet, eller bruk en SQLite-kompatibel backup mens den kjører. Lokale data er ignorert av Git.

Nettleseren har en lokal reservekopi. Hvis backend er frakoblet, vises dette, og økter synkroniseres når den blir tilgjengelig. Øktoppsummering kan lastes ned som JSON, råmålinger som CSV og ekte sensorøkter som **FIT**. FIT bruker Garmins offisielle encoder med CRC, indoor cycling-aktivitet, effekt, tilgjengelig kadens/puls og pausetidsstempler. Virtuell distanse og manglende GPS/puls diktes ikke inn i FIT-filen.

«Min utvikling» viser historikk, effektrekorder på 5 sekunder / 1 / 5 / 20 minutter, treffsikkerhet mot wattmål og forskjell fra sammenlignbare økter. Ulik økttype eller høyere målwatt er ikke i seg selv dokumentasjon på bedre form.

FTP-anslaget er **95 % av beste sammenhengende målte 20-minuttersperiode**. Det er et øktbasert anslag, ikke en gjennomført FTP-test. Demoturer, datagap og pauser brukes ikke som sammenhengende effektgrunnlag. Rolige økter skal ikke tolkes som fall i FTP, og anslaget endrer aldri innstilt FTP automatisk. TSS er et forenklet planestimat fra intensitet² og tid.

## 3D

Three.js `WebGPURenderer` bruker WebGPU når tilgjengelig og faller automatisk tilbake til WebGL2. Prosedyregenererte fjell, fjord, skog, syklist og løype trenger ingen eksterne 3D-ressurser. Fjordveien, Høyfjell og Midnattssol deler løypegeometri. Neon Rush og Skybound har hver sin geometri, tredelte verden og kjøretøy. Ingen av verdenene er geografisk kartlagte baner. Fontene lastes fra Google Fonts; systemfont brukes uten nett.

## Verifikasjon

```sh
npm test
npm run build
npm run test:sensors
```

Sensor-smoketesten oppretter egen midlertidig SQLite-database og nettleser, parer simulerte BLE-sensorer, sykler gjennom pause/segmenthopp, lagrer og dekoder FIT. Den påvirker ikke personlige treningsdata.

`npm run test:ui` tester grensesnittet på `localhost:5186` med API-forespørsler isolert i testens minne. Start frontend på denne porten før testen. Skjermbilder lagres under `output/ui-expedition/`. Spilltestklienten fra `develop-web-game`-skillen ligger som en uendret lokal kopi i `scripts/game-client.mjs` slik at den kan finne prosjektets Playwright-installasjon.

## Protokoller og kilder

- [Three.js WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Xebex Smart Connect](https://getrxd.com/pages/smart-connect-ecosystem)
- [Bluetooth FTMS](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0-1/)
- [Bluetooth Heart Rate Service](https://www.bluetooth.com/wp-content/uploads/Files/Specification/HTML/HRS_v1.0/out/en/index-en.html)
- [Garmin FIT-protokoll](https://developer.garmin.com/fit/protocol/) og [JavaScript SDK](https://github.com/garmin/fit-javascript-sdk)
- [FTP-baserte effektsoner](https://www.trainingpeaks.com/blog/power-training-levels/)

Sprintsonen over 150 % FTP er en praktisk visningskonvensjon. Biblioteket inneholder 100 kuraterte standardformater og varianter, ikke en dokumentert popularitetsrangering.

## Nye spillverdener og raskere start

**Neon Rush** er en svevesykkeltur gjennom Nova City, reaktortunnelen og orbitalbroen. Three.js RenderPipeline/TSL bloom gir lysende arkitektur, energispor og portaler. **Skybound** følger en gyllen vei mellom svevende øyer, fosser og templer. Fjordveien, Høyfjell og Midnattssol er fortsatt tilgjengelige.

Spillprogresjonen følger treningsplanen:

- Innenfor ±10 % av gjeldende wattmål lades energi; 12 målsekunder gir en puls/et lysfrø.
- 15 sammenhengende målsekunder øker flytnivået, opp til nivå 4. Små avvik har tre sekunders slingringsmonn.
- Gjennomførte segmenter gir én til tre stjerner etter presisjon. Minst 85 % av segmentet må være observert; segmenthopp gir ikke stjerner.
- Rolige pauser og nedkjøring gir også energi når pausens lavere mål følges. Høyere watt enn målsonen gir ikke flere poeng.
- Ekte turer bygger nivå og lagrer poengforløpet i SQLite. Beste tur i samme verden og økt kan vises som en gjennomsiktig rival. Sammenligningen gjelder spillpoeng/presisjon, ikke dokumentert kondisjonsendring.
- Demoturer har egne øvingspoeng og påvirker ikke karrieren. Lydknappen aktiverer korte, syntetiske kvitteringer for pulser, stjerner og segmentbytte.

Designet bruker tydelige delmål, umiddelbar tilbakemelding, valgfri utforsking og egen mestring som grunnlag for motivasjon. Inspirasjon: [motivasjonsmodellen for spill fra Przybylski, Rigby og Ryan](https://www.selfdeterminationtheory.org/SDT/documents/2010_PrzybylskiRigbyRyan_ROGP.pdf), [Sid Meiers GDC-foredrag om interessante valg](https://gdcvault.com/play/1016165/Interesting), og [Criterion Games om kjørefølelse](https://media.gdcvault.com/gdc2018/presentations/Harris_Matthew_VehicleFeelMasterclass.pdf). Dette er designinspirasjon, ikke dokumentasjon på at denne appen vil engasjere alle likt.

Trykk **Start økten** direkte. Første gang velger du sykkelen i nettleserens tillatelsesvindu; økten starter når ferske wattdata kommer. Sykkel og pulsbelte huskes etter vellykket tilkobling. Appen forsøker stille gjenkobling ved åpning og opptil tre ganger etter uventet brudd. En gjenopprettet økt forblir pauset til du fortsetter. Under **Sensorinnstillinger** kan du slå av automatikk eller glemme sykkelen. Nettlesere uten [`Bluetooth.getDevices()`](https://developer.mozilla.org/en-US/docs/Web/API/Bluetooth/getDevices) trenger fortsatt enhetsvelgeren; nye tillatelser krever alltid et brukertrykk.

Utvidet verifikasjon: `node scripts/gameplay-smoke.mjs` bruker bygd app på port 3001 (eller `SUMMIT_UI_URL`) med API-data isolert i testens minne. Sensor-smoketesten bruker egen midlertidig SQLite og verifiserer også ett-klikksstart og automatisk gjenkobling etter reload. Skjermbilder fra de nye verdenene ligger under `output/gameplay-expedition/` og `output/playwright/`.

## Ekspedisjoner og veivalg

Neon Rush og Skybound har to fysiske veier: **Gjenreis** samler energikjerner til landemerker og broer, mens **Utforsk** tar høyveien og samler relikvier. Valget trer visuelt i kraft ved neste felles veiskille. HUD-en viser navnet og fremgangen mot neste landemerke.

- En port krever 30 målsekunder for Gjenreis eller 40 for Utforsk. Målsekunder betyr watt innenfor ±10 % av øktens gjeldende mål, også i rolige segmenter. Avvik stopper ladingen uten å slette den.
- Når porten åpner, kan du velge neste retning med knapp eller `1`/`2`. Etter 12 sekunder fortsetter samme retning automatisk. Pause fryser også valgvinduet.
- Hver verden har seks byggverk og seks relikvier med stigende krav. Lagrede ekte økter teller samlet; kartet, oppsummeringen og 3D-verdenen viser fremgangen. Demoturer lar deg prøve mekanikken uten å endre den lagrede verdenen.
- Standardøkten for nye brukere er 20 minutter lett sykling. Sist valgte økt huskes. «Allerede oppvarmet» kan velges før start.
- Watt, mål, segmenttimer og øktkontroller samles nederst. Poeng og sammenligning med egen rekord finnes under detaljer.

`npm run test:expedition` tester porter, valgenes følger, lagret kampanje, pause, segmenthopp, demoskille og mobilkontroller med isolerte API-data. Testen bruker bygd app på port 3001, eller `SUMMIT_UI_URL`. Skjermbilder og resultat lagres i `output/expedition/`. Sensor-smoketesten verifiserer dessuten at ekspedisjonsdata bevares gjennom SQLite-omstart og FIT-eksport.

Den tidligere evalueringen med 20 simulerte spillere ligger i `evaluation/`. Den beskriver versjonen før ekspedisjonene, og er modellbasert designkritikk, ikke målt glede eller bruk hos mennesker.

## TRON / The Grid og dokumenterte prestasjoner

The Grid er en egen lyssykkelløype med svart grid, cyan/oransje konturer, lysvegg og tre sektorer. Originale verdener beholdes. Oppgraderinger er deterministiske og beregnes fra lagrede, ekte målinger i alle verdener:

- **Presisjon:** minst 300 målte sekunder i hoveddelen, minst 90 % innenfor wattmålet → cyan hjulkrans.
- **Utholdenhet:** minst 1200 målte sekunder i én økt, minst 80 % innenfor målet → opplyste grid-tårn.
- **Pausekontroll:** minst 180 målte sekunder i aktive pauser, minst 90 % innenfor pausens mål → systembuer i kjernesektoren.
- **Kontinuitet:** tre ulike lokale treningsdager, hver med en økt på minst 600 målte sekunder og 80 % innenfor målet → lengre lysspor og karosserilys.

Alle krever minst 95 % datadekning og kjent wattmål. Målområdet er ±10 %; ekstra watt over målområdet gir ingen fordel. Hoppet tid og demo gir ingen varige belønninger. En prestasjon kan forhåndsvises under en tur, men beholdes først når en ekte økt er lagret. Kravene vises på startsiden for The Grid, og oppsummeringen viser målegrunnlaget for nye prestasjoner.

Treningsanalysen kommer før spillresultatene. Den viser syklet/planlagt tid, måledekning, watt mot mål, arbeid/pause-presisjon og resultat per del av økten. `workoutSecond` i hver ny måling bevarer plasseringen i planen gjennom segmenthopp. Eldre økter med hopp uten denne posisjonen markeres som ukjent blokkfordeling. Pauser og datagap bryter sammenhengende effektvinduer; sammenligninger krever samme plan og FTP, tilstrekkelig dekning og sammenlignbar gjennomføring. Spillresultatene ligger i en egen utvidbar seksjon.

`node scripts/tron-smoke.mjs` kjører isolert nettlesertest og skriver evidens til `evaluation-v2/evidence/`. Måledata i denne testen er syntetiske fixtures og skrives aldri til personlige treningsdata. Den nye evalueringen med 20 GPT-5.6 Sol-profiler ligger under `evaluation-v2/`; dette er modellvurderinger, ikke menneskelige brukertester.


## Forgrenede Tron-kapitler

The Grid har nå fire kapitteltemaer med tre etapper hver. Valgrekkefølgen bestemmer destinasjoner og finale: eksempelvis bro → lyshage → frøarkiv, eller skjult arkiv → frøbank → grønn forbindelse. Bro, datavault, lyshage og signaltårn har egne 3D-former som endres og passeres etter hvert som målsekundene samles. Temaene gjentas etter fire kapitler; dette er en avgrenset kampanje, ikke endeløst unikt innhold.

Startsiden viser neste etappe og følgene av begge valg. Under sykling viser et kompakt panel stedet og fremdriften; åpne panelet for krav og treningsprestasjoner. Bruk knappene eller `1`/`2` ved fullført etappe, eller la samme retning fortsette automatisk etter 12 sekunder. Pause fryser valgvinduet. Wattmålet fra intervallplanen bestemmer fremdriften, også under restitusjon.

Fullførte etapper og valgt retning utledes fra lagrede ekte ekspedisjoner. Neste økt beholder valgt destinasjon; uferdig ladning starter på nytt når en økt avsluttes. En pauset økt som gjenopptas fra checkpoint beholder også ladningen. Demo har separat fremdrift. Øktoppsummeringen viser de besøkte stedene etter treningsanalysen.

Verifikasjon: `node scripts/journey-smoke.mjs` bruker bygd app (standardport3001) og isolerte API-data; kontrollerer alle fire destinasjoner, kapittelfinale, pause, reload, mobil og kvittering. `SUMMIT_SENSOR_WORLD=tron node scripts/sensor-smoke.mjs` bruker simulert BLE og egen midlertidig SQLite; kontrollerer også valgt destinasjon etter backend-omstart og gyldig FIT. Resultater: `output/journey/` og `output/playwright/sensor-smoke-tron/`.

Evalueringen i `evaluation-v2/` beskriver versjonen før disse kapittelløpene. Dens opprinnelige kildekode, skjermbilder og produksjonsbygg er bevart under `evaluation-v2/frozen-build/`; rapportgeneratoren verifiserer disse arkivfilene. Tidligere skårer er ikke justert etter de nye endringene.

### Egne intervalløkter

Velg **Bygg egen økt** i treningsrommet eller øktbiblioteket. Start fra 6 × 6 × 40/40, 3 × 13 × 30/15, 8 × 4 min eller et tomt oppsett. Hver blokk har antall serier, drag per serie, wattmål i prosent av FTP, dragpause og seriepause. Legg til, kopier og flytt blokker for ulike lengder, mål og pauser gjennom økten. Oppvarming og nedtrapping kan slås av.

Alle deler kan styres av sekunder, minutter, meter eller kilometer. Seriepause erstatter dragpause mellom seriene og brukes før neste blokk; det legges ingen ekstra pause etter siste drag i hele hoveddelen. Distanser følger appens virtuelle meter beregnet fra watt. Forhåndsvisningens tid, sonefordeling og TSS bruker 30 km/t som anslag; selve syklingen avslutter distansedelen ved oppnådd antall meter.

Egne maler lagres både lokalt i nettleseren og i SQLite (`/api/workouts`). Uten backend køes endringene til neste åpning. Hver gjennomført økt beholder en kopi av planen, faktisk tid og virtuelle meter per del og hvilke deler du hoppet over. Senere redigering eller sletting av malen endrer derfor ikke historikken. FIT-eksport gjelder gjennomførte, målte økter som før.

### Vestlandsveien – naturtro verden

Velg **Vestlandsveien** i verdensvelgeren. En oppdiktet, vestlandsinspirert rundløype følger fjordkanten, skogen og en liten bygd. Ruten er en sammenhengende 8,4 km virtuell løype med terreng i meterskala, asfalt og gruskanter, autovern, vegetasjon og hus. Velg mellom **Vei** i sykkelhøyde, **Utsikt** med høyere kamera og **Styre** med synlige armer, hender og integrert aerostyre sett mer ovenfra. Styrevisningen bruker en lokalt lagret, fotorealistisk 2,5D-forgrunn med gjennomsiktig bakgrunn, bevart bildeformat og separat utsnitt for smale skjermer. Den er AI-generert med innebygd imagegen; kildefil og full prompt finnes under `public/assets/rider/` (`aero-cockpit-v1.png` og `aero-provenance.json`). Kameravalget huskes lokalt. Bakker er visuelle og endrer ikke øktens wattmål eller sykkelens motstand.

Kamerabevegelsen interpolerer øktens registrerte posisjoner med 300 ms visuell buffer for jevn bevegelse mellom appens fire oppdateringer per sekund. Økttid og lagret distanse bruker de opprinnelige målingene. Scenen beregner ikke videre bevegelse ved manglende oppdateringer; pause stopper ved registrert posisjon. Vegetasjonen er delt i lokale grupper slik at områder utenfor kameraets og skyggenes synsfelt kan utelates fra tegningen.

Materialene bruker originale CC0-fotografier og HDR-belysning fra Poly Haven. Alle 11 ressurser (ca. 13,7 MB) ligger lokalt under `public/assets/vestland`; opphav, kilder og SHA256 finnes i `credits.json`. Verdenen lastes først når den velges og krever ingen eksterne bilde-/karttjenester under turen. Three.js bruker WebGPU med WebGL2-reserve. Miljøet er en sanntidsrekonstruksjon, ikke foto/video eller en geografisk nøyaktig kopi av en virkelig vei.

Validering: `node scripts/real-world-smoke.mjs` tester ekte 3D med isolert API, alle tre sektorer, kamerabytte, pausing, segmenthopp, rundeovergang, gjenopptakelse, mobilkontroller og lagret øktdata. Geometritestene kontrollerer lukket løype, 8,4 km lengde og at terrenget ligger under asfaltflaten.


### FTP-ramptest og utvikling

Åpne **FTP-test** i hovedmenyen (også tilgjengelig i treningsrommet). Velg standard **100 W + 20 W/min** eller rolig start **50 W + 10 W/min**. Testen har fem minutter oppvarming, ett minutts wattsteg og tre minutter nedkjøring. Du regulerer tråkk/motstand selv på Xebex; dette er ikke automatisk ERG-styring. Sitt og følg målene uten en avsluttende spurt.

Trykk **Jeg klarer ikke mer** når du ikke klarer wattmålet. Etter de første to rampeminuttene starter nedkjøringen også automatisk ved ti sammenhengende sekunder med ferske watt under 80 % av målet. Sensorbrudd gir pause og ugyldig test, ikke automatisk godkjent utmattelse. Ingen testsegmenter kan hoppes over. **Lagre test** lar deg avslutte nedkjøringen tidligere; resultatet bruker bare rampedelen.

FTP-anslaget er avrundet én gang fra **75 % av beste sammenhengende 60 målte sekunder** i rampen, også på tvers av delvis fullførte wattsteg. Metodegrunnlag: [TrainerRoads forklaring](https://support.trainerroad.com/hc/trainerroad-support/articles/360003910912-how-to-test-with-the-ramp-test). Dette er et anslag, ikke en direkte måling av terskeleffekt. Appens egne kvalitetskrav er minst fem rampeminutter, minst 95 % målte sekunder og minst 85 % måloppnåelse innenfor ±15 % (siste 15 sekunders naturlige effektfall holdes utenfor måloppnåelsen). Et helt målt, ubrutt minutt må finnes. Demo, pauser/gjenåpning under rampen, avbrudd og fullførte 40 maksimaltrinn gir ikke en anvendbar FTP. Vanlige økters 20-minuttersanslag brukes ikke på ramptester.

Resultatet viser beste minutt, wattdekning, rampetid, fullførte trinn og endring mot forrige gyldige test med **samme protokoll**. **FTP over tid** viser graf og tabell, med egne protokollfiltre. Bruk samme sykkel, kalibrering og omtrent like forhold; små forskjeller kan være normal variasjon. Protokollen lagres med hver økt og gjentas med samme absolutte watt selv om profilens FTP endres. Ugyldige forsøk beholdes med forklaring; demo inngår ikke i fremgangskurven.

FTP endres kun med **Bruk … W som FTP**. Valget lagres lokalt og i SQLite-profilen; ved frakoblet backend køes profilen for senere synkronisering. Testmetadata, råmålinger og tidligere resultater beholdes ved profilendring. Ekte måledata kan eksporteres som FIT med eksisterende eksportknapp.

Validering: `node scripts/ramp-smoke.mjs` kjører gjentatte tester gjennom simulerte BLE-pakker, isolert SQLite, profilaksept, automatisk slutt, sensorbrudd, pauser, demo, nedkjøring, trinngrense og mobilvisning. `src/rampTest.test.ts` tester beregning og datakvalitet; `server/ramp-test.test.mjs` tester validering, databasestart og FIT-rundtur. Testene bruker aldri brukerens database eller fysiske sensorer.

## Treningscockpit, øktrapport og utvikling

**Cockpit under økten.** Appmenyen skjules mens du sykler. Nederst ser du watt som 3 sekunders snitt (som på en sykkelcomputer; lagrede målinger er fortsatt rådata hvert sekund), wattmålet og et målbånd for ±10 %. Markøren viser hvor du ligger, og teksten sier hva du skal gjøre: «Øk 24 W», «Senk 18 W» eller «I målområdet». Farger betyr det samme overalt: grønn = i målområdet, blå = mer kraft, oransje = mindre. Skjermkanten lyser i samme farge, slik at du kan følge målet med perifersynet. I pauser og oppvarming er oransje dempet, fordi litt for mye der ikke er en feil.

- Timeren viser tid eller virtuelle meter igjen av blokken, sonen og snittet i blokken så langt.
- «Neste» viser kommende blokk og den etter. De siste fem sekundene teller en stor 3‑2‑1 ned med neste wattmål (lydsignal når lyd er på).
- Etter hvert arbeidsdrag som faktisk ble syklet, vises en kort kvittering: snittwatt, mål og andel tid i målområdet. Hoppede drag gir ingen kvittering.
- Øktgrafen viser hele planen i sonefarger med ditt faktiske wattspor og en markør for hvor du er.
- **Fokusmodus** (øyeknappen eller `H`) skjuler alle spillpaneler og veivalg. Bare treningen vises.

**Øktrapport.** Etter økten, og fra historikken, åpnes en egen side:
- En samlet vurdering og en ring for andelen av hoveddelen innenfor målet.
- Nøkkeltall: tid, snitteffekt, normalisert effekt (NP), IF og TSS beregnet fra målte watt, arbeid, puls, kadens og distanse.
- Et interaktivt wattdiagram med målområdet, sonefarger, FTP-linje og puls. Hold over eller trykk for å lese et sekund.
- Ett kort per drag, sonefordeling, effektrekorder og FTP-anslag.
- Spillresultater ligger sammenfoldet nederst.
- Ramptester viser FTP-resultatet i stedet for treffsikkerhet.

NP krever minst ti minutter med målte watt. Pauser og datagap bryter 30-sekundersvinduene, og demoturer får ingen NP eller TSS.

**Min utvikling.** Ukesbelastning (TSS og minutter) for de siste åtte ukene, rullerende 28 dager mot de 28 før, og en effektkurve med beste watt for 5 sekunder til 60 minutter. Kurven sammenligner alle økter med de siste seks ukene. Hver økt i listen viser verden, sonefordeling, tid, snittwatt og TSS. Økter uten wattdata får ukjent belastning, aldri null.

Logikken ligger i `src/cockpit.ts`, `src/reportInsights.ts` og `src/trends.ts` og er dekket av enhetstester. Formlene følger TrainingPeaks' definisjoner av NP, IF og TSS. Det er beregninger fra dine målinger, ikke laboratoriemålinger.

## Farger: «Nordisk skumring»

Grensesnittet bygger på fjorden en vinterkveld. Bakgrunnen er blekksvart med et kjølig blåskjær, teksten er varm beinhvit, og det finnes én signaturfarge: **alpeglød**, den dempede korallgløden på fjelltopper ved solnedgang. Alpeglød brukes sparsomt: på primærknapper, aktiv meny, logo og én overskrift per side. Øvrige farger brukes bare når de betyr noe:

| Token | Verdi | Bruk |
|---|---|---|
| `--bg` | `#0c0f14` | Bakgrunn (fjordblekk) |
| `--panel` / `--panel-2` | `#151a22` / `#1b212b` | Flater og hevede flater |
| `--line` | `#262e3b` | Linjer og rammer |
| `--text` / `--text-2` / `--muted` | `#f2eee8` / `#b8bec8` / `#8d95a2` | Tekst i tre nivåer |
| `--accent` | `#f48468` | Alpeglød: handling og merkevare |
| `--good` | `#6ed3a6` | I målområdet, presis gjennomføring |
| `--info` | `#79b8ee` | Under mål (øk kraften) |
| `--warn` | `#f2b356` | Over mål (senk kraften) |

Treningssonene beholder sine kjente farger. Gult og oransje vises aldri med lav opasitet på mørk bakgrunn, fordi dempet gult blir oliven. Grafer bruker derfor nøytrale grafittflater, og sonefargen ligger i selve linjen eller i blokken du er i. Tokenene står i `:root` øverst i `src/styles.css`. 3D-verdenene har egne fargepaletter og påvirkes ikke.
