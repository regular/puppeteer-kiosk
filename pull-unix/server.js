const os = require('os')
const net = require('net')
const fs = require('fs')
const {join} = require('path')

const once = require('once')
const toDuplex = require('stream-to-pull-stream').duplex
const debug = require('debug')('pull-unix:server')

module.exports = function (opts, onConnection, cb) {
  opts = opts || {}
  cb = once(cb)

  const {platform} = process
  opts.path = opts.path || (
    platform == 'win32'
      ? join('\\\\?\\pipe', process.cwd(), 'unix-socket')
      : fs.mkdtempSync(join(os.tmpdir(), 'unix-socket'))
  )

  const server = net.createServer(opts, stream => {
    debug('incoming conncetion')
    onConnection(toDuplex(stream))
  })

  server.listen(opts.path, err => {
    if (!err) {
      if (platform !== 'win32') {
        //const mode = fs.constants.S_IRUSR + fs.constants.S_IWUSR
        // TODO:
        const mode = 0777;
        fs.chmodSync(opts.path, mode)
      }
      debug('listening on socket %s', opts.path)
    }
    cb(err)
  })

  server.on('error', err => {
    debug("socket: %s, error: %s", opts.path, err.message)
    cb(err)
  })

  return {
    close: ()=>{
      debug('Closing server socket %s', opts.path)
      server.close(cb)
    },
    path: opts.path
  }
}

