const http = require('http')
const url = require('url')
const {spawn} = require('child_process')

module.exports = function(page, port, cb) {
  const server = http.createServer(requestHandler)
  server.listen(port, 'localhost', err => {
    if (err) return cb(err)
    console.log('Listening on', port)
    cb(err, server)
  })

  function requestHandler(req, res) {
    console.log('Request', req.url)
    if (req.method !== "GET") {
      res.statusCode = 405 // method not allowed
      return res.end('Invalid method')
    }
    const u = url.parse('http://makeurlparseright.com' + req.url)
    if (u.pathname !== '/screenshot') {
      console.log('Page not found:' + req.url)
      res.statusCode = 404
      return res.end()
    }

    page.screenshot()
      .then( buffer => {
        console.log('Got screenshot')
        const p = spawn(
          '/usr/bin/convert',
          ['png:-', '-resize', '25%',  'png:-']
        )
        res.setHeader('Content-Type', 'image/png')
        //res.setHeader('Content-Size', buffer.length)
        res.setHeader('Access-Control-Allow-Origin', '*')
        
        p.stdout.pipe(res, {end: false})
        let exited = false
        p.on('error', err => {
          if (exited) return
          exited = true
          console.error(err.message)
          res.statusCode = 503
          res.end(err.message)
        })
        p.on('close', code => {
          console.log('exit code', code)
          if (exited) return
          exited = true
          res.statusCode = 200
          res.end()
        })

        p.stdin.write(buffer)
        p.stdin.end()
      })
      .catch( err=>{
        console.log('Screenshot failed', err.message)
        res.statusCode = 503
        res.end(err.message)
      })
  }
}
