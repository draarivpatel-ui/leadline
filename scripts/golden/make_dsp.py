"""SciPy reference outputs for the filters and the spectrogram. Writes raw float64 files plus a JSON index.
Usage: python make_dsp.py <test-data-dir> <out.json>
"""
import json, os, sys
import numpy as np
import pyedflib
import scipy
from scipy import signal

D = sys.argv[1]
OUT = os.path.join(D, 'dsp')
os.makedirs(OUT, exist_ok=True)


def load(name, ch, seconds=None):
    r = pyedflib.EdfReader(os.path.join(D, name))
    fs = r.getSampleFrequency(ch)
    n = r.getNSamples()[ch] if seconds is None else int(seconds * fs)
    x = r.readSignal(ch, 0, n)
    r.close()
    return x, fs


def save(key, arr):
    path = os.path.join(OUT, key + '.f64')
    np.asarray(arr, dtype='<f8').tofile(path)
    return 'dsp/' + key + '.f64'

cases = []
x160, fs160 = load('S001R03.edf', 0)
x100, fs100 = load('SC4001E0-PSG.edf', 0, 3600)
inputs = {'S001R03.edf#0': (x160, fs160), 'SC4001E0-PSG.edf#0@3600': (x100, fs100)}

def butter_case(key, src, order, cutoff, btype):
    x, fs = inputs[src]
    sos = signal.butter(order, cutoff, btype=btype, fs=fs, output='sos')
    y = signal.sosfiltfilt(sos, x)
    cases.append(dict(key=key, kind='butter', input=src, order=order, cutoff=cutoff, btype=btype, fs=fs,
                      sos=sos.tolist(), output=save(key, y)))

butter_case('hp05_o2_160', 'S001R03.edf#0', 2, 0.5, 'highpass')
butter_case('lp30_o4_160', 'S001R03.edf#0', 4, 30.0, 'lowpass')
butter_case('hp1_o3_160', 'S001R03.edf#0', 3, 1.0, 'highpass')
butter_case('lp35_o5_100', 'SC4001E0-PSG.edf#0@3600', 5, 35.0, 'lowpass')
butter_case('hp03_o2_100', 'SC4001E0-PSG.edf#0@3600', 2, 0.3, 'highpass')

b, a = signal.iirnotch(60.0, 30.0, fs=fs160)
y = signal.filtfilt(b, a, x160)
cases.append(dict(key='notch60_160', kind='notch', input='S001R03.edf#0', f0=60.0, Q=30.0, fs=fs160, b=b.tolist(), a=a.tolist(),
                  output=save('notch60_160', y)))
b, a = signal.iirnotch(50.0, 30.0, fs=fs160)
cases.append(dict(key='notch50_160', kind='notch', input='S001R03.edf#0', f0=50.0, Q=30.0, fs=fs160, b=b.tolist(), a=a.tolist(),
                  output=save('notch50_160', signal.filtfilt(b, a, x160))))

# The viewer's chain: high-pass, then low-pass, then notch, each zero phase.
y = signal.sosfiltfilt(signal.butter(2, 0.5, 'highpass', fs=fs160, output='sos'), x160)
y = signal.sosfiltfilt(signal.butter(2, 35.0, 'lowpass', fs=fs160, output='sos'), y)
b, a = signal.iirnotch(60.0, 30.0, fs=fs160)
y = signal.filtfilt(b, a, y)
cases.append(dict(key='chain_160', kind='chain', input='S001R03.edf#0', fs=fs160, highpass=0.5, lowpass=35.0, notch=60.0,
                  order=2, Q=30.0, output=save('chain_160', y)))

for key, src, nperseg, noverlap, nfft in [('spec256', 'SC4001E0-PSG.edf#0@3600', 256, 128, 256),
                                         ('spec3000', 'SC4001E0-PSG.edf#0@3600', 3000, 0, 4096),
                                         ('spec160', 'S001R03.edf#0', 160, 80, 256)]:
    x, fs = inputs[src]
    f, t, s = signal.spectrogram(x, fs=fs, window='hann', nperseg=nperseg, noverlap=noverlap, nfft=nfft,
                                 detrend='constant', scaling='density', mode='psd')
    cases.append(dict(key=key, kind='spectrogram', input=src, fs=fs, nperseg=nperseg, noverlap=noverlap, nfft=nfft,
                      times=t.tolist(), nfreq=len(f), output=save(key, s.T)))

with open(sys.argv[2], 'w') as fh:
    json.dump(dict(scipy=scipy.__version__, cases=cases), fh)
print('dsp cases', len(cases))
