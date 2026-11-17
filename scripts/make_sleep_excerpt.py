"""Cuts the sleep period out of PhysioNet Sleep-EDF SC4001E0-PSG.edf (ODC-By 1.0) for the bundled demo.

Byte-level copy: the header is kept except the start date, start time and record count, which are updated so the
excerpt keeps its true wall-clock time (the unmodified hypnogram file then aligns by header start times). Data
records are copied unchanged. Usage: python make_sleep_excerpt.py <SC4001E0-PSG.edf> <out.edf>
"""
import datetime, sys

src, dst = sys.argv[1], sys.argv[2]
FIRST_S, LAST_S = 29400, 54000  # sleep onset is at 30630 s and the last sleep epoch ends at 52260 s
raw = open(src, 'rb').read()
ns = int(raw[252:256])
hbytes = int(raw[184:192])
dur = float(raw[244:252])
spr = [int(raw[256 + ns * 216 + 8 * i: 256 + ns * 216 + 8 * i + 8]) for i in range(ns)]
rec = sum(spr) * 2
r0, r1 = int(FIRST_S / dur), int(LAST_S / dur)
start = datetime.datetime.strptime(raw[168:184].decode(), '%d.%m.%y%H.%M.%S') + datetime.timedelta(seconds=r0 * dur)
hdr = bytearray(raw[:hbytes])
hdr[168:176] = start.strftime('%d.%m.%y').encode()
hdr[176:184] = start.strftime('%H.%M.%S').encode()
hdr[236:244] = str(r1 - r0).ljust(8).encode()
open(dst, 'wb').write(bytes(hdr) + raw[hbytes + r0 * rec: hbytes + r1 * rec])
print(dst, r1 - r0, 'records from', start)
