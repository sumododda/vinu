// Electron-builder config. JS form (not yml) so we can conditionally apply
// hardened runtime + notarization: required for Developer-ID-signed production
// builds, but fatal on macOS 15+ when the app is only ad-hoc signed (local dev).

const signed = Boolean(process.env.CSC_NAME || process.env.CSC_LINK);

/** @type {import('electron-builder').Configuration} */
module.exports = {
  appId: 'dev.local.vinu',
  productName: 'vinu',
  directories: { output: 'release', buildResources: 'build' },
  files: ['out/**', 'package.json', '!node_modules/**/test/**', '!node_modules/**/*.md'],
  asarUnpack: ['**/*.{node,dll}', 'node_modules/better-sqlite3/**'],
  extraResources: [{ from: 'resources/bin', to: 'bin', filter: ['**/*'] }],
  mac: {
    category: 'public.app-category.productivity',
    target: [{ target: 'dmg', arch: ['arm64', 'x64'] }],
    // Only apply the hardened-runtime / entitlements / notarization stack when a
    // real signing identity is present. Ad-hoc signed apps with hardened runtime
    // fail Gatekeeper on macOS 15+ even though the signature is valid.
    ...(signed
      ? {
          identity: process.env.CSC_NAME,
          hardenedRuntime: true,
          gatekeeperAssess: false,
          entitlements: 'build/entitlements.mac.plist',
          entitlementsInherit: 'build/entitlements.mac.plist',
          notarize: true,
          binaries: [
            'Contents/Resources/bin/mac-arm64/ffmpeg',
            'Contents/Resources/bin/mac-arm64/whisper',
          ],
        }
      : {
          // Local dev: ad-hoc signing (electron-builder's default when identity
          // is unset) without hardened runtime. arm64 Macs require *some*
          // signature to load the binary, but Gatekeeper on macOS 15+ rejects
          // ad-hoc + hardened runtime, so we explicitly strip the runtime flag.
          hardenedRuntime: false,
          gatekeeperAssess: false,
        }),
    extendInfo: {
      NSMicrophoneUsageDescription:
        'Vinu uses your microphone to record voice notes that are transcribed locally.',
    },
  },
  win: {
    target: 'nsis',
    cscLink: process.env.WIN_CSC_LINK,
    cscKeyPassword: process.env.WIN_CSC_KEY_PASSWORD,
  },
  linux: {
    target: ['AppImage', 'deb'],
    category: 'Utility',
  },
  // CI uses `npx electron-builder --publish always`; this tells electron-builder
  // *where* to publish when that flag is set (creates/updates the GitHub Release
  // tied to the tag).  Local `npm run package:*` never publishes because the
  // CLI flag isn't set.
  publish: {
    provider: 'github',
  },
  npmRebuild: true,
};
