module.exports = function(page, log, exit) {
  return function makeAction(name, args) {
    if (name == 'log') return function(cb) {
      const [prio, source, ...msg] = args.split(' ')
      log.push([prio, source, msg.join(' ')])
      cb(null)
    }
    if (name == 'reload') return function(cb) {
      page.evaluate('document.location.reload()')
        .then( ()=> cb(null) )
        .catch( cb )
    }
    if (name == 'exit') return function(cb) {
      const [code, ...msg] = args.split(' ')
      const err = new Error(msg.join(' '))
      err.exitCode = code
      exit(err)
    }
  }
}
