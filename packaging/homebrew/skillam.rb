cask "skillam" do
  # Until the universal build lands the release ships one .dmg per
  # architecture. electron-builder drops the `-${arch}` part of the default
  # artifact name for the default architecture only, so the arm64 file carries
  # a suffix and the x64 file carries none — hence no `intel:` value here, which
  # leaves `#{arch}` interpolating to nothing on Intel.
  arch arm: "-arm64"

  version "0.2.0"
  sha256 arm:   "7f69749503f1aa71e82ba0d500d98b4d8f08fd9890baf3703f7573a7587fa656",
         intel: "d1dcc2236cb44860d95e8307acbb9dc8a4db7aec1d4d111ea8c49ad2cc01e2d1"

  url "https://github.com/yut0takagi/skillam/releases/download/v#{version}/skillam-#{version}#{arch}.dmg"
  name "skillam"
  desc "Manage Claude Code skills, MCP servers, agents, permissions as IAM-like roles"
  homepage "https://github.com/yut0takagi/skillam"

  livecheck do
    url :url
    strategy :github_latest
  end

  # Electron 44 — which this app pins — supports macOS Ventura and up. A bare
  # symbol here already means "or newer"; Cask's depends_on parses it with a
  # `>=` comparator by default.
  depends_on macos: :ventura

  app "skillam.app"

  # `brew uninstall` leaves all of this alone; only an explicit
  # `brew uninstall --zap` removes it.
  #
  # ~/.skillam/skillam.db holds the apply history — the record of what skillam
  # wrote into each project and into ~/.claude. Deleting it does not undo those
  # writes; it only makes them unattributable, so the next apply can no longer
  # tell "skillam put this here" from "the user put this here" and will leave
  # the old entries behind for someone to clean up by hand. The caveats say so
  # before anyone reaches for --zap.
  zap trash: [
    "~/.skillam",
    "~/Library/Caches/dev.yut0takagi.skillam",
    "~/Library/HTTPStorages/dev.yut0takagi.skillam",
    "~/Library/Preferences/dev.yut0takagi.skillam.plist",
    "~/Library/Saved Application State/dev.yut0takagi.skillam.savedState",
  ]

  caveats <<~EOS
    skillam keeps its data in ~/.skillam/skillam.db, which includes the record
    of every setting it has applied to your projects and to ~/.claude.

      brew uninstall --cask skillam         keeps that data
      brew uninstall --zap --cask skillam   deletes it

    Removing the database does not revert anything skillam already wrote. It
    only discards the record of it, so those settings stay on disk with nothing
    left to identify them as skillam's. Run `skillam check` and export the
    roles you care about before zapping.

    The encryption key for stored MCP secrets lives in the login Keychain and
    is not removed by either command. To delete it:

      security delete-generic-password -s skillam -a master-key
  EOS
end
