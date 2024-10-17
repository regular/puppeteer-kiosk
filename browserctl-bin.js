const pull = require('pull-stream')
const muxrpc = require('muxrpc')
const SocketClient = require('./pull-unix/client')
const manifest = require('./manifest')
const argv = require('minimist')(process.argv.slice(2))

const rpc = runMuxrpc(argv)

require('./browserctl')(rpc, argv)

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

