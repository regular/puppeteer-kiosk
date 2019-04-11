const http = require('http')
const url = require('url')

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
        res.setHeader('Content-Type', 'image/png')
        res.setHeader('Content-Size', buffer.length)
        res.end(buffer)
      })
      .catch( err=>{
        console.log('Screenshot failed', err.message)
        res.statusCode = 503
        res.end(err.message)
      })
  }
}
