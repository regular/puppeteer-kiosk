// copied and adapted from node-repl
// jshint -W061
// jshint esversion: 9

module.exports = function (page) { // uppercase namespaces var to avoid clashes
  var NODE_REPL_SOURCES = []
  var NODE_REPL_LOOP = (function * () {
    while (true) {
      if (NODE_REPL_SOURCES.length) {
        var NODE_REPL_NEXT = NODE_REPL_SOURCES.shift()
        const {command, callback} = NODE_REPL_NEXT
        page.evaluate(command).then(result => {
          callback(null, result)
        }).catch(err =>{
          callback(err)
        })
      }
      yield null
    }
  })()

  ;(async function () {
    var repl = require('repl')
    var os = require('os')
    var empty = '(' + os.EOL + ')'
    console.log('REPL')

    //const tile = await page.title()
    const title = 'bla'
    console.log('REPL', title)

    repl.start({
      prompt: `${title}> `,
      input: process.stdin,
      output: process.stdout,
      eval: function (cmd, context, filename, callback) {
        if (cmd === empty) return callback()
        NODE_REPL_SOURCES.push({command: cmd, callback: callback})
        NODE_REPL_LOOP.next()
      }
    })
  })()
}
