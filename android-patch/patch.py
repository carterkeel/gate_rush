"""Run after `npx cap add android`: portrait lock, dark window, and our fullscreen MainActivity."""
import pathlib, re, shutil

root = pathlib.Path('android/app/src/main')
shutil.rmtree(root / 'java', ignore_errors=True)
dest = root / 'java/com/carterkeel/gaterush'
dest.mkdir(parents=True)
shutil.copy('android-patch/MainActivity.java', dest / 'MainActivity.java')

m = root / 'AndroidManifest.xml'
t = m.read_text()
if 'screenOrientation' not in t:
    t = t.replace('<activity', '<activity\n            android:screenOrientation="portrait"', 1)
m.write_text(t)

st = root / 'res/values/styles.xml'
t = st.read_text()
t = t.replace('</style>', '    <item name="android:windowBackground">#0a0f1c</item>\n    </style>', 1)
st.write_text(t)

# app name and launcher icon (the web favicon)
sv = root / 'res/values/strings.xml'
t = sv.read_text()
t = re.sub(r'(<string name="app_name">)[^<]*', r'\1Gate Rush', t)
t = re.sub(r'(<string name="title_activity_main">)[^<]*', r'\1Gate Rush: Multiply &amp; Conquer', t)
sv.write_text(t)
shutil.copytree('android-patch/res', root / 'res', dirs_exist_ok=True)
bg = root / 'res/values/ic_launcher_background.xml'
bg.write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#141C33</color>\n</resources>\n')


# Google Play (Play Protect / automatic protection) needs minSdk 24 or higher; Capacitor's default is 22
vg = pathlib.Path('android/variables.gradle')
t = vg.read_text()
t, n = re.subn(r'minSdkVersion\s*=\s*\d+', 'minSdkVersion = 24', t)
assert n == 1, 'minSdkVersion not found in variables.gradle'
vg.write_text(t)
