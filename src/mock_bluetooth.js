// Injected before page load: fake navigator.bluetooth backed by a simulated radio.
(() => {
  const SIM = { mem: null, original: null, writes: [], state: "idle", key: null, inb: [], chunks: 0, maxChunk: 0 };
  window.__SIM = SIM;
  function init() {
    const BJ = window.BJ;
    SIM.mem = new Uint8Array(0x10000); for (let i = 0; i < SIM.mem.length; i++) SIM.mem[i] = (i * 31 + 7) & 0xFF;
    for (let s = 0; s < 990; s++) SIM.mem.set(BJ.EMPTY_REC, s * 32);
    SIM.mem.fill(0xFF, 0x7BC0, 0x8000);
    for (const s of [0, 1, 50, 900]) SIM.mem.set(BJ.buildRecord({ Frequency: (146 + s / 1000).toFixed(4), Name: "OLD" + s, Mode: "FM" }), s * 32);
    SIM.mem.fill(0xFF, 0xC000, 0xC100); SIM.mem.set(Array.from("OLDZONE1", c => c.charCodeAt(0)), 0xC000);
    SIM.original = new Uint8Array(SIM.mem);
    SIM.aprs = new Uint8Array(128).fill(0x00);
    SIM.aprs.set([0, 1, 0, 0, 0, 0, 8, 0x4E, 44, 39, 21, 0x57, 59, 104, 10, 0x64, 0x00], 0);
    SIM.aprs.set(Array.from("N0CALL", c => c.charCodeAt(0)), 17); SIM.aprs[23] = 9; SIM.aprs[26] = 2;
    SIM.aprs.set(Array.from("Hello world!", c => c.charCodeAt(0)), 79); SIM.aprs.fill(0xFF, 119, 128);
    SIM.aprsOriginal = new Uint8Array(SIM.aprs); SIM.reconnects = 0;
  }
  let listener = null;
  const notify = bytes => { for (let i = 0; i < bytes.length; i += 20) { const p = new Uint8Array(bytes.slice(i, i + 20)); setTimeout(() => listener && listener({ target: { value: new DataView(p.buffer) } }), 2 + i / 20); } };
  const xor = d => { const o = new Uint8Array(d); for (let i = 0; i < o.length; i++) { const k = SIM.key[i % 4], v = o[i]; if (k !== 0x20 && v !== 0 && v !== 0xFF && v !== k && v !== (k ^ 0xFF)) o[i] = v ^ k; } return o; };
  function process() {
    const b = SIM.inb;
    for (;;) {
      if (SIM.state === "idle") { if (b.length < 14) return; b.splice(0, 14); notify([6]); SIM.state = "hs"; continue; }
      if (!b.length) return;
      if (SIM.state === "hs") {
        if (b[0] === 0x46) { b.splice(0, 1); notify([...Array(16).keys()]); continue; }
        if (b[0] === 0x4D) { b.splice(0, 1); notify(Array.from((SIM.model || "RT-950").padEnd(12, " "), c => c.charCodeAt(0))); continue; }
        if (b[0] === 0x45) { b.splice(0, 1); SIM.state = "idle"; continue; }
        if (b.length < 25) return;
        const f = b.splice(0, 25), code = f[4]; const idx = ((code & 0x20) ? (code - 0x20) * 2 + 1 : (code - 0x10) * 2) + 1;
        SIM.key = window.BJ.XOR_KEYS[f[4 + idx]]; notify([6]); SIM.state = "open"; continue;
      }
      if (b[0] === 0x45) { b.splice(0, 1); SIM.state = "idle"; continue; }
      if (b[0] === 0x52) { if (b.length < 4) return; const h = b.splice(0, 4), a = (h[1] << 8) | h[2]; notify([...h, ...xor(SIM.mem.subarray(a, a + 128))]); continue; }
      if (b[0] === 0x54) { if (b.length < 4) return; const h = b.splice(0, 4); notify([...h, ...xor(SIM.aprs)]); continue; }
      if (b[0] === 0x58) { if (b.length < 132) return; const f = b.splice(0, 132); SIM.aprs.set(xor(new Uint8Array(f.slice(4))), 0); SIM.aprsWrites = (SIM.aprsWrites || 0) + 1; notify([6]);
        setTimeout(() => { device.gatt.connected = false; SIM.state = "idle"; SIM.inb.length = 0; }, 40); continue; }
      if (b[0] === 0x57) { if (b.length < 132) return; const f = b.splice(0, 132), a = (f[1] << 8) | f[2]; SIM.mem.set(xor(new Uint8Array(f.slice(4))), a); SIM.writes.push(a); notify([6]); continue; }
      throw new Error("sim: unexpected " + b[0]);
    }
  }
  const ffe1 = {
    uuid: "0000ffe1-0000-1000-8000-00805f9b34fb", properties: { writeWithoutResponse: true, write: true, notify: true },
    addEventListener: (ev, fn) => { listener = fn; }, removeEventListener: () => { },
    startNotifications: async () => ffe1,
    writeValueWithoutResponse: async (p) => { if (!device.gatt.connected) throw new Error("GATT Server is disconnected"); SIM.chunks++; SIM.maxChunk = Math.max(SIM.maxChunk, p.length); SIM.inb.push(...p); process(); },
    writeValueWithResponse: async (p) => { if (p[0] === 0x58) SIM.aprsWithResponse = true; return ffe1.writeValueWithoutResponse(p); },
  };
  const ff31 = { uuid: "0000ff31-0000-1000-8000-00805f9b34fb", properties: { write: true },
    writeValueWithResponse: async (p) => { SIM.unlock = Array.from(new Uint8Array(p.buffer || p)).map(x => x.toString(16).padStart(2, "0")).join(""); notify([0x21, 0x4F, 0x4B]); } };
  const device = {
    name: "RT-950 Pro", addEventListener: () => { },
    gatt: { connected: false,
      connect: async () => { if (SIM.everConnected) SIM.reconnects++; SIM.everConnected = true; SIM.state = "idle"; device.gatt.connected = true; return { getPrimaryServices: async () => [
        { uuid: "0000ffe0-0000-1000-8000-00805f9b34fb", getCharacteristics: async () => [ffe1] },
        { uuid: "0000ff30-0000-1000-8000-00805f9b34fb", getCharacteristics: async () => [ff31] }] }; },
      disconnect: () => { device.gatt.connected = false; } },
  };
  Object.defineProperty(navigator, "bluetooth", { value: { requestDevice: async (o) => { SIM.requestOpts = o; if (!SIM.mem) init(); return device; } } });
})();
