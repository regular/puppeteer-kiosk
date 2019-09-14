#!/usr/bin/env node
//jshint esversion: 9
const journal = new (require('systemd-journald'))({syslog_identifier: 'puppeteer-kiosk'})
// NOTE: we assume stderr to go to the journal by means of the systemd unit
const fs = require('fs')
const argv = require('minimist')(process.argv.slice(2))
const puppeteer = require('puppeteer')
const Log = require('puppeteer-log')
const ScreenshotServer = require('../screenshot-server')
const parseTriggers = require('../triggers')
const TriggerTypes = require('../trigger-types')
const Actions = require('../actions')

const runtumeDir = process.env.XDG_RUNTIME_DIR || process.env.HOME
const wsEndpointFile = `${runtumeDir}/puppeteer-kiosk-ws-endpoint`

const userDataDir = process.env.HOME + '/.config/chromium'
const opacity = argv['hide-until-loaded'] ? require('../opacity')({userDataDir}) : ()=>{}
const triggerConfigPath = argv.triggers
const fastExit = argv['fast-exit']

const URI = argv._[0] || 'about:blank'

const DEVTOOLS = 0

;(async () => {
  const args=[
    '--no-default-browser-check',
    '--disable-features=InfiniteSessionRestore',
    '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gesture-requirement-for-media-playback',
    '--use-fake-ui-for-media-stream',

    DEVTOOLS ? 
      '--auto-open-devtools-for-tabs'
      : '--kiosk',

    '--disable-pinch',

    '--overscroll-history-navigation=0', // has no effect
    '--enable-gesture-navigation=0', // has no effect
    // this si solved with `overscroll-behavior` CSS property

    '--noerrdialogs',
    '--start-fullscreen',
    '--disable-infobars',
    '--disable-notifications',
    '--disable-session-crashed-bubble',
    '--password-store=basic'
  ]

  if (argv.sandbox == false) {
    args.push('--no-sandbox')
  }

  opacity(0) // hide browser window as chromium flickers into existence

  let browser
  try {
    browser = await puppeteer.launch({
      timeout: 120000,
      args,
      headless: false,
      ignoreDefaultArgs: ['--mute-audio', '--enable-automation'],
      userDataDir,
      devtools: true,
      handleSIGTERM: false,
      handleSIGHUP: false,
      handleSIGINT: false,
      defaultViewport: {
        width: argv.vw || 1920,
        height: argv.vh || 1080,
        hasTouch: true
      }
    })
  } catch(err) {
    console.error('Failed to launch browser', err.message)
    process.exit(1)
  }

  const log = Log( (()=>{
    let currUrl
    return ({consoleMessage, values}) => {
      let loc = '', source, prio
      if (consoleMessage) {
        const type = consoleMessage.type()
        prio = journaldPriorityFromConsoleType(type )
        source = 'console.' + type
        const {lineNumber, url} = consoleMessage.location()
        if (url !== currUrl) {
          console.log('In', url)
          currUrl = url
        }
        if (lineNumber !== undefined) {
          loc = `:${lineNumber} `
        }
        if (!values.length) {
          values.unshift(consoleMessage.text())
        }
      } else {
        prio = values.shift()
        source = values.shift()
      }
      const text=values.map(stringify).join(' ')
      journal[prio](text,{
        CODE_FILE: consoleMessage ? consoleMessage.location().url : undefined,
        CODE_LINE: consoleMessage ? consoleMessage.location().lineNumber : undefined
      })
      console.log(`${loc} ${prio} [${source}] ${text}`)
    }
  })(), err=>{
    console.error('log stream ended', err && err.message)
  })

  journal.info(`puppeteer-kiosk PID ${process.pid}`)
  journal.info(`DevTools ws endpoint: ${browser.wsEndpoint()}`)
  fs.writeFileSync(wsEndpointFile, browser.wsEndpoint(), {
    encoding: 'utf8',
    mode: 0o600
  })

  journal.info(`Chrome Version: ${await browser.version()}`)
  process.on('SIGTERM', signalHandler)
  process.on('SIGINT', signalHandler)
    
  function signalHandler(signal) {
    console.log('Received signal', signal)
    journal.notice(`Received signal ${signal}`)
    const err = new Error(`Received ${signal}`)
    err.exitCode = 0
    exit(err)
  }

  let exiting = false
  async function exit(err) {
    console.error(err.message)
    if (exiting) return
    exiting = true
    try {
      const page = await browser.newPage()
      await page.setContent(`<body>${getPageStyles()}<h1>${err.message}</h1></body>`)
      await page.bringToFront()
      opacity(90)
    } catch(e) {}
    if (!fastExit) await wait(4)
    try {
      await browser.close()
    } catch(e) {
      console.error('Failed to close browser:', e.message)
    }
    console.log('quitting')
    log.end()
    let {exitCode} = err
    if (exitCode == undefined) exitCode = 1
    process.exit(exitCode)
  }

  browser.on('disconnected', ev =>{
    exit(new Error('Browser disconnected'))
  })

  const page = await browser.newPage()
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) {
      log.push(msg)
    }
  })
  page.on('pageerror', error => log.push(['err', 'pageerror', error.message]))
  page.on('error', error => {
    log.push(['err', 'onerror', error.message])
    if (err.message == "Page crashed!") {
      const err = new Error('Chrome process crashed, restarting.')
      log.push(['err', 'puppeteer', err.message])
      exit(err)
    }
  })
  page.on('response', response => {
    const status = response.status()
    if (status < 200 || status >= 300) {
      log.push(['notice', 'http-response', status, response.url()])
    }
  })
  page.on('requestfailed', request => {
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

  })

  parseTriggers(triggerConfigPath, Actions(page, log, exit), TriggerTypes(), (err, trigger) => {
    if (err) return console.error('Unable to parse trigger config', err.message)
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
  })
  
  try {
    const response = await page.goto(URI, {
      timeout: 90000
    })
    if (!response.ok()) {
      throw new Error(`Server response: ${response.status()} ${response.statusText()}`)
    }
    page.bringToFront()
  } catch(err) {
    exit(err)
  }
  setTimeout( ()=> opacity(100), 1000)

  const port = argv['screenshot-port']
  if (port) {
    ScreenshotServer(page, port, err => {
      if (err) {
        return console.error('Screenshot server listen failed:', err.message)
      }
      console.log('Screenshot server listens on port', port)
    })
  }
})()
//
// -- utils

function wait(s) {
  return new Promise( resolve => {
    setTimeout(resolve, s * 1000)
  })
}

function getPageStyles() {
  return `<style>
    body, html {
      background-color: #000010;
      color: #445;
    }  
  </style>`
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

function stringify(v) {
  if (typeof v == 'string') return v
  if (typeof v == 'number' || typeof v == 'boolean') return `${v}`
  return JSON.stringify(v)
}
