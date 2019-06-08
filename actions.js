module.exports = function(page, log) {
  return function makeAction(name, args) {
    if (name == 'log') return function(cb) {
      const [type, ...msg] = args.split(' ')
      log.push([type, msg.join(' ')])
      cb(null)
    }
    if (name == 'reload') return function(cb) {
      page.evaluate('document.location.reload()')
        .then( ()=> cb(null) )
        .catch( cb )
    }
  }
}
