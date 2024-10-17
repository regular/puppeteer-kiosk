const Log = require('puppeteer-log')
const {stringify} = require('../lib/util')

module.exports = function(output, opts) {
  opts = opts || {}
  const log = Log( (()=>{
    let currUrl
    return ({consoleMessage, values}) => {
      let loc = '', source, prio, type
      if (consoleMessage) {
        type = consoleMessage.type()
        source = 'console.' + type
        const {lineNumber, url} = consoleMessage.location()
        if (url !== currUrl) {
          if (opts.location) console.error('In', url)
          currUrl = url
        }
        if (lineNumber !== undefined) {
          loc = `:${lineNumber} `
        }
        if (!values.length) {
          values.unshift(consoleMessage.text())
        }
      } else {
        //This comes from the log action
        prio = values.shift()
        source = values.shift()
      }
      const text = values.map(stringify).join(' ')
      output({
        type, text, source, prio,
        file: consoleMessage ? consoleMessage.location().url : undefined,
        line: consoleMessage ? consoleMessage.location().lineNumber : undefined
      })
      //console.log(`${loc} ${prio} [${source}] ${text}`)
    }
  })(), err=>{
    console.error('log stream ended', err && err.message)
  })
  
  return {
    push: log.push.bind(log),
    end,
    attach,
    detach
  }

  function end() {
    log.end()
  }

  function attach(page) {
    manageHandlers(page, true)
  }

  function detach(page) {
    manageHandlers(page, false)
  }

  function manageHandlers(page, attach) {
    const f = page[attach ? 'on' : 'off'].bind(page)

    f('console', onConsole)
    f('pageerror', onPageError)
    f('error', onError)
    f('response', onResponse)
    f('requestfailed', onRequestFailed)
  }

  function onConsole(msg) {
    if (opts.all || ['error', 'warning'].includes(msg.type())) {
      log.push(msg)
    }
  }

  function onPageError(error) {
    log.push(['err', 'pageerror', error.message])
  }

  function onError(error) {
    log.push(['err', 'onerror', error.message])
    if (err.message == "Page crashed!") {
      log.push(['err', 'puppeteer', err.message])
    }
  }

  function onResponse(response) {
    const status = response.status()
    if (status < 200 || status >= 300) {
      log.push(['notice', 'http-response', status, response.url()])
    }
  }

  function onRequestFailed(request) {
    const errorText = request.failure().errorText
    log.push([
      'info',
      'request-failed',
      errorText,
      request.resourceType(),
      request.url(),
      request.headers()
    ])
    if (
      errorText == "net::ERR_ABORTED" &&
      request.resourceType() == "image"
    ) {
      log.push(['info', 'puppeteer', 'failed to load image'])
    }
  }
}

