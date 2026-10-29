#!/usr/bin/env bash
# Downloads the public test-ROM suites and free homebrew games used by tests/demo (not committed).
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p test homebrew
cd test
if [ ! -d blargg ]; then git clone -q --depth 1 https://github.com/retrio/gb-test-roms blargg && rm -rf blargg/.git; fi
[ -f dmg-acid2.gb ] || curl -sfL -o dmg-acid2.gb https://github.com/mattcurrie/dmg-acid2/releases/download/v1.0/dmg-acid2.gb
[ -f cgb-acid2.gbc ] || curl -sfL -o cgb-acid2.gbc https://github.com/mattcurrie/cgb-acid2/releases/download/v1.1/cgb-acid2.gbc
[ -f dmg-acid2-ref.png ] || curl -sfL -o dmg-acid2-ref.png https://raw.githubusercontent.com/mattcurrie/dmg-acid2/master/img/reference-dmg.png
[ -f cgb-acid2-ref.png ] || curl -sfL -o cgb-acid2-ref.png https://raw.githubusercontent.com/mattcurrie/cgb-acid2/master/img/reference.png
MTS=mts-20240926-1737-443f6e1
if [ ! -d $MTS ]; then curl -sfL https://gekkio.fi/files/mooneye-test-suite/$MTS/$MTS.tar.xz | tar xJ; fi
cd ../homebrew
[ -f libbet.gb ] || curl -sfL -o libbet.gb https://github.com/pinobatch/libbet/releases/download/v0.08/libbet.gb
[ -f big2small.gb ] || curl -sfL -o big2small.gb https://github.com/mdsteele/big2small/releases/download/v1.0.0/big2small.gb
[ -f ucity.gbc ] || curl -sfL -o ucity.gbc https://github.com/AntonioND/ucity/releases/download/v1.3/ucity.gbc
DB=https://raw.githubusercontent.com/gbdev/database/master/entries
[ -f adjustris.gb ] || curl -sfL -o adjustris.gb https://github.com/tbsp/Adjustris/releases/download/v1.1/adjustris.gb
[ -f geometrix.gbc ] || curl -sfL -o geometrix.gbc https://raw.githubusercontent.com/AntonioND/geometrix/master/geometrix.gbc
[ -f 2048.gb ] || curl -sfL -o 2048.gb $DB/2048gb/2048.gb
[ -f tobudx.gb ] || curl -sfL -o tobudx.gb $DB/tobutobugirldeluxe/tobudx.gb
[ -f porklike.gb ] || curl -sfL -o porklike.gb $DB/porklike-gb/porklike.gb
[ -f shocklobster.gb ] || curl -sfL -o shocklobster.gb $DB/shock-lobster/shocklobster.gb
# Our own two-player link-cable demo (source in homebrew/linktron/, prebuilt so no RGBDS needed).
cp ../../homebrew/linktron/linktron.gb linktron.gb
echo "ROMs ready."
