#!/bin/sh
# Downloads the third-party test recordings into test-data/ and checks each SHA-256.
# None of these files are committed: the PhysioNet ones are ODC-By 1.0 (see DATA.md), the others carry no
# stated licence, so they are fetched for local testing only.
set -eu
cd "$(dirname "$0")/.."
mkdir -p test-data
cd test-data

fetch() { # url sha256 [name]
  name="${3:-$(basename "$1")}"
  if [ -f "$name" ] && [ "$(shasum -a 256 "$name" | cut -d' ' -f1)" = "$2" ]; then echo "ok   $name"; return; fi
  echo "get  $name"
  curl -fsSL --retry 3 -m 600 -o "$name.part" "$1"
  got="$(shasum -a 256 "$name.part" | cut -d' ' -f1)"
  if [ "$got" != "$2" ]; then echo "SHA-256 mismatch for $name: $got" >&2; rm -f "$name.part"; exit 1; fi
  mv "$name.part" "$name"
}

PN=https://physionet.org/files
fetch $PN/sleep-edfx/1.0.0/sleep-cassette/SC4001E0-PSG.edf 2b40a18adf76af69a42d6db1f30f31d26b369f6d27ca0050ef30147ef892b131
fetch $PN/sleep-edfx/1.0.0/sleep-cassette/SC4001EC-Hypnogram.edf a4cf67694ade1b52a0ddd06d5817fd45d2d3e8bac5302f640f3e9cfbbf12a996
fetch $PN/eegmmidb/1.0.0/S001/S001R03.edf 3427c8d01bff1380bc9ab9f27a35ece2af5dfadf3e291bbc05eb66e4dadbfe2e
fetch $PN/eegmmidb/1.0.0/S001/S001R01.edf 4743b736131a7e147c150e8b37711029b6cda5e356c4b3e8261a03cdcaaf8b0c

TZ=https://www.teuniz.net/edf_bdf_testfiles
fetch $TZ/test_generator_2_edfplus.zip b13f451c07c50a9d8bbfb4d14b89638c9a79266cd1b07bcf43fa8c6497b274fd
fetch $TZ/test_generator_2_bdfplus.zip 42d3bf98e31d7dc453eee2ad799ae34b741db8bbcbb889b61d9ad8e3ba9b1528
fetch $TZ/test_generator.zip 8db25fe8c7b8ed2f43be6ab49b548274b6d49cd2bf1627a8f6e69b8b9cdab967
fetch https://www.biosemi.com/download/BDFtestfiles.zip dd37b279bf80b7070f70835c00b33f0ffc93286c7629027049ca371c862dd7d4
fetch https://www.edfplus.info/downloads/files/edfcalib.zip b34dc00324cb9987e0f530e4a3e765aec5b2852ba53e17981b51dce864275510

for z in test_generator_2_edfplus.zip test_generator_2_bdfplus.zip test_generator.zip BDFtestfiles.zip edfcalib.zip; do
  unzip -oq "$z"
done
echo "test data ready in $(pwd)"
