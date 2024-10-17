const os = require('os')
const net = require('net')
const fs = require('fs')

const pull = require('pull-stream')
const defer = require('pull-defer')
const toDuplex = require('stream-to-pull-stream').duplex
const debug = require('debug')('pull-unix:client')

module.exports = function(opts) {
  opts = opts || {}

  let once = false;
  const deferred = defer.duplex()

  const stream = net.connect(opts.path)
  stream.on('connect', ()=> {
    const ps = toDuplex(stream)
    once = true
    deferred.resolve(ps)
  })

  stream.on('error', err => {
    debug("socket: %s, error: %s", opts.path, err.message)
    if (once) return
    once = true
    deferred.resolve({
      source: pull.error(err),
      sink: read =>read(err, ()=>{})
    })
  })

  deferred.close = function() {
    stream.destroy()
  }

  return deferred
}
