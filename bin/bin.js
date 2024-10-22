const pull = require('pull-stream')
const muxrpc = require('muxrpc')
const argv = require('minimist')(process.argv.slice(2))

const server = require('../server')
const client = require('../browserctl')
const SocketClient = require('../pull-unix/client')
const manifest = require('../manifest')

if (argv._[0] == 'server') {
  server(argv)
} else {
  const rpc = runMuxrpc(argv)
  client (rpc, argv)
}

function runMuxrpc(argv) {
  const unixSocketPath = argv.S || '/tmp/browserctl.socket'
  const rpc  = muxrpc(manifest, null)
  const stream = SocketClient({path: unixSocketPath})
  pull(
    stream,
    //pull.through( (d)=> console.log(`from ws ${d}`) ),
    rpc.stream,
    //pull.through( (d)=> console.log(`to ws ${d}`) ),
    stream
  )
  return rpc
}

