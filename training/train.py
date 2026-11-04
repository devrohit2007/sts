"""Train, evaluate once on the test split, and export ONNX for the browser.
Usage: python train.py features_dir ../public/models/asl --dataset "NAME (licence)"
Needs: pip install torch onnx numpy
Steps: train on train.npz, pick the best epoch on val.npz, then score test.npz ONCE.
Only glosses with >= MIN_TRAIN training clips are kept, so labels.json lists exactly what was learned."""
import json, os, sys
from collections import Counter
import numpy as np
import torch, torch.nn as nn
from features import SEQ_LEN, FEATURE_DIM

MIN_TRAIN = 20
MEANINGS = None  # filled from the vocabulary JSON below


class SignNet(nn.Module):
    def __init__(self, n_classes):
        super().__init__()
        self.conv = nn.Sequential(nn.Conv1d(FEATURE_DIM, 128, 3, padding=1), nn.ReLU(), nn.Dropout(0.2))
        self.gru = nn.GRU(128, 128, batch_first=True, bidirectional=True)
        self.head = nn.Sequential(nn.Dropout(0.3), nn.Linear(256, n_classes))

    def forward(self, x):                      # x: (B, SEQ_LEN, FEATURE_DIM)
        h = self.conv(x.transpose(1, 2)).transpose(1, 2)
        o, _ = self.gru(h)
        return self.head(o.mean(1))


def augment(x):
    """Train-only: small noise + small scale of wrist position. Never applied to val/test."""
    x = x + 0.01 * torch.randn_like(x)
    return x


def main(feat_dir, out_dir, dataset):
    vocab = {v['gloss']: v['meaning'] for v in json.load(open(os.path.join(os.path.dirname(__file__), 'vocabulary.json')))}
    L = {k: np.load(os.path.join(feat_dir, f'{k}.npz')) for k in ('train', 'val', 'test')}
    counts = Counter(L['train']['y'].tolist())
    glosses = sorted(g for g, c in counts.items() if c >= MIN_TRAIN and g in vocab)
    if len(glosses) < 2:
        raise SystemExit('Not enough training clips per sign. Collect more data.')
    idx = {g: i for i, g in enumerate(glosses)}

    def prep(k):
        keep = [i for i, g in enumerate(L[k]['y']) if g in idx]
        return torch.tensor(L[k]['X'][keep]), torch.tensor([idx[L[k]['y'][i]] for i in keep])

    (Xtr, ytr), (Xva, yva), (Xte, yte) = prep('train'), prep('val'), prep('test')
    torch.manual_seed(0)
    net = SignNet(len(glosses)); opt = torch.optim.AdamW(net.parameters(), 2e-3, weight_decay=1e-2)
    best, best_state, bad = -1, None, 0
    for ep in range(80):
        net.train(); perm = torch.randperm(len(Xtr))
        for i in range(0, len(perm), 64):
            b = perm[i:i + 64]
            loss = nn.functional.cross_entropy(net(augment(Xtr[b])), ytr[b], label_smoothing=0.05)
            opt.zero_grad(); loss.backward(); opt.step()
        net.eval()
        with torch.no_grad():
            acc = (net(Xva).argmax(1) == yva).float().mean().item()
        print(f'epoch {ep} val top-1 {acc:.3f}')
        if acc > best: best, bad, best_state = acc, 0, {k: v.clone() for k, v in net.state_dict().items()}
        else:
            bad += 1
            if bad >= 10: break
    net.load_state_dict(best_state); net.eval()
    with torch.no_grad():                       # the one and only look at the test set
        lo = net(Xte); top1 = (lo.argmax(1) == yte).float().mean().item()
        k = min(5, len(glosses)); top5 = (lo.topk(k, 1).indices == yte[:, None]).any(1).float().mean().item()

    os.makedirs(out_dir, exist_ok=True)
    torch.onnx.export(net, torch.zeros(1, SEQ_LEN, FEATURE_DIM), os.path.join(out_dir, 'model.onnx'),
                      input_names=['input'], output_names=['logits'], dynamic_axes=None, opset_version=17)
    json.dump({'sequenceLength': SEQ_LEN, 'featureDim': FEATURE_DIM, 'threshold': 0.7,
               'labels': [{'gloss': g, 'meaning': vocab[g]} for g in glosses]},
              open(os.path.join(out_dir, 'labels.json'), 'w'), indent=1)
    json.dump({'split': 'signer-disjoint', 'dataset': dataset, 'testClips': int(len(yte)), 'testTop1': top1, 'testTop5': top5,
               'valTop1': best, 'signs': len(glosses)}, open(os.path.join(out_dir, 'metrics.json'), 'w'), indent=1)
    print(f'signs {len(glosses)}  test top-1 {top1:.3f}  top-5 {top5:.3f}  ({len(yte)} clips)')


if __name__ == '__main__':
    a = sys.argv
    if len(a) < 4 or '--dataset' not in a:
        raise SystemExit(__doc__)
    main(a[1], a[2], a[a.index('--dataset') + 1])
