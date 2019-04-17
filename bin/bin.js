#!/usr/bin/env node
//jshint esversion: 9
const argv = require('minimist')(process.argv.slice(2))
const puppeteer = require('puppeteer')
const Log = require('puppeteer-log')
const ScreenshotServer = require('../screenshot-server')

const userDataDir = process.env.HOME + '/.config/chromium'
const opacity = argv['hide-until-loaded'] ? require('../opacity')({userDataDir}) : ()=>{}

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
    '--overscroll-history-navigation=0',
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

  const browser = await puppeteer.launch({
    timeout: 90000,
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

  console.log('PID', process.pid)
  process.on('SIGTERM', signalHandler)
    
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
    await wait(4)
    await browser.close()
    console.log('quitting')
    log.end()
    let {exitCode} = err
    if (exitCode == undefined) exitCode = 1
    process.exit(exitCode)
  }

  const page = await browser.newPage()
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) {
      log.push(msg)
    }
  })
  page.on('pageerror', error => log.push(['pageerror', error.message]))
  page.on('error', error => log.push(['error', error.message]))
  page.on('response', response => {
    const status = response.status()
    if (status < 200 || status >= 300) {
      log.push(['http-response', status, response.url()])
    }
  })
  page.on('requestfailed', request => log.push(['request-failed', request.failure().errorText, request.url]))
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
  ScreenshotServer(page, port, err => {
    if (err) {
      return console.error('Screenshot server listen failed:', err.message)
    }
    console.log('Screenshot server listens on port', port)
  })
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
