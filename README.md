# BJ-9000 / RT-950 Pro Bluetooth Programmer (web app) v1.2.0

**Open the app:** https://facenot.github.io/bj9000-programmer/ (no install, nothing to sign up for)

`index.html` is the whole app. It programs a **Bajeton BJ-9000** or **Radtel RT-950 Pro** over Bluetooth LE from a phone
browser. The two are the same hardware with the same programming protocol, so pick yours at the top of the page.
That choice only changes the names the app shows and expects.
**The app contains no channel data.** You load your own zone CSV files on the phone.

## Phone browser

| Phone | Browser |
|---|---|
| Android | **Chrome** (also Edge, Samsung Internet) |
| iPhone / iPad | **Bluefy** (App Store). Safari and iOS Chrome have no Web Bluetooth |

Web Bluetooth only runs on an **https://** address, e.g. this repo's GitHub Pages site.

## Channels

1. Choose your radio. On the radio, turn Bluetooth **on** and make sure it is **not** connected to the manufacturer's phone app.
2. **Connect** → pick the radio. If it isn't listed, tick *Show all Bluetooth devices*.
3. **Read radio.** A backup is kept on the phone. Also tap **Download backup**.
   If the radio reports a model name other than "RT-950", the app stops and shows the name, with a
   one-tap button to accept it as your radio.
4. **Choose zone package (.zip) or CSV files.** Pick one `.zip` holding your `ZoneNN_NAME.csv` files (sub-folders are fine, no need to unzip first), or multi-select the CSVs themselves. If a loose CSV and a zip both carry the same zone number, the file picked later wins and the log says so. Everything stays on the phone.
5. **Preview changes** → **Write to radio**. Every written block is read back and verified.
   **Undo last write** restores the exact pre-write state.

### Zone CSV format

**Starter file:** [`examples/Zone01_HAM_SIMPLEX.csv`](examples/Zone01_HAM_SIMPLEX.csv) has national calling channels,
APRS, a repeater example, NOAA and an airband example. Edit it (CHIRP or any spreadsheet), keep the `ZoneNN_NAME.csv`
naming, and load it. Files exported from CHIRP for other radios work if you rename them this way.

CHIRP CSV columns (`Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,RxDtcsCode,CrossMode,Mode,TStep,Skip,Power,...`).
The file name sets the zone: `Zone03_LOCAL.csv` = zone 3, named "LOCAL" (max 12 chars).
A zone package is just these CSVs zipped together (standard zip, stored or deflate, not password-protected). Zip reading uses the browser's built-in decompressor: Chrome 103+ on Android, Bluefy on iOS 16.4+.
A zone file replaces that whole zone. Zones without a file are left untouched.
`Duplex` = `off` → TX disabled. `Mode` = `AM` → AM receive.

### 27 MHz CB

Under *Add CB 40 channels* in step 3 you can append the 40 US CB channels to a zone, or replace a zone with them.
The radio transmits **FM only** on 27 MHz. CB channels work only after you switch the radio itself to
**Menu › Radio Set › Work Band › 18–64 MHz** (the radio restarts) and fit a 27 MHz antenna.
Switch back to 64–999 MHz for VHF/UHF. The app can't toggle Work Band because that setting isn't in a mapped memory area.

## APRS

Section **A** reads the radio's APRS settings block and edits:

- **Basic:** enable, GPS, callsign, SSID, symbol, beacon interval, path, position source
- **Fixed position:** lat/lon/altitude. Fill it with **Use phone location**, or paste a decimal `lat, lon`.
- **Optional:** beacon message, PATH1/PATH2, and advanced raw values.

How it writes:

- Only the fields you change are written. Every other byte stays as read.
- The radio saves the block and may drop Bluetooth. The app reconnects and reads it back to verify.
- **Undo APRS change** restores the previous settings.

Fields marked **\*** have option mappings taken from the manual's menu order that haven't been confirmed on hardware.
The current raw value is shown, and the field is left alone unless you change it.
APRS transmits on the frequency of the channel/VFO it uses. Put your APRS frequency (144.390 MHz in the US) in a channel.
A callsign requires an amateur radio licence.

## Safety

- **Channel writes** cover only channel memory and zone names, and only the 128-byte blocks that change.
  VFO, settings, DTMF and channels 961–990 (0x7800+) are never written unless you allow it under Advanced.
- **APRS writes** cover only the 128-byte APRS block, and only from section A.
- **Firmware layout:** pick 0.24+ (10 zones × 99) or older (15 zones × 64) to match **Menu › About**.

## Source & tests

- `src/core.js`: protocol, BLE link, channel + APRS encoding. Build with `node src/build.js index.html`.
- `node src/test_ble_sim.js`: protocol, APRS (incl. the link dropping after commit), CB template against a simulated radio
- `python3 src/test_ui.py`: full UI in headless Chromium with mocked Web Bluetooth (needs Playwright)

## Credits / status

Protocol, BLE details (ffe1 data/notify, ff31 unlock, 20-byte writes), and channel/APRS memory maps come from the
MIT-licensed RT-950 Pro work of Nathan G. Barguss (2E0NBS), PE1HVH and nivingoonesekera.
See `THIRD_PARTY_LICENSE_rt950pro_driver.txt`. This is an independent implementation (MIT, see `LICENSE`).
Channel/zone writing has been used on a real BJ-9000; APRS writing is tested against a simulated radio only.
Keep your backups. Use at your own risk. You are responsible for transmitting only where you are licensed
(amateur, GMRS, etc.). Set channels you may not transmit on to `Duplex` = `off`.

Bug reports and radio-variant reports (model string, firmware version) are welcome in Issues.
