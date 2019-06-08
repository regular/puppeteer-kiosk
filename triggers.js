const pull = require('pull-stream')
const file = require('pull-file')
const split = require('pull-split')
const utf8 = require('pull-utf8-decoder')

module.exports = function(filename, makeAction, makeTrigger, cb) {
  let trigger
  const triggers = []

  function addTrigger(trigger) {
    //console.log('ADD trigger', trigger.name, trigger.args)
    trigger.test = makeTrigger(trigger.name, trigger.args.join(' '))
    triggers.push(trigger)
  }

  pull(
    file(filename || '/etc/puppeteer-kiosk/triggers'),
    utf8(),
    split(),
    pull.asyncMap((line, cb) => {
      line = line.trim()
      //console.log('LINE', line)
      if (line.startsWith('trigger')) {
        const words = line.split(' ')
        const [_, name, ...args] = words
        if (trigger) addTrigger(trigger)
        trigger = {name, args, actions: []}
        return cb(null)
      }
      if (line.startsWith('action')) {
        if (!trigger) return cb(new Error('action without trigger'))
        const words = line.split(' ')
        trigger.actions.push(makeAction(words[1], words.slice(2).join(' ')))
        return cb(null)
      }
      if (line) cb(new Error(`Syntax Error in trigger file: ${line}`))
      cb(null)
    }),
    pull.onEnd(err => {
      //console.log('END', err)
      if (err && err !== true) return cb(err)
      if (trigger) addTrigger(trigger)
      cb(null, Trigger(triggers))
    })
  )
}

function Trigger(triggers) {
  return function(name, args, cb) {
    //console.log('TESTING TRIG', name, args)
    for (let trigger of triggers) {
      if (trigger.name !== name) continue
      if (!trigger.test(args)) continue
      //console.log(`${name} triggerd!`)
      pull(
        pull.values(trigger.actions || []),
        pull.asyncMap( (a, cb) => a(cb) ),
        pull.onEnd(cb)
      )
      return
    }
    cb(null)
  }
}
