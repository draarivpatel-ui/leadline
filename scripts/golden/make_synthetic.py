"""Writes synthetic EDF+D, BDF+D and malformed files byte by byte, plus the ground truth as JSON.

This writer is independent of the TypeScript parser (different language, written from the EDF+ spec), so the
truth here comes from construction. edfcore (MIT, a separate implementation) is a second opinion in the tests.
Usage: python make_synthetic.py <out-dir>
"""
import json, os, struct, sys
import numpy as np

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(20261116)


def field(s, width):
    b = s.encode('ascii')
    assert len(b) <= width, (s, width)
    return b + b' ' * (width - len(b))


def numfield(x, width=8):
    s = repr(x) if isinstance(x, float) else str(x)
    if isinstance(x, float) and s.endswith('.0'):
        s = s[:-2]
    return field(s, width)


def tal(onset, duration=None, texts=('',)):
    b = onset.encode('ascii')
    if duration is not None:
        b += b'\x15' + duration.encode('ascii')
    b += b'\x14'
    for t in texts:
        b += t.encode('utf-8') + b'\x14'
    return b + b'\x00'


def write_plus(path, bdf, discontinuous, signals, record_duration, record_onsets, extra_tals, ann_bytes):
    """signals: list of dict(label, unit, pmin, pmax, dmin, dmax, spr, data(int array per record list))."""
    bps = 3 if bdf else 2
    ns = len(signals) + 1
    hdr = bytearray()
    hdr += (b'\xffBIOSEMI' if bdf else field('0', 8))
    hdr += field('X X X X', 80)
    hdr += field('Startdate 16-NOV-2026 X X leadline_synthetic', 80)
    hdr += field('16.11.26', 8) + field('21.30.00', 8)
    hdr += numfield(256 * (ns + 1))
    tag = ('BDF+' if bdf else 'EDF+') + ('D' if discontinuous else 'C')
    hdr += field(tag, 44)
    hdr += numfield(len(record_onsets)) + numfield(record_duration) + numfield(ns, 4)
    ann_label = 'BDF Annotations' if bdf else 'EDF Annotations'
    labels = [s['label'] for s in signals] + [ann_label]
    lim = (-8388608, 8388607) if bdf else (-32768, 32767)
    rows = [
        (16, [s['label'] for s in signals] + [ann_label]),
        (80, ['AgAgCl electrode'] * len(signals) + ['']),
        (8, [s['unit'] for s in signals] + ['']),
        (8, [str(s['pmin']) for s in signals] + ['-1']),
        (8, [str(s['pmax']) for s in signals] + ['1']),
        (8, [str(s['dmin']) for s in signals] + [str(lim[0])]),
        (8, [str(s['dmax']) for s in signals] + [str(lim[1])]),
        (80, ['HP:0.1Hz LP:75Hz'] * len(signals) + ['']),
        (8, [str(s['spr']) for s in signals] + [str(ann_bytes // bps)]),
        (32, [''] * ns),
    ]
    for width, vals in rows:
        for v in vals:
            hdr += field(v, width)
    assert len(hdr) == 256 * (ns + 1)
    body = bytearray()
    for r, onset in enumerate(record_onsets):
        for s in signals:
            d = np.asarray(s['data'][r], dtype=np.int64)
            if bdf:
                for v in d:
                    body += int(v & 0xFFFFFF).to_bytes(3, 'little')
            else:
                body += struct.pack('<%dh' % len(d), *d)
        a = tal(onset) + b''.join(extra_tals.get(r, []))
        assert len(a) <= ann_bytes, (len(a), ann_bytes)
        body += a + b'\x00' * (ann_bytes - len(a))
    with open(path, 'wb') as f:
        f.write(hdr + body)
    return labels


def make_discontinuous(bdf):
    name = 'synthetic_%s_D' % ('bdf' if bdf else 'edf')
    dmin, dmax = (-8388608, 8388607) if bdf else (-32768, 32767)
    rec_dur = 0.5
    onsets_s = ['+0', '+0.5', '+1', '+7.25', '+7.75', '+20.125', '+20.625']
    specs = [('Fp1', 256, 'uV', -3200.0, 3200.0), ('C3', 128, 'uV', -800.5, 799.5), ('Resp', 16, 'mV', -5.0, 5.0)]
    signals = []
    for label, fs, unit, pmin, pmax in specs:
        spr = int(fs * rec_dur)
        data = [rng.integers(dmin, dmax + 1, size=spr) for _ in onsets_s]
        # make the extremes appear so sign handling is covered
        data[0][0] = dmin
        data[0][1] = dmax
        data[0][2] = -1
        signals.append(dict(label=label, unit=unit, pmin=pmin, pmax=pmax, dmin=dmin, dmax=dmax, spr=spr, data=data))
    extra = {
        0: [tal('+0.2', '1.5', ['Lights off', 'Close door'])],
        3: [tal('+7.3', None, ['Spike'])],
        5: [tal('-0.065', None, ['Pre-stimulus beep 1000Hz']), tal('+20.4', '0.25', ['Électrode décollée µV'])],
        6: [tal('+20.9', '0', ['Recording ends'])],
    }
    write_plus(os.path.join(OUT, name + ('.bdf' if bdf else '.edf')), bdf, True, signals, rec_dur, onsets_s, extra, 120)
    truth = dict(
        variant=('BDF+D' if bdf else 'EDF+D'),
        recordDuration=rec_dur,
        recordOnsets=[float(o) for o in onsets_s],
        segments=[[0.0, 1.5], [7.25, 8.25], [20.125, 21.125]],
        annotations=[
            [-0.065, None, 'Pre-stimulus beep 1000Hz'],
            [0.2, 1.5, 'Lights off'], [0.2, 1.5, 'Close door'],
            [7.3, None, 'Spike'],
            [20.4, 0.25, 'Électrode décollée µV'],
            [20.9, 0.0, 'Recording ends'],
        ],
        signals=[dict(label=s['label'], unit=s['unit'], pmin=s['pmin'], pmax=s['pmax'], dmin=s['dmin'], dmax=s['dmax'],
                      spr=s['spr'], digital=np.concatenate(s['data']).tolist()) for s in signals],
    )
    with open(os.path.join(OUT, name + '.json'), 'w') as f:
        json.dump(truth, f)


make_discontinuous(False)
make_discontinuous(True)

# ---- malformed files, derived from a small valid EDF+C file ----
def small_valid():
    signals = [dict(label='Cz', unit='uV', pmin=-500.0, pmax=500.0, dmin=-2048, dmax=2047, spr=100,
                    data=[rng.integers(-2048, 2048, size=100) for _ in range(4)])]
    p = os.path.join(OUT, 'valid_small.edf')
    write_plus(p, False, False, signals, 1.0, ['+0', '+1', '+2', '+3'], {1: [tal('+1.5', '2', ['Event'])]}, 60)
    return bytearray(open(p, 'rb').read())

good = small_valid()
H = 256 * 3  # two signals


def put(buf, offset, width, s):
    buf[offset:offset + width] = field(s, width)


def sig_field(base, i, width, ns=2):
    return 256 + base * ns + width * i

bad = {}
bad['truncated'] = good[:len(good) - 150]
b = bytearray(good); put(b, 184, 8, '1024'); bad['header_size_mismatch'] = b
b = bytearray(good); put(b, 236, 8, '-1'); bad['record_count_minus_one'] = b  # must still open, with a warning
b = bytearray(good); put(b, 244, 8, '1,0'); bad['non_numeric_duration'] = b
b = bytearray(good); put(b, sig_field(120, 0, 8), 8, '2047'); bad['digital_min_equals_max'] = b
b = bytearray(good); put(b, sig_field(216, 0, 8), 8, '0'); bad['zero_samples_per_record'] = b
b = bytearray(good); put(b, 252, 4, '0'); put(b, 184, 8, '256'); bad['zero_signals'] = b[:256]
b = bytearray(good); b[0:8] = field('1', 8); bad['bad_version'] = b
bad['too_short'] = good[:100]
b = bytearray(good)
# Overwrite the annotation bytes of record 2 with a TAL that never terminates (no 0x14, no 0x00).
rec_bytes = 100 * 2 + 60
start = H + 2 * rec_bytes + 200
b[start:start + 60] = b'+2' + b'9' * 58
bad['tal_without_terminator'] = b
b = bytearray(good); put(b, 244, 8, '0'); bad['zero_duration_with_signals'] = b
b = bytearray(good); put(b, sig_field(104, 0, 8), 8, 'abc'); bad['non_numeric_physical_min'] = b
for k, v in bad.items():
    with open(os.path.join(OUT, 'bad_%s.edf' % k), 'wb') as f:
        f.write(bytes(v))
print('wrote', sorted(os.listdir(OUT)))
