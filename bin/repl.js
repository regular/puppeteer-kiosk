#!/usr/bin/env node
//jshint esversion: 9

const fs = require('fs')
const argv = require('minimist')(process.argv.slice(2))
const puppeteer = require('puppeteer-core')
const {prompt} = require('promptly')
const repl = require('../lib/repl')
const Logger = require('../lib/logger')
const {wait} = require('../lib/util')

const runtimeeDir = process.env.XDG_RUNTIME_DIR || process.env.HOME
const wsEndpointFile = `${runtimeeDir}/puppeteer-kiosk-ws-endpoint`

let wsEndpoint;
try {
  wsEndpoint = fs.readFileSync(wsEndpointFile, 'utf8')
} catch(e) {
  console.error(e.message)
}

wsEndpoint = argv._[0] || wsEndpoint
if (!wsEndpoint) {
  console.error('Usage: pupeteer-repl WS_ENDPOINT')
  process.exit(1)
}

const logger = Logger(({type, text})=>{
  if (type in ['warning', 'error', 'notice']) {
    console.error(text)
  } else {
    console.log(text)
  }
}, {all: true})

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

  console.error('puppeteer-reps PID', process.pid)
  console.error('DevTools ws endpoint', browser.wsEndpoint())
  console.error('Chrome Version:', await browser.version())

  /*
  process.on('SIGTERM', signalHandler)
  process.on('SIGINT', signalHandler)
    
  async function signalHandler(signal) {
    console.error('Received signal', signal)
    process.exit(0)
  }
  */

  const pages = await browser.pages()
  console.error(`${pages.length} open pages:`)
  for(let i=0; i<pages.length; ++i) {
    console.error(`- ${i}`, await pages[i].title())
  }
  let pageIndex = await prompt('Select page:', {validator: x => {
    x = Number(x)
    if (isNaN(x)) throw new Error('invalid number')
    if (x<0 || x >= pages.length) throw new Error('out of range')
    return x
  }})
  console.error(`attaching to page ${pageIndex}`)
  const page = pages[pageIndex]
  const title = await page.title()

  logger.attach(page)

  repl(page, title, async ()=>{
    try {
      await browser.disconnect()
    } catch(e) {
      console.error('Failed to close browser:', e.message)
    }
    logger.end()
  })

})()

