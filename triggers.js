const pull = require('pull-stream')
const file = require('pull-file')
const split = require('pull-split')
const utf8 = require('pull-utf8-decoder')
const Log = require('puppeteer-log')

const TriggerTypes = require('./trigger-types')

module.exports = {
  attachTriggers,
  parseTriggers
}

async function attachTriggers(page, triggerConfigPath, actions) {
  let trigger
  try {
    trigger = await promisify(parseTriggers)(triggerConfigPath, actions, TriggerTypes())
  } catch (err) {
    return console.error('Unable to parse trigger config', err.message)
  }
  const pushable = Log( ({consoleMessage, values}) => {
    if (!values.length) {
      values.unshift(consoleMessage.text())
    }
    const args = `${consoleMessage.type()} ${values.map(stringify).join(' ')}`
    trigger('console', args, err =>{
      if (err) console.error('failed to run console trigger', err.message)
    })
  }, err=>{
    console.error('trigger console sink ended', err && err.message)
  })
  page.on('console', msg => {
    pushable.push(msg)
  })
}

function parseTriggers(filename, makeAction, makeTrigger, cb) {
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
