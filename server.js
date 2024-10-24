#!/usr/bin/env node
//jshint esversion: 9

// NOTE: we assume stderr to go to the journal by means of the systemd unit

const journal = new (require('systemd-journald'))({syslog_identifier: 'browserctl'})
const sdnotify = require('sd-notify')
const puppeteer = require('puppeteer-core')
const debug = require('debug')('browserctl:bin')

//const Actions = require('./actions')
const Logger = require('./lib/logger')
const {wait, journaldPriorityFromConsoleType} = require('./lib/util')
const UnixSocketAPI = require('./unix-socket-api')

//const runtimeeDir = process.env.XDG_RUNTIME_DIR || process.env.HOME

module.exports = async function server(argv) {
  const userDataDir = process.env.HOME + '/.config/chromium'
  const fastExit = argv['fast-exit']
  const unixSocketPath = argv.ctlSocket || '/tmp/browserctl.socket'

  const expected_chrome_version  = puppeteer.PUPPETEER_REVISIONS.chrome
  console.error(`Supported Chrome version is ${expected_chrome_version}`)
  const {executablePath} = argv
  if (!executablePath) {
    console.error('Must specify --executablePath')
    process.exit(1)
  }
  journal.info(`Chrome Executable Path is ${executablePath}`)

  let browser
  try {
    browser = await puppeteer.launch({
      executablePath,
      timeout: 120000,
      args: getBrowserArgs(argv),
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

  console.error(`Chrome Version: ${await browser.version()}`)
  console.error(`puppeteer-kiosk PID ${process.pid}`)
  console.error(`DevTools ws endpoint: ${browser.wsEndpoint()}`)

  const logger = Logger(journalOutput, {location: true})
  const exit = Exit(browser, logger)
  handleSignals(journal, exit)
  
  browser.on('disconnected', ev =>{
    exit(new Error('Browser disconnected'))
  })

  const socketServer = await UnixSocketAPI(browser, unixSocketPath, err=>{
    if (err) return exit(err) 
    console.error('Unix control socket:', unixSocketPath)
    sdnotify.ready()
  })

  // there always is one tab open
  const page = (await browser.pages())[0]
  logger.attach(page)

  page.on('error', err => {
    if (err.message == "Page crashed!") {
      const err = new Error('Chrome process crashed, restarting.')
      exit(err)
    }
  })

  //await attachTriggers(page, triggerConfigPath, Actions(page, logger, exit))
    
  if (argv.u) {
    try {
      gotoURI(page, argv.u)
    } catch(err) {
      exit(err)
    }
  }
}


// -- utils

function getExitPageStyles() {
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

function Exit(browser, logger, opacity) {
  let exiting = false
  return async function exit(err) {
    console.error(err.message)
    if (exiting) return
    exiting = true
    try {
      const page = await browser.newPage()
      await page.setContent(`<body>${getExitPageStyles()}<h1>${err.message}</h1></body>`)
      await page.bringToFront()
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
}

function getBrowserArgs(argv) {
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

    argv['dev-tools'] ? 
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

  return args
}

function handleSignals(journal, exit) {
  function signalHandler(signal) {
    console.log('Received signal', signal)
    journal.notice(`Received signal ${signal}`)
    const err = new Error(`Received ${signal}`)
    err.exitCode = 0
    exit(err)
  }
  process.on('SIGTERM', signalHandler)
  process.on('SIGINT', signalHandler)
}

async function gotoURI(page, URI) {
  console.error('Navigating to', URI)
  const response = await page.goto(URI, {
    timeout: 90000
  })
  if (response && !response.ok()) {
    throw new Error(`Server response: ${response.status()} ${response.statusText()}`)
  }
}

