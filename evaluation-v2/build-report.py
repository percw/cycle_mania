"""Validate and aggregate synthetic judgments; reveal baseline only after freezing all 20.

python3 evaluation-v2/build-report.py                 # partial report, explicit missing count
python3 evaluation-v2/build-report.py --freeze        # requires 20 valid, uncontaminated pairs
python3 evaluation-v2/build-report.py --compare ../evaluation/report.json

No third-party packages. Does not alter verdicts or access a running application.
"""
import argparse
import csv
import hashlib
import html
import json
import re
import statistics
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
LABELS = {'first_fun': 'Første økt', 'third_fun': 'Forventet tredje økt',
          'agency': 'Meningsfulle valg', 'visuals': 'Visuelt inntrykk',
          'clarity': 'Forståelighet', 'interval_fit': 'Passer intervallene'}
TRAINING = {'data_trust': 'Tillit til data', 'analysis_usefulness': 'Nytte av analysen',
            'unlock_fairness': 'Rettferdige opplåsinger'}
STAGES = {'first_use', 'first_interval', 'recovery', 'minute_20', 'after_session', 'third_session'}
LIMITATIONS = [
    'Dette er modellgenererte hypoteser, ikke menneskers opplevde spilleglede eller målt returbruk.',
    'Profilene er håndplukket; snitt beskriver disse profilene og estimerer ingen brukerpopulasjon.',
    'Separate kontekster bruker samme modell og evidens, og gir derfor korrelerte vurderinger.',
    'Bilder, kildekode og automatiserte tester gjenskaper ikke fysisk trening, lyd eller bruk over flere uker.',
    'Nye treningsskårer har ingen historisk sammenligningsverdi; de ble ikke samlet i første runde.',
    'Forskjeller fra forrige runde kan skyldes endret evidens, modellvariasjon eller sterkere fokus på data, ikke bare produktendringer.',
]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def validate(value, schema, at='$'):
    """Validate the deliberately small JSON Schema subset used by schema.json."""
    if 'const' in schema and value != schema['const']:
        raise ValueError(f'{at}: must equal {schema["const"]!r}')
    if 'enum' in schema and value not in schema['enum']:
        raise ValueError(f'{at}: unknown value {value!r}')
    kind = schema.get('type')
    valid = {'object': isinstance(value, dict), 'array': isinstance(value, list),
             'string': isinstance(value, str), 'integer': type(value) is int,
             'boolean': type(value) is bool}
    if kind and not valid[kind]:
        raise ValueError(f'{at}: expected {kind}')
    if kind == 'object':
        missing = set(schema.get('required', [])) - value.keys()
        if missing:
            raise ValueError(f'{at}: missing {sorted(missing)}')
        props = schema.get('properties', {})
        extra = value.keys() - props.keys()
        if extra and schema.get('additionalProperties') is False:
            raise ValueError(f'{at}: unexpected {sorted(extra)}')
        for key, child in props.items():
            if key in value:
                validate(value[key], child, f'{at}.{key}')
    elif kind == 'array':
        if len(value) < schema.get('minItems', 0) or len(value) > schema.get('maxItems', float('inf')):
            raise ValueError(f'{at}: incorrect number of entries')
        for i, child in enumerate(value):
            validate(child, schema['items'], f'{at}[{i}]')
    elif kind == 'string':
        if len(value.strip()) < schema.get('minLength', 0):
            raise ValueError(f'{at}: empty text')
        if 'pattern' in schema and not re.fullmatch(schema['pattern'], value):
            raise ValueError(f'{at}: invalid format')
    elif kind == 'integer':
        if not schema.get('minimum', -float('inf')) <= value <= schema.get('maximum', float('inf')):
            raise ValueError(f'{at}: out of range')


def manifest_data():
    path = ROOT / 'evidence-manifest.json'
    if not path.exists():
        return None, None, []
    data = read(path)
    if data.get('frozen') is not True:
        raise ValueError('Evidence manifest must declare frozen:true before evaluations are accepted')
    files = data.get('allowed_files', [])
    if not files or any(not isinstance(x, str) for x in files):
        raise ValueError('Manifest needs a nonempty allowed_files array of repository-relative paths')
    hashes = data.get('sha256', {})
    if set(hashes) != set(files):
        raise ValueError('Manifest sha256 map must cover every allowed_file, and no others')
    for name in files:
        archive = ROOT / 'frozen-build' / name
        evidence = (archive if archive.exists() else REPO / name).resolve()
        if not evidence.is_relative_to(REPO) or not evidence.is_file() or sha(evidence) != hashes[name]:
            raise ValueError(f'Frozen evidence missing or changed: {name}')
    for name, expected in data.get('build_sha256', {}).items():
        archive = ROOT / 'frozen-build' / name
        artifact = (archive if archive.exists() else REPO / name).resolve()
        if not artifact.is_relative_to(REPO) or not artifact.is_file() or sha(artifact) != expected:
            raise ValueError(f'Frozen build missing or changed: {name}')
    return data, sha(path), files


def collect(profiles, manifest_hash, allowed):
    players, missing, invalid = [], [], []
    schema = read(ROOT / 'schema.json')
    hashes = {}
    for profile in profiles:
        ident = profile['id']
        path, txt = ROOT / 'players' / f'{ident}.json', ROOT / 'players' / f'{ident}.txt'
        if not path.exists():
            missing.append(ident)
            continue
        try:
            player = read(path)
            validate(player, schema)
            if player['id'] != ident or player['persona'] != profile['name']:
                raise ValueError('Wrong assigned id/persona')
            if player['contamination']['disclosed']:
                raise ValueError('Disclosed prior-verdict contamination; needs fresh replacement')
            if not manifest_hash or player['evidence_manifest_sha256'] != manifest_hash:
                raise ValueError('Wrong/missing frozen evidence manifest hash')
            if any(x['path'] not in allowed for x in player['evidence']):
                raise ValueError('Evidence cites a path outside the allowlist')
            if {x['stage'] for x in player['journey']} != STAGES:
                raise ValueError('Journey stages missing or duplicated')
            if any(x['basis'] != 'prediction' for x in player['journey'] if x['stage'] in ('minute_20', 'third_session')):
                raise ValueError('Long-duration journey reactions must be explicit predictions')
            if not txt.exists() or not txt.read_text(encoding='utf-8').strip():
                raise ValueError('Missing readable TXT report')
            hashes[f'players/{ident}.json'] = sha(path)
            hashes[f'players/{ident}.txt'] = sha(txt)
            players.append({**player, 'assigned_profile': profile['profile']})
        except (ValueError, OSError, KeyError) as error:
            invalid.append({'id': ident, 'reason': str(error)})
    expected = {f'{p["id"]}.json' for p in profiles}
    extra = sorted(p.name for p in (ROOT / 'players').glob('*.json') if p.name not in expected)
    if extra:
        invalid.append({'id': 'unexpected_files', 'reason': ', '.join(extra)})
    return players, missing, invalid, hashes


def aggregate(players, key, labels):
    return {name: {'mean': round(statistics.mean(p[key][name] for p in players), 2),
                   'median': statistics.median(p[key][name] for p in players),
                   'min': min(p[key][name] for p in players), 'max': max(p[key][name] for p in players)}
            for name in labels} if players else {}


def make_html(report):
    e = lambda x: html.escape(str(x), quote=True)
    def bullets(values):
        return '<ul>' + ''.join(f'<li>{e(x)}</li>' for x in values) + '</ul>'
    s = report['summary']
    rows = ''.join(f'<tr><th>{e(label)}</th><td>{s[group].get(key, {}).get("mean", "—")}</td></tr>'
                   for group, labels in [('ratings', LABELS), ('training_ratings', TRAINING)] for key, label in labels.items())
    comparison = '<p>Historisk sammenligning er ikke åpnet. Alle 20 dommer må først fryses.</p>'
    if report['comparison']:
        c = report['comparison']
        comparison = '<p>Beskrivende forskjeller mellom to syntetiske vurderingsrunder; dette beviser ikke effekt hos mennesker.</p><table><tr><th>Skår</th><th>Tidligere</th><th>Nå</th><th>Forskjell</th></tr>'
        comparison += ''.join(f'<tr><th>{e(LABELS[k])}</th><td>{v["previous_mean"]}</td><td>{v["current_mean"]}</td><td>{v["delta"]:+.2f}</td></tr>' for k, v in c['ratings'].items()) + '</table>'
    cards = []
    for p in report['players']:
        ratings = ''.join(f'<tr><th>{e(label)}</th><td>{p[group][key]}/7</td><td>{e(p["rating_reasons"][key])}</td></tr>' for group, labels in [('ratings', LABELS), ('training_ratings', TRAINING)] for key, label in labels.items())
        details = ''
        for key, label in [('training_data', 'Treningsdata og analyse'), ('performance_unlocks', 'Prestasjon og opplåsing')]:
            x = p[key]
            details += f'<h4>{label}</h4><p>{e(x["verdict"])}</p><b>Styrker</b>{bullets(x["strengths"])}<b>Mangler</b>{bullets(x["gaps"])}<b>Evidens</b>{bullets(x["evidence"])}'
        friction = ''.join(f'<li><b>{e(f["issue"])}</b> · {e(f["severity"])}<br>{e(f["evidence"])}</li>' for f in p['frictions'])
        evidence = ''.join(f'<li><code>{e(x["path"])}</code> · {e(x["basis"])}<br>{e(x["observation"])}</li>' for x in p['evidence'])
        journey = ''.join(f'<li><b>{e(x["stage"])}</b> · {e(x["basis"])}<br>{e(x["reaction"])}</li>' for x in p['journey'])
        cards.append(f'<article data-return="{e(p["would_return"])}"><small>Profil {e(p["id"])} · GPT-5.6 Sol</small><h3>{e(p["persona"])}</h3><p>{e(p["assigned_profile"])}</p><p>{e(p["summary"])}</p><p><b>Simulert retur:</b> {e(p["would_return"])} · <b>Verden:</b> {e(p["preferred_world"])}</p><p>{e(p["return_reason"])}</p><p><b>Viktigste endring:</b> {e(p["one_change"])}</p><details><summary>Skårer, begrunnelse og evidens</summary><table>{ratings}</table><h4>Det som trekker inn</h4>{bullets(p["hooks"])}<h4>Friksjon</h4><ul>{friction}</ul>{details}<h4>Simulert forløp</h4><ol>{journey}</ol><h4>Evidens</h4><ul>{evidence}</ul><h4>Usikkerhet</h4><p>{e(p["counterargument"])}</p>{bullets(p["limitations"])}<p><a href="players/{e(p["id"])}.json">JSON</a> · <a href="players/{e(p["id"])}.txt">Spillerrapport</a></p></details></article>')
    status = 'Fullført og fryst' if s['verdicts_frozen'] else 'Ufullstendig eller ikke fryst'
    missing = ', '.join(s['missing_ids']) or 'ingen'
    errors = bullets(f'{x["id"]}: {x["reason"]}' for x in s['invalid'])
    page = '''<!doctype html><html lang="nb"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SUMMIT · ny syntetisk spillerevaluering</title><style>
    :root{font:16px/1.6 system-ui;color-scheme:dark;background:#09121c;color:#eaf7ff}*{box-sizing:border-box}body{margin:0}main{max-width:1150px;margin:auto;padding:32px 20px}h1{font-size:clamp(30px,5vw,48px);line-height:1.15}a,summary{color:#74e6ef}article,.notice{border:1px solid #365162;background:#122231;border-radius:12px;padding:22px;margin:16px 0}.notice{border-left:4px solid #f6cd72}table{width:100%;border-collapse:collapse}td,th{padding:8px;text-align:left;border-bottom:1px solid #355063}th{font-weight:500}summary{cursor:pointer}code{overflow-wrap:anywhere;font-size:12px}small{color:#afc7d5}li{margin:8px 0}details{margin-top:18px}input,select{padding:10px;font:inherit;background:#122231;color:inherit;border:1px solid #567285;border-radius:6px}label{display:inline-block;margin:0 12px 12px 0}footer{margin-top:40px} @media(max-width:600px){main{padding:20px 12px}article{padding:16px}table{font-size:13px}td,th{padding:5px}}
    </style><main><small>SUMMIT / RUNDE 2 / SYNTETISK DESIGNVURDERING</small><h1>Treningen først.<br>Hva tilfører spillet?</h1><div class="notice"><b>Dette er ikke en menneskelig brukertest.</b> Skårer og returvalg er modellgenererte hypoteser basert på samme frosne appversjon og evidens. De må ikke tolkes som målt glede, treningsutbytte eller ekte gjenbruk.</div>'''
    page += f'<h2>Status: {status}</h2><p><b>{s["n_scenarios"]} av {s["expected"]}</b> gyldige profiler. Mangler: {e(missing)}. Ugyldige: {len(s["invalid"])}.</p>{errors}<h2>Skårer, 1–7</h2><table><tr><th>Dimensjon</th><th>Syntetisk snitt</th></tr>{rows}</table><p>Returvalg: {e(s["return_intentions"])}. {s["lower_third_session"]} profiler har lavere forventet tredjeøktskår enn førsteøktskår.</p><h2>Historisk sammenligning</h2>{comparison}<h2>Alle vurderinger</h2><label>Søk <input id="search" type="search"></label><label>Retur <select id="return"><option value="all">Alle</option><option>yes</option><option>maybe</option><option>no</option></select></label><p id="count" aria-live="polite"></p><section id="players">{"".join(cards)}</section><h2>Metode og begrensninger</h2>{bullets(LIMITATIONS)}<p>Samme 20 forhåndsdefinerte profiler og seks opprinnelige skårnøkler beholdes. Tre nye dimensjoner vurderer data, analyse og opplåsinger separat. Tidligere dommer er holdt utenfor spilleragentenes evidens. Filhashene låser både kildegrunnlag og ferdige dommer før sammenligning.</p><footer><a href="report.json">Samlet JSON</a> · <a href="ratings.csv">CSV</a> · <a href="protocol.txt">Protokoll</a> · <a href="profiles.json">Profiler</a> · <a href="evidence-manifest.json">Evidensmanifest</a></footer></main>'
    page += '<script>const cards=[...document.querySelectorAll("article")],search=document.querySelector("#search"),ret=document.querySelector("#return");function filter(){let n=0;for(const c of cards){c.hidden=!(c.textContent.toLocaleLowerCase("nb").includes(search.value.toLocaleLowerCase("nb"))&&(ret.value==="all"||c.dataset.return===ret.value));if(!c.hidden)n++}document.querySelector("#count").textContent=n+" vurderinger vises"}search.addEventListener("input",filter);ret.addEventListener("input",filter);filter();</script></html>'
    corrections = report.get('factual_clarifications', [])
    findings = report.get('root_synthesis')
    if findings:
        note = '<h2>Samlet vurdering og neste prioriteringer</h2><p>Utviklerens syntese av de uendrede modellvurderingene:</p>'
        note += f'<p>{e(findings["conclusion_nb"])}</p><ol>'
        note += ''.join(f'<li><b>{e(x["title"])}</b> · {e(x["detail"])} <small>Profiler {e(", ".join(x["player_ids"]))}</small></li>' for x in findings['priorities'])
        note += '</ol><p><a href="findings.json">Funn og forslag til faktisk brukstest</a> · <a href="root-audit.json">Metodekontroll og faktasjekk</a></p>'
        page = page.replace('<h2>Alle vurderinger</h2>', note + '<h2>Alle vurderinger</h2>')
    if corrections:
        note = '<div class="notice"><h2>Faktasjekk av vurderingene</h2><p>Spillertekstene og skårene er bevart uendret. Følgende konkrete påstander er kontrollert mot koden:</p>'
        note += ''.join(f'<p><b>Profil {e(x["player_id"])}</b> · {e(x.get("correction_nb", x["correction"]))}</p><small>{e(", ".join(x["source"]))}</small>' for x in corrections)
        page = page.replace('<h2>Alle vurderinger</h2>', note + '</div><h2>Alle vurderinger</h2>')
    return page


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--freeze', action='store_true', help='Lock all 20 completed verdict pairs before comparing')
    parser.add_argument('--compare', type=Path, help='Historical aggregate JSON path, relative to evaluation-v2')
    args = parser.parse_args()
    profiles = read(ROOT / 'profiles.json')
    if len(profiles) != 20 or len({p['id'] for p in profiles}) != 20:
        raise ValueError('Exactly 20 distinct profiles required')
    manifest, manifest_hash, allowed = manifest_data()
    players, missing, invalid, hashes = collect(profiles, manifest_hash, allowed)
    freeze_path = ROOT / 'verdicts-frozen.json'
    expected_freeze = {'evidence_manifest_sha256': manifest_hash, 'profiles_sha256': sha(ROOT / 'profiles.json'), 'files': hashes}
    frozen = False
    if freeze_path.exists():
        frozen_data = read(freeze_path)
        if any(frozen_data.get(k) != v for k, v in expected_freeze.items()) or missing or invalid:
            raise ValueError('Frozen verdicts/evidence changed; refuse aggregation or historical comparison')
        frozen = True
    if args.freeze:
        if missing or invalid or len(players) != 20:
            raise ValueError(f'Cannot freeze: {len(players)}/20 valid; missing={missing}; invalid={invalid}')
        if not frozen:
            freeze_path.write_text(json.dumps({**expected_freeze, 'frozen_at': datetime.now(timezone.utc).isoformat()}, ensure_ascii=False, indent=2)+'\n')
        frozen = True
    comparison = None
    ratings, training = aggregate(players, 'ratings', LABELS), aggregate(players, 'training_ratings', TRAINING)
    if args.compare:
        if not frozen:
            raise ValueError('Refusing to read baseline before all 20 verdicts are frozen')
        baseline_path = args.compare if args.compare.is_absolute() else ROOT / args.compare
        old = read(baseline_path)['summary']
        if old.get('n_scenarios') != 20:
            raise ValueError('Historical aggregate must contain 20 scenarios')
        comparison = {'baseline_file': str(args.compare), 'baseline_sha256': sha(baseline_path),
                      'interpretation': 'Descriptive model-score differences only; not measured human improvement.',
                      'ratings': {k: {'previous_mean': old['ratings'][k]['mean'], 'current_mean': ratings[k]['mean'], 'delta': round(ratings[k]['mean'] - old['ratings'][k]['mean'], 2)} for k in LABELS},
                      'previous_return_intentions': old.get('return_intentions')}
    counts = Counter(p['would_return'] for p in players)
    summary = {'method': 'Twenty separate GPT-5.6 Sol persona contexts; synthetic predictions, no human participants.',
               'generated_at': datetime.now(timezone.utc).isoformat(), 'expected': 20,
               'n_scenarios': len(players), 'missing_ids': missing, 'invalid': invalid, 'verdicts_frozen': frozen,
               'evidence_manifest_sha256': manifest_hash, 'ratings': ratings, 'training_ratings': training,
               'return_intentions': {k: counts[k] for k in ['yes', 'maybe', 'no']},
               'lower_third_session': sum(p['ratings']['third_fun'] < p['ratings']['first_fun'] for p in players),
               'friction_categories': {k: [p['id'] for p in players if any(f['category'] == k for f in p['frictions'])] for k in sorted({f['category'] for p in players for f in p['frictions']})},
               'limitations': LIMITATIONS}
    audit = read(ROOT / 'root-audit.json') if (ROOT / 'root-audit.json').exists() else {}
    report = {'summary': summary, 'comparison': comparison, 'players': players,
              'factual_clarifications': audit.get('factual_clarifications', []),
              'root_synthesis': read(ROOT / 'findings.json') if (ROOT / 'findings.json').exists() else None}
    (ROOT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    (ROOT / 'report.html').write_text(make_html(report), encoding='utf-8')
    with (ROOT / 'ratings.csv').open('w', encoding='utf-8', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['id', 'persona', *LABELS, *TRAINING, 'would_return', 'preferred_world', 'confidence'])
        for p in players:
            writer.writerow([p['id'], p['persona'], *[p['ratings'][k] for k in LABELS], *[p['training_ratings'][k] for k in TRAINING], p['would_return'], p['preferred_world'], p['confidence']])
    print(json.dumps({'valid': len(players), 'missing': missing, 'invalid': invalid, 'frozen': frozen, 'comparison': comparison is not None}, ensure_ascii=False))
    return 1 if invalid else 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (ValueError, OSError, KeyError) as error:
        raise SystemExit(f'Evaluation report error: {error}')
