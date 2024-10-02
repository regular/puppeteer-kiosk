#!/usr/bin/env node
//jshint esversion: 9

const journal = new (require('systemd-journald'))({syslog_identifier: 'puppeteer-kiosk'})
// NOTE: we assume stderr to go to the journal by means of the systemd unit
const fs = require('fs')
const argv = require('minimist')(process.argv.slice(2))
const puppeteer = require('puppeteer-core')
const Log = require('puppeteer-log')
const ScreenshotServer = require('../screenshot-server')
const parseTriggers = require('../triggers')
const TriggerTypes = require('../trigger-types')
const Actions = require('../actions')

const Logger = require('../lib/logger')
const {wait, stringify, journaldPriorityFromConsoleType} = require('../lib/util')

const runtimeeDir = process.env.XDG_RUNTIME_DIR || process.env.HOME
const wsEndpointFile = `${runtimeeDir}/puppeteer-kiosk-ws-endpoint`

const userDataDir = process.env.HOME + '/.config/chromium'
const opacity = argv['hide-until-loaded'] ? require('../opacity')({userDataDir}) : ()=>{}
const triggerConfigPath = argv.triggers
const fastExit = argv['fast-exit']

const URI = argv._[0] || 'about:blank'

const DEVTOOLS = 0

;(async () => {
  const args = [
    '--no-default-browser-check',
    '--disable-features=InfiniteSessionRestore',
    '--no-first-run',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-gesture-requirement-for-media-playback',
    '--use-fake-ui-for-media-stream',

    argv.wayland ? [
      '--enable-features=UseOzonePlatform',
      '--ozone-platform=wayland'
    ] : [],

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
  ].flat()

  if (argv.sandbox == false) {
    args.push('--no-sandbox')
  }

  opacity(0) // hide browser window as chromium flickers into existence

  let browser
  const expected_chrome_version  = puppeteer.PUPPETEER_REVISIONS.chrome
  journal.info(`Supported Chrome version is ${expected_chrome_version}`)
  const {executablePath} = argv
  if (!executablePath) {
    console.error('Must specify --executablePath')
    process.exit(1)
  }
  journal.info(`Chrome Executable Path is ${executablePath}`)
  try {
    browser = await puppeteer.launch({
      executablePath,
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

  journal.info(`Chrome Version: ${await browser.version()}`)
  journal.info(`puppeteer-kiosk PID ${process.pid}`)
  journal.info(`DevTools ws endpoint: ${browser.wsEndpoint()}`)

  fs.writeFileSync(wsEndpointFile, browser.wsEndpoint(), {
    encoding: 'utf8',
    mode: 0o600
  })

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
  let logger = Logger(journalOutput, {location: true})
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
    logger.end()
    let {exitCode} = err
    if (exitCode == undefined) exitCode = 1
    process.exit(exitCode)
  }

  browser.on('disconnected', ev =>{
    exit(new Error('Browser disconnected'))
  })

  const page = await browser.newPage()
  logger.attach(page)

  page.on('error', err => {
    if (err.message == "Page crashed!") {
      const err = new Error('Chrome process crashed, restarting.')
      exit(err)
    }
  })

  parseTriggers(triggerConfigPath, Actions(page, logger, exit), TriggerTypes(), (err, trigger) => {
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
    console.error('Navigating to', URI)
    const response = await page.goto(URI, {
      timeout: 90000
    })
    if (response && !response.ok()) {
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


// -- utils

function getPageStyles() {
  return `<style>
    body, html {
      background-color: #000010;
      color: #445;
    }  
  </style>`
}

function journalOutput({type, text, file, line, prio}) {
  prio = prio || journaldPriorityFromConsoleType(type)
  if (journal[prio] == undefined) {
    console.error(`Invalid log prio: "${prio}" for log entry ${text}\nsourc=${source}`)
    return
  }
  journal[prio](text,{
    CODE_FILE: file,
    CODE_LINE: line
  })
}
