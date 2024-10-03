// browserctl-module.js

const bl = require('bl') // BufferList for reading stdin
const debug = require('debug')('browserctl')

module.exports = async function(browser, argv) {
  const command = argv[0]

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
    'eval': evalJS,
    'run': runJS,
  }

  // Execute the command with a consistent function signature
  if (typeof commands[command] === 'function') {
    return commands[command](argv)
  } else {
    throw new Error(`Unknown command: ${command}`)
  }

  // Command implementations

  async function newPage(argv) {
    const url = argv.includes('-u') ? argv[argv.indexOf('-u') + 1] : 'about:blank'
    const pageName = argv.includes('-n') ? argv[argv.indexOf('-n') + 1] : null

    try {
      const page = await browser.newPage(url)
      if (pageName) {
        await page.evaluate(title => {
          document.title = title
        }, pageName)
      }
      await browser.setActivePage(page)
      debug('New page created')
    } catch (err) {
      throw new Error(`Failed to create new page: ${err.message}`)
    }
  }

  async function listPages() {
    const pageList = await browser.getPages()
    const activePage = await browser.getActivePage()
    const pagesInfo = []
    for (let i = 0; i < pageList.length; i++) {
      const page = pageList[i]
      try {
        const title = await page.title()
        const url = page.url()
        const isActive = page === activePage
        pagesInfo.push({ id: i, title, url, isActive })
        debug(`Page ${i}: ${title} ${url} ${isActive ? '(active)' : ''}`)
      } catch (err) {
        debug(`Error retrieving info for page ${i}: ${err.message}`)
      }
    }
    return pagesInfo
  }

  async function killPage(argv) {
    const target = argv.includes('-t') ? argv[argv.indexOf('-t') + 1] : null
    try {
      const page = await findPage(target)
      await page.close()
      debug('Page closed successfully')
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

  async function selectPage(argv) {
    const target = argv.includes('-t') ? argv[argv.indexOf('-t') + 1] : null
    try {
      const page = await findPage(target)
      await browser.setActivePage(page)
      //await page.bringToFront()
      debug('Page brought to foreground')
    } catch (err) {
      throw new Error(`Failed to select page: ${err.message}`)
    }
  }

   async function evalJS(argv) {
    const target = argv.includes('-t') ? argv[argv.indexOf('-t') + 1] : null
    const printResult = argv.includes('-p')
    const jsCode = await getJavaScriptCode(argv)
    if (!jsCode) {
      throw new Error('No JavaScript code provided')
    }
    try {
      const page = await findPage(target)
      const result = await page.evaluate(new Function(jsCode))
      if (printResult) {
        debug(`JavaScript Evaluation Result: ${result}`)
        return result
      }
    } catch (err) {
      throw new Error(`Failed to evaluate JavaScript: ${err.message}`)
    }
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
      const result = await page.evaluate((jsCode)
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
    const pageList = await browser.getPages()
    if (!target) {
      const activePage = await browser.getActivePage()
      if (activePage) {
        return activePage
      } else {
        throw new Error('No active page')
      }
    }

    // Handle special symbols
    switch (target) {
      case '^':
        const firstPage = pageList[0]
        await browser.setActivePage(firstPage)
        return firstPage
      case '$':
        const lastPage = pageList[pageList.length - 1]
        await browser.setActivePage(lastPage)
        return lastPage
      case '+':
        return getRelativePage(1)
      case '-':
        return getRelativePage(-1)
      case '!':
        const lastActivePage = await browser.getLastActivePage()
        if (lastActivePage) {
          await browser.setActivePage(lastActivePage)
          return lastActivePage
        } else {
          throw new Error('No last active page available')
        }
    }

    // Try to parse as ID
    const id = parseInt(target, 10)
    if (!isNaN(id) && id >= 0 && id < pageList.length) {
      const page = pageList[id]
      await browser.setActivePage(page)
      return page
    }

    // Search by title or URL
    const matches = await searchPagesByTitleOrURL(target, pageList)

    if (matches.length === 1) {
      await browser.setActivePage(matches[0])
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
    const index = pageList.indexOf(activePage)
    if (index === -1) {
      throw new Error('Active page not found')
    }
    const newIndex = (index + offset + pageList.length) % pageList.length
    const newPage = pageList[newIndex]
    await browser.setActivePage(newPage)
    return newPage
  }

  async function searchPagesByTitleOrURL(target, pageList) {
    const matches = []
    for (const page of pageList) {
      try {
        const title = await page.title()
        const url = page.url()
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
    } else if (argv[1]) {
      return argv[1]
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