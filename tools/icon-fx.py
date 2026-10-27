from PIL import Image, ImageEnhance, ImageFilter, ImageDraw, ImageChops
import random, math
random.seed(7)
S=1024
base=Image.open('base.png').convert('RGB')
am=Image.open('armyonly.png').convert('RGB')
# mask: anything not magenta
r,g,b=am.split()
mask=ImageChops.invert(ImageChops.multiply(ImageChops.subtract(r,g).point(lambda v:255 if v>200 else 0), ImageChops.subtract(b,g).point(lambda v:255 if v>200 else 0))).filter(ImageFilter.GaussianBlur(0.8))
# saturated base
sat=ImageEnhance.Color(base).enhance(1.55)
sat=sat
# slightly darken the surroundings so the crowd pops
dark=ImageEnhance.Brightness(sat).enhance(0.82)
glow_mask=mask.filter(ImageFilter.GaussianBlur(26)).point(lambda v:min(255,int(v*1.7)))
glow=Image.new('RGB',(S,S),(255,226,120))
out=Image.composite(sat,dark,mask.filter(ImageFilter.GaussianBlur(120)).point(lambda v:min(255,v*3)))
out=Image.composite(glow,out,glow_mask.point(lambda v:int(v*0.55)))
# the army itself: brighter and more colourful
army=ImageEnhance.Color(sat).enhance(1.35); army=ImageEnhance.Brightness(army).enhance(1.32); army=ImageEnhance.Contrast(army).enhance(1.12)
out=Image.composite(army,out,mask)
# speed lines radiating from the vanishing point, only near the edges
lay=Image.new('RGBA',(S*2,S*2),(0,0,0,0)); d=ImageDraw.Draw(lay)
cx,cy=S*2*0.5,S*2*0.50
for i in range(260):
    a=random.uniform(0,2*math.pi)
    # avoid dense lines straight above/below the gates/crowd: thin them toward the vertical
    r0=random.uniform(0.40,0.62)*S*2; r1=r0+random.uniform(0.25,0.6)*S*2
    wd=random.uniform(2.5,8)
    x0,y0=cx+math.cos(a)*r0,cy+math.sin(a)*r0; x1,y1=cx+math.cos(a)*r1,cy+math.sin(a)*r1
    # tapered: draw polygon thin at inner end
    nx,ny=-math.sin(a),math.cos(a)
    poly=[(x0,y0),(x1+nx*wd,y1+ny*wd),(x1-nx*wd,y1-ny*wd)]
    d.polygon(poly,fill=(235,248,255,random.randint(150,240)))
lay=lay.resize((S,S),Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))
out=out.convert('RGBA'); out.alpha_composite(lay)
# soft vignette
vig=Image.new('L',(S,S),0); vd=ImageDraw.Draw(vig); vd.ellipse([-S*0.15,-S*0.15,S*1.15,S*1.15],fill=255); vig=vig.filter(ImageFilter.GaussianBlur(120))
black=Image.new('RGBA',(S,S),(0,0,0,255)); out=Image.composite(out,black,vig.point(lambda v:int(150+v*0.39)))
out.convert('RGB').save('gate_rush_icon_v2.png')
