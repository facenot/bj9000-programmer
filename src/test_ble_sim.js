// Node tests: core.js against a simulated RT-950 Pro over a BLE-like link
// (20-byte notifications, async delivery, unlock reply, stray ACK).
"use strict";
const fs = require("fs"), path = require("path");
const BJ = require("./core.js");
const ZDIR = process.argv[2] || null;   // optional: folder of ZoneNN_*.csv; default = neutral sample
const SAMPLE = [
  { zone: 1, name: "LOCAL", rows: [
    { Name: "RPT A", Frequency: "146.940000", Duplex: "-", Offset: "0.600000", Tone: "Cross", rToneFreq: "136.5", cToneFreq: "156.7", CrossMode: "Tone->Tone", Mode: "NFM", Power: "High" },
    { Name: "SIMPLEX", Frequency: "146.520000", Duplex: "", Offset: "0", Tone: "TSQL", rToneFreq: "100.0", cToneFreq: "100.0", Mode: "FM", Power: "Low" },
    { Name: "WX RX", Frequency: "162.550000", Duplex: "off", Offset: "0", Tone: "", Mode: "FM" }] },
  { zone: 2, name: "AIR", rows: [{ Name: "AIR TWR", Frequency: "119.900000", Duplex: "off", Offset: "0", Tone: "", Mode: "AM" }] },
  { zone: 3, name: "UHF", rows: [{ Name: "UHF SPL", Frequency: "446.000000", Duplex: "split", Offset: "441.000000", Tone: "Tone", rToneFreq: "123.0", Mode: "NFM" }] },
  { zone: 4, name: "DCS", rows: [{ Name: "DCS", Frequency: "446.100000", Duplex: "", Offset: "0", Tone: "DTCS", DtcsCode: "023", DtcsPolarity: "NN", Mode: "NFM" }] },
];

class SimRadio {
  constructor({ model = "RT-950", strayAck = true, dropFirstHandshake = false, corrupt = null, dropReadOnce = null } = {}) {
    this.mem = new Uint8Array(0x10000); for (let i = 0; i < this.mem.length; i++) this.mem[i] = (i * 31 + 7) & 0xFF;
    for (let s = 0; s < 990; s++) this.mem.set(BJ.EMPTY_REC, s * 32);
    this.mem.fill(0xFF, 0x7BC0, 0x8000);
    for (const s of [0, 1, 50, 900, 960, 975]) this.mem.set(BJ.buildRecord({ Frequency: (146 + s / 1000).toFixed(4), Name: "OLD" + s, Mode: "FM" }), s * 32);
    this.mem.fill(0xFF, 0xC000, 0xC100); this.mem.set(Array.from("OLDZONE1", c => c.charCodeAt(0)), 0xC000);
    this.original = new Uint8Array(this.mem);
    // APRS block: realistic factory-ish content, message NUL-padded like the CPS writes it
    this.aprs = new Uint8Array(128).fill(0x00);
    this.aprs.set([0, 1, 0, 0, 0, 0, 8, 0x4E, 44, 39, 21, 0x57, 59, 104, 10, 0x64, 0x00], 0);
    this.aprs.set(Array.from("N0CALL", c => c.charCodeAt(0)), 17);
    this.aprs[23] = 9; this.aprs[24] = 2; this.aprs[25] = 1; this.aprs[26] = 2; this.aprs[27] = 0x85; this.aprs[36] = 0;
    this.aprs.set(Array.from("Hello world!", c => c.charCodeAt(0)), 79);
    this.aprs.fill(0xFF, 119, 128);
    this.aprsOriginal = new Uint8Array(this.aprs);
    this.dropped = false; this.aprsWithResponse = null;
    Object.assign(this, { model, strayAck, dropFirstHandshake, corrupt, dropReadOnce });
    this.inb = []; this.state = "idle"; this.key = null; this.writes = []; this.handshakes = 0; this.unlocked = false;
    this.chunks = 0;
    this.link = { onData: null,
      write: BJ.chunkedWriter(async (b, o) => {
        if (this.dropped) throw new Error("Bluetooth link is down");
        if (b[0] === 0x58 && this.state === "open") this.aprsWithResponse = !!o.withResponse;
        this.chunks++; await this._rx(b);
      }),
      ensure: async () => {
        if (this.dropped) { this.dropped = false; this.unlocked = false; this.state = "idle"; this.inb.length = 0; this.reconnects = (this.reconnects || 0) + 1; }
        if (!this.unlocked) { this.unlocked = true; this._notify([0x21, 0x4F, 0x4B]); }
      } };
  }
  _notify(bytes) {           // deliver as 20-byte BLE notifications, async
    for (let i = 0; i < bytes.length; i += 20) {
      const part = new Uint8Array(bytes.slice(i, i + 20));
      setTimeout(() => this.link.onData && this.link.onData(part), 1 + i / 20);
    }
  }
  _xor(d) { const o = new Uint8Array(d); for (let i = 0; i < o.length; i++) { const k = this.key[i % 4], v = o[i]; if (k !== 0x20 && v !== 0 && v !== 0xFF && v !== k && v !== (k ^ 0xFF)) o[i] = v ^ k; } return o; }
  async _rx(bytes) {
    if (bytes.length > 20) throw new Error("sim expects <=20-byte chunks from link layer");
    this.inb.push(...bytes); this._process();
  }
  _process() {
    const b = this.inb;
    for (;;) {
      if (this.state === "idle") {
        if (b.length < 14) return;
        const s = String.fromCharCode(...b.slice(0, 14));
        if (s !== "PROGRAMBT9000U") throw new Error("bad handshake " + s);
        b.splice(0, 14); this.handshakes++;
        if (this.dropFirstHandshake && this.handshakes === 1) { this.state = "idle"; continue; } // cold-link drop
        this._notify([0x06]); this.state = "hs"; continue;
      }
      if (this.state === "hs") {
        if (!b.length) return;
        if (b[0] === 0x46) { b.splice(0, 1); const id = [...Array(16).keys()]; this._notify(this.strayAck && this.handshakes <= 2 ? [0x06, ...id] : id); continue; }
        if (b[0] === 0x4D) { b.splice(0, 1); this._notify(Array.from(this.model.padEnd(12, " "), c => c.charCodeAt(0))); continue; }
        if (b[0] === 0x45) { b.splice(0, 1); this.state = "idle"; continue; }
        if (b[0] === 0x53) {
          if (b.length < 25) return;
          const f = b.splice(0, 25), code = f[4];
          const idx = ((code & 0x20) ? (code - 0x20) * 2 + 1 : (code - 0x10) * 2) + 1;
          this.key = BJ.XOR_KEYS[f[4 + idx]]; this._notify([0x06]); this.state = "open"; continue;
        }
        if (b[0] === 0x50) { this.state = "idle"; continue; } // re-handshake after dropped one
        throw new Error("hs unexpected " + b[0]);
      }
      if (this.state === "open") {
        if (!b.length) return;
        if (b[0] === 0x45) { b.splice(0, 1); this.state = "idle"; continue; }
        if (b[0] === 0x50) { this.state = "idle"; continue; }
        if (b[0] === 0x52) {
          if (b.length < 4) return;
          const h = b.splice(0, 4), a = (h[1] << 8) | h[2];
          if (this.dropReadOnce === a) { this.dropReadOnce = null; continue; }   // lost request
          this._notify([...h, ...this._xor(this.mem.subarray(a, a + h[3]))]); continue;
        }
        if (b[0] === 0x54) {
          if (b.length < 4) return;
          const h = b.splice(0, 4);
          this._notify([...h, ...this._xor(this.aprs.subarray(0, 128))]); continue;
        }
        if (b[0] === 0x58) {
          if (b.length < 132) return;
          const f = b.splice(0, 132);
          this.aprs.set(this._xor(new Uint8Array(f.slice(4))), 0); this.aprsWrites = (this.aprsWrites || 0) + 1;
          this._notify([0x06]);
          setTimeout(() => { this.dropped = true; }, 30);   // radio commits, then drops the BLE link
          continue;
        }
        if (b[0] === 0x57) {
          if (b.length < 132) return;
          const f = b.splice(0, 132), a = (f[1] << 8) | f[2];
          let data = this._xor(new Uint8Array(f.slice(4)));
          if (this.corrupt === a) data = new Uint8Array(128);
          this.mem.set(data, a); this.writes.push(a); this._notify([0x06]); continue;
        }
        throw new Error("open unexpected " + b[0]);
      }
    }
  }
}

function loadZones() {
  if (!ZDIR) return SAMPLE;
  return fs.readdirSync(ZDIR).filter(f => /^Zone\d+_.*\.csv$/i.test(f)).sort().map(f => {
    const z = BJ.zoneFromFilename(f);
    return { zone: z.zone, name: z.name, rows: BJ.parseCSV(fs.readFileSync(path.join(ZDIR, f), "utf8")) };
  });
}

const results = [];
const check = (n, c) => results.push([n, !!c]);
const opts = (extra = {}) => Object.assign({ allowedModels: ["RT-950"], log: () => { } }, extra);
const slot = (sim, z, k, per = 99) => sim.mem.subarray(((z - 1) * per + k - 1) * 32, ((z - 1) * per + k) * 32);

async function fullWrite(sim, layout = "990", o = opts()) {
  const img = await BJ.readImage(sim.link, o);
  const target = BJ.buildTarget(img, loadZones(), layout, false);
  const blocks = BJ.planWrites(img, target, layout, false);
  await BJ.writeBlocks(sim.link, o, blocks);
  const bad = await BJ.verifyBlocks(sim.link, o, blocks);
  return { img, blocks, bad };
}

(async () => {
  const zones = loadZones();
  check("zones loaded", zones.length > 0);
  check("BCD 145.2125", BJ.toHex(BJ.encFreq(145.2125)) === "50125214");
  check("CTCSS 88.5", BJ.toHex(BJ.encCtcss(88.5)) === "7503");
  check("DCS idx", BJ.encDcs(23, "N")[0] === 1 && BJ.encDcs(23, "I")[0] === 106);

  // cross-check with Python tool encodings
  if (process.argv[3]) {   // optional byte-for-byte cross-check against bj9000_upload.py output
    const py = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    let mism = 0, n = 0;
    for (const z of zones) z.rows.forEach((r, i) => { n++; if (BJ.toHex(BJ.buildRecord(r)) !== py[`${z.zone}:${i}`]) { mism++; console.log("MISMATCH", z.zone, i, r.Name); } });
    check(`JS records == Python records (${n})`, mism === 0 && n > 0);
  }

  // 1 read image over BLE (stray ACK + unlock reply)
  let sim = new SimRadio();
  await sim.link.ensure();
  const img = await BJ.readImage(sim.link, opts());
  check("read image matches radio", BJ.eq(img.ch, sim.mem.subarray(0, 0x8000)) && BJ.eq(img.zn, sim.mem.subarray(0xC000, 0xC100)));
  check("read wrote nothing", sim.writes.length === 0);

  // 2 full write + verify
  sim = new SimRadio(); await sim.link.ensure();
  let r = await fullWrite(sim);
  check("write+verify OK", r.bad.length === 0 && r.blocks.length > 0);
  check("only channel(<0x7800)+zone blocks", sim.writes.every(a => a < 0x7800 || (a >= 0xC000 && a < 0xC100)));
  check("settings untouched", BJ.eq(sim.mem.subarray(0x8000, 0xC000), sim.original.subarray(0x8000, 0xC000)) && BJ.eq(sim.mem.subarray(0xC100), sim.original.subarray(0xC100)));
  check("ch 961-990 untouched", BJ.eq(sim.mem.subarray(0x7800, 0x8000), sim.original.subarray(0x7800, 0x8000)));
  if (!ZDIR) {
    const v = slot(sim, 1, 1);
    check("repeater -0.6 split + cross tones", BJ.decFreq(v.subarray(0, 4)) === 146.94 && BJ.decFreq(v.subarray(4, 8)) === 146.34 && BJ.toHex(v.subarray(8, 12)) === BJ.toHex(BJ.encCtcss(156.7)) + BJ.toHex(BJ.encCtcss(136.5)) && (v[15] & 0x42) === 0x42);
    check("TSQL + low power", BJ.toHex(slot(sim, 1, 2).subarray(8, 12)) === BJ.toHex(BJ.encCtcss(100)) + BJ.toHex(BJ.encCtcss(100)) && slot(sim, 1, 2)[14] === 2);
    check("RX-only FM", (slot(sim, 1, 3)[15] & 0x43) === 0);
    check("AM RX-only", (slot(sim, 2, 1)[15] & 3) === 1);
    check("odd split TX 441", BJ.decFreq(slot(sim, 3, 1).subarray(4, 8)) === 441);
    check("DCS D023N both", BJ.toHex(slot(sim, 4, 1).subarray(8, 12)) === "01000100");
    check("zone names", BJ.zoneNames(sim.mem.subarray(0xC000, 0xC100)).slice(0, 4).join("|") === "LOCAL|AIR|UHF|DCS");
  }
  check("old ch cleared", BJ.eq(slot(sim, 1, 51), BJ.EMPTY_REC));

  // 3 idempotent
  const w0 = sim.writes.length;
  r = await fullWrite(sim);
  check("second write no-op", r.blocks.length === 0 && sim.writes.length === w0);

  // 4 restore from backup JSON
  const bk = BJ.backupJSON({ ch: sim.original.subarray(0, 0x8000), zn: sim.original.subarray(0xC000, 0xC100), model: "RT-950" });
  const bimg = BJ.parseBackup(bk.text);
  const cur = await BJ.readImage(sim.link, opts());
  const rb = BJ.changedBlocks(cur.ch, bimg.ch, 0, BJ.LOW_LIMIT).concat(BJ.changedBlocks(cur.zn, bimg.zn, 0xC000, 0x100));
  await BJ.writeBlocks(sim.link, opts(), rb);
  check("restore -> original", BJ.eq(sim.mem, sim.original) && (await BJ.verifyBlocks(sim.link, opts(), rb)).length === 0);

  // 5 model guard + override
  sim = new SimRadio({ model: "BJ-9000" }); await sim.link.ensure();
  let refused = false; try { await BJ.readImage(sim.link, opts()); } catch (e) { refused = /not allowed/.test(e.message); }
  check("unknown model refused", refused && sim.writes.length === 0);
  r = await fullWrite(sim, "990", opts({ allowedModels: ["RT-950", "BJ-9000"] }));
  check("model override works", r.bad.length === 0);

  // 6 cold link: first handshake dropped -> retry
  sim = new SimRadio({ dropFirstHandshake: true }); await sim.link.ensure();
  r = await fullWrite(sim);
  check("handshake retry after cold-link drop", r.bad.length === 0);

  // 7 lost read request -> block retry
  sim = new SimRadio({ dropReadOnce: 0x0100 }); await sim.link.ensure();
  r = await fullWrite(sim);
  check("lost read request recovered", r.bad.length === 0);

  // 8 verify catches corruption
  sim = new SimRadio({ corrupt: 0x0000 }); await sim.link.ensure();
  r = await fullWrite(sim);
  check("verify detects corrupt block", r.bad.includes(0x0000));

  // 9 960 layout
  sim = new SimRadio(); await sim.link.ensure();
  r = await fullWrite(sim, "960");
  check("960 layout: no zone names, <0x7800", r.bad.length === 0 && sim.writes.every(a => a < 0x7800));
  check("960 zone2 ch1 at slot 64", BJ.decFreq(slot(sim, 2, 1, 64).subarray(0, 4)) === BJ.decFreq(BJ.buildRecord(zones.find(z => z.zone === 2).rows[0]).subarray(0, 4)));

  // 10 Python-compatible backup format
  check("backup JSON round-trip", BJ.eq(BJ.parseBackup(bk.text).ch, sim.original.subarray(0, 0x8000)));

  // 11 APRS: read, edit a few fields, write (link drops after commit), reconnect + verify
  sim = new SimRadio(); await sim.link.ensure();
  const ablk = await BJ.readAprs(sim.link, opts());
  check("APRS read matches", BJ.eq(ablk, sim.aprs));
  const ap = BJ.parseAprs(ablk);
  check("APRS parse", ap.call === "N0CALL" && ap.ssid === 9 && ap.lat_ns === "N" && ap.lat_deg === 39 && ap.lat_min === 44 && ap.lon_ew === "W" && ap.lon_deg === 104 && ap.alt === 100 && ap.msg === "Hello world!" && ap.icon === 5);
  const dms = BJ.decimalToDMS(-104.9903, false);
  const { block: nb, changed } = BJ.encodeAprs(ablk, { aprs_on: 1, call: "test1", ssid: 7, beacon_time: 4, msg: "Mobile 146.52", lon_ew: dms.hemi, lon_deg: dms.d, lon_min: dms.m, lon_sec: dms.s, alt: 120 });
  check("decimal->DMS", dms.hemi === "W" && dms.d === 104 && dms.m === 59 && dms.s === 25);
  check("APRS only edited fields changed", changed.map(c => c.key).sort().join(",") === "alt,aprs_on,beacon_time,call,lon_sec,msg,ssid");
  const diff = []; for (let i = 0; i < 128; i++) if (nb[i] !== ablk[i]) diff.push(i);
  check("APRS byte diff limited to edited offsets", diff.every(i => [0, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 36].includes(i) || (i >= 79 && i < 119)));
  check("message keeps NUL padding", nb[79 + 13] === 0x00 && nb[118] === 0x00);
  check("icon high bit preserved", nb[27] === 0x85);
  await BJ.writeAprs(sim.link, opts(), nb);
  check("APRS frame sent with response", sim.aprsWithResponse === true);
  await BJ.sleep(80);
  check("link dropped after commit", sim.dropped === true);
  const back = await BJ.readAprs(sim.link, opts());
  check("reconnected + APRS verified", sim.reconnects === 1 && BJ.eq(back, nb) && BJ.eq(sim.aprs, nb));
  check("channel memory untouched by APRS", BJ.eq(sim.mem, sim.original));
  let bad = 0; for (const [k, v] of [["call", "TOOLONG1"], ["ssid", 16], ["lat_deg", 91], ["lat_ns", "X"], ["alt", 20000], ["msg", "x".repeat(41)]]) { try { BJ.encodeAprs(ablk, { [k]: v }); } catch (e) { bad++; } }
  check("APRS validation rejects bad values", bad === 6);
  // undo APRS
  await BJ.writeAprs(sim.link, opts(), sim.aprsOriginal);
  await BJ.sleep(80);
  check("APRS undo", BJ.eq(await BJ.readAprs(sim.link, opts()), sim.aprsOriginal));

  // 12 CB template rows encode (FM-only TX band 18-64 MHz)
  const cb = BJ.cbRows();
  const r23 = BJ.buildRecord(cb[22]), r1 = BJ.buildRecord(cb[0]);
  check("CB 40 template: ch1 26.965, ch23 27.255, ch40 27.405", cb.length === 40 && BJ.decFreq(r1.subarray(0, 4)) === 26.965 && BJ.decFreq(r23.subarray(0, 4)) === 27.255 && BJ.decFreq(BJ.buildRecord(cb[39]).subarray(0, 4)) === 27.405 && (r1[15] & 0x03) === 0x02);

  for (const [n2, ok] of results) console.log((ok ? "PASS " : "FAIL ") + n2);
  console.log(`${results.filter(x => x[1]).length}/${results.length} passed`);
  process.exit(results.every(x => x[1]) ? 0 : 1);
})().catch(e => { console.error("CRASH", e); process.exit(2); });
