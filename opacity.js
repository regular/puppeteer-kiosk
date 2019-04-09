const {execFile} = require('child_process')

const prefix = '/org/freedesktop/compiz'
const dest = 'org.freedesktop.compiz'
const bin='/usr/bin/dbus-send'

function throwOnFail(err, result) {
  if (err) throw err
  console.log(result)
}

function callMethod(method, obj, arg, cb) {
  if (typeof arg == 'function') {
    cb=arg
    arg=undefined
  }

  const args = [
    '--print-reply',
    '--type=method_call',
    `--dest=${dest}`,
    `${prefix}/${obj}`,
    `${dest}.${method}`,
    ...(arg ? [arg] : [])
  ]
  execFile(bin, args, cb)
}

callMethod('list', 'obs/screen0', (err, result) => {
  if (err) throw err
  console.log(result)
})
//callMethod('get', 'obs/screen0/opacity_values')

function setArray(key, type, values) {
  callMethod('set', key, `array:${type}:${values.join(':')}`, throwOnFail)
}

module.exports = function(opts) {
  opts = opts || {}
  const userDataDir = opts.userDataDir || 'puppeteer_dev_profile'

  setArray(
    'obs/screen0/opacity_matches', 
    'string',
    [`name=chromium-browser (${userDataDir})`]
  )

  return function setOpacity(opacity) {
    setArray('obs/screen0/opacity_values', 'int32', [opacity])
  }
}

