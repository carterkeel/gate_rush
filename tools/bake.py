"""Bake Kenney Mini Dungeon characters/weapons into static, vertex-coloured geometry (src/models.data.ts).
Usage: python3 tools/bake.py <path-to-extracted-pack>/Models/GLB\ format <path-to>/Models/Textures/colormap-or-variation.png
Needs: npm deps installed (esbuild, three) and Playwright with Chromium."""
import base64, json, subprocess, sys, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.check_call(['npx','esbuild',os.path.join(root,'tools/bake-page.ts'),'--bundle','--format=iife','--outfile=/tmp/bake-page.js'],cwd=root)
glb = sys.argv[1]
def b64(n): return base64.b64encode(open(os.path.join(glb,n),'rb').read()).decode()
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); pg.set_content('<html></html>')
    pg.add_script_tag(path='/tmp/bake-page.js')
    for name, clip, t in json.loads(sys.argv[2]):
        out[f'{name}:{clip}:{t}'] = pg.evaluate('([b,c,t])=>window.pose(b,c,t)', [b64(name+'.glb'), clip, t])
    b.close()
json.dump(out, open('/tmp/baked_raw.json','w'))
print({k: (len(v['meshes']), list(v['nodes'].keys())[:12]) for k,v in out.items()})
