const EventEmitter = require('eventemitter3')
const debug = require('debug')('ilp-plugin-chain:rpc')
const request = require('superagent')

// TODO: when using HTTP RPC the peers should generate a shared secret
// to authenticate requests to one another
// right now that's difficult to do with the Chain SDK API because we
// don't have direct access to the keys to be able to do something like Diffie-Hellman
const NOT_SAFE_NEED_AN_ACTUAL_SHARED_SECRET = 'open sesame'

// TODO: really call it HTTP RPC?
module.exports = class HttpRpc extends EventEmitter {
  constructor (that) {
    super()
    this._methods = {}
    this._that = that

    this.receive = co.wrap(this._receive).bind(this)
    this.call = co.wrap(this._call).bind(this)
  }

  addMethod (name, handler) {
    this._methods[name] = handler
  }

    async _receive (method, params) {
      // TODO: 4XX when method doesn't exist
      debug('got request for', method)
      debug('got params:', params)
      return this._methods[method].apply(this._that, params)
    }

    async _call (rpcUri, method, prefix, params) {
      debug('calling', method, 'with', params)

      const uri = rpcUri + '?method=' + method + '&prefix=' + prefix
      const result = await Promise.race([
        request.post(uri)
          .send(params)
          .auth(NOT_SAFE_NEED_AN_ACTUAL_SHARED_SECRET, { type: 'bearer' })
        new Promise((resolve, reject) => {
          setTimeout(() => {
            reject(new Error('request to ' + uri + ' timed out.'))
          }, 2000)
        })
      ])

      if (result.statusCode !== 200) {
        debug(`error making rpc call to ${uri}:`, result.statusCode, result.body)
        throw new Error('Unexpected status code ' + result.statusCode + ', with body "' + JSON.stringify(result.body) + '"')
      }

      debug(method, 'got result:', result.body)
      return result.body
    }
}
