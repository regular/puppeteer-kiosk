const bl = require('bl') // BufferList for reading stdin
const pull = require('pull-stream')
const debug = require('debug')('browserctl')
const {promisify} = require('util')

module.exports = async function(browser, argv) {
  browser = (function (b) {
    return {
      eval: b.eval,
      setActivePage: promisify(b.setActivePage),
      getActivePage: promisify(b.getActivePage),
      newPage: promisify(b.newPage),
      closePage: promisify(b.closePage),
      close: promisify(cb=>{
        b.close(err=>cb(err==true ? null : err)
      )}),
      getPages: function() {
        return new Promise( (resolve, reject)=>{
          pull(
            b.getPages(),
            pull.collect( (err, result)=>{
              if (err) return reject(err)
              resolve(result)
            })
          )
        })
      }
    }
  })(browser)

  const command = argv._[0]

  if (!command) {
    throw new Error('No command specified')
  }

  // Command mapping
  const commands = {
    'new-page': newPage,
    'list-pages': listPages,
    'kill-page': killPage,
    'rename-page': renamePage,
    'select-page': selectPage,
    'active-page': activePage,
    'eval': evalJS,
    'run': runJS,
  }

  // Execute the command with a consistent function signature
  if (typeof commands[command] === 'function') {
    try {
      const ret = await commands[command](argv)
      console.log(ret)
    } catch(err) {
      console.error(err.message)
    }
    try {
      await browser.close()
    } catch(err) {
      console.error('error closing rpc:', err.message)
    }
  } else {
    throw new Error(`Unknown command: ${command}`)
  }

  // Command implementations

  async function newPage(argv) {
    const url = argv.u || 'about:blank'
    const {select} = argv
    const pageName = argv.n

    try {
      const page = await browser.newPage({
        url,
        background: !select
      })
      if (pageName) {
        await page.evaluate(title => {
          document.title = title
        }, pageName)
      }
      debug('New page created')
    } catch (err) {
      throw new Error(`Failed to create new page: ${err.message}`)
    }
  }

  async function listPages() {
    const pageList = await browser.getPages()
    pageList.sort( (a,b)=>a.humanId - b.humanId )
    const activePage = await browser.getActivePage()
    for (let i = 0; i < pageList.length; i++) {
      const page = pageList[i]
      try {
        const {title, url, humanId} = page
        const isActive = page.targetId === activePage.targetId
        console.log(`Page ${humanId}: ${title} ${url} ${isActive ? '(active)' : ''}`)
      } catch (err) {
        debug(`Error retrieving info for page ${i}: ${err.message}`)
      }
    }
  }

  async function killPage(argv) {
    const target = argv.t
    try {
      const page = await findPage(target)
      await browser.closePage(page)
      debug('Page %d closed', page.humanId)
    } catch (err) {
      throw new Error(`Failed to close page: ${err.message}`)
    }
  }

  async function renamePage(argv) {
    const target = argv.includes('-t') ? argv[argv.indexOf('-t') + 1] : null
    const newName = argv[1] || null
    if (!newName) {
      throw new Error('No new name specified')
    }
    try {
      const page = await findPage(target)
      await page.evaluate(title => {
        document.title = title
      }, newName)
      debug('Page renamed successfully')
    } catch (err) {
      throw new Error(`Failed to rename page: ${err.message}`)
    }
  }

  async function activePage(argv) {
    const target = argv.t
    try {
      const result = await browser.getActivePage()
      debug('Active page: %O', result)
      console.log(result.humanId)
    } catch (err) {
      throw new Error(`Failed to determine whether page is visible: ${err.message}`)
    }
  }

  async function selectPage(argv) {
    const target = argv.t
    try {
      const page = await findPage(target)
      await browser.setActivePage(page)
      debug('Page brought to foreground')
    } catch (err) {
      throw new Error(`Failed to select page: ${err.message}`)
    }
  }

  async function evalJS(argv) {
    const page = await findPage(argv.t)
    const jsCode = await getJavaScriptCode(argv)
    if (!jsCode) {
      throw new Error('No JavaScript code provided')
    }
    return new Promise( (resolve, reject)=>{
      pull(
        browser.eval(page, jsCode),
        pull.drain(msg=>{
          //console.log(msg)
          if (msg.type !== undefined) {
            if (msg.type == 'log') {
              console.log(msg.text)
            } else {
              console.error(msg.text)
            }
          }
          if (msg.source == 'page.evaluate') {
            if (msg.prio == 'exception') {
              reject(new Error(msg.text))
            } else if (msg.prio == 'result') {
              resolve(msg.text)
            }
          }
        }, err=>{
          if (err && err !== true) return reject(new Error(`Failed to evaluate JavaScript: ${err.message}\n${err.stack}`))
          //resolve(null)
        })
      )
    })
  }

  async function runJS(argv) {
    const url = argv.u || 'about:blank'
    const printResult = argv.p
    const jsCode = await getJavaScriptCode(argv)
    if (!jsCode) {
      throw new Error('No JavaScript code provided')
    }
    let page
    try {
      page = await browser.newPage(url)
      const result = await page.evaluate(jsCode)
      if (printResult) {
        debug(`JavaScript Run Result: ${result}`)
        console.log(result)
        return result
      }
    } catch (err) {
      throw new Error(`Failed to run JavaScript: ${err.message}`)
    } finally {
      if (page) {
        await page.close()
      }
    }
  }

  // Utility functions

  async function findPage(target) {
    if (target !== undefined) {
      // Try to parse as ID
      const id = parseInt(target, 10)
      if (!isNaN(id) && id >= 0) {
        return {humanId: id}
      }
    } else {
      const activePage = await browser.getActivePage()
      if (activePage) {
        return activePage
      } else {
        throw new Error('No active page')
      }
    }

    // Handle special symbols
    const pageList = await browser.getPages()
    switch (target) {
      case '^':
        return pageList[0]
      case '$':
        return pageList[pageList.length - 1]
      case '+':
        return getRelativePage(1)
      case '-':
        return getRelativePage(-1)
      case '!':
        const lastActivePage = await browser.getLastActivePage()
        if (lastActivePage !== undefined) {
          return lastActivePage
        } else {
          throw new Error('No last active page available')
        }
    }

    // Search by title or URL
    const matches = await searchPagesByTitleOrURL(target, pageList)

    if (matches.length === 1) {
      return matches[0]
    } else if (matches.length === 0) {
      throw new Error(`No page found matching "${target}"`)
    } else {
      throw new Error(`Multiple pages match "${target}", please be more specific`)
    }
  }

  async function getRelativePage(offset) {
    const pageList = await browser.getPages()
    const activePage = await browser.getActivePage()
    const entry = pageList.find(p=>p.targetId == activePage.targetId)
    const index = pageList.indexOf(entry)
    if (index === -1) {
      throw new Error('Active page not found')
    }
    const newIndex = (index + offset + pageList.length) % pageList.length
    const newPage = pageList[newIndex]
    return newPage
  }

  async function searchPagesByTitleOrURL(target, pageList) {
    const matches = []
    for (const page of pageList) {
      try {
        const {title, url} = page
        if (
          title.toLowerCase().includes(target.toLowerCase()) ||
          url.toLowerCase().includes(target.toLowerCase())
        ) {
          matches.push(page)
        }
      } catch (err) {
        debug(`Error searching page: ${err.message}`)
      }
    }
    return matches
  }

  async function getJavaScriptCode(argv) {
    if (argv.f) {
      return readStdin()
    } else if (argv._[1]) {
      return argv._[1]
    } else {
      return null
    }
  }

  function readStdin() {
    return new Promise((resolve, reject) => {
      process.stdin.pipe(
        bl((err, data) => {
          if (err) return reject(err)
          resolve(data.toString('utf8'))
        })
      )
    })
  }
}
