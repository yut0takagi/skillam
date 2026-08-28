// electron-builder afterSign hook: submits the signed app to Apple for
// notarization.
//
// Credentials come from the environment only, never from the repo:
//   APPLE_API_KEY      path to the App Store Connect .p8 private key
//   APPLE_API_KEY_ID   the key's ID
//   APPLE_API_ISSUER   the issuer UUID
//
// With no credentials this skips loudly rather than failing the build: a
// signed-but-unnotarized app is a legitimate output (it runs fine locally),
// so the build should still succeed — but it must never look notarized when
// it isn't, hence the explicit message.
exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') {
    return
  }

  const { APPLE_API_KEY, APPLE_API_KEY_ID, APPLE_API_ISSUER } = process.env
  if (!APPLE_API_KEY || !APPLE_API_KEY_ID || !APPLE_API_ISSUER) {
    console.log(
      '  • skipped notarization  reason=APPLE_API_KEY / APPLE_API_KEY_ID / APPLE_API_ISSUER not set\n' +
        '    The app is signed but NOT notarized. Other Macs will warn on first open.\n' +
        '    See docs/DISTRIBUTION.md to set up credentials.'
    )
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`
  console.log(`  • notarizing  file=${appPath}`)

  const { notarize } = await import('@electron/notarize')
  await notarize({
    appPath,
    appleApiKey: APPLE_API_KEY,
    appleApiKeyId: APPLE_API_KEY_ID,
    appleApiIssuer: APPLE_API_ISSUER
  })

  console.log('  • notarized successfully')
}
