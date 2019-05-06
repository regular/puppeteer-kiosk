#!/usr/bin/env node
//jshint esversion: 9
const fs = require('fs')
const argv = require('minimist')(process.argv.slice(2))
const puppeteer = require('puppeteer')
const {prompt} = require('promptly')
const repl = require('../lib/repl')

const runtumeDir = process.env.XDG_RUNTIME_DIR || process.env.HOME
const wsEndpointFile = `${runtumeDir}/puppeteer-kiosk-ws-endpoint`

const wsEndpoint = argv._[0] || fs.readFileSync(wsEndpointFile, 'utf8')
if (!wsEndpoint) {
  console.error('Usage: pupeteer-repl WS_ENDPOINT')
}

;(async () => {

  let browser
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint: wsEndpoint,
      defaultViewport: null
    })
  } catch(err) {
    console.error('Failed to connect to browser', err.message)
    process.exit(1)
  }

  console.log('puppeteer-reps PID', process.pid)
  console.log('DevTools ws endpoint', browser.wsEndpoint())
  console.log('Chrome Version:', await browser.version())
  process.on('SIGTERM', signalHandler)
  process.on('SIGINT', signalHandler)
    
  async function signalHandler(signal) {
    console.log('Received signal', signal)
    try {
      await browser.disconnect()
    } catch(e) {
      console.error('Failed to close browser:', e.message)
    }
    process.exit(0)
  }

  const pages = await browser.pages()
  console.log(`${pages.length} open pages:`)
  for(let i=0; i<pages.length; ++i) {
    console.log(`- ${i}`, await pages[i].title())
  }
  let pageIndex = await prompt('Select page:', {validator: x => {
    x = Number(x)
    if (isNaN(x)) throw new Error('invalid number')
    if (x<0 || x >= pages.length) throw new Error('out of range')
    return x
  }})
  console.log(`attaching to page ${pageIndex}`)
  const page = pages[pageIndex]

  logPageOutput(page, console.error.bind(console))
  repl(page)

})()
//
// -- utils

function logPageOutput(page, log) {
  page.on('console', msg => {
    log(msg._type, msg._text)
  })
  page.on('pageerror', error => log(['pageerror', error.message]))
  page.on('error', error => {
    log(['error', error.message])
    if (err.message == "Page crashed!") {
      const err = new Error('Chrome process crashed, restarting.')
      log(['puppeteer', err.message])
    }
  })
  page.on('response', response => {
    const status = response.status()
    if (status < 200 || status >= 300) {
      log(['http-response', status, response.url()])
    }
  })
  page.on('requestfailed', request => {
    const errorText = request.failure().errorText
    log([
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
      log(['puppeteer', 'failed to load image'])
    }
  })
}

function wait(s) {
  return new Promise( resolve => {
    setTimeout(resolve, s * 1000)
  })
}

