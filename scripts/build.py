#!/usr/bin/env python3
"""Build browser-specific extension packages.

Both browsers use the same code and the same declarativeNetRequest Referer
rule (rules/hltb-referer.json). Only the manifest differs: Firefox keeps the
source manifest as-is (event-page background), while the Chrome build swaps in
a service-worker background, drops the Gecko-only manifest keys, and sets
minimum_chrome_version.

Usage: python scripts/build.py
Outputs: dist/firefox/, dist/chrome/ (unpacked, for local testing) and
web-ext-artifacts/steam-value-per-hour-{firefox,chrome}-<version>.zip
"""
import json
import pathlib
import shutil
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
ARTIFACTS = ROOT / "web-ext-artifacts"
SHARED_FILES = [
    "background.js",
    "content.js",
    "styles.css",
    "options.html",
    "options.js",
    "options.css",
    "popup.html",
    "popup.js",
    "popup.css",
    "LICENSE",
    "PRIVACY.md",
]
CHROME_MIN_VERSION = "116"  # requestDomains (101+), AbortSignal.timeout (103+), promise sendMessage (99+)


def chrome_manifest(base):
    manifest = json.loads(json.dumps(base))
    del manifest["browser_specific_settings"]
    manifest["background"] = {"service_worker": "background.js"}
    manifest["minimum_chrome_version"] = CHROME_MIN_VERSION
    return manifest


def stage(target, manifest):
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    for name in SHARED_FILES:
        shutil.copy2(ROOT / name, target / name)
    shutil.copytree(ROOT / "icons", target / "icons")
    shutil.copytree(ROOT / "rules", target / "rules")


def zip_dir(source_dir, archive_path):
    if archive_path.exists():
        archive_path.unlink()
    with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source_dir.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(source_dir).as_posix())


def main():
    base_manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    version = base_manifest["version"]

    ARTIFACTS.mkdir(exist_ok=True)
    builds = [
        ("firefox", base_manifest),
        ("chrome", chrome_manifest(base_manifest)),
    ]
    for name, manifest in builds:
        target = DIST / name
        stage(target, manifest)
        archive = ARTIFACTS / f"steam-value-per-hour-{name}-{version}.zip"
        zip_dir(target, archive)
        print(f"built {target.relative_to(ROOT)} -> {archive.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
