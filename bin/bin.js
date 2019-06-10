#!/usr/bin/env node
//jshint esversion: 9
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
      ignoreDefaultArgs: ['--mute-audio'],
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
      let loc = '', type
      if (consoleMessage) {
        type = 'console.' + consoleMessage.type()
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
        type = values.shift()
      }
      console.log(`${loc}[${type}] ${values.map(v=>JSON.stringify(v)).join(' ')}`)
    }
  })(), err=>{
    console.error('log stream ended', err && err.message)
  })

  console.log('puppeteer-kiosk PID', process.pid)
  console.log('DevTools ws endpoint', browser.wsEndpoint())
  fs.writeFileSync(wsEndpointFile, browser.wsEndpoint(), {
    encoding: 'utf8',
    mode: 0o600
  })

  console.log('Chrome Version:', await browser.version())
  process.on('SIGTERM', signalHandler)
  process.on('SIGINT', signalHandler)
    
  function signalHandler(signal) {
    console.log('Received signal', signal)
    const err = new Error(`Received ${signal}`)
    err.exitCode = 0
    exit(err)
  }

  async function exit(err) {
    console.error(err.message)
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
  page.on('pageerror', error => log.push(['pageerror', error.message]))
  page.on('error', error => {
    log.push(['error', error.message])
    if (err.message == "Page crashed!") {
      const err = new Error('Chrome process crashed, restarting.')
      log.push(['puppeteer', err.message])
      exit(err)
    }
  })
  page.on('response', response => {
    const status = response.status()
    if (status < 200 || status >= 300) {
      log.push(['http-response', status, response.url()])
    }
  })
  page.on('requestfailed', request => {
    const errorText = request.failure().errorText
    log.push([
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
      log.push(['puppeteer', 'failed to load image'])
    }

  })

  parseTriggers(triggerConfigPath, Actions(page, log), TriggerTypes(), (err, trigger) => {
    if (err) return console.error('Unable to parse trigger config', err.message)
    const pushable = Log( ({consoleMessage, values}) => {
      if (!values.length) {
        values.unshift(consoleMessage.text())
      }
      const args = `${consoleMessage.type()} ${values.map(v=>JSON.stringify(v)).join(' ')}`
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
