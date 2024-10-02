//jshint esversion: 9

module.exports = {
  wait,
  stringify,
  journaldPriorityFromConsoleType
}

function wait(s) {
  return new Promise( resolve => {
    setTimeout(resolve, s * 1000)
  })
}

function stringify(v) {
  if (typeof v == 'string') return v
  if (typeof v == 'number' || typeof v == 'boolean') return `${v}`
  return JSON.stringify(v)
}

function journaldPriorityFromConsoleType(t) {
  switch(t) {
    case 'debug':
      return 'debug'
    case 'log':
    case 'dir':
    case 'info':
      return 'info'
    case 'warning':
      return 'warning'
    case 'error':
      return 'err'
    default:
      return 'notice'
  }
  /* unused journald priorities:
     - emerg
     - alert
     - crit
     - notice
  */
}
