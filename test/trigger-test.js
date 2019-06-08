const test = require('tape')
const parse = require('../triggers')

const TriggerTypes = require('../trigger-types')
const Actions = require('../actions')

test('parse simple file', t => {

  function Action(name, args) {
    t.equal(name, 'sound', 'action name')
    t.equal(args, 'beep beep', 'action args')
  }

  function Trigger(name, args) {
    t.equal(name, 'MyTrigger', 'trigger name')
    t.equal(args, 'foo bar', 'trigger args')
    return {}
  }

  t.plan(6)
  parse(__dirname + '/fixtures/triggers1', Action, Trigger, (err, trigger) => {
    t.error(err)
    t.equal(typeof trigger, 'function', 'returns function')
  })  
})

test('trigger failing action', t => {
  function Action(name, args) {
    return function(cb) {
      t.assert(true, 'run action')
      cb(new Error('an error'))
    }
  }

  function Trigger(name, args) {
    return function(testArgs) {
      t.assert(true, `test trigger ${name} ${testArgs}`)
      return true
    }
  }

  t.plan(4)
  parse(__dirname + '/fixtures/triggers1', Action, Trigger, (err, trigger) => {
    t.error(err)
    trigger('MyTrigger', 'my trigger args', err => {
      t.equal(err.message, 'an error', 'returns error')
    })
  })  
})

test('multi-trigger, multi-action', t => {
  const actions = []

  function Action(name, args) {
    return function(cb) {
      if (name == 'print') console.log(args)
      else if(name == 'newLine') console.log()
      actions.push({name, args})
      cb(null)
    }
  }

  function Trigger(name, args) {
    if (name == 'isTrue') return b => b == 'true'
    if (name == 'isFalse') return b => b == 'false'
    t.fail()
  }

  parse(__dirname + '/fixtures/triggers2', Action, Trigger, (err, trigger) => {
    t.error(err)
    trigger('isTrue', 'true', ()=>{})
    trigger('isTrue', 'false', ()=>{})
    trigger('isFalse', 'true', ()=>{})
    trigger('isFalse', 'false', ()=>{})
    console.log(actions)
    t.deepEqual(actions, [
      { name: 'print', args: 'true' },
      { name: 'newLine', args: '' },
      { name: 'print', args: 'false' },
      { name: 'newLine', args: '' }
    ], 'ran correct actions')

    t.end()
  })  
})

test('use predefined actions and trigger types', t => {
  
  const page = {
    evaluate: js => {
      console.log('RELOAD')
      t.equal(js, 'document.location.reload()', 'reloads page')
      const ret = new Promise((resolve, reject) => {
        resolve(true)
      })
      return ret
    }
  }

  const log = {
    push: function([type, message]) {
      console.log('LOG', type, message)
      t.equal(type, 'foo', 'log type')
      t.equal(message, 'bar', 'log message')
    }
  }

  t.plan(6)
  parse(__dirname + '/fixtures/triggers3', Actions(page, log), TriggerTypes(), (err, trigger) => {
    t.error(err)
    trigger('console', 'log xxx', err => {
      trigger('console', 'warn yyy', err => {
        trigger('console', 'error FATAL', err => {
        })
      })
    })
  })  
})
