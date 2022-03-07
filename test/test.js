'use strict'

const t = require('tap')
const test = t.test
const sget = require('simple-get').concat
const path = require('path')
const Fastify = require('fastify')

test('fastify.view exist', t => {
  t.plan(2)
  const fastify = Fastify()

  fastify.register(require('../index'), {
    engine: {
      ejs: require('ejs')
    }
  })

  fastify.ready(err => {
    t.error(err)
    t.ok(fastify.view)

    fastify.close()
  })
})

test('reply.view exist', t => {
  t.plan(6)
  const fastify = Fastify()

  fastify.register(require('../index'), {})

  fastify.get('/', (req, reply) => {
    t.ok(reply.view)
    reply.send({ hello: 'world' })
  })

  fastify.listen(0, err => {
    t.error(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, response, body) => {
      t.error(err)
      t.equal(response.statusCode, 200)
      t.equal(response.headers['content-length'], '' + body.length)
      t.same(JSON.parse(body), { hello: 'world' })
      fastify.close()
    })
  })
})

test('Possibility to access res.locals variable across all views', t => {
  t.plan(6)
  const fastify = Fastify()

  fastify.register(require('../index'), {
    engine: {
      ejs: require('ejs')
    },
    root: path.join(__dirname, '../templates'),
    layout: 'index-layout-body',
    viewExt: 'ejs'
  })

  fastify.addHook('preHandler', async function (req, reply) {
    reply.locals = {
      content: 'ok'
    }
  })

  fastify.get('/', async (req, reply) => {
    return reply.view('index-layout-content')
  })

  fastify.listen(0, err => {
    t.error(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, response, body) => {
      t.error(err)
      t.equal(response.statusCode, 200)
      t.equal(response.headers['content-length'], '' + body.length)
      t.equal(response.headers['content-type'], 'text/html; charset=utf-8')
      t.equal('ok', body.toString().trim())
      fastify.close()
    })
  })
})

test('reply.view should return 500 if page is missing', t => {
  t.plan(3)
  const fastify = Fastify()

  fastify.register(require('../index'), {})

  fastify.get('/', (req, reply) => {
    reply.view()
  })

  fastify.listen(0, err => {
    t.error(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, response, body) => {
      t.error(err)
      t.equal(response.statusCode, 500)
      fastify.close()
    })
  })
})

test('reply.view should return 500 if layout is set globally and provided on render', t => {
  t.plan(3)
  const fastify = Fastify()
  const data = { text: 'text' }
  fastify.register(require('../index'), {
    layout: 'layout.html'
  })

  fastify.get('/', (req, reply) => {
    reply.view('index-for-layout.ejs', data, { layout: 'layout.html' })
  })

  fastify.listen(0, err => {
    t.error(err)

    sget({
      method: 'GET',
      url: 'http://localhost:' + fastify.server.address().port
    }, (err, response, body) => {
      t.error(err)
      t.equal(response.statusCode, 500)
      fastify.close()
    })
  })
})

test('register callback with handlebars engine should throw if layout file does not exist', t => {
  t.plan(2)
  const fastify = Fastify()

  fastify.register(require('../index'), {
    layout: './templates/does-not-exist.hbs'
  }).ready(err => {
    t.ok(err instanceof Error)
    t.same('unable to access template "./templates/does-not-exist.hbs"', err.message)
  })
})

test('plugin is registered with "point-of-view" name', t => {
  t.plan(2)
  const fastify = Fastify()

  fastify.register(require('../index'), {
  })

  fastify.ready(err => {
    t.error(err)

    const kRegistedPlugins = Symbol.for('registered-plugin')
    const registeredPlugins = fastify[kRegistedPlugins]
    t.ok(registeredPlugins.find(name => name === 'point-of-view'))

    fastify.close()
  })
})
