"""Signer-disjoint train/val/test split, so the test score is not inflated by the model
recognising a person instead of a sign. Reads a manifest CSV: path,gloss,signer
Writes split.json: {"train":[row,...],"val":[...],"test":[...]}.
Usage: python split.py manifest.csv split.json [--seed 7]"""
import csv, json, random, sys


def split_rows(rows, seed=7, val_frac=0.15, test_frac=0.15):
    signers = sorted({r['signer'] for r in rows})
    if len(signers) < 5:
        raise SystemExit(f'Need at least 5 different signers for a signer-disjoint split, found {len(signers)}.')
    rng = random.Random(seed); rng.shuffle(signers)
    n_test = max(1, round(len(signers) * test_frac)); n_val = max(1, round(len(signers) * val_frac))
    test, val = set(signers[:n_test]), set(signers[n_test:n_test + n_val])
    out = {'train': [], 'val': [], 'test': []}
    for r in rows:
        out['test' if r['signer'] in test else 'val' if r['signer'] in val else 'train'].append(r)
    sets = {k: {r['signer'] for r in v} for k, v in out.items()}
    assert not (sets['train'] & sets['val'] or sets['train'] & sets['test'] or sets['val'] & sets['test']), 'signer leakage'
    return out


if __name__ == '__main__':
    if len(sys.argv) < 3:
        raise SystemExit(__doc__)
    seed = int(sys.argv[sys.argv.index('--seed') + 1]) if '--seed' in sys.argv else 7
    with open(sys.argv[1], newline='') as f:
        rows = list(csv.DictReader(f))
    res = split_rows(rows, seed)
    json.dump(res, open(sys.argv[2], 'w'), indent=1)
    print({k: len(v) for k, v in res.items()})
