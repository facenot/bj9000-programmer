# BJ-9000 / RT-950 Pro Bluetooth Programmer (web app)

`index.html` is the whole app. It programs a Bajeton BJ-9000 / Radtel RT-950 Pro over Bluetooth LE
from a phone browser. **It contains no channel data.** You load your own zone CSV files on the phone.

## Phone browser

| Phone | Browser |
|---|---|
| Android | **Chrome** (also Edge, Samsung Internet) |
| iPhone / iPad | **Bluefy** (App Store). Safari and iOS Chrome have no Web Bluetooth |

Web Bluetooth only runs on an **https://** address, e.g. this repo's GitHub Pages site.

## Use

1. Radio: Bluetooth **on** and **not** connected to the Radtel app.
2. **Connect** → pick the radio. If it isn't listed, tick *Show all Bluetooth devices*.
3. **Read radio.** A backup is kept on the phone. Also tap **Download backup**.
4. **Choose zone CSV files** and multi-select your `ZoneNN_NAME.csv` files.
   They stay on the phone and are never uploaded. *Remember on this phone* is optional.
5. **Preview changes** → **Write to radio** → tick both boxes → Write. Keep the screen on until it finishes.
   Every written block is read back and verified.
6. **Undo last write** restores the exact pre-write state.

## Zone CSV format

CHIRP CSV columns (`Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,RxDtcsCode,CrossMode,Mode,TStep,Skip,Power,Comment,...`).
The file name sets the zone: `Zone03_LOCAL.csv` = zone 3, named "LOCAL" (max 12 chars).
A zone file replaces that whole zone. Zones without a file are left untouched.
`Duplex` = `off` → TX disabled. `Mode` = `AM` → AM receive. Names are limited to 12 characters.

## Safety

- **Writes:** channel memory and zone names only, and only the 128-byte blocks that change.
- **Never writes:** VFO, settings, DTMF, APRS, or channels 961–990 / 0x7800+ (unless *Allow writing channels 961–990* is ticked under Advanced).
- **Firmware layout:** pick 0.24+ (10 zones × 99) or older (15 zones × 64) to match **Menu › About**.
- **Model check:** the radio must report "RT-950". If yours reports another name, add it under **Advanced**.

## Source & tests

- `src/core.js`: protocol, BLE link, record encoding
- `src/template.html`: UI. Build with `node src/build.js index.html`
- `node src/test_ble_sim.js`: protocol against a simulated radio over a BLE-like link
- `python3 src/test_ui.py`: full UI in headless Chromium with mocked Web Bluetooth (needs Playwright)

## Credits / status

Protocol, BLE details (ffe1 data/notify, ff31 unlock, 20-byte writes) and memory map come from the
MIT-licensed RT-950 Pro work of Nathan G. Barguss (2E0NBS), PE1HVH and nivingoonesekera.
See `THIRD_PARTY_LICENSE_rt950pro_driver.txt`. This is an independent implementation.
It has been tested against simulated radios. Keep your backups. Use at your own risk.
