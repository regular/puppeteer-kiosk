const Server = require('./pull-unix/server')
const debug = require('debug')('browserctl')
const pull = require('pull-stream')
const muxrpc = require('muxrpc')
const defer = require('pull-defer')
const pushable = require('pull-pushable')

const Logger = require('./lib/logger')

const manifest = require('./manifest')

module.exports = async function(browser, socketPath, cb) {
  const api = getApi(browser)
  // before we serve the API, we initialze the himanIds by calling getPages
  return new Promise( (resolve, reject)=>{
    pull(
      api.getPages(),
      pull.onEnd( err=>{
        if (err) return reject(err)
        resolve(runServer(browser, socketPath, api, cb))
      })
    )
  })
}

function runServer(browser, socketPath, api, cb) {
  const server = Server({
    path: socketPath
  }, stream =>{
    debug('unix control socket connected')
    const rpc_server = muxrpc(null, manifest, api)
    pull(
      rpc_server.stream,
      stream,
      rpc_server.stream
    )
  }, cb)
  return server
}

function humanIds() {
  const ids = []

  return {
    humanFromUUID: function (uuid) {
      let id = ids.indexOf(uuid)
      if (id == -1) id = ids.push(uuid) -1
      return id
    },
    UUIDFromHuman: function (id) {
      return ids[id]
    }
  }
}

function getApi(browser) {
  const {UUIDFromHuman, humanFromUUID} = humanIds()

  return {
    getCDPSocket: ()=>browser.wsEndpoint(),

    closePage: ({targetId, humanId}, cb) =>{
      if (targetId == undefined) targetId = UUIDFromHuman(humanId)
      if (!targetId) return cb(new Error('target not found'))
      debug('closePage target %s', targetId)
      browser.target().createCDPSession().then(async client=>{
        // TODO: detach client in case an error is thrown here (use finally)
        try {
          const result = await client.send('Target.closeTarget', {targetId})
        } catch(err) {
          return cb(err)
        } finally {
          await client.detach()
        }
        cb(null, result)
      }).catch(cb)
    },

    eval: (t, code) =>{
      const pa = pushable()

      function error(err) {
        debug('eval: error() called', err)
        pa.end(err)
        return pa
      }
      
      function output(msg) {
        debug('eval output: %O', msg)
        pa.push(msg)
        if (msg.source == 'page.evaluate') {
          pa.end()
        }
      }

      const target = getTarget(t)
      if (!target) return error(new Error('target not found'))
      
      target.page().then(async page=>{
        if (!page) return error(new Error('Target is not a page'))
        const logger  = Logger(output, {all: true})
        logger.attach(page)
        try {
          const result = await page.evaluate(code)
          logger.push([
            'result',
            'page.evaluate', 
            result
          ])
        } catch(err) {
          debug('eval @1: caught exception %2', err.message)
          logger.push([
            'exception',
            'page.evaluate',
            err.message
          ])
        } finally {
          logger.end()
          logger.detach(page)
        }
      })
      return pa
    },

    getActivePage: cb => {
      const pages = browser.targets().map(t=>t.page())
      Promise.all(pages.map(async pp => {
        const p = await pp
        if (!p) return false
        const state = await p.evaluate(() => document.webkitHidden)
        return !state;
      })).then(results=>{
        const visibleTargets = browser.targets().filter((_v, index) => results[index])
        debug('visible targets are %O', visibleTargets)
        const targetId = visibleTargets[0]._targetId
        const humanId = humanFromUUID(targetId)
        cb(null, {targetId, humanId})
      }).catch(cb)
    },
    
    getPages: ()=>{
      const deferred = defer.source()

      browser.target().createCDPSession().then(async client=>{
        const {targetInfos} = await client.send('Target.getTargets')
        targetInfos.reverse()
        deferred.resolve(pull(
          pull.values(targetInfos),
          pull.map(t=>{
            return Object.assign({
              humanId: humanFromUUID(t.targetId)
            }, t)
          })
        ))
        await client.detach();
      }).catch(err=>{
        deferred.resolve(pull.error(err))
      })

      return deferred
    },

    newPage: function(opts, cb) {
      opts = opts || {}
      browser.target().createCDPSession().then(async client=>{
        // TODO: detach client in case an error is thrown here (use finally)
        const { targetId } = await client.send('Target.createTarget', opts)
        cb(null, {
          targetId,
          humanId: humanFromUUID(targetId)
        })
        await client.detach()
      }).catch(err=>{
        cb(err)
        deferred.resolve(pull.error(err))
      })
    },

    setActivePage: function({humanId, targetId}, cb) {
      if (targetId == undefined) targetId = UUIDFromHuman(humanId)
      debug('activating target %s', targetId)
      browser.target().createCDPSession().then(async client=>{
        // TODO: detach client in case an error is thrown here (use finally)
        const result = await client.send('Target.activateTarget', {targetId})
        cb(null, result)
        await client.detach()
      }).catch(err=>{
        cb(err)
      })
    }
    /*
    getLastActivePage: "async"
    */
  }

  function getTarget(t) {
    let {targetId, humanId} = t
    if (targetId == undefined) targetId = UUIDFromHuman(humanId)
    if (!targetId) return null

    debug('target %s', targetId)
    const target = browser.targets().find(tg=>{
      return tg._targetId == targetId
    })
    return target
  }
}

