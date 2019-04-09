//jshint esversion: 9
const argv = require('minimist')(process.argv.slice(2))
const puppeteer = require('puppeteer')

const userDataDir = process.env.HOME + '/.config/chromium'
const opacity = require('../opacity')({userDataDir})

const URI = argv._[0] || 'about:blank'

const DEVTOOLS = 0

;(async () => {
  const args=[
    '--no-default-browser-check',
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

  opacity(0) // hide browser window as chromium flickers into existence

  const browser = await puppeteer.launch({
    timeout: 90000,
    args,
    headless: false,
    ignoreDefaultArgs: ['--mute-audio'],
    userDataDir,
    devtools: true,
    defaultViewport: {
      width: argv.vw || 1920,
      height: argv.vh || 1080,
      hasTouch: true
    }
  })
  const page = await browser.newPage()
  await page.goto(URI, {
    timeout: 90000
  })
  page.bringToFront()
  setTimeout( ()=> opacity(100), 1000)
})();
