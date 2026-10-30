#!/usr/bin/env bash
set -euo pipefail
adb shell cmd connectivity airplane-mode enable
adb shell svc wifi disable
adb shell svc data disable
test_status=0
(cd android && ./gradlew --no-daemon connectedDebugAndroidTest) || test_status=$?
mkdir -p build/qa
adb pull /sdcard/Android/data/com.qiuqiule.game/files/. build/qa/ || true
adb logcat -d > build/qa/logcat.txt || true
exit "$test_status"
