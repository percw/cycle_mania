SUMMIT — evaluering, runde 2

For rotagenten, før spilleragentene startes:
1. Fullfør appendringer og automatisert testing. Hold deretter appen/evidensen fast gjennom alle 20 vurderinger.
2. Legg et frosset evidensgrunnlag i evidence/, gjerne kopier av skjermbilder og testresultater. Ikke ta med tidligere dommer, snitt eller rotagentens konklusjoner.
3. Opprett evidence-manifest.json med dette formatet:
   {
     "frozen": true,
     "build_description": "Kort nøktern beskrivelse av versjonen, uten vurderinger",
     "captured_at": "ISO8601",
     "allowed_files": ["evaluation-v2/evidence/tron.png", "src/game.ts"],
     "sha256": {"evaluation-v2/evidence/tron.png": "...", "src/game.ts": "..."},
     "screenshots": [
       {"path": "evaluation-v2/evidence/tron.png", "shows": "Aktiv Tron-scene", "category": "active_tron"}
     ],
     "runtime_notes": ["Nøkterne begrensninger: mockede sensorer, akselerert tid, osv."]
   }
   Alle filstier er relative til prosjektroten. Hashkartet må dekke nøyaktig allowed_files. Bare filene i listen kan leses av spillerne, i tillegg til protokoll, profil, skjema, mal og manifest. Minst ett bilde av hver kategori kreves av protokollen: active_tron, active_other, result_or_analysis, launcher_or_progression, mobile. Kategoriene er beskrivende metadata; kontroller at bildene faktisk viser dette.
4. Spawn 20 ferske gpt-5.6-sol-agenter med fork_turns=none. Bruk player-invocation.txt og hver uendrede profil fra profiles.json. Ikke del gammel samtale, gamle skårer eller nye foreløpige resultater. Kjør i puljer etter tilgjengelige slots. Ingen parallell GPU-nettleser er nødvendig; agentene leser den samme frosne evidensen.
5. Hver spiller skriver bare players/NN.json og NN.txt. Oppdagede formatfeil kan returneres til samme agent uten å foreslå skår eller dom. Ved kontaminasjon behold originalfilen utenfor players/ og bruk en fersk agent for samme profil. Loggfør slike erstatninger separat etter evalueringen; ikke la andre spillere lese loggen.
6. Bygg en ærlig delrapport når som helst:
   python3 evaluation-v2/build-report.py
   Manglende profiler blir listet og teller aldri som utført.
7. Når alle 20 filer er gyldige og alle agenter er ferdige:
   python3 evaluation-v2/build-report.py --freeze
   Dette låser 40 domfiler, profilene og evidensmanifestet med SHA-256. Endringer etter frysing avvises.
8. Først da kan historisk aggregat åpnes:
   python3 evaluation-v2/build-report.py --compare ../evaluation/report.json
   Kun de seks opprinnelige skårene sammenlignes. Nye treningsskårer vises separat. Ingen p-verdier, kausal effekt eller menneskelig retensjon hevdes.

Rapporten er en selvstendig HTML-fil med søk og filter, pluss JSON/CSV. Ingen eksterne ressurser eller nettverk trengs. Den kan åpnes direkte eller serveres som en statisk mappe.
Alle resultater er syntetiske modellvurderinger. En gjennomført serie på 20 er ikke en faktisk brukertest, og vurderingene er ikke uavhengige menneskelige datapunkter.
