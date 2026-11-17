"""Reference values from pyEDFlib (primary) and MNE-Python (secondary) for the test recordings.

For every ordinary signal: SHA-256 of the full digital array (int32 little endian) and of the full physical array
(float64 little endian) as pyEDFlib returns them, plus a few raw values. Annotations as pyEDFlib reads them.
MNE: for channels at the file's highest rate (MNE resamples lower-rate channels), SHA-256 is not usable because
MNE scales to volts in a different operation order, so a strided sample of values is stored for a tolerance check.
Usage: python make_golden.py <test-data-dir> <out.json>
"""
import hashlib, json, os, sys, warnings
import numpy as np
import pyedflib

warnings.filterwarnings('ignore')
D = sys.argv[1]
FILES = ['SC4001E0-PSG.edf', 'SC4001EC-Hypnogram.edf', 'S001R03.edf', 'S001R01.edf', 'test_generator_2.edf',
         'test_generator_2.bdf', 'test_generator.edf', 'Newtest17-256.bdf', 'Newtest17-2048.bdf', 'PositiveSpikes.edf',
         'synthetic/synthetic_edf_D.edf', 'synthetic/synthetic_bdf_D.bdf', 'synthetic/valid_small.edf']

def sha(a):
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()

out = {'pyedflib': pyedflib.__version__}
try:
    import mne
    out['mne'] = mne.__version__
except Exception:
    mne = None

for name in FILES:
    path = os.path.join(D, name)
    entry = {}
    try:
        r = pyedflib.EdfReader(path)
    except Exception as e:
        entry['pyedflibError'] = str(e)
        out[name] = entry
        continue
    entry['nrec'] = int(r.datarecords_in_file)
    entry['recordDuration'] = float(r.datarecord_duration)
    entry['start'] = r.getStartdatetime().isoformat()
    sigs = []
    for i in range(r.signals_in_file):
        h = r.getSignalHeader(i)
        dig = r.readSignal(i, digital=True).astype('<i4')
        phys = r.readSignal(i).astype('<f8')
        sigs.append(dict(label=h['label'], n=int(len(dig)), fs=float(r.getSampleFrequency(i)),
                         digitalSha256=sha(dig), physicalSha256=sha(phys),
                         physicalHead=[float(x) for x in phys[:5]], physicalTail=[float(x) for x in phys[-5:]]))
    entry['signals'] = sigs
    on, du, tx = r.readAnnotations()
    entry['annotations'] = [[float(a), float(b), str(c)] for a, b, c in zip(on, du, tx)]
    r.close()
    if mne is not None and not name.endswith('Hypnogram.edf'):
        try:
            raw = mne.io.read_raw_edf(path, preload=True, verbose='error') if name.endswith('.edf') else \
                mne.io.read_raw_bdf(path, preload=True, verbose='error')
            fsmax = max(s['fs'] for s in sigs)
            m = []
            for ch, s in zip(raw.ch_names, [s for s in sigs]):
                pass
            data = raw.get_data()
            for idx, s in enumerate(sigs):
                if s['fs'] != fsmax or idx >= data.shape[0]:
                    continue
                stride = max(1, s['n'] // 4000)
                m.append(dict(index=idx, name=raw.ch_names[idx], stride=stride, values=[float(v) for v in data[idx, ::stride]]))
            entry['mne'] = dict(sfreq=float(raw.info['sfreq']), channels=m,
                                annotations=[[float(a['onset']), float(a['duration']), a['description']] for a in raw.annotations])
        except Exception as e:
            entry['mneError'] = '%s: %s' % (type(e).__name__, e)
    out[name] = entry
    print(name, 'signals', len(sigs), 'ann', len(entry['annotations']), 'mne', 'mne' in entry, entry.get('mneError', ''))

with open(sys.argv[2], 'w') as f:
    json.dump(out, f)
