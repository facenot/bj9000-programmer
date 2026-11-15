"""Drive dist/index.html in headless Chromium with a mocked Web Bluetooth radio."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
DIST = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else HERE.parent   # folder holding index.html
results = []
HDR = "Location,Name,Frequency,Duplex,Offset,Tone,rToneFreq,cToneFreq,DtcsCode,DtcsPolarity,RxDtcsCode,CrossMode,Mode,TStep,Skip,Power,Comment,URCALL,RPT1CALL,RPT2CALL,DVCODE"
SAMPLE = {
    "Zone01_LOCAL.csv": ["1,RPT A,146.940000,-,0.600000,Cross,136.5,156.7,023,NN,023,Tone->Tone,NFM,5.00,,High,,,,,",
                         "2,SIMPLEX,146.520000,,0.000000,TSQL,100.0,100.0,023,NN,023,Tone->Tone,FM,5.00,,Low,,,,,"],
    "Zone02_AIR.csv": ["1,AIR TWR,119.900000,off,0.000000,,88.5,88.5,023,NN,023,Tone->Tone,AM,25.00,,High,,,,,"],
}


def check(name, cond):
    results.append((name, bool(cond)))


with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, accept_downloads=True)
    ctx.add_init_script(path=str(HERE / "mock_bluetooth.js"))
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # served over http://localhost so the page is a secure context, like https
    import http.server, threading, functools
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(DIST))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    page.goto(f"http://127.0.0.1:{srv.server_address[1]}/index.html")

    check("Read disabled before connect", page.is_disabled("#btnRead"))
    page.screenshot(path=str(HERE / "shot_1_start.png"), full_page=True)
    page.click("#btnConnect")
    page.wait_for_function("document.getElementById('s1').textContent.startsWith('Connected')", timeout=10000)
    check("connected + unlock sent", page.evaluate("window.__SIM.unlock") == "3f3f3f3f022e171d5e57252f57136256044b2342")

    page.click("#btnRead")
    page.wait_for_function("document.getElementById('s2').className.includes('ok')", timeout=60000)
    check("read shows model", 'Model "RT-950"' in page.inner_text("#s2"))
    check("backup stored on phone", page.evaluate("!!localStorage.getItem('bj_last_backup')"))
    with page.expect_download() as dl:
        page.click("#btnSaveBk")
    d = dl.value
    check("backup download", d.suggested_filename.startswith("bj9000_backup_"))

    page.click("#btnPlan")
    check("plan refused with no channels loaded", "no channels loaded" in page.inner_text("#s4"))
    import tempfile
    tmp = Path(tempfile.mkdtemp())
    files = []
    for name, rows in SAMPLE.items():
        (tmp / name).write_text(HDR + "\r\n" + "\r\n".join(rows) + "\r\n")
        files.append(str(tmp / name))
    page.set_input_files("#csvIn", files)
    page.wait_for_function("document.getElementById('zsrc').textContent.startsWith('Loaded')")
    check("CSV upload: 2 zones, 3 channels", page.inner_text("#zsrc") == "Loaded: 2 zones, 3 channels.")
    page.click("#btnPlan")
    plan_txt = page.inner_text("#s4")
    check("plan lists zones", "Zone 1 LOCAL: 2 ch" in plan_txt and "Zone 2 AIR: 1 ch" in plan_txt and "blocks" in plan_txt)
    check("write enabled after plan", not page.is_disabled("#btnWrite"))
    page.click("#btnWrite")
    check("dialog requires both ticks", page.is_disabled("#dlgYes"))
    page.check("#dlgFw"); page.check("#dlgBk")
    page.screenshot(path=str(HERE / "shot_2_confirm.png"))
    page.click("#dlgYes")
    page.wait_for_function("document.getElementById('s4').className.match(/ok|bad|warn/)", timeout=120000)
    check("write verified", "written and verified" in page.inner_text("#s4"))
    sim = page.evaluate("""() => { const S = window.__SIM; return {
        writes: S.writes, maxChunk: S.maxChunk,
        settings: Array.from(S.mem.subarray(0x8000, 0xC000)).every((v,i)=>v===S.original[0x8000+i]),
        high: Array.from(S.mem.subarray(0x7800, 0x8000)).every((v,i)=>v===S.original[0x7800+i]),
        z1: String.fromCharCode(...S.mem.subarray(0xC000, 0xC005)) } }""")
    check("<=20-byte BLE writes", sim["maxChunk"] <= 20)
    check("only channel/zone blocks", all(a < 0x7800 or 0xC000 <= a < 0xC100 for a in sim["writes"]))
    check("settings untouched", sim["settings"])
    check("ch 961-990 untouched", sim["high"])
    check("zone 1 name", sim["z1"] == "LOCAL")
    page.screenshot(path=str(HERE / "shot_3_done.png"), full_page=True)

    # restore from the stored backup
    page.click("#btnRead")
    page.wait_for_function("document.getElementById('s2').textContent.includes('channels in use')", timeout=60000)
    page.click("#btnLastBk")
    page.check("#dlgFw"); page.check("#dlgBk"); page.click("#dlgYes")
    page.wait_for_function("document.getElementById('s5').className.match(/ok|bad|warn/)", timeout=120000)
    check("restore verified", "verified" in page.inner_text("#s5"))
    check("radio back to original", page.evaluate(
        "() => window.__SIM.mem.every((v,i)=>v===window.__SIM.original[i])"))
    # loaded channels survive a reload on the same phone, and can be cleared
    page.reload()
    page.wait_for_function("document.getElementById('zsrc').textContent.length > 0")
    check("channels remembered after reload", page.inner_text("#zsrc") == "Loaded: 2 zones, 3 channels.")
    page.click("#btnClearZones")
    check("clear removes them", page.inner_text("#zsrc") == "No channels loaded." and page.evaluate("!localStorage.getItem('bj_zones')"))
    check("no page errors", not errors)
    if errors:
        print(errors)
    srv.shutdown()
    browser.close()

for n, ok in results:
    print(("PASS " if ok else "FAIL ") + n)
print(f"{sum(ok for _, ok in results)}/{len(results)} passed")
sys.exit(0 if all(ok for _, ok in results) else 1)
