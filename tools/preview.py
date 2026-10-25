import json, subprocess, sys, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def render(variants, out, cam=None):
    """variants: list of merged dicts. Renders them side by side (front-3/4 view) to a PNG."""
    html = """<html><body style='margin:0;background:#26304a'><canvas id=c width=%d height=420></canvas>
<script src='file:///tmp/prev-page.js'></script></body></html>""" % (len(variants)*300)
    open('/tmp/prev.html','w').write(html)
    subprocess.check_call(['npx','esbuild',os.path.join(root,'tools/preview-page.ts'),'--bundle','--format=iife','--outfile=/tmp/prev-page.js'],cwd=root,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    with sync_playwright() as p:
        b = p.chromium.launch(args=['--use-gl=swiftshader','--enable-unsafe-swiftshader','--allow-file-access-from-files'])
        pg = b.new_page(viewport={'width':len(variants)*300,'height':420}); pg.goto('file:///tmp/prev.html'); pg.wait_for_timeout(300)
        pg.evaluate('(c)=>{window.camPos=c}', cam); pg.evaluate('(v)=>window.show(v)', variants); pg.wait_for_timeout(300)
        pg.screenshot(path=out); b.close()
