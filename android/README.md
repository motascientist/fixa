# Fixa for Android (APK)

A minimal shell: the APK carries the whole web app inside (the `assets` folder) and opens it in an embedded WebView.
There is no other app code. **It does not hold the internet permission**, so it cannot send data anywhere; the only
permission is the microphone, used to record audio on a card. Android's automatic backup to the Google account is off.

## Build

```bash
FIXA_KEYSTORE=/path/fixa.keystore FIXA_KEYSTORE_PASSWORD=... bash android/build.sh
# or: FIXA_ENV=/path/.env bash android/build.sh   (a .env file holding both variables)
```

The APK lands in `android/out/fixa-<version>.apk`. It needs JDK 17, the Android SDK (platform 34 + build-tools
34.0.0) and Gradle 8.7; by default the script looks for them in `%LOCALAPPDATA%\Android` (override with
`FIXA_TOOLS`).

To create a key (once):

```bash
keytool -genkeypair -keystore fixa.keystore -storetype PKCS12 -alias fixa -keyalg RSA -keysize 2048 -validity 10950
```

## The signing key

**It never goes into the repository.** Android only accepts an update installed on top of the old app if the new APK
has the same signature. Without the key the only way out is uninstalling — and uninstalling deletes the cards, which
only exist on the device. Before any reinstall: Settings → Download backup.

## Shipping an update

1. Change the web app (the parent folder) and run the tests.
2. Bump `versionCode` (and `versionName`) in `app/build.gradle`.
3. `bash android/build.sh` and install the new APK on top. The cards stay.

## What the shell does that the WebView does not do on its own

`MainActivity.java`: picking files (image, audio, backup), asking for the microphone, saving the backup to a file
(`FixaAndroid.saveBackup`) and the phone's back button. The web app detects the APK through `window.FixaAndroid`.
`tests/android_bridge.py` simulates that bridge in a browser.
