# Publishing to Google Play

The workflow always builds a debug APK (`apk-latest` release) for testing. It also builds a signed **release bundle (AAB)** for
Google Play, but only after you add signing secrets. Keep the key yourself: never commit it and never share it.

## One-time: create your upload key (on your own computer)

    keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000

Remember the passwords you choose. **Back up `upload.jks` somewhere safe** (password manager or encrypted drive).
In Play Console, enrol in **Play App Signing** so Google holds the final app-signing key; this upload key can then be reset if lost.

## Add repository secrets (GitHub: Settings, Secrets and variables, Actions)

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | output of `base64 -w0 upload.jks` (macOS: `base64 -i upload.jks`) |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
| `ANDROID_KEY_ALIAS` | `upload` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | the key password |

Push to `main` (or run the workflow manually). The run then uploads `gate-rush.aab` as a workflow artifact. Download it and
upload it in Play Console. The version code is the workflow run number, so each build is newer than the last.

## Before you submit

- Privacy policy URL: `https://carterkeel.github.io/gate_rush/privacy.html` (add your contact email to the policy if you want one).
- Data safety form: the only data collected is what a user types into the optional bug report (message, optional name and email),
  plus device info sent with it. It goes to Web3Forms and then the developer.
- Content rating questionnaire, store listing, screenshots (`assets/screens`), icon (`assets/icon.png`) and banner.
- Restrict the Web3Forms access key to your domain in the Web3Forms dashboard.
- Search the trademark databases and both stores for the game name again right before submitting.
- The package name `com.overkeel.gaterush` cannot be changed after publishing.
