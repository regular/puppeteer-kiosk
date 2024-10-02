// copied and adapted from node-repl
// jshint -W061
// jshint esversion: 9
const repl = require('repl')
const os = require('os')
const EMPTY = '(' + os.EOL + ')'

module.exports = function (page, title, cb) {
  const evalQueue = []
  const repl_gen = (function * () {
    while (true) {
      if (evalQueue.length) {
        const {command, callback} = evalQueue.shift()
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
    //const tile = await page.title()

    repl.start({
      prompt: `${title}> `,
      input: process.stdin,
      output: process.stderr,
      eval: function (cmd, context, filename, callback) {
        if (cmd === EMPTY) return callback()
        //console.log(context)
        evalQueue.push({command: cmd, callback})
        repl_gen.next()
      }
    }).on('exit', ()=>{
      cb(null)
    })
  })()
}
