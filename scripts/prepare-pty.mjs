// node-pty 1.1.0 ships its macOS prebuilt spawn-helper without executable bits.
// Correct the package installation, not every runtime terminal allocation.
import { chmod } from 'node:fs/promises'
if (process.platform === 'darwin') {
  try {
    await chmod(new URL(`../node_modules/node-pty/prebuilds/darwin-${process.arch}/spawn-helper`, import.meta.url), 0o755)
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}
