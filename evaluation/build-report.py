"""Build a reviewable report from all 20 independent synthetic evaluations."""
import csv
import html
import json
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROFILES = json.loads((ROOT / 'profiles.json').read_text())
RATING_LABELS = {
    'first_fun': 'Første økt', 'third_fun': 'Tredje økt', 'agency': 'Innflytelse og valg',
    'visuals': 'Visuelt inntrykk', 'clarity': 'Forståelighet', 'interval_fit': 'Passer intervallene',
}
players = []
for profile in PROFILES:
    player = json.loads((ROOT / 'players' / f"{profile['id']}.json").read_text())
    assert player['id'] == profile['id']
    assert player['model'] == 'gpt-5.6-sol'
    assert set(player['ratings']) == set(RATING_LABELS)
    assert all(type(n) is int and 1 <= n <= 7 for n in player['ratings'].values())
    assert player['would_return'] in ('yes', 'maybe', 'no')
    assert player['confidence'] in ('low', 'medium')
    assert len(player['journey']) >= 5
    assert len(player['evidence']) >= 3
    assert len(player['frictions']) >= 1
    assert player['limitations'] and player['counterargument']
    players.append({**player, 'assigned_profile': profile['profile']})

summary = {
    'method': '20 independent GPT-5.6 Sol synthetic persona evaluations of the same build; no human participants.',
    'date': '2026-09-30', 'n_scenarios': len(players), 'retained_evaluations': 20, 'agent_invocations': 21, 'excluded_evaluations': 1,
    'limitations': [
        'Ratings and return intentions are model-generated hypotheses, not measured enjoyment or retention.',
        'Personas are intentionally selected for varied priorities; no representative sampling or statistical confidence intervals.',
        'All evaluators share one model family and evidence, so separate contexts do not eliminate correlated judgment.',
        'Screenshots, source and automated traces cannot reproduce exertion, bike feel, sound quality or multi-week use.',
        'No physical sensor, device performance or real-person accessibility claim follows from this evaluation.',
    ],
    'ratings': {key: {
        'mean': round(statistics.mean(p['ratings'][key] for p in players), 2),
        'median': statistics.median(p['ratings'][key] for p in players),
        'min': min(p['ratings'][key] for p in players), 'max': max(p['ratings'][key] for p in players),
    } for key in RATING_LABELS},
    'return_intentions': {k: sum(p['would_return'] == k for p in players) for k in ('yes', 'maybe', 'no')},
    'lower_third_session': sum(p['ratings']['third_fun'] < p['ratings']['first_fun'] for p in players),
    'friction_categories': {k: [p['id'] for p in players if any(f['category'] == k for f in p['frictions'])]
        for k in sorted({f['category'] for p in players for f in p['frictions']})},
}
findings_path = ROOT / 'findings.json'
findings = json.loads(findings_path.read_text()) if findings_path.exists() else []
report = {'summary': summary, 'prioritized_findings': findings, 'players': players}
(ROOT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
with (ROOT / 'ratings.csv').open('w', newline='') as file:
    writer = csv.writer(file)
    writer.writerow(['id', 'persona', *RATING_LABELS, 'would_return', 'preferred_world', 'confidence'])
    for p in players:
        writer.writerow([p['id'], p['persona'], *[p['ratings'][k] for k in RATING_LABELS], p['would_return'], p['preferred_world'], p['confidence']])

e = lambda value: html.escape(str(value), quote=True)
return_labels = {'yes': 'Ja', 'maybe': 'Kanskje', 'no': 'Nei'}
def bullet(items):
    return '<ul>' + ''.join(f'<li>{e(x)}</li>' for x in items) + '</ul>'

cards = []
for p in players:
    rows = ''.join(f'<tr><th>{e(label)}</th><td><meter min="1" max="7" value="{p["ratings"][key]}"></meter> {p["ratings"][key]}/7</td></tr>' for key, label in RATING_LABELS.items())
    evidence = ''.join(f'<li><code>{e(item["path"])}</code> — {e(item["observation"])}</li>' for item in p['evidence'])
    frictions = ''.join(f'<li><strong>{e(f["issue"])}</strong> ({e(f["severity"])}): {e(f["evidence"])}</li>' for f in p['frictions'])
    journey = ''.join(f'<li><strong>{e(j["stage"])}</strong> · {e(j["basis"])}<br>{e(j["reaction"])}</li>' for j in p['journey'])
    cards.append(f'''<article class="player" data-id="{p['id']}" data-first="{p['ratings']['first_fun']}" data-third="{p['ratings']['third_fun']}" data-return="{p['would_return']}">
    <header><span>Profil {p['id']} · GPT-5.6 Sol</span><h3>{e(p['persona'])}</h3></header>
    <p>{e(p['assigned_profile'])}</p><p class="verdict">{e(p['summary'])}</p>
    <div class="bars" aria-label="Simulerte skårer fra 1 til 7"><div><label>Første økt <b>{p['ratings']['first_fun']}/7</b></label><i style="width:{p['ratings']['first_fun']/7*100}%"></i></div><div><label>Tredje økt <b>{p['ratings']['third_fun']}/7</b></label><i class="third" style="width:{p['ratings']['third_fun']/7*100}%"></i></div></div>
    <p><strong>Simulert retur: {return_labels[p['would_return']]}</strong> · Foretrukket verden: {e(p['preferred_world'])}</p>
    <p>{e(p['return_reason'])}</p><p><strong>Viktigste endring:</strong> {e(p['one_change'])}</p>
    <details><summary>Begrunnelse, forløp og evidens</summary><table>{rows}</table>
    <h4>Det som trekker inn</h4>{bullet(p['hooks'])}<h4>Friksjon</h4><ul>{frictions}</ul>
    <h4>Simulert forløp</h4><ol>{journey}</ol><h4>Inspisert evidens</h4><ul>{evidence}</ul>
    <h4>Hva kan gjøre vurderingen feil?</h4><p>{e(p['counterargument'])}</p>{bullet(p['limitations'])}
    <a href="players/{p['id']}.txt">Les agentens rapport</a> · <a href="players/{p['id']}.json">Evidens og skårer</a></details></article>''')

finding_html = ''.join(f'<li><strong>{e(f["priority"])} · {e(f["title"])}</strong><p>{e(f["finding"])}</p><p><b>Forslag:</b> {e(f["change"])}</p><p><b>Prøv med mennesker:</b> {e(f["human_test"])}</p><small>Profiler: {e(", ".join(f["profiles"]))}</small></li>' for f in findings)
means = summary['ratings']
page = '''<!doctype html><html lang="nb"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SUMMIT · 20 simulerte spillere</title>
<style>
:root{color-scheme:dark;font:16px/1.6 system-ui,sans-serif;background:#101919;color:#edf5ed}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:38px 24px 80px}h1{font-size:clamp(30px,5vw,52px);line-height:1.1;margin:12px 0 24px}h2{margin-top:42px}h3{margin:4px 0;font-size:24px}p{max-width:86ch}a{color:#a8ead7}.eyebrow,small,article header span{color:#b8cbbf}.notice{border-left:4px solid #efd789;padding:14px 20px;background:#252820}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.stat{padding:20px;background:#1b2c29;border-radius:12px}.stat b{display:block;font-size:32px;color:#b7eccb}.stat span{font-size:14px}.controls{display:flex;flex-wrap:wrap;gap:16px;position:sticky;top:0;background:#101919f5;padding:14px 0;z-index:2}label{display:block}input,select{background:#1b2c29;color:#fff;border:1px solid #557567;border-radius:6px;padding:10px;font:inherit;max-width:100%}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.player{padding:24px;background:#182522;border:1px solid #354a40;border-radius:12px;min-width:0}.verdict{color:#def1dc}.bars{display:grid;gap:10px;background:#0f1b18;padding:12px;border-radius:8px}.bars label{display:flex;justify-content:space-between;font-size:14px}.bars i{display:block;height:9px;background:#86d8b0;border-radius:4px}.bars i.third{background:#ddb879}details{border-top:1px solid #45604e;margin-top:20px;padding-top:14px}summary{cursor:pointer;color:#b3e8c2}table{width:100%;font-size:14px}th{text-align:left;font-weight:400}td{text-align:right}meter{width:80px}li{margin-bottom:12px}code{overflow-wrap:anywhere;font-size:12px}.findings>li{background:#1b2926;padding:18px 24px;list-style:none;border-radius:10px}.findings{padding:0}button{font:inherit;cursor:pointer}.method{color:#c5d5c9}.evidence-images{display:grid;grid-template-columns:1fr 1fr;gap:16px}.evidence-images figure{margin:0}.evidence-images img{display:block;width:100%;border-radius:10px}.evidence-images figcaption{font-size:13px;color:#b8cbbf}.empty{display:none}footer{margin-top:40px;color:#b8cbbf}@media(max-width:750px){.grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}main{padding:24px 16px}.player{padding:18px}.controls{position:static}}
</style><main><span class="eyebrow">SUMMIT / DESIGNEVALUERING / 30. SEPTEMBER 2026</span><h1>20 simulerte spillere.<br>Hva får dem tilbake?</h1>
<div class="notice"><strong>Dette er ikke en menneskelig brukertest.</strong> Hver profil er evaluert av en egen GPT-5.6 Sol-agent med samme vurderingsskala. Skårer og returvalg er modellens hypoteser basert på skjermbilder, kode og automatiserte tester. De må ikke tolkes som målt spilleglede eller en prognose for ekte brukere.</div>
'''
page += f'''<h2>Oppsummering av de valgte profilene</h2><div class="stats"><div class="stat"><b>{means['first_fun']['mean']:.1f}/7</b><span>Første økt · syntetisk snitt</span></div><div class="stat"><b>{means['third_fun']['mean']:.1f}/7</b><span>Tredje økt · syntetisk snitt</span></div><div class="stat"><b>{means['interval_fit']['mean']:.1f}/7</b><span>Passer intervallene</span></div><div class="stat"><b>{summary['return_intentions']['yes']} / {summary['return_intentions']['maybe']} / {summary['return_intentions']['no']}</b><span>Simulert retur: ja / kanskje / nei</span></div></div>
<p>{summary['lower_third_session']} av 20 profiler fikk lavere skår for forventet tredje økt enn første. Dette er en beskrivelse av disse modellvurderingene, ikke et estimat for en brukergruppe.</p>
<div class="evidence-images"><figure><img src="evidence/neon-flow.png" alt="Neon Rush med wattmål, svevesykkel og spillpanel"><figcaption>Faktisk skjermbilde: Neon Rush.</figcaption></figure><figure><img src="evidence/sky-flow.png" alt="Skybound med sveveøyer og intervallmål"><figcaption>Faktisk skjermbilde: Skybound.</figcaption></figure></div><h2>Prioriterte funn</h2><ol class="findings">{finding_html}</ol>
<h2>Hva bør bevares?</h2><p>Belønning for å følge intervallmålet, inkludert rolig restitusjon; tydelig segmenthopp; pause og gjenoppretting; valget mellom to nye visuelle verdener og originalen. Disse er konkrete styrker som nye spillmekanikker bør bygge videre på.</p><h2>Avveininger</h2><p>Action- og strategiprofiler etterspør flere valg, mens den travle og disiplinerte syklisten kan verdsette automatisk fremdrift. Derfor bør ny spillstyring være valgfri og passe rundt intervallene. Den sosiale profilen savner venner, men dette enkeltfunnet er ikke et krav om å gjøre singleplayer-prosjektet til multiplayer. En strengere presisjonsskala bør heller ikke innføres for alle på grunnlag av de mest konkurranseorienterte profilene.</p><h2>Utforsk alle vurderingene</h2><div class="controls"><label>Profil<input id="search" type="search" placeholder="Søk etter profil eller funn"></label><label>Simulert retur<select id="return"><option value="all">Alle</option><option value="yes">Ja</option><option value="maybe">Kanskje</option><option value="no">Nei</option></select></label><label>Rekkefølge<select id="sort"><option value="id">Profilnummer</option><option value="first">Første økt, høyest først</option><option value="third">Tredje økt, høyest først</option><option value="drop">Størst fall til tredje økt</option></select></label></div><p id="count" aria-live="polite">20 profiler</p><div class="grid">{''.join(cards)}</div>
<h2>Metode og begrensninger</h2><div class="method"><p>Tjue separate agentkontekster, én forhåndsdefinert profil per agent. Alle brukte GPT-5.6 Sol og fikk beskjed om å inspisere minst tre faktiske skjermbilder, lese relevante spillregler og ikke lese andres vurderinger. Én førstevurdering ble utelatt da agenten selv meldte utilsiktet innsyn i et internt sammendrag; profilen ble evaluert på nytt i en fersk kontekst. Totalt 21 agentkall gir 20 beholdte profiler. Root har loggført faktiske evidenskorrigeringer uten å endre skårer eller returvalg. Appen ble holdt uendret under evalueringen. Det er samme modellfamilie i alle kontekster; vurderingene er derfor ikke statistisk uavhengige menneskelige observasjoner.</p><p>Skala: 1 avvisende, 2 stort sett kjedelig/frustrerende, 3 svakt, 4 blandet/tilstrekkelig, 5 engasjerende med tydelige hull, 6 sterkt engasjerende, 7 eksepsjonelt. Langtidsreaksjoner og returvalg er uttrykkelige antakelser. Bilder viser visuelt uttrykk, men tester ikke opplevd fart, lyd, fysisk belastning eller gjentatt bruk over uker.</p><p>Rotagenten kjørte i tillegg seks deterministiske wattforløp gjennom den faktiske spillmotoren. Eksisterende isolerte nettlesertester dokumenterer grensesnitt, gjenkobling og lagring. Det ble ikke koblet til brukerens sensorer eller lagt testøkter i den virkelige databasen.</p></div>
<footer><a href="report.json">Samlet JSON</a> · <a href="ratings.csv">Skårer som CSV</a> · <a href="protocol.txt">Protokoll</a> · <a href="profiles.json">Profiler</a> · <a href="runtime-probes.json">Regelprober</a> · <a href="root-audit.json">Teknisk kontroll</a> · <a href="audit.json">Evidenskorrigeringer</a> · <a href="manifest.json">Versjonsgrunnlag</a> · <a href="human-validation.txt">Plan for mennesketest</a></footer></main>
'''
page += '''<script>
const cards=[...document.querySelectorAll('.player')],grid=document.querySelector('.grid'),search=document.querySelector('#search'),ret=document.querySelector('#return'),sort=document.querySelector('#sort');
function render(){const q=search.value.toLocaleLowerCase('nb');let count=0;const ordered=[...cards].sort((a,b)=>sort.value==='id'?a.dataset.id.localeCompare(b.dataset.id):sort.value==='drop'?(Number(b.dataset.first)-Number(b.dataset.third))-(Number(a.dataset.first)-Number(a.dataset.third)):Number(b.dataset[sort.value])-Number(a.dataset[sort.value]));for(const c of ordered){c.hidden=!(c.textContent.toLocaleLowerCase('nb').includes(q)&&(ret.value==='all'||c.dataset.return===ret.value));if(!c.hidden)count++;grid.append(c)}document.querySelector('#count').textContent=count+' av 20 profiler'}[search,ret,sort].forEach(el=>el.addEventListener('input',render));
</script></html>'''
(ROOT / 'report.html').write_text(page)
print(json.dumps(summary, ensure_ascii=False, indent=2))
