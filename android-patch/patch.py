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
