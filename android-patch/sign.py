"""Release signing + version code for the Play bundle. Run after patch.py when signing secrets exist."""
import pathlib, re, os
gradle = pathlib.Path('android/app/build.gradle')
g = gradle.read_text()
run = os.environ.get('GITHUB_RUN_NUMBER')
if run:
    g = re.sub(r'versionCode \d+', f'versionCode {run}', g, count=1)
if os.environ.get('KEYSTORE_FILE') and 'signingConfigs' not in g:
    sign = """signingConfigs {
        release {
            storeFile file(System.getenv('KEYSTORE_FILE'))
            storePassword System.getenv('KEYSTORE_PASSWORD')
            keyAlias System.getenv('KEY_ALIAS')
            keyPassword System.getenv('KEY_PASSWORD')
        }
    }
    buildTypes {"""
    g = g.replace('buildTypes {', sign, 1)
    g = re.sub(r'(buildTypes \{[\s\S]*?release \{)', r'\1\n            signingConfig signingConfigs.release', g, count=1)
gradle.write_text(g)
