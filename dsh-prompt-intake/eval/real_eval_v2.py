"""Offline v2 experiment, opt-in network execution. Never deploys or changes routing.

Primary: EXACT frozen manual v2 (including its five demos) vs frozen baseline.
Secondary: real DSPy train-only fresh-demo replacement, explicitly UNVALIDATED.
The two candidates are distinct artifacts; train optimization cannot replace v2.
"""
import argparse
import fcntl
import json
import os
import urllib.request
from pathlib import Path

import prepare_v2
import real_eval as old

ROOT = Path(__file__).resolve().parent
LIMITS = {'train-generation': 6, 'train-judge': 6,
          'validation-generation': 24, 'validation-judge': 24}
CHECKS = ('intent', 'scope', 'clarification', 'consent')
encoded, digest, stamp = old.encoded, old.digest, old.stamp


def dry_plan():
    return {'main_comparison': 'exact frozen baseline vs exact frozen manual v2',
            'validation_cases': 12, 'validation_status': 'public, not sealed',
            'secondary': 'DSPy BootstrapFewShot train-only fresh demos; unvalidated',
            'phase_caps': LIMITS, 'maximum_planned_attempts': 48, 'hard_limit': 60,
            'prior_attempts': 71, 'maximum_actual_total': 131,
            'broader_total_ceiling': 160, 'retries': 0}


def save_new(path, obj):
    """Immutable artifact: fail rather than overwrite evidence from any run."""
    with Path(path).open('x') as f:
        f.write(json.dumps(obj, ensure_ascii=False, indent=2)+'\n')


def append(path, obj):
    # Incremental JSONL evidence survives a subsequent failure.
    with Path(path).open('a') as f:
        f.write(encoded(obj)+'\n'); f.flush(); os.fsync(f.fileno())


class Ledger(old.Ledger):
    def reserve(self, phase, payload):
        if phase not in LIMITS:
            raise ValueError('Unknown experiment phase')
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open('a+') as f:
            fcntl.flock(f, fcntl.LOCK_EX); f.seek(0)
            rows = [json.loads(line) for line in f.read().splitlines()]
            if len(rows) >= 60:
                raise RuntimeError('Hard attempt budget exhausted')
            if sum(r['phase'] == phase for r in rows) >= LIMITS[phase]:
                raise RuntimeError('Phase attempt budget exhausted: '+phase)
            row = {'attempt': len(rows)+1, 'time': stamp(), 'phase': phase,
                   'model': old.MODEL, 'request_sha256': digest(payload)}
            f.seek(0, 2); f.write(encoded(row)+'\n'); f.flush(); os.fsync(f.fileno())
            return row


class Transport(old.Transport):
    def __init__(self, ledger, out, key, open_url=None):
        opener = open_url or urllib.request.build_opener(
            urllib.request.ProxyHandler({}), old.NoRedirect()).open
        # Reuse routing, reservation, response/error artifacts and canonical model.
        # Override only timeout; neither wrapper nor old Transport retries.
        def open_120(req, timeout):
            return opener(req, timeout=120)
        super().__init__(ledger, out, key, open_url=open_120)

    def call(self, messages, phase):
        # run/resume holds the run lock; refuse stale/reset ledger collisions
        # before reservation/network and create evidence exclusively afterwards.
        path = self.out/f'attempt-{len(self.ledger.rows())+1:03d}.json'
        if path.exists():
            raise FileExistsError('Attempt evidence already exists: '+str(path))
        old.verify_local_routing([old.MODEL])
        payload = {'model':old.MODEL, 'messages':messages, 'temperature':0,
                   'max_tokens':1400, 'stream':False}
        row = self.ledger.reserve(phase, payload)
        path = self.out/f"attempt-{row['attempt']:03d}.json"
        request = urllib.request.Request(old.ENDPOINT+'/chat/completions',
            data=encoded(payload).encode(), headers={
                'Authorization':'Bearer '+self.key, 'Content-Type':'application/json'})
        artifact = {'reservation':row, 'request':payload}
        try:
            with self.open_url(request, timeout=120) as response:
                artifact['response'] = json.load(response)
            text = artifact['response']['choices'][0]['message']['content']
            if not isinstance(text, str) or not text.strip():
                raise ValueError('Empty model response')
            return text
        except Exception as exc:
            artifact['error'] = {'type':type(exc).__name__, 'status':getattr(exc,'code',None)}
            raise
        finally:
            save_new(path, artifact)


def load_train():
    data = json.loads((ROOT/'scenarios.json').read_text())['scenarios']
    train = [old.public_case(c) for c in data if c['split'] == 'train'][:6]
    if len(train) != 6:
        raise ValueError('Require six existing train scenarios')
    validation = prepare_v2.load_bundle()['cases']
    excluded = {c['id'] for c in validation} | {c.get('source') for c in validation}
    if any(c['id'] in excluded for c in train):
        raise ValueError('Training/validation overlap')
    return train


def parse_json(text):
    text = text.strip()
    if text.startswith('```'):
        text = text.split('\n', 1)[1].rsplit('```', 1)[0]
    return json.loads(text)


def parse_judgment(text):
    obj = old.parse_judgment(text)
    if not isinstance(obj.get('reason'), str) or not obj['reason'].strip():
        raise ValueError('Invalid judge reason')
    return obj


def bootstrap(bundle, train, transport, out):
    import dspy
    # Deliberately replace, NOT retain, five manual-v2 demos in this separate
    # secondary artifact. Primary comparison below always uses frozen bundle.
    policy = bundle['candidate']['policy']
    class Intake(dspy.Module):
        def __init__(self):
            super().__init__()
            self.predict = dspy.Predict('case -> response')
        def forward(self, case):
            messages = [{'role': 'system', 'content': policy},
                        {'role': 'user', 'content': case}]
            response = transport.call(messages, 'train-generation')
            append(out/'train-generations.jsonl', {'case': json.loads(case), 'response': response})
            prediction = dspy.Prediction(response=response)
            if dspy.settings.trace is not None:
                dspy.settings.trace.append((self.predict, {'case': case}, prediction))
            return prediction
    def metric(example, prediction, trace=None):
        payload = {'case': json.loads(example.case), 'response': prediction.response}
        raw = transport.call([{'role': 'system', 'content': old.RUBRIC},
                              {'role': 'user', 'content': encoded(payload)}], 'train-judge')
        append(out/'train-judgments-raw.jsonl', {'id': payload['case']['id'], 'raw': raw})
        judgment = parse_judgment(raw)
        append(out/'train-judgments.jsonl', {'id': payload['case']['id'], 'judgment': judgment})
        return all(judgment[k] for k in CHECKS)
    examples = [dspy.Example(case=encoded(c)).with_inputs('case') for c in train]
    optimizer = dspy.BootstrapFewShot(metric=metric, max_bootstrapped_demos=6,
                                     max_labeled_demos=0, max_rounds=1, max_errors=1)
    candidate = optimizer.compile(Intake(), trainset=examples)
    artifact = {'policy': policy, 'demos': [dict(d) for d in candidate.predict.demos]}
    result = {'frozen': stamp(), 'artifact': artifact, 'demos': artifact['demos'],
              'sha256': digest(artifact), 'dspy': dspy.__version__,
              'optimizer': 'dspy.BootstrapFewShot', 'validated': False,
              'demo_method': 'fresh train demos replace old five; NOT manual v2'}
    save_new(out/'dspy-train-candidate-frozen.json', result)
    return result


def group_summary(bundle, judgments):
    groups = {}
    for group in ('regression', 'new_public_validation'):
        ids = {c['id'] for c in bundle['cases'] if c['group'] == group}
        rows = [r for r in judgments if r['id'] in ids]
        groups[group] = {'n': len(rows), 'expected': len(ids)}
        for variant in ('baseline', 'candidate'):
            groups[group][variant] = {k: sum(r[variant][k] for r in rows) for k in CHECKS}
            groups[group][variant]['all_pass'] = sum(all(r[variant][k] for k in CHECKS) for r in rows)
    return groups


def run(out=None, ledger=None, transport=None, catalog=None):
    out = Path(out) if out is not None else ROOT/'runs'/'2026-10-20-v2-real'
    ledger = ledger if ledger is not None else Ledger(ROOT/'runs'/'v2-model-attempts.jsonl')
    # Lock entire run, including the empty-ledger/output preflight. Never resume
    # implicitly or truncate old artifacts. All model reservations remain durable.
    ledger.path.parent.mkdir(parents=True, exist_ok=True)
    with (ledger.path.parent/(ledger.path.name+'.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        if ledger.rows():
            raise RuntimeError('Existing attempts: inspect artifacts; refusing automatic rerun')
        if out.exists():
            raise RuntimeError('Existing output: refusing overwrite')
        out.mkdir(parents=True)
        judgments, generations = [], []
        status, failure, bundle, secondary = 'failed', None, None, None
        try:
            bundle = prepare_v2.load_bundle()
            if len(bundle['cases']) != 12:
                raise ValueError('Require fixed twelve v2 validation cases')
            train = load_train()
            save_new(out/'manifest.json', {'started': stamp(), 'plan': dry_plan(),
                'model': old.MODEL, 'authorized_label': old.AUTHORIZED_LABEL,
                'ledger_path': str(ledger.path.resolve()),
                'frozen_bundle': bundle['manifest'], 'bundle_manifest_sha256': prepare_v2.sha(prepare_v2.BUNDLE/'manifest.json'),
                'train_sha256': digest(train), 'generation_gold_fields': False,
                'params': {'temperature': 0, 'max_tokens': 1400, 'timeout_seconds': 120, 'retries': 0}})
            for variant, name in (('baseline','baseline-frozen.json'), ('candidate','manual-v2-frozen.json')):
                save_new(out/name, {'artifact': bundle[variant], 'sha256': digest(bundle[variant]), 'frozen': stamp()})
            if transport is None:
                key, catalog = old.credentials()
                transport = Transport(ledger, out, key)
            save_new(out/'catalog.json', catalog)
            secondary = bootstrap(bundle, train, transport, out)
            for i, case in enumerate(bundle['cases']):
                order = ['baseline', 'candidate'] if i % 2 == 0 else ['candidate', 'baseline']
                outputs = {}
                for variant in order:
                    response = transport.call(prepare_v2.messages(bundle, variant, case), 'validation-generation')
                    outputs[variant] = response
                    generations.append({'id': case['id'], 'variant': variant, 'response': response})
                    append(out/'validation-generations.jsonl', generations[-1])
                payload = {'case': old.public_case(case), 'A': outputs[order[0]], 'B': outputs[order[1]]}
                instructions = old.RUBRIC + ' Evaluate A and B independently. Return ONLY JSON with keys A and B, each containing intent,scope,clarification,consent (booleans) and reason (quote short evidence).'
                raw = transport.call([{'role': 'system', 'content': instructions},
                                      {'role': 'user', 'content': encoded(payload)}], 'validation-judge')
                append(out/'validation-judgments-raw.jsonl', {'id': case['id'], 'raw': raw, 'mapping': order})
                obj = parse_json(raw)
                row = {'id': case['id'], **{variant: parse_judgment(encoded(obj[label])) for label, variant in zip(('A','B'), order)}}
                judgments.append(row)
                append(out/'validation-judgments.jsonl', row)
            status = 'completed'
        except BaseException as exc:
            failure = {'type': type(exc).__name__}
            raise
        finally:
            save_new(out/'validation-generations.json', generations)
            save_new(out/'validation-judgments.json', judgments)
            summary = {'time': stamp(), 'status': status, 'failure': failure,
                'attempts': len(ledger.rows()), 'prior_attempts': 71,
                'actual_total': 71+len(ledger.rows()), 'judged_pairs': len(judgments),
                'groups': group_summary(bundle, judgments) if bundle else {},
                'main_candidate': 'exact frozen manual v2 with five retained demos',
                'secondary_dspy': {'validated': False, 'frozen': secondary is not None},
                'same_model_judge': True, 'semanticQualityVerified': False, 'deployment': False,
                'limitations': ['Public synthetic validation, not sealed heldout.',
                    'Regression cases informed manual policy; report separately.',
                    'Same model generates and judges; correlated bias.',
                    'No gold review fields sent to generation or judges.',
                    'DSPy secondary train candidate is NOT validated or substituted for manual v2.',
                    'No tool/runtime testing; independent human review required before promotion.']}
            save_new(out/'comparison.json', summary)
        return summary


def resume(out, ledger, transport=None):
    """Explicit recovery only; keep original snapshots and all failed reservations."""
    out = Path(out)
    with (ledger.path.parent/(ledger.path.name+'.lock')).open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        bundle = prepare_v2.load_bundle()
        manifest = json.loads((out/'manifest.json').read_text())
        if manifest.get('ledger_path') != str(ledger.path.resolve()):
            raise RuntimeError('Missing or mismatched ledger binding; legacy run is audit-only')
        if manifest['bundle_manifest_sha256'] != prepare_v2.sha(prepare_v2.BUNDLE/'manifest.json'):
            raise RuntimeError('Frozen bundle changed')
        for variant, name in (('baseline','baseline-frozen.json'), ('candidate','manual-v2-frozen.json')):
            frozen = json.loads((out/name).read_text())
            if frozen['artifact'] != bundle[variant] or frozen['sha256'] != digest(bundle[variant]):
                raise RuntimeError('Frozen artifact changed')
        def rows(name):
            path = out/name
            return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []
        generations = rows('validation-generations.jsonl')
        judgments = rows('validation-judgments.jsonl')
        ids = {c['id'] for c in bundle['cases']}
        outputs = {(r['id'], r['variant']): r['response'] for r in generations}
        if len(outputs) != len(generations) or any(k[0] not in ids or k[1] not in ('baseline','candidate') for k in outputs):
            raise RuntimeError('Invalid saved generations')
        done = {r['id'] for r in judgments}
        if len(done) != len(judgments) or not done <= ids:
            raise RuntimeError('Invalid saved judgments')
        if len(done) == 12:
            raise RuntimeError('Already completed')
        if not ledger.rows() or len(ledger.rows()) >= 60:
            raise RuntimeError('Missing or exhausted ledger')
        # Each explicit invocation performs at most one call per missing item.
        # Failed judge reservations remain counted; phase allowance uses the
        # original 12 spare attempts, never raises the hard 60-attempt budget.
        start = len(ledger.rows())
        receipt = out/f'recovery-{start:03d}.json'
        if receipt.exists():
            raise RuntimeError('Recovery receipt already exists')
        if transport is None:
            key, _ = old.credentials()
            transport = Transport(ledger, out, key)
        status, failure = 'failed', None
        try:
            for i, case in enumerate(bundle['cases']):
                if case['id'] in done:
                    continue
                order = ['baseline','candidate'] if i % 2 == 0 else ['candidate','baseline']
                for variant in order:
                    key = (case['id'], variant)
                    if key not in outputs:
                        response = transport.call(prepare_v2.messages(bundle, variant, case), 'validation-generation')
                        outputs[key] = response
                        append(out/'validation-generations.jsonl', {'id':case['id'], 'variant':variant, 'response':response})
                payload = {'case':old.public_case(case), 'A':outputs[(case['id'],order[0])], 'B':outputs[(case['id'],order[1])]}
                instructions = old.RUBRIC + ' Evaluate A and B independently. Return ONLY JSON with keys A and B, each containing intent,scope,clarification,consent (booleans) and reason (quote short evidence).'
                raw = transport.call([{'role':'system','content':instructions}, {'role':'user','content':encoded(payload)}], 'validation-judge')
                append(out/'validation-judgments-raw.jsonl', {'id':case['id'],'raw':raw,'mapping':order})
                obj = parse_json(raw)
                row = {'id':case['id'], **{v:parse_judgment(encoded(obj[k])) for k,v in zip(('A','B'),order)}}
                judgments.append(row)
                append(out/'validation-judgments.jsonl', row)
            status = 'completed'
        except BaseException as exc:
            failure = {'type':type(exc).__name__}
            raise
        finally:
            summary = {'time':stamp(), 'status':status, 'failure':failure,
                       'attempts':len(ledger.rows()), 'prior_attempts':71,
                       'actual_total':71+len(ledger.rows()), 'judged_pairs':len(judgments),
                       'groups':group_summary(bundle,judgments), 'deployment':False,
                       'secondary_dspy_validated':False, 'same_model_judge':True}
            save_new(receipt, summary)
        return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    print(encoded(run() if args.execute else dry_plan()))
