const test = require('tape')
const Client = require('../client')
const Server = require('../server')

const pull = require('pull-stream')

test('Explicit path', t=>{
  const path = '/tmp/my-unix-socket'

  const server = Server({path}, stream =>{
    console.log('connected')
    pull(
      stream,
      pull.map(x=>x.toString().toUpperCase()),
      stream
    )
  }, err=>{
    t.notOk(err)

    pull(
      pull.values(['Hello', 'World']),
      Client({path}),
      pull.collect( (err, data)=>{
        t.notOk(err)
        t.equal(data.toString(), 'HELLOWORLD')
        server.close()
        t.end()
      })
    )
  })

  t.equal(server.path, path)

})
