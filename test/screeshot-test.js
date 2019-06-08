const test = require('tape')
const http = require('http')
const shotserver = require('../screenshot-server')

const PORT = 60080

test('Wrong path', t => {
  shotserver(null, PORT, (err, server) => {
    t.error(err)
    const req = http.request({
      method: 'GET',
      hostname: 'localhost',
      port: PORT,
      path: '/xxx'
    }, res => {
      t.equal(res.statusCode, 404)
      server.close()
      t.end()
    })

    req.on('error', t.error.bind(t))
    req.end()
  })
})

test('Promise rejected', t => {
  const page = {
    screenshot: function() {
      return new Promise( (resolve, reject) => {
        reject(new Error('meh'))
      })
    }
  }

  shotserver(page, PORT, (err, server) => {
    t.error(err)
    const req = http.request({
      method: 'GET',
      hostname: 'localhost',
      port: PORT,
      path: '/screenshot'
    }, res => {
      t.equal(res.statusCode, 503)
      server.close()
      t.end()
    })

    req.on('error', t.error.bind(t))
    req.end()
  })
})

test('Promise resolved', t => {
  const page = {
    screenshot: function() {
      return new Promise( (resolve, reject) => {
        resolve(Buffer.from('yay'))
      })
    }
  }

  shotserver(page, PORT, (err, server) => {
    t.error(err)
    const req = http.request({
      method: 'GET',
      hostname: 'localhost',
      port: PORT,
      path: '/screenshot'
    }, res => {
      t.equal(res.statusCode, 200)
      //console.log(res)
      t.equal(res.headers['content-type'], 'image/png')
      t.equal(res.headers['content-length'], '3')
      server.close()
      t.end()
    })

    req.on('error', t.error.bind(t))
    req.on('data', data =>{
      t.equal(data.toString() == 'yay')
    })
    req.end()
  })
})
