// Explicitly approved public demo import. The batch signer is read from stdin.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const fromWeb = createRequire(path.join(root, 'web/package.json'));
const fromSwarm = createRequire(fs.realpathSync(path.join(root, 'web/node_modules/@snaha/swarm-id/package.json')));
const { createPublicClient, http, parseAbi } = fromWeb('viem');
const { Bee, Stamper, PrivateKey, Utils } = fromSwarm('@ethersphere/bee-js');
const gateway = 'https://api.gateway.ethswarm.org';
const batchId = '4a0f7f9dbc0f0255fb66868d7b6ba7d7a44356e629a4c0f2226651764f32c53e';
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'demo/.local/new-flow-state.json')));
const pool = deployment.rounds.USDC.pool;
if (!deployment.publicGolemApproved || !/^0x[0-9a-fA-F]{40}$/.test(pool || '')) throw Error('Deploy the new pool and approve public Golem import first.');
const statePath = path.join(root, 'cache/swarm/proposal-upload-' + batchId + '.json');
const receiptsPath = path.join(root, 'swarm/proposal-uploads.json');
const outputPath = path.join(root, 'demo/golem-public-uploads.json');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const save = (file, value) => {
  fs.writeFileSync(file + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(file + '.tmp', file);
};

async function main() {
  const plan = JSON.parse(fs.readFileSync(path.join(root, 'swarm/pool-import-plan.json')));
  const round = plan.rounds.find(r => r.currency === 'USDC');
  if (plan.chainId !== 5042002 || round.proposals.length !== 6) throw Error('Unexpected import target.');
  const bee = new Bee(gateway);
  const prepared = round.proposals.map(row => {
    if (!row.source.startsWith('content/proposals/golem/') || hash(fs.readFileSync(path.join(root, row.source))) !== row.sha256) throw Error('Changed source: ' + row.source);
    const data = Buffer.from(JSON.stringify({ version: 1, title: row.title, body: row.body, attachments: [] }));
    if (data.length > 4096) throw Error('Proposal exceeds this single-chunk uploader.');
    const chunk = bee.makeContentAddressedChunk(data);
    return { row, data, chunk, reference: chunk.address.toHex() };
  });
  const output = { version: 1, chainId: 5042002, pool, encryption: false, batchId, gateway,
    proposals: prepared.map(({ row, data, reference }) => ({ ...row, proposer: deployment.deployer, recipient: deployment.recipient, privateReference: undefined, keyHash: '0x' + '00'.repeat(32),
      contentRef: '0x' + reference, contentSha256: hash(data), url: gateway + '/bytes/' + reference })) };
  if (process.argv.includes('--prepare')) {
    save(outputPath, output);
    console.log('Prepared 6 public Golem JSON proposal documents with original text, budgets, and recipients.');
    return;
  }
  if (!process.argv.includes('--upload')) throw Error('Pass --prepare or --upload.');
  const signer = new PrivateKey(fs.readFileSync(0, 'utf8').trim().replace(/^0x/, ''));
  const rpc = createPublicClient({ transport: http('https://rpc.gnosischain.com') });
  const contract = { address: '0x45a1502382541cd610cc9068e88727426b696293', abi: parseAbi([
    'function batches(bytes32) view returns (address owner,uint8 depth,uint8 bucketDepth,bool immutableFlag,uint256 normalisedBalance,uint256 lastUpdatedBlockNumber)',
    'function currentTotalOutPayment() view returns (uint256)',
  ]) };
  const [chain, batch, paid] = await Promise.all([rpc.getChainId(), rpc.readContract({ ...contract, functionName: 'batches', args: ['0x' + batchId] }), rpc.readContract({ ...contract, functionName: 'currentTotalOutPayment' })]);
  if (chain !== 100 || batch[2] !== 16 || batch[4] <= paid || signer.publicKey().address().toHex().toLowerCase() !== batch[0].slice(2).toLowerCase()) throw Error('Inactive batch or incorrect signer.');
  // Share the original upload counters; never allocate the same stamp slot twice.
  const lock = statePath + '.lock';
  const fd = fs.openSync(lock, 'wx', 0o600);
  try {
    const state = JSON.parse(fs.readFileSync(statePath));
    const receipts = JSON.parse(fs.readFileSync(receiptsPath));
    if (state.batchId !== batchId || state.depth !== batch[1] || state.bucketDepth !== batch[2]) throw Error('Batch state mismatch.');
    for (const [bucket, next] of Object.entries(receipts.stampCounters.nextSlotByBucket)) {
      if ((state.nextSlotByBucket[bucket] || 0) < next) throw Error('Local stamp counters are behind the receipt file.');
    }
    const counters = new Uint32Array(65536);
    for (const [bucket, next] of Object.entries(state.nextSlotByBucket)) counters[Number(bucket)] = next;
    const stamper = Stamper.fromState(signer, batchId, counters, batch[1]);
    function checkpoint() {
      save(statePath, state);
      receipts.stampCounters.nextSlotByBucket = state.nextSlotByBucket;
      receipts.updatedAt = new Date().toISOString();
      save(receiptsPath, receipts);
      save(outputPath, output);
    }
    for (const [i, item] of prepared.entries()) {
      let saved = state.chunks[item.reference];
      if (!saved) {
        const envelope = stamper.stamp({ hash: () => item.chunk.address.toUint8Array() });
        const bucket = Buffer.from(item.chunk.address.toUint8Array()).readUInt16BE(0);
        state.nextSlotByBucket[bucket] = stamper.getState()[bucket];
        saved = state.chunks[item.reference] = { stamp: Utils.convertEnvelopeToMarshaledStamp(envelope).toHex(), bucket,
          slot: state.nextSlotByBucket[bucket] - 1, status: 'pending' };
        checkpoint();
      }
      if (saved.status !== 'uploaded') {
        const response = await fetch(gateway + '/chunks', { method: 'POST',
          headers: { 'content-type': 'application/octet-stream', 'swarm-postage-stamp': saved.stamp, 'swarm-deferred-upload': 'false' },
          body: item.chunk.data, signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw Error('Upload HTTP ' + response.status);
        if ((await response.json()).reference !== item.reference) throw Error('Unexpected uploaded reference.');
        saved.status = 'uploaded'; saved.uploadedAt = new Date().toISOString(); checkpoint();
      }
      const downloaded = await fetch(gateway + '/bytes/' + item.reference, { signal: AbortSignal.timeout(30000) });
      if (!downloaded.ok || !Buffer.from(await downloaded.arrayBuffer()).equals(item.data)) throw Error('Download verification failed: ' + item.row.source);
      output.proposals[i].verifiedAt = new Date().toISOString();
      checkpoint();
      console.log('Uploaded and verified ' + (i + 1) + '/6: ' + item.row.title);
    }
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
main().catch(error => { console.error('Public upload stopped: ' + String(error.shortMessage || error.message).replace(/(?:0x)?[0-9a-fA-F]{64,}/g, '[hex data]').slice(0, 240)); process.exitCode = 1; });
