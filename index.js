'use strict'

const fp = require('fastify-plugin')
const readFile = require('fs').readFile
const accessSync = require('fs').accessSync
const resolve = require('path').resolve
const join = require('path').join
const handlebars = require('handlebars')
const promisedHandlebars = require('promised-handlebars')
const { basename, dirname, extname } = require('path')

function fastifyView (fastify, opts, next) {
  const charset = opts.charset || 'utf-8'
  const propertyName = opts.propertyName || 'view'
  const globalOptions = opts.options || {}
  const templatesDir = opts.root || resolve(opts.templates || './')
  const defaultCtx = opts.defaultContext || {}
  const globalLayoutFileName = opts.layout

  const engine = promisedHandlebars(handlebars)

  function layoutIsValid (_layoutFileName) {
    if (!hasAccessToLayoutFile(_layoutFileName)) {
      throw new Error(`unable to access template "${_layoutFileName}"`)
    }
  }

  if (globalLayoutFileName) {
    try {
      layoutIsValid(globalLayoutFileName)
    } catch (error) {
      next(error)
      return
    }
  }

  const renderer = withLayout(viewHandlebars, globalLayoutFileName)

  function viewDecorator () {
    const args = Array.from(arguments)

    let done
    if (typeof args[args.length - 1] === 'function') {
      done = args.pop()
    }

    const promise = new Promise((resolve, reject) => {
      renderer.apply(
        {
          getHeader: () => {},
          header: () => {},
          send: (result) => {
            if (result instanceof Error) {
              reject(result)
              return
            }
            resolve(result)
          }
        },
        args
      )
    })

    if (done && typeof done === 'function') {
      promise.then(done.bind(null, null), done)
      return
    }

    return promise
  }

  fastify.decorate(propertyName, viewDecorator)

  fastify.decorateReply(propertyName, function () {
    renderer.apply(this, arguments)
    return this
  })

  function getPage (page) {
    const filename = basename(page, extname(page))
    return join(dirname(page), filename + '.hbs')
  }

  function isPathExcludedMinification (currentPath, pathsToExclude) {
    return pathsToExclude && Array.isArray(pathsToExclude) ? pathsToExclude.includes(currentPath) : false
  }

  function useHtmlMinification (globalOpts, requestedPath) {
    return (
      globalOptions.useHtmlMinifier &&
      typeof globalOptions.useHtmlMinifier.minify === 'function' &&
      !isPathExcludedMinification(requestedPath, globalOptions.pathsToExcludeHtmlMinifier)
    )
  }

  function getRequestedPath (fastify) {
    return fastify && fastify.request ? fastify.request.context.config.url : null
  }

  // Gets template as string (or precompiled for Handlebars)
  const getTemplate = function (file, callback, requestedPath) {
    readFile(join(templatesDir, file), 'utf-8', (err, data) => {
      if (err) {
        callback(err, null)
        return
      }

      if (useHtmlMinification(globalOptions, requestedPath)) {
        data = globalOptions.useHtmlMinifier.minify(data, globalOptions.htmlMinifierOptions || {})
      }

      if (globalOptions.helpers) {
        Object.keys(globalOptions.helpers).forEach((name) => {
          engine.registerHelper(name, globalOptions.helpers[name])
        })
      }

      const compiledTemplate = engine.compile(data)
      compiledTemplate().then((template) => {
        data = template
        callback(null, data)
      })
    })
  }

  const getPartials = function ({ partials, requestedPath }, callback) {
    let filesToLoad = Object.keys(partials).length
    if (filesToLoad === 0) {
      callback(null, {})
      return
    }
    let error = null
    const partialsHtml = {}
    Object.keys(partials).forEach((key, index) => {
      readFile(join(templatesDir, partials[key]), 'utf-8', (err, data) => {
        if (err) {
          error = err
        }
        if (useHtmlMinification(globalOptions, requestedPath)) {
          data = globalOptions.useHtmlMinifier.minify(data, globalOptions.htmlMinifierOptions || {})
        }

        partialsHtml[key] = data
        if (--filesToLoad === 0) {
          callback(error, partialsHtml)
        }
      })
    })
  }

  function viewHandlebars (page, data, opts) {
    if (opts && opts.layout) {
      try {
        layoutIsValid(opts.layout)
        const that = this
        return withLayout(viewHandlebars, opts.layout).call(that, page, data)
      } catch (error) {
        this.send(error)
        return
      }
    }

    if (!page) {
      this.send(new Error('Missing page'))
      return
    }

    const options = Object.assign({}, globalOptions)
    data = Object.assign({}, defaultCtx, this.locals, data)
    // append view extension
    page = getPage(page)
    const requestedPath = getRequestedPath(this)
    getTemplate(
      page,
      (err, template) => {
        if (err) {
          this.send(err)
          return
        }

        getPartials({ partials: options.partials || {}, requestedPath: requestedPath }, (err, partialsObject) => {
          if (err) {
            this.send(err)
            return
          }

          try {
            Object.keys(partialsObject).forEach((name) => {
              engine.registerPartial(name, engine.compile(partialsObject[name]))
            })

            if (!this.getHeader('content-type')) {
              this.header('Content-Type', 'text/html; charset=' + charset)
            }

            this.send(template)
          } catch (e) {
            this.send(e)
          }
        })
      },
      requestedPath
    )
  }

  next()

  function withLayout (render, layout) {
    if (layout) {
      return function (page, data, opts) {
        if (opts && opts.layout) throw new Error('A layout can either be set globally or on render, not both.')
        const that = this
        data = Object.assign({}, defaultCtx, this.locals, data)
        render.call(
          {
            getHeader: () => {},
            header: () => {},
            send: (result) => {
              if (result instanceof Error) {
                throw result
              }

              data = Object.assign(data || {}, { body: result })
              render.call(that, layout, data, opts)
            }
          },
          page,
          data,
          opts
        )
      }
    }
    return render
  }

  function hasAccessToLayoutFile (fileName) {
    try {
      accessSync(join(templatesDir, getPage(fileName, 'hbs')))

      return true
    } catch (e) {
      return false
    }
  }
}

module.exports = fp(fastifyView, {
  fastify: '3.x',
  name: 'point-of-view'
})
