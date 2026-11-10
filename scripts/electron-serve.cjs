// Webpack 4 needs this option in Node, but Electron rejects it in NODE_OPTIONS.
// The npm script supplies it directly to Node; keep it out of Electron's environment.
if (process.env.NODE_OPTIONS) {
  const options = process.env.NODE_OPTIONS.replace(/(?:^|\s)--openssl-legacy-provider(?=\s|$)/g, ' ').trim()
  if (options) process.env.NODE_OPTIONS = options
  else delete process.env.NODE_OPTIONS
}
const cli = require.resolve('@vue/cli-service/bin/vue-cli-service.js')
process.argv = [process.execPath, cli, 'electron:serve', ...process.argv.slice(2)]
require(cli)
