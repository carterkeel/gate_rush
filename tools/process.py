"""Turn /tmp/baked_raw.json (from bake.py) into merged, vertex-coloured variants. Used by build_models.py and preview."""
import json, math
from PIL import Image
RAW = json.load(open('/tmp/baked_raw.json'))
TEX = Image.open('/tmp/kn/glb/Textures/colormap.png').convert('RGB')
TW, TH = TEX.size

def srgb2lin(c): c/=255; return c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4

def sample(u, v):
    x = min(TW-1, max(0, int(u*TW))); y = min(TH-1, max(0, int(v*TH)))  # glTF uv origin top-left
    r,g,b = TEX.getpixel((x,y)); return [srgb2lin(r),srgb2lin(g),srgb2lin(b)]

def part(key, scale=1.0, rotY=math.pi, offset=(0,0,0), rot=None):
    """Meshes of one baked item. rot=(rx,ry,rz) euler applied before the offset (weapons)."""
    out = []
    c, s = math.cos(rotY), math.sin(rotY)
    for m in RAW[key]['meshes']:
        P = m['pos']; N = m['nor']; UV = m['uv']; n = len(P)//3
        pos=[]; nor=[]; col=[]
        for i in range(n):
            x,y,z = P[3*i:3*i+3]; nx,ny,nz = N[3*i:3*i+3]
            if rot:
                x,y,z = rotxyz(x,y,z,rot); nx,ny,nz = rotxyz(nx,ny,nz,rot)
            x,y,z = x+offset[0], y+offset[1], z+offset[2]
            # yaw so the model faces -z (our run direction)
            x,z = x*c+z*s, -x*s+z*c
            nx,nz = nx*c+nz*s, -nx*s+nz*c
            pos += [x*scale,y*scale,z*scale]; nor += [nx,ny,nz]
            col += sample(UV[2*i], UV[2*i+1])
        out.append({'pos':pos,'nor':nor,'col':col,'idx':m['idx']})
    return out

def rotxyz(x,y,z,r):
    rx,ry,rz = r
    y,z = y*math.cos(rx)-z*math.sin(rx), y*math.sin(rx)+z*math.cos(rx)
    x,z = x*math.cos(ry)+z*math.sin(ry), -x*math.sin(ry)+z*math.cos(ry)
    x,y = x*math.cos(rz)-y*math.sin(rz), x*math.sin(rz)+y*math.cos(rz)
    return x,y,z

def merge(parts):
    pos=[];nor=[];col=[];idx=[]
    for m in parts:
        base = len(pos)//3
        pos+=m['pos']; nor+=m['nor']; col+=m['col']; idx+=[i+base for i in m['idx']]
    return {'pos':pos,'nor':nor,'col':col,'idx':idx}
