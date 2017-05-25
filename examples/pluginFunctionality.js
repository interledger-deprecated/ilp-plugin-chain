const PluginChain = require('../')
const crypto = require('crypto')
const moment = require('moment')
const uuid = require('uuid/v4')

const chain = require('chain-sdk')
const client = new chain.Client()
const signer = new chain.HsmSigner()

function hash (fulfillment) {
  const h = crypto.createHash('sha256')
  h.update(Buffer.from(fulfillment, 'base64'))
  return h.digest()
}

const fulfillment = crypto.randomBytes(32).toString('base64')
const condition = hash(fulfillment).toString('base64')
console.log('condition: ', condition, 'fulfillment:', fulfillment)

async function runTest () {
  const sender = new PluginChain({
    accountAlias: 'Alice',
    accountId: 'acc0X1RJTW1008Z0',
    assetAlias: 'Gold',
    assetId: '1fbad4676a71a8326a754422e62e768bada294c324ad91ab481ab241bb48a3d6',
    clientOpts: {
      url: 'http://localhost:1999'
    }
  })

  const receiver = new PluginChain({
    accountAlias: 'Bob',
    accountId: 'acc0X1RJTVS008YW',
    assetAlias: 'Gold',
    assetId: '1fbad4676a71a8326a754422e62e768bada294c324ad91ab481ab241bb48a3d6',
    clientOpts: {
      url: 'http://localhost:1999'
    }
  })

  await sender.connect()
  console.log('sender connected')
  await receiver.connect()
  console.log('receiver connected')
  console.log(`sender balance is: ${await sender.getBalance()}, receiver balance is: ${await receiver.getBalance()}`)

  console.log('submitting first transfer')
  const transfer = {
    id: uuid(),
    from: sender.getAccount(),
    to: receiver.getAccount(),
    ledger: sender.getInfo().prefix,
    amount: 10,
    ilp: 'blah',
    noteToSelf: {
      'just': 'some stuff'
    },
    executionCondition: condition,
    expiresAt: moment().add(5, 'seconds').toISOString(),
    custom: {
      'other': 'thing'
    }
  }

  const receiverFulfilledPromise = new Promise((resolve, reject) => {
    receiver.once('incoming_prepare', async function (transfer) {
      console.log('receiver got incoming prepare notification', transfer)
      console.log(`sender balance is: ${await sender.getBalance()}, receiver balance is: ${await receiver.getBalance()}`)

      console.log('receiver fulfilling first transfer')
      try {
        await receiver.fulfillCondition(transfer.id, fulfillment)
      } catch (err) {
        console.log('error submitting fulfillment', err)
        reject(err)
      }

      console.log(`sender balance is: ${await sender.getBalance()}, receiver balance is: ${await receiver.getBalance()}`)
      resolve()
    })
  })

  await sender.sendTransfer(transfer)
  await receiverFulfilledPromise

  // It will detect if you try to submit a duplicate transaction
  console.log('attempting to send duplicate transfer')
  try {
    const transfer2 = await sender.sendTransfer(transfer)
  } catch (e) {
    console.log('avoided submitting duplicate transfer')
  }
  console.log(`sender balance is: ${await sender.getBalance()}, receiver balance is: ${await receiver.getBalance()}`)

  console.log('sending a transfer that will not be fulfilled')
  const otherTransfer = await sender.sendTransfer(Object.assign({}, transfer, {
    id: uuid()
  }))
  console.log(`sender balance is: ${await sender.getBalance()}, receiver balance is: ${await receiver.getBalance()}`)
  const timedOutPromise = new Promise((resolve) => {
    sender.once('outgoing_reject', (transfer, rejectionMessage) => {
      console.log('sender got outgoing_reject notification with message:', rejectionMessage)
      resolve()
    })
  })
  await timedOutPromise
  console.log(`sender balance is: ${await sender.getBalance()}, receiver balance is: ${await receiver.getBalance()}`)

  console.log('sending a transfer the receiver will reject')
  const transferToReject = await sender.sendTransfer(Object.assign({}, transfer, {
    id: uuid(),
    expiresAt: moment().add(10, 'seconds').toISOString()
  }))

  receiver.once('incoming_prepare', (transfer) => {
    console.log('receiver got prepared notification, now rejecting transfer')
    receiver.rejectIncomingTransfer(transfer.id, {
      code: 'F06',
      name: 'Unexpected Payment',
      message: 'did not like it',
      triggeredBy: receiver.getAccount(),
      triggeredAt: moment().toISOString()
    })
  })

  const rejectedPromise = new Promise((resolve) => {
    sender.once('outgoing_reject', (transfer, rejectionMessage) => {
      console.log('sender got outgoing_reject notification with message:', rejectionMessage)
      resolve()
    })
  })
  await rejectedPromise
  console.log(`sender balance is: ${await sender.getBalance()}, receiver balance is: ${await receiver.getBalance()}`)

  console.log('plugins can also send messages to one another')
  const messagePromise = new Promise((resolve) => {
    receiver.once('incoming_message', (message) => {
      console.log('receiver got message', message)
      resolve()
    })
  })
  await sender.sendMessage({
    to: receiver.getAccount(),
    data: {
      foo: 'bar'
    }
  })
  await messagePromise

  await sender.disconnect()
  await receiver.disconnect()
  console.log('disconnected plugins')
  process.exit()
}

runTest().catch(err => console.log(err))
